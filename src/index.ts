import { dirname } from 'node:path';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type {
  PluginApi,
  PluginConfig,
  PluginLogger,
  PluginHookBeforeModelResolveResult,
  ProviderModelEntry,
} from './types';
import {
  clearMainConversationSessionBindings,
  clearSpecificSessionBinding,
  getUserOriginalModel,
  injectProviderConfig,
  setSpecificSessionBinding,
  updateRuntimeModelConfig,
} from './provider-inject';
import { classifyMessage, isRoutingBypassCommand, shouldBypassAutomaticRouting, startServer } from './server';
import { getCategories, previewRouteCategory, restore } from './router-bridge';

const AUTO_MODEL: ProviderModelEntry = {
  id: 'auto',
  name: 'OpenMark Auto Router',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 2_000_000,
  maxTokens: 128_000,
};
const AUTO_PROVIDER_ID = 'openmark';
const AUTO_MODEL_ID = 'auto';
const AUTO_MODEL_KEY = `${AUTO_PROVIDER_ID}/${AUTO_MODEL_ID}`;
const CLASSIFIER_SESSION_MARKER = 'openmark-classify-';
const CLASSIFIER_PROMPT_MARKER = 'openmark_classifier_internal';
const RETRY_PROMPT_MARKERS = [
  'continue where you left off. the previous model attempt failed or timed out',
  'the previous model attempt failed or timed out',
];
const INTERNAL_SESSION_MARKERS = ['slug-generator', CLASSIFIER_SESSION_MARKER, CLASSIFIER_PROMPT_MARKER];
const BEFORE_DISPATCH_DEDUPE_TTL_MS = 30_000;
const BEFORE_DISPATCH_DEDUPE_PRUNE_INTERVAL_MS = 5_000;
const SAME_TURN_ROUTE_TTL_MS = 30_000;
let loggedResolveEventShape = false;
let _replyRuntimeBridge: any | null | undefined = undefined;
const recentBeforeDispatchReplies = new Map<string, number>();
let lastBeforeDispatchDedupePruneAt = 0;
const pendingCliRouteCards = new Map<string, string>();
const pendingCliRouteRestores = new Set<string>();
const activeCliRoutedRuns = new Set<string>();
let pendingSameTurnResolve:
  | {
    providerOverride?: string;
    modelOverride: string;
    messageSnippet: string;
    expiresAt: number;
  }
  | null = null;

type RepoConfigCacheEntry = {
  mtimeMs: number;
  size: number;
  value: Record<string, unknown>;
};

const repoConfigCache = new Map<string, RepoConfigCacheEntry>();

function resolveConfigObject(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  return (
    raw && typeof raw === 'object' && 'config' in raw && raw.config != null && typeof raw.config === 'object'
      ? (raw.config as Record<string, unknown>)
      : (raw ?? {}) as Record<string, unknown>
  );
}

function readRepoConfig(pluginDir: string, logger: PluginLogger): Record<string, unknown> {
  const configPath = join(pluginDir, 'config.json');
  if (!existsSync(configPath)) {
    repoConfigCache.delete(configPath);
    return {};
  }

  try {
    const stat = statSync(configPath);
    const cached = repoConfigCache.get(configPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value;
    }
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    const value = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    repoConfigCache.set(configPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      value,
    });
    return value;
  } catch (err: unknown) {
    repoConfigCache.delete(configPath);
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] Failed to read config.json: ${msg}`);
    return {};
  }
}

function parseConfig(
  raw: Record<string, unknown> | undefined,
  pluginDir: string,
  logger: PluginLogger,
): PluginConfig {
  const pluginConfig = resolveConfigObject(raw);
  const repoConfig = readRepoConfig(pluginDir, logger);

  // Use config.json as the source of truth so the TS runtime and router.py
  // stay aligned; plugin entry values only fill gaps.
  const inner = { ...pluginConfig, ...repoConfig };

  return {
    classifier_model:
      typeof inner.classifier_model === 'string' && inner.classifier_model.length > 0
        ? inner.classifier_model
        : '',
    no_route_passthrough:
      typeof inner.no_route_passthrough === 'string' && inner.no_route_passthrough.length > 0
        ? inner.no_route_passthrough
        : '',
    port:
      typeof inner.port === 'number' && inner.port > 0
        ? inner.port
        : 2098,
    gateway_port:
      typeof inner.gateway_port === 'number' && inner.gateway_port > 0
        ? inner.gateway_port
        : 18789,
    show_routing_card:
      typeof inner.show_routing_card === 'boolean'
        ? inner.show_routing_card
        : true,
    restore_delay_s:
      typeof inner.restore_delay_s === 'number' && inner.restore_delay_s > 0
        ? inner.restore_delay_s
        : 30,
  };
}

function resolvePluginDir(): string {
  try {
    return dirname(__dirname);
  } catch {
    return process.cwd();
  }
}

function resolveReplyRuntimeBridge(): any | null {
  if (_replyRuntimeBridge !== undefined) {
    return _replyRuntimeBridge;
  }

  const probeSpecifiers = [
    process.argv[1],
    require.main?.filename,
    __filename,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const specifier of probeSpecifiers) {
    try {
      const runtimeRequire = createRequire(specifier);
      _replyRuntimeBridge = runtimeRequire('openclaw/plugin-sdk/reply-runtime');
      return _replyRuntimeBridge;
    } catch {
      // Try the next host entrypoint.
    }
  }

  _replyRuntimeBridge = null;
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const plugin = {
  id: 'openmark-router',
  name: 'OpenMark AI Router',

  register(api: PluginApi) {
    const logger: PluginLogger = api.logger || {
      info: (...args: unknown[]) => console.log(...args),
      debug: () => {},
      error: (...args: unknown[]) => console.error(...args),
      warn: (...args: unknown[]) => console.warn(...args),
    };

    const pluginDir = resolvePluginDir();
    const config = parseConfig(api.pluginConfig, pluginDir, logger);

    logger.info('[openmark-router] Initializing v7 hybrid router');
    logger.debug(`[openmark-router] Plugin API methods: ${Object.keys(api).join(', ')}`);

    const rt = (api as any).runtime;
    if (rt && typeof rt === 'object') {
      logger.debug(`[openmark-router] runtime keys: ${Object.keys(rt).join(', ')}`);
      if (rt.subagent && typeof rt.subagent === 'object') {
        logger.debug(`[openmark-router] runtime.subagent keys: ${Object.keys(rt.subagent).join(', ')}`);
      }
    }
    logger.info(`[openmark-router] Classifier: ${config.classifier_model || '(user default — resolved at runtime)'}`);
    logger.info(`[openmark-router] Passthrough: ${config.no_route_passthrough || '(user default — resolved at runtime)'}`);
    logger.info(`[openmark-router] Server port: ${config.port}, Gateway port: ${config.gateway_port}`);

    registerProvider(api, config, logger);

    injectProviderConfig(api, `http://127.0.0.1:${config.port}/v1`, config.port, logger, pluginDir);

    registerBeforeDispatchHook(api, config, pluginDir, logger);
    registerCliRoutingHooks(api, config, pluginDir, logger);
    registerRestoreHook(api, config, pluginDir, logger);

    const routerPy = join(pluginDir, 'scripts', 'router.py');
    if (!existsSync(routerPy)) {
      logger.warn(`[openmark-router] router.py not found at ${routerPy} — routing will not work`);
    }

    const runtime = (api as any).runtime;

    api.registerService({
      id: 'openmark-router',
      start: async () => {
        startServer(config, pluginDir, logger, runtime);

        const categories = await getCategories(pluginDir, logger);
        if (categories.length > 0) {
          logger.info(`[openmark-router] ${categories.length} benchmark categories loaded`);
        } else {
          logger.warn(
            '[openmark-router] No benchmark categories found. ' +
            'Place OpenMark AI CSV exports in the benchmarks/ directory.',
          );
        }

        logger.info('[openmark-router] Routing active');
      },
    });
  },
};

function registerProvider(api: PluginApi, config: PluginConfig, logger: PluginLogger): void {
  if (typeof api.registerProvider !== 'function') {
    logger.warn('[openmark-router] registerProvider not available in this OpenClaw version');
    return;
  }

  try {
    api.registerProvider({
      id: 'openmark',
      label: 'OpenMark AI Router',
      models: {
        baseUrl: `http://127.0.0.1:${config.port}/v1`,
        api: 'openai-completions',
        models: [AUTO_MODEL],
      },
    });

    logger.info('[openmark-router] Registered as provider (model: openmark/auto)');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] registerProvider failed: ${msg}`);
  }
}

type RoutingState = {
  manual?: boolean;
  routed_model?: string;
  routed_at?: string;
  remaining_concrete_turns?: number;
};

function collectEventStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || out.length >= 40) {
    return;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      out.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEventStrings(item, out, depth + 1);
      if (out.length >= 40) return;
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectEventStrings(item, out, depth + 1);
      if (out.length >= 40) return;
    }
  }
}

function summarizeResolveEvent(event: unknown): { keys: string[]; strings: string[]; joined: string } {
  const keys = event && typeof event === 'object' ? Object.keys(event as Record<string, unknown>) : [];
  const strings: string[] = [];
  collectEventStrings(event, strings);
  return { keys, strings, joined: strings.join(' | ').toLowerCase() };
}

function isInternalResolveEvent(summary: { joined: string }): boolean {
  return INTERNAL_SESSION_MARKERS.some(marker => summary.joined.includes(marker.toLowerCase()));
}

function isClassifierResolveEvent(summary: { joined: string }): boolean {
  return (
    summary.joined.includes(CLASSIFIER_PROMPT_MARKER) ||
    summary.joined.includes(CLASSIFIER_SESSION_MARKER.toLowerCase()) ||
    RETRY_PROMPT_MARKERS.some(marker => summary.joined.includes(marker))
  );
}

function splitModelId(modelId: string): { provider?: string; model: string } {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) {
    return { model: modelId };
  }

  return {
    provider: modelId.slice(0, slashIdx),
    model: modelId.slice(slashIdx + 1),
  };
}

function getConcreteClassifierOverride(config: PluginConfig): PluginHookBeforeModelResolveResult | null {
  const classifierModel = config.classifier_model || getUserOriginalModel();
  if (!classifierModel || classifierModel.toLowerCase() === AUTO_MODEL_KEY) {
    return null;
  }

  const { provider, model } = splitModelId(classifierModel);
  return {
    providerOverride: provider,
    modelOverride: model,
  };
}

function cloneConfigWithModelOverride(
  cfg: Record<string, unknown>,
  primary: string,
  fallbacks: string[],
): Record<string, unknown> {
  const cloned = typeof structuredClone === 'function'
    ? structuredClone(cfg ?? {}) as Record<string, unknown>
    : JSON.parse(JSON.stringify(cfg ?? {})) as Record<string, unknown>;
  if (!cloned.agents || typeof cloned.agents !== 'object') cloned.agents = {};
  const agents = cloned.agents as Record<string, unknown>;
  if (!agents.defaults || typeof agents.defaults !== 'object') agents.defaults = {};
  const defaults = agents.defaults as Record<string, unknown>;
  if (!defaults.model || typeof defaults.model !== 'object') defaults.model = {};
  const model = defaults.model as Record<string, unknown>;
  model.primary = primary;
  model.fallbacks = fallbacks;
  return cloned;
}

function buildConversationAddress(
  channelId: string | undefined,
  conversationId: string | undefined,
  senderId: string | undefined,
): string | undefined {
  const channel = channelId?.trim();
  const target = conversationId?.trim() || senderId?.trim();
  if (!channel || !target) {
    return undefined;
  }
  return `${channel}:${target}`;
}

function buildBeforeDispatchContext(event: any, ctx: any): Record<string, unknown> {
  const channelId = typeof ctx?.channelId === 'string'
    ? ctx.channelId
    : typeof event?.channel === 'string'
      ? event.channel
      : 'unknown';
  const senderId = typeof event?.senderId === 'string'
    ? event.senderId
    : typeof ctx?.senderId === 'string'
      ? ctx.senderId
      : undefined;
  const destination = buildConversationAddress(channelId, ctx?.conversationId, senderId);
  const body = typeof event?.body === 'string' && event.body.trim()
    ? event.body.trim()
    : typeof event?.content === 'string'
      ? event.content.trim()
      : '';

  return {
    Body: body,
    BodyForAgent: body,
    RawBody: body,
    CommandBody: body,
    BodyForCommands: body,
    From: destination,
    To: destination,
    SessionKey: typeof ctx?.sessionKey === 'string' ? ctx.sessionKey : undefined,
    AccountId: typeof ctx?.accountId === 'string' ? ctx.accountId : undefined,
    SenderId: senderId,
    Timestamp: typeof event?.timestamp === 'number' ? event.timestamp : undefined,
    Provider: channelId,
    Surface: channelId,
    OriginatingChannel: channelId,
    OriginatingTo: destination,
    ChatType: event?.isGroup ? 'group' : 'direct',
    CommandAuthorized: false,
  };
}

function replyPayloadsToText(reply: unknown): string {
  const payloads = Array.isArray(reply) ? reply : [reply];
  return payloads
    .filter((payload): payload is Record<string, unknown> => typeof payload === 'object' && payload !== null)
    .filter(payload => payload.isReasoning !== true && payload.isCompactionNotice !== true)
    .map(payload => typeof payload.text === 'string' ? payload.text.trim() : '')
    .filter(Boolean)
    .join('\n\n');
}

function normalizeFallbackModels(fallbacks: unknown): string[] {
  if (!Array.isArray(fallbacks)) {
    return [];
  }
  return fallbacks
    .map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).model === 'string') {
        return ((item as Record<string, unknown>).model as string).trim();
      }
      return '';
    })
    .filter(Boolean);
}

function extractCurrentModelDefaults(cfg: Record<string, unknown>): { primary: string; fallbacks: string[] } {
  const primary = typeof (cfg.agents as any)?.defaults?.model?.primary === 'string'
    ? ((cfg.agents as any).defaults.model.primary as string)
    : AUTO_MODEL_KEY;
  const fallbacks = Array.isArray((cfg.agents as any)?.defaults?.model?.fallbacks)
    ? ((cfg.agents as any).defaults.model.fallbacks as unknown[])
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim())
    : [];
  return { primary, fallbacks };
}

function getCliRouteStateKey(ctx: any): string | null {
  const candidates = [
    ctx?.sessionKey,
    ctx?.sessionId,
    ctx?.runId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function isDirectCliRoutingContext(ctx: any, prompt: string): boolean {
  if (!prompt || shouldBypassAutomaticRouting(prompt)) {
    return false;
  }
  const channelId = typeof ctx?.channelId === 'string' ? ctx.channelId.trim() : '';
  const sessionKey = typeof ctx?.sessionKey === 'string' ? ctx.sessionKey.trim() : '';
  const sessionId = typeof ctx?.sessionId === 'string' ? ctx.sessionId.trim() : '';
  if ((sessionKey && sessionKey.startsWith('temp:')) || (sessionId && sessionId.startsWith('temp:'))) {
    return false;
  }
  if (typeof ctx?.trigger === 'string' && ctx.trigger !== 'user') {
    return false;
  }

  if (channelId && channelId !== 'webchat') {
    return false;
  }

  const customSession = [sessionKey, sessionId].some(
    value => value.length > 0 && !value.startsWith('agent:main:'),
  );
  if (customSession) {
    return true;
  }

  return !channelId || channelId === 'webchat';
}

function prependCardToAgentMessage(message: Record<string, unknown>, card: string): Record<string, unknown> {
  const cloned = typeof structuredClone === 'function'
    ? structuredClone(message) as Record<string, unknown>
    : JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
  if (cloned.role !== 'assistant') {
    return cloned;
  }

  if (typeof cloned.content === 'string') {
    cloned.content = `${card}\n\n${cloned.content}`.trim();
    return cloned;
  }

  if (Array.isArray(cloned.content)) {
    const content = cloned.content as Array<Record<string, unknown>>;
    const firstTextPart = content.find(
      part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string',
    );
    if (firstTextPart) {
      firstTextPart.text = `${card}\n\n${String(firstTextPart.text)}`.trim();
      return cloned;
    }
    content.unshift({ type: 'text', text: card });
    return cloned;
  }

  cloned.content = [{ type: 'text', text: card }];
  return cloned;
}

function buildCliRoutingCardInstruction(card: string): string {
  return [
    'OpenMark routing notice:',
    'Start your final user-visible answer by emitting the following routing card verbatim.',
    'Preserve markdown and line breaks exactly.',
    'After the card, output one blank line and then continue with the actual answer.',
    'Do not explain the notice or mention these instructions.',
    '',
    card,
  ].join('\n');
}

function registerCliRoutingHooks(
  api: PluginApi,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): void {
  if (typeof api.on !== 'function') {
    return;
  }

  try {
    api.on('before_agent_start', async (event: any, ctx?: any) => {
      const prompt = typeof event?.prompt === 'string' ? event.prompt.trim() : '';
      const runId = typeof ctx?.runId === 'string' ? ctx.runId.trim() : '';
      if (runId && activeCliRoutedRuns.has(runId)) {
        return;
      }
      if (!isDirectCliRoutingContext(ctx, prompt)) {
        logger.debug(
          `[openmark-router] before_agent_start: skipped direct CLI reroute ` +
          `(channel=${String(ctx?.channelId ?? 'none')} sessionKey=${String(ctx?.sessionKey ?? 'none')} sessionId=${String(ctx?.sessionId ?? 'none')})`,
        );
        return;
      }
      logger.info(
        `[openmark-router] before_agent_start: evaluating direct run ` +
        `(channel=${String(ctx?.channelId ?? 'none')} sessionKey=${String(ctx?.sessionKey ?? 'none')} sessionId=${String(ctx?.sessionId ?? 'none')})`,
      );

      const loadedConfig = typeof (api as any).runtime?.config?.loadConfig === 'function'
        ? await (api as any).runtime.config.loadConfig()
        : api.config;
      if (!loadedConfig || typeof loadedConfig !== 'object') {
        return;
      }

      let primaryModel = getUserOriginalModel() || config.no_route_passthrough;
      let fallbackModels: string[] = [];
      let routingCard = '';
      let decision: { kind: 'match' | 'none' | 'error'; category?: string; reason?: string };

      if (prompt.length < 10) {
        logger.info('[openmark-router] before_agent_start short message — using passthrough model without classification');
        decision = { kind: 'none' };
      } else {
        decision = await classifyMessage(
          prompt,
          config,
          pluginDir,
          logger,
          loadedConfig as Record<string, unknown>,
        );
        if (decision.kind === 'error') {
          logger.warn(`[openmark-router] before_agent_start classification failed: ${decision.reason}`);
          return;
        }
      }

      if (decision.kind === 'match' && decision.category) {
        const recommendation = await previewRouteCategory(decision.category, pluginDir, logger);
        if (!recommendation || recommendation.status !== 'ok') {
          logger.warn('[openmark-router] before_agent_start route preview failed');
          return;
        }
        primaryModel = typeof recommendation.model === 'string'
          ? recommendation.model
          : typeof recommendation.model_set === 'string'
            ? recommendation.model_set
            : primaryModel;
        fallbackModels = normalizeFallbackModels(recommendation.fallbacks);
        routingCard = config.show_routing_card && typeof recommendation.card === 'string'
          ? recommendation.card.trim()
          : '';
        logger.info(`[openmark-router] before_agent_start routed current CLI turn to ${primaryModel}`);
      } else {
        logger.info(`[openmark-router] before_agent_start no route match — using ${primaryModel}`);
      }

      if (!primaryModel || primaryModel.toLowerCase() === AUTO_MODEL_KEY) {
        return;
      }

      updateRuntimeModelConfig(api, primaryModel, fallbackModels, logger);
      const routeKey = getCliRouteStateKey(ctx);
      if (runId) {
        activeCliRoutedRuns.add(runId);
      }
      if (routeKey) {
        pendingCliRouteRestores.add(routeKey);
        if (routingCard) {
          pendingCliRouteCards.set(routeKey, routingCard);
        } else {
          pendingCliRouteCards.delete(routeKey);
        }
      }

      const { provider, model } = splitModelId(primaryModel);
      const cliRoutingInstruction = routingCard ? buildCliRoutingCardInstruction(routingCard) : undefined;
      return {
        providerOverride: provider,
        modelOverride: model,
        appendSystemContext: cliRoutingInstruction,
      };
    }, { priority: 70 });

    api.on('before_message_write', (event: any, ctx?: any) => {
      const routeKey = getCliRouteStateKey(ctx);
      if (!routeKey) {
        return;
      }
      const card = pendingCliRouteCards.get(routeKey);
      if (!card || !event?.message || typeof event.message !== 'object') {
        return;
      }

      const message = event.message as Record<string, unknown>;
      if (message.role !== 'assistant') {
        return;
      }

      pendingCliRouteCards.delete(routeKey);
      return {
        message: prependCardToAgentMessage(message, card),
      };
    }, { priority: 70 });

    api.on('agent_end', async (_event: any, ctx?: any) => {
      const routeKey = getCliRouteStateKey(ctx);
      if (typeof ctx?.runId === 'string' && ctx.runId.trim()) {
        activeCliRoutedRuns.delete(ctx.runId.trim());
      }
      if (!routeKey || !pendingCliRouteRestores.has(routeKey)) {
        return;
      }

      pendingCliRouteRestores.delete(routeKey);
      pendingCliRouteCards.delete(routeKey);
      updateRuntimeModelConfig(api, AUTO_MODEL_KEY, [], logger);
      if (typeof ctx?.sessionKey === 'string' && ctx.sessionKey.trim()) {
        clearSpecificSessionBinding(ctx.sessionKey.trim(), logger, 'cli-restore');
      }
      logger.info('[openmark-router] Restored CLI runtime default model to openmark/auto after routed turn');
    }, { priority: 70 });

    logger.info('[openmark-router] Registered CLI routing hooks for direct same-turn handoff');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] CLI routing hook registration failed: ${msg}`);
  }
}

function buildBeforeDispatchDedupeKey(event: any, ctx: any, body: string): string | null {
  const sessionKey = typeof ctx?.sessionKey === 'string' ? ctx.sessionKey.trim() : '';
  const channelId = typeof ctx?.channelId === 'string'
    ? ctx.channelId.trim()
    : typeof event?.channel === 'string'
      ? event.channel.trim()
      : '';
  const senderId = typeof ctx?.senderId === 'string'
    ? ctx.senderId.trim()
    : typeof event?.senderId === 'string'
      ? event.senderId.trim()
      : '';
  if (!body || (!sessionKey && !channelId)) {
    return null;
  }
  return [sessionKey, channelId, senderId, body].filter(Boolean).join('|');
}

function wasRecentlyHandledBeforeDispatch(key: string | null): boolean {
  if (!key) {
    return false;
  }
  const now = Date.now();
  if (now - lastBeforeDispatchDedupePruneAt >= BEFORE_DISPATCH_DEDUPE_PRUNE_INTERVAL_MS) {
    lastBeforeDispatchDedupePruneAt = now;
    for (const [entryKey, timestamp] of recentBeforeDispatchReplies.entries()) {
      if (now - timestamp > BEFORE_DISPATCH_DEDUPE_TTL_MS) {
        recentBeforeDispatchReplies.delete(entryKey);
      }
    }
  }
  const handledAt = recentBeforeDispatchReplies.get(key);
  return typeof handledAt === 'number' && now - handledAt <= BEFORE_DISPATCH_DEDUPE_TTL_MS;
}

function rememberBeforeDispatchHandled(key: string | null): void {
  if (!key) {
    return;
  }
  recentBeforeDispatchReplies.set(key, Date.now());
}

function rememberSameTurnResolve(modelId: string, messageBody: string): void {
  const { provider, model } = splitModelId(modelId);
  pendingSameTurnResolve = {
    providerOverride: provider,
    modelOverride: model,
    messageSnippet: messageBody.trim().toLowerCase().slice(0, 120),
    expiresAt: Date.now() + SAME_TURN_ROUTE_TTL_MS,
  };
}

function takePendingSameTurnResolve(summary: { joined: string }): PluginHookBeforeModelResolveResult | null {
  if (!pendingSameTurnResolve) {
    return null;
  }

  if (Date.now() > pendingSameTurnResolve.expiresAt) {
    pendingSameTurnResolve = null;
    return null;
  }

  const snippet = pendingSameTurnResolve.messageSnippet;
  if (snippet && !summary.joined.includes(snippet)) {
    return null;
  }

  const result: PluginHookBeforeModelResolveResult = {
    providerOverride: pendingSameTurnResolve.providerOverride,
    modelOverride: pendingSameTurnResolve.modelOverride,
  };
  pendingSameTurnResolve = null;
  return result;
}

function registerBeforeDispatchHook(
  api: PluginApi,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): void {
  if (typeof api.on !== 'function') {
    logger.warn('[openmark-router] api.on() not available — before_dispatch routing disabled');
    return;
  }

  try {
    api.on('before_dispatch', async (event: any, ctx?: any) => {
      const body = typeof event?.body === 'string' && event.body.trim()
        ? event.body.trim()
        : typeof event?.content === 'string'
          ? event.content.trim()
          : '';

      if (!body) {
        return;
      }

      if (typeof ctx?.sessionKey === 'string' && ctx.sessionKey.startsWith('temp:')) {
        return;
      }

      if (ctx?.channelId === 'openmark' || event?.channel === 'openmark') {
        logger.debug('[openmark-router] before_dispatch: openmark provider traffic detected — skipping reroute');
        return;
      }

      if (isRoutingBypassCommand(body)) {
        logger.debug('[openmark-router] before_dispatch: slash command detected — leaving default flow untouched');
        return;
      }

      if (shouldBypassAutomaticRouting(body)) {
        logger.debug('[openmark-router] before_dispatch: internal/system message detected — leaving default flow untouched');
        return;
      }

      const dedupeKey = buildBeforeDispatchDedupeKey(event, ctx, body);
      if (wasRecentlyHandledBeforeDispatch(dedupeKey)) {
        logger.debug('[openmark-router] before_dispatch: suppressing duplicate handled reply');
        return { handled: true, text: '' };
      }

      const replyRuntimeBridge = resolveReplyRuntimeBridge();
      if (!replyRuntimeBridge?.getReplyFromConfig || !replyRuntimeBridge?.finalizeInboundContext) {
        logger.warn('[openmark-router] before_dispatch: OpenClaw reply runtime unavailable');
        return;
      }

      const runtime = (api as any).runtime;
      const loadedConfig = typeof runtime?.config?.loadConfig === 'function'
        ? await runtime.config.loadConfig()
        : api.config;
      if (!loadedConfig || typeof loadedConfig !== 'object') {
        logger.warn('[openmark-router] before_dispatch: current OpenClaw config unavailable');
        return { handled: true, text: 'Routing is temporarily unavailable. Please try again.' };
      }

      let primaryModel = getUserOriginalModel() || config.no_route_passthrough;
      let fallbackModels: string[] = [];
      let routingCard = '';
      let decision: { kind: 'match' | 'none' | 'error'; category?: string; reason?: string };

      logger.info(`[openmark-router] before_dispatch: evaluating "${body.slice(0, 80)}..."`);

      if (body.length < 10) {
        logger.info('[openmark-router] before_dispatch short message — using passthrough model without classification');
        decision = { kind: 'none' };
      } else {
        decision = await classifyMessage(
          body,
          config,
          pluginDir,
          logger,
          loadedConfig as Record<string, unknown>,
        );
        if (decision.kind === 'error') {
          logger.warn(`[openmark-router] before_dispatch classification failed: ${decision.reason}`);
          return { handled: true, text: 'Routing is temporarily unavailable. Please try again.' };
        }
      }

      if (decision.kind === 'match' && decision.category) {
        const recommendation = await previewRouteCategory(decision.category, pluginDir, logger);
        if (!recommendation || recommendation.status !== 'ok') {
          logger.warn('[openmark-router] before_dispatch route preview failed');
          return { handled: true, text: 'Routing failed for this request. Please try again.' };
        }

        primaryModel = typeof recommendation.model === 'string'
          ? recommendation.model
          : typeof recommendation.model_set === 'string'
            ? recommendation.model_set
            : primaryModel;
        fallbackModels = normalizeFallbackModels(recommendation.fallbacks);
        routingCard = config.show_routing_card && typeof recommendation.card === 'string'
          ? recommendation.card.trim()
          : '';
        logger.info(`[openmark-router] before_dispatch routed same turn to ${primaryModel}`);
        if (primaryModel.toLowerCase() !== AUTO_MODEL_KEY) {
          rememberSameTurnResolve(primaryModel, body);
        }
      } else {
        logger.info(`[openmark-router] before_dispatch no route match — using ${primaryModel}`);
      }

      if (!primaryModel) {
        logger.warn('[openmark-router] before_dispatch: no concrete model available for reply');
        return { handled: true, text: 'Routing is temporarily unavailable. Please try again.' };
      }

      const configOverride = cloneConfigWithModelOverride(
        loadedConfig as Record<string, unknown>,
        primaryModel,
        fallbackModels,
      );
      const sessionKey = typeof ctx?.sessionKey === 'string' ? ctx.sessionKey.trim() : '';
      const primarySplit = splitModelId(primaryModel);
      let sessionBindingApplied = false;
      const runtimeModelApplied = primaryModel.toLowerCase() !== AUTO_MODEL_KEY;
      if (
        sessionKey
        && primarySplit.provider
        && primarySplit.model
        && primaryModel.toLowerCase() !== AUTO_MODEL_KEY
      ) {
        sessionBindingApplied = setSpecificSessionBinding(
          sessionKey,
          primarySplit.provider,
          primarySplit.model,
          logger,
          'same-turn-route',
        );
      }
      if (runtimeModelApplied) {
        updateRuntimeModelConfig(api, primaryModel, fallbackModels, logger);
      }
      const dispatchContext = replyRuntimeBridge.finalizeInboundContext(buildBeforeDispatchContext(event, ctx));
      let reply: unknown;
      try {
        reply = await replyRuntimeBridge.getReplyFromConfig(
          dispatchContext,
          {
            suppressTyping: true,
            onModelSelected: (selected: { provider?: string; model?: string }) => {
              logger.info(
                `[openmark-router] before_dispatch reply selected ${selected.provider ?? 'unknown'}/${selected.model ?? 'unknown'}`,
              );
            },
          },
          configOverride,
        );
      } finally {
        if (sessionBindingApplied && sessionKey) {
          clearSpecificSessionBinding(sessionKey, logger, 'runtime-restore');
        }
        if (runtimeModelApplied) {
          updateRuntimeModelConfig(api, AUTO_MODEL_KEY, [], logger);
        }
      }

      const replyText = replyPayloadsToText(reply);
      const finalText = [routingCard, replyText].filter(Boolean).join('\n\n').trim();

      if (!finalText) {
        logger.debug('[openmark-router] before_dispatch produced no reply text');
        rememberBeforeDispatchHandled(dedupeKey);
        return { handled: true, text: routingCard || '' };
      }

      rememberBeforeDispatchHandled(dedupeKey);
      return { handled: true, text: finalText };
    }, { priority: 60 });

    logger.info('[openmark-router] Registered before_dispatch hook for same-turn routing handoff');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] before_dispatch hook registration failed: ${msg}`);
  }
}

function isLikelyUserConversationResolve(summary: { joined: string }): boolean {
  const joined = summary.joined;
  if (!joined) return false;

  if (isInternalResolveEvent(summary)) return false;

  return [
    'agent:main:',
    'telegram',
    'webchat',
    'direct:',
    'sessionid',
    'conversation',
  ].some(token => joined.includes(token));
}

function readRoutingState(pluginDir: string): RoutingState | null {
  const statePath = join(pluginDir, '.routing_state.json');
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statePath, 'utf-8')) as RoutingState;
  } catch {
    return null;
  }
}

function writeRoutingState(pluginDir: string, state: RoutingState): void {
  const statePath = join(pluginDir, '.routing_state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Register a before_model_resolve hook that auto-restores openmark/auto
 * after the routed model has been used (Turn 2).
 *
 * The hook fires before model resolution on every turn. If routing state
 * exists, it calls --restore to write openmark/auto back. The config
 * change takes effect via hot-reload, so the CURRENT turn still uses the
 * routed model (intended for Turn 2), and the NEXT turn goes back to
 * openmark/auto.
 *
 * Falls back to a timer if api.on() is not available.
 */
function registerRestoreHook(
  api: PluginApi,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): void {
  if (typeof api.on !== 'function') {
    logger.warn('[openmark-router] api.on() not available — falling back to timer-based restore');
    logger.info(`[openmark-router] Timer restore delay: ${config.restore_delay_s}s`);
    return;
  }

  try {
    api.on(
      'before_model_resolve',
      async (event) => {
        const summary = summarizeResolveEvent(event);
        if (!loggedResolveEventShape) {
          loggedResolveEventShape = true;
          logger.debug(
            `[openmark-router] before_model_resolve keys: ${summary.keys.join(', ') || '(none)'}; strings: ${summary.strings.slice(0, 10).join(' | ') || '(none)'}`,
          );
        }

        if (isClassifierResolveEvent(summary)) {
          const classifierOverride = getConcreteClassifierOverride(config);
          if (classifierOverride) {
            logger.debug(
              `[openmark-router] Forcing classifier internal resolve to ${classifierOverride.providerOverride}/${classifierOverride.modelOverride}`,
            );
            return classifierOverride;
          }
          logger.debug('[openmark-router] Classifier internal resolve detected but no concrete override is available');
          return;
        }

        if (isInternalResolveEvent(summary)) {
          logger.debug('[openmark-router] Internal subagent/system resolve detected — skipping override/restore');
          return;
        }

        if (isLikelyUserConversationResolve(summary)) {
          const pendingResolve = takePendingSameTurnResolve(summary);
          if (pendingResolve) {
            logger.info(
              `[openmark-router] Re-applying same-turn concrete model handoff for ` +
              `${pendingResolve.providerOverride ?? 'unknown'}/${pendingResolve.modelOverride ?? 'unknown'}`,
            );
            return pendingResolve;
          }
        }

        const state = readRoutingState(pluginDir);
        if (!state) {
          if (isLikelyUserConversationResolve(summary)) {
            logger.debug('[openmark-router] Real user turn resolve observed; not overriding live session');
          }
          return;
        }

        if (state.manual) {
          logger.debug('[openmark-router] Manual lock active — skipping restore');
          return;
        }

        if (isLikelyUserConversationResolve(summary)) {
          const remainingConcreteTurns = Math.max(0, state.remaining_concrete_turns ?? 1);
          if (remainingConcreteTurns > 0) {
            state.remaining_concrete_turns = remainingConcreteTurns - 1;
            writeRoutingState(pluginDir, state);
            logger.info(
              `[openmark-router] Allowing one-turn concrete model handoff for ${state.routed_model}; remaining concrete turns: ${state.remaining_concrete_turns}`,
            );
            return;
          }
        }

        logger.info(`[openmark-router] Routing state found (model: ${state.routed_model}) — restoring openmark/auto`);

        const result = await restore(pluginDir, logger);

        if (result && result.status === 'ok') {
          updateRuntimeModelConfig(api, AUTO_MODEL_KEY, [], logger);
          clearMainConversationSessionBindings(logger, 'restore');
          logger.info(`[openmark-router] Auto-restored to ${result.model_set ?? AUTO_MODEL_KEY}`);
          logger.debug('[openmark-router] Restore applied safely; no live session override requested');
        } else {
          logger.warn(`[openmark-router] Restore failed — state file kept for retry`);
        }
      },
      { priority: 50 },
    );

    logger.info('[openmark-router] Registered before_model_resolve hook for auto-restore');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] Hook registration failed: ${msg} — falling back to timer-based restore`);
  }
}

export default plugin;
module.exports = plugin;

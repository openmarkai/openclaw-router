import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type {
  PluginLogger,
  PluginConfig,
} from './types';
import { previewRouteCategory, routeCategory, setPassthrough, restore, getCategories } from './router-bridge';
import { clearMainConversationSessionBindings, getUserOriginalModel } from './provider-inject';

let serverInstance: ReturnType<typeof createServer> | null = null;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let cachedCategories: Array<{ name: string; display_name: string | null; description: string | null }> = [];
let cachedCategoriesAt = 0;
const CATEGORY_CACHE_TTL_MS = 300_000;
const INTERNAL_PROMPT_MARKERS = [
  'generate a short 1-2 word filename slug',
  'filename slug',
  'a new session was started via /new or /reset',
  'run your session startup sequence',
  'continue where you left off. the previous model attempt failed or timed out',
  'the previous model attempt failed or timed out',
  'openmark_classifier_internal',
];
const ROUTING_BYPASS_COMMAND_PATTERN = /^\/[a-z0-9_]+(?:@\w+)?(?:\s|$)/i;

/* eslint-disable @typescript-eslint/no-explicit-any */
let _runtime: any = null;
let _agentRuntimeBridge: any | null | undefined = undefined;
let _replyRuntimeBridge: any | null | undefined = undefined;
let loggedCompatibilityFallback = false;

type ClassificationDecision =
  | { kind: 'match'; category: string }
  | { kind: 'none' }
  | { kind: 'error'; reason: string };

export function startServer(
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
  runtime?: any,
): void {
  _runtime = runtime ?? null;
  if (serverInstance) {
    logger.debug('[openmark-router] Server already running');
    return;
  }

  const port = config.port;
  const host = '127.0.0.1';

  serverInstance = createServer((req, res) => {
    handleRequest(req, res, config, pluginDir, logger).catch((err) => {
      logger.error(`[openmark-router] Request error: ${err}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: 'Internal server error', type: 'server_error' } }));
    });
  });

  serverInstance.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`[openmark-router] Port ${port} already in use — reusing existing server`);
    } else {
      logger.error(`[openmark-router] Server error: ${err.message}`);
    }
  });

  serverInstance.listen(port, host, () => {
    logger.info(`[openmark-router] Server listening on http://${host}:${port}`);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): Promise<void> {
  if (req.method === 'GET' && req.url === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '7.0.0' }));
    return;
  }

  if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not found', type: 'invalid_request' } }));
    return;
  }

  const body = await readBody(req);
  let chatReq: {
    stream?: boolean;
    messages?: Array<{ role: string; content?: string | null }>;
  };
  try {
    chatReq = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request' } }));
    return;
  }

  const userMessage = extractLastUserMessage(chatReq);
  logger.info(`[openmark-router] Incoming request — user message: ${userMessage?.slice(0, 80)}...`);

  if (!userMessage) {
    logger.debug('[openmark-router] No user message found — bypassing without state change');
    sendTextResponse(res, '', Boolean(chatReq.stream));
    return;
  }

  if (shouldBypassAutomaticRouting(userMessage)) {
    logger.debug('[openmark-router] Internal OpenClaw prompt detected — bypassing without state change');
    sendTextResponse(res, '', Boolean(chatReq.stream));
    return;
  }

  if (userMessage.length < 10) {
    logger.debug('[openmark-router] Message too short for routing — treating as no-match');
    const passthroughModel = getUserOriginalModel() || config.no_route_passthrough;
    logCompatibilityFallback(logger, 'short-message passthrough');
    await setPassthrough(passthroughModel, pluginDir, logger);
    scheduleRestore(config, pluginDir, logger);
    sendTextResponse(
      res,
      `No routing match. Compatibility fallback activated; your next message will be handled by ${passthroughModel}.`,
      Boolean(chatReq.stream),
    );
    return;
  }

  const decision = await classifyMessage(userMessage, config, pluginDir, logger);

  if (decision.kind === 'match') {
    logger.info(`[openmark-router] Classified as: ${decision.category}`);
    const rec = await previewRouteCategory(decision.category, pluginDir, logger);

    if (rec && rec.status === 'ok' && rec.card) {
      const card = config.show_routing_card ? rec.card : '';
      const primaryModel = typeof rec.model === 'string'
        ? rec.model
        : typeof rec.model_set === 'string'
          ? rec.model_set
          : '';
      const fallbackModels = normalizeFallbackModels(rec.fallbacks);
      logger.info(`[openmark-router] Preview-routed to: ${primaryModel}`);

      logCompatibilityFallback(logger, `route match for ${decision.category}`);
      const persistedRoute = await routeCategory(decision.category, pluginDir, logger);
      if (persistedRoute && persistedRoute.status === 'ok') {
        logger.info(`[openmark-router] Routed to: ${persistedRoute.model_set ?? persistedRoute.model}`);
        scheduleRestore(config, pluginDir, logger);
        const responseText = card || `Routed to ${persistedRoute.model_set ?? persistedRoute.model}. Send your message again.`;
        sendTextResponse(res, responseText, Boolean(chatReq.stream));
        return;
      }
    }

    logger.warn('[openmark-router] Routing command failed after successful classification');
    sendTextResponse(res, 'Routing failed for this request. Please send your message again.', Boolean(chatReq.stream));
    return;
  }

  if (decision.kind === 'error') {
    logger.warn(`[openmark-router] Classification failed: ${decision.reason}`);
    sendTextResponse(res, 'Routing is temporarily unavailable. Please send your message again.', Boolean(chatReq.stream));
    return;
  }

  const passthroughModel = getUserOriginalModel() || config.no_route_passthrough;
  logger.info('[openmark-router] No classification match — setting passthrough via compatibility fallback');
  logCompatibilityFallback(logger, 'no-match passthrough');
  await setPassthrough(passthroughModel, pluginDir, logger);
  scheduleRestore(config, pluginDir, logger);
  sendTextResponse(
    res,
    `No routing match. Compatibility fallback activated; your next message will be handled by ${passthroughModel}.`,
    Boolean(chatReq.stream),
  );
}

export async function classifyMessage(
  userMessage: string,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): Promise<ClassificationDecision> {
  const categories = await loadCategories(pluginDir, logger);
  if (categories.length === 0) {
    return { kind: 'error', reason: 'No benchmark categories available' };
  }

  const classifierModel = config.classifier_model || getUserOriginalModel();
  if (!classifierModel) {
    logger.warn('[openmark-router] No classifier model available');
    return { kind: 'error', reason: 'No classifier model available' };
  }

  if (isRouterAliasModel(classifierModel)) {
    logger.warn('[openmark-router] Classifier model resolved to openmark/auto — refusing to recurse');
    return { kind: 'error', reason: 'Classifier model cannot be openmark/auto' };
  }

  if (hasSimpleCompletionRuntime()) {
    const simpleCompletionDecision = await classifyViaSimpleCompletion(
      userMessage,
      categories,
      classifierModel,
      logger,
    );
    if (simpleCompletionDecision.kind !== 'error') {
      return simpleCompletionDecision;
    }

    if (_runtime?.subagent?.run) {
      logger.warn(
        `[openmark-router] Simple completion classifier failed (${simpleCompletionDecision.reason}); falling back to subagent`,
      );
      return classifyViaSubagent(userMessage, categories, classifierModel, logger);
    }

    return simpleCompletionDecision;
  }

  if (_runtime?.subagent?.run) {
    logger.warn('[openmark-router] Falling back to subagent classifier path');
    return classifyViaSubagent(userMessage, categories, classifierModel, logger);
  }

  logger.warn('[openmark-router] No OpenClaw classifier runtime available');
  return { kind: 'error', reason: 'No OpenClaw classifier runtime available' };
}

function hasSimpleCompletionRuntime(): boolean {
  return Boolean(resolveAgentRuntimeBridge());
}

function resolveAgentRuntimeBridge(): any | null {
  if (_agentRuntimeBridge !== undefined) {
    return _agentRuntimeBridge;
  }

  const probeSpecifiers = [
    process.argv[1],
    require.main?.filename,
    __filename,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const specifier of probeSpecifiers) {
    try {
      const runtimeRequire = createRequire(specifier);
      _agentRuntimeBridge = runtimeRequire('openclaw/plugin-sdk/agent-runtime');
      return _agentRuntimeBridge;
    } catch {
      // Try the next host entrypoint.
    }
  }

  _agentRuntimeBridge = null;
  return null;
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

function buildClassifierPrompt(
  userMessage: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
): string {
  const categoryList = categories
    .map(c => `- ${c.name}: ${c.description || c.display_name || c.name}`)
    .join('\n');

  return (
    `OPENMARK_CLASSIFIER_INTERNAL\n` +
    `You are a task classifier. Given the user message below, determine which benchmark category it best matches.\n` +
    `Reply with ONLY the category name, nothing else. If no category matches, reply "none".\n\n` +
    `Categories:\n${categoryList}\n\n` +
    `User message: "${userMessage}"\n\nCategory:`
  );
}

function parseClassifierResponse(
  assistantText: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
  logger: PluginLogger,
  sourceLabel: string,
): ClassificationDecision {
  const raw = assistantText.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  logger.info(`[openmark-router] ${sourceLabel} response: "${assistantText.trim()}" -> parsed: "${raw}"`);

  const validNames = categories.map(c => c.name);
  if (validNames.includes(raw)) return { kind: 'match', category: raw };

  for (const name of validNames) {
    if (raw.includes(name) || name.includes(raw)) {
      return { kind: 'match', category: name };
    }
  }

  if (raw === 'none' || raw === '') return { kind: 'none' };
  logger.debug(`[openmark-router] ${sourceLabel} response "${raw}" did not match any category`);
  return { kind: 'none' };
}

function summarizeAssistantMessage(message: any): string {
  if (!message || typeof message !== 'object') {
    return 'missing';
  }

  const content = Array.isArray(message.content) ? message.content : [];
  const contentTypes = content
    .filter((part: unknown): part is Record<string, unknown> => typeof part === 'object' && part !== null)
    .map((part: Record<string, unknown>) => String(part.type ?? 'unknown'));

  return JSON.stringify({
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    provider: message.provider,
    model: message.model,
    contentTypes,
    contentItems: content.length,
    extractedTextPreview: extractClassifierText(message)?.slice(0, 80) ?? null,
  });
}

function extractClassifierText(message: any): string | null {
  const fromContent = contentToText(message?.content);
  if (fromContent && fromContent.trim()) {
    return fromContent.trim();
  }

  const topLevelCandidates = [
    message?.text,
    message?.outputText,
    message?.contentText,
  ];
  for (const candidate of topLevelCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      const nestedCandidates = [record.text, record.value, record.content];
      for (const candidate of nestedCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
        if (
          candidate &&
          typeof candidate === 'object' &&
          typeof (candidate as Record<string, unknown>).value === 'string'
        ) {
          const nestedValue = ((candidate as Record<string, unknown>).value as string).trim();
          if (nestedValue) {
            return nestedValue;
          }
        }
      }
    }
  }

  return null;
}

async function classifyViaSimpleCompletion(
  userMessage: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
  classifierModel: string,
  logger: PluginLogger,
): Promise<ClassificationDecision> {
  const agentRuntimeBridge = resolveAgentRuntimeBridge();
  if (!agentRuntimeBridge) {
    return { kind: 'error', reason: 'openclaw/plugin-sdk/agent-runtime not resolvable' };
  }

  const { provider, model } = splitModelId(classifierModel);
  if (!provider || !model) {
    return { kind: 'error', reason: `Invalid classifier model: ${classifierModel}` };
  }

  const prompt = buildClassifierPrompt(userMessage, categories);

  try {
    const cfg = typeof _runtime?.config?.loadConfig === 'function'
      ? await _runtime.config.loadConfig()
      : undefined;
    const agentDir = cfg && typeof _runtime?.agent?.resolveAgentDir === 'function'
      ? _runtime.agent.resolveAgentDir(cfg)
      : undefined;

    logger.info(`[openmark-router] Classifying via simple completion (model: ${classifierModel}, isolated prompt)`);

    const prepared = await agentRuntimeBridge.prepareSimpleCompletionModel({
      cfg,
      provider,
      modelId: model,
      agentDir,
    });

    if (!prepared || typeof prepared !== 'object' || 'error' in prepared) {
      const reason = prepared && typeof prepared.error === 'string'
        ? prepared.error
        : 'Failed to prepare simple completion model';
      logger.warn(`[openmark-router] Simple completion preparation failed: ${reason}`);
      return { kind: 'error', reason };
    }

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const assistantMsg = await agentRuntimeBridge.completeWithPreparedSimpleCompletionModel({
        model: prepared.model,
        auth: prepared.auth,
        context: {
          messages: [{
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
          }],
        },
        options: {
          temperature: 0,
          maxTokens: 120,
          reasoning: 'minimal',
        },
      });

      const assistantText = extractClassifierText(assistantMsg);
      if (assistantText) {
        return parseClassifierResponse(assistantText, categories, logger, 'Simple completion');
      }

      logger.warn(
        `[openmark-router] Simple completion attempt ${attempt}/${maxAttempts} returned no text; summary=${summarizeAssistantMessage(assistantMsg)}`,
      );
      if (attempt < maxAttempts) {
        logger.info('[openmark-router] Retrying simple completion classifier once');
      }
    }

    return { kind: 'error', reason: 'Simple completion returned no content' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] Simple completion classification failed: ${msg}`);
    return { kind: 'error', reason: msg };
  }
}

async function classifyViaSubagent(
  userMessage: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
  classifierModel: string,
  logger: PluginLogger,
): Promise<ClassificationDecision> {
  const prompt = buildClassifierPrompt(userMessage, categories);

  const sessionKey = `openmark-classify-${Date.now()}-${randomUUID()}`;
  const idempotencyKey = `openmark-classify:${sessionKey}`;
  const { provider, model } = splitModelId(classifierModel);

  try {
    logger.info(`[openmark-router] Classifying via subagent (model: ${classifierModel})`);

    const { runId } = await _runtime.subagent.run({
      sessionKey,
      idempotencyKey,
      message: prompt,
      provider,
      model,
      deliver: false,
    });

    await _runtime.subagent.waitForRun({ runId, timeoutMs: 15_000 });

    const sessionResult = await _runtime.subagent.getSessionMessages({ sessionKey, limit: 5 });
    const messages = Array.isArray(sessionResult?.messages) ? sessionResult.messages : [];
    const assistantMsg = messages?.filter((m: any) => m.role === 'assistant').pop();

    try { await _runtime.subagent.deleteSession({ sessionKey }); } catch { /* cleanup */ }

    const assistantText = contentToText(assistantMsg?.content);
    if (!assistantText) {
      logger.warn('[openmark-router] Subagent returned no content');
      return { kind: 'error', reason: 'Subagent returned no content' };
    }

    return parseClassifierResponse(assistantText, categories, logger, 'Subagent');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] Subagent classification failed: ${msg}`);
    return { kind: 'error', reason: msg };
  }
}

async function loadCategories(
  pluginDir: string,
  logger: PluginLogger,
): Promise<Array<{ name: string; display_name: string | null; description: string | null }>> {
  const now = Date.now();
  if (cachedCategories.length > 0 && now - cachedCategoriesAt < CATEGORY_CACHE_TTL_MS) {
    return cachedCategories;
  }
  cachedCategories = await getCategories(pluginDir, logger);
  cachedCategoriesAt = now;
  return cachedCategories;
}

async function loadCurrentConfig(logger: PluginLogger): Promise<Record<string, unknown> | null> {
  try {
    if (typeof _runtime?.config?.loadConfig === 'function') {
      const cfg = await _runtime.config.loadConfig();
      return cfg && typeof cfg === 'object' ? cfg as Record<string, unknown> : null;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] Failed to load current OpenClaw config: ${msg}`);
  }

  return null;
}

function cloneConfigWithModelOverride(
  cfg: Record<string, unknown>,
  primary: string,
  fallbacks: string[],
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(cfg ?? {})) as Record<string, unknown>;
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

function normalizeFallbackModels(fallbacks: unknown): string[] {
  if (!Array.isArray(fallbacks)) {
    return [];
  }
  return fallbacks
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

function extractInboundHistory(
  req: { messages?: Array<{ role: string; content?: string | null }> },
): Array<{ sender: string; body: string }> | undefined {
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return undefined;
  }

  let lastUserIndex = -1;
  for (let i = req.messages.length - 1; i >= 0; i -= 1) {
    if (req.messages[i]?.role === 'user' && contentToText(req.messages[i]?.content)) {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex <= 0) {
    return undefined;
  }

  const history = req.messages
    .slice(0, lastUserIndex)
    .map(message => {
      const body = contentToText(message?.content);
      if (!body) return null;
      if (message.role !== 'user' && message.role !== 'assistant') return null;
      return {
        sender: message.role,
        body,
      };
    })
    .filter((entry): entry is { sender: string; body: string } => entry !== null);

  return history.length > 0 ? history : undefined;
}

function buildProviderReplyContext(
  req: { messages?: Array<{ role: string; content?: string | null }> },
  userMessage: string,
): Record<string, unknown> {
  const syntheticPeer = 'openmark-auto';
  return {
    Body: userMessage,
    BodyForAgent: userMessage,
    RawBody: userMessage,
    CommandBody: userMessage,
    BodyForCommands: userMessage,
    InboundHistory: extractInboundHistory(req),
    From: `webchat:${syntheticPeer}`,
    To: `webchat:${syntheticPeer}`,
    Provider: 'webchat',
    Surface: 'webchat',
    OriginatingChannel: 'webchat',
    OriginatingTo: syntheticPeer,
    ChatType: 'direct',
    ConversationLabel: 'OpenMark Auto Router',
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

async function tryReplyViaReplyRuntime(
  chatReq: { messages?: Array<{ role: string; content?: string | null }> },
  loadedConfig: Record<string, unknown>,
  primaryModel: string,
  fallbackModels: string[],
  logger: PluginLogger,
): Promise<string | null> {
  const replyRuntimeBridge = resolveReplyRuntimeBridge();
  if (!replyRuntimeBridge?.getReplyFromConfig || !replyRuntimeBridge?.finalizeInboundContext) {
    return null;
  }

  if (!primaryModel || isRouterAliasModel(primaryModel)) {
    return null;
  }

  const userMessage = extractLastUserMessage(chatReq);
  if (!userMessage) {
    return null;
  }

  try {
    const configOverride = cloneConfigWithModelOverride(loadedConfig, primaryModel, fallbackModels);
    const finalizedContext = replyRuntimeBridge.finalizeInboundContext(
      buildProviderReplyContext(chatReq, userMessage),
    );
    const reply = await replyRuntimeBridge.getReplyFromConfig(
      finalizedContext,
      {
        suppressTyping: true,
        onModelSelected: (selected: { provider?: string; model?: string }) => {
          logger.info(
            `[openmark-router] Reply-runtime selected ${selected.provider ?? 'unknown'}/${selected.model ?? 'unknown'}`,
          );
        },
      },
      configOverride,
    );

    const replyText = replyPayloadsToText(reply).trim();
    if (!replyText) {
      logger.warn('[openmark-router] Reply-runtime produced no reply text for provider request');
      return null;
    }
    return replyText;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] Reply-runtime seamless reply failed: ${msg}`);
    return null;
  }
}

function logCompatibilityFallback(logger: PluginLogger, reason: string): void {
  if (!loggedCompatibilityFallback) {
    loggedCompatibilityFallback = true;
    logger.warn('[openmark-router] Falling back to compatibility mode: persisting route and returning card-only response');
  }
  logger.info(`[openmark-router] Compatibility fallback reason: ${reason}`);
}

function scheduleRestore(
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): void {
  if (restoreTimer) {
    clearTimeout(restoreTimer);
  }

  const delayMs = (config.restore_delay_s || 30) * 1000;
  logger.debug(`[openmark-router] Scheduling timer restore in ${config.restore_delay_s || 30}s`);

  restoreTimer = setTimeout(async () => {
    restoreTimer = null;
    try {
      const result = await restore(pluginDir, logger);
      if (result && result.status === 'ok') {
        clearMainConversationSessionBindings(logger, 'timer-restore');
        logger.info(`[openmark-router] Timer-restored to ${result.model_set ?? 'openmark/auto'}`);
      } else if (result && result.status === 'no_state') {
        logger.debug('[openmark-router] Timer restore: no state (hook already restored)');
      } else {
        logger.warn(`[openmark-router] Timer restore returned: ${JSON.stringify(result)}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[openmark-router] Timer restore failed: ${msg}`);
    }
  }, delayMs);
}

function sendTextResponse(res: ServerResponse, text: string, stream = false): void {
  if (stream && text.length > 0) {
    sendStreamingTextResponse(res, text);
    return;
  }

  const responseBody = {
    id: `openmark-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'openmark/auto',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: {
      input: 0,
      output: text ? 1 : 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: text ? 1 : 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      prompt_tokens: 0,
      completion_tokens: text ? 1 : 0,
      total_tokens: text ? 1 : 0,
    },
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseBody));
}

function sendStreamingTextResponse(res: ServerResponse, text: string): void {
  const created = Math.floor(Date.now() / 1000);
  const id = `openmark-${Date.now()}`;
  const model = 'openmark/auto';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const startChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{
      index: 0,
      delta: { role: 'assistant' },
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(startChunk)}\n\n`);

  if (text) {
    const contentChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: { content: text },
        finish_reason: null,
      }],
    };
    res.write(`data: ${JSON.stringify(contentChunk)}\n\n`);
  }
  res.end('data: [DONE]\n\n');
}

export function isInternalSystemPrompt(text: string): boolean {
  const normalized = text.toLowerCase();
  return INTERNAL_PROMPT_MARKERS.some(marker => normalized.includes(marker));
}

export function isRoutingBypassCommand(text: string): boolean {
  return ROUTING_BYPASS_COMMAND_PATTERN.test(text.trim());
}

export function shouldBypassAutomaticRouting(text: string): boolean {
  return isInternalSystemPrompt(text) || isRoutingBypassCommand(text);
}

function isRouterAliasModel(modelId: string): boolean {
  return modelId.trim().toLowerCase() === 'openmark/auto';
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

function contentToText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .filter((part): part is { type?: string; text?: string } => typeof part === 'object' && part !== null)
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string);
    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  return null;
}

function extractLastUserMessage(
  req: { messages?: Array<{ role: string; content?: string | null }> },
): string | null {
  if (!req.messages || !Array.isArray(req.messages)) return null;
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const msg = req.messages[i];
    if (msg.role !== 'user' || !msg.content) continue;

    const text = contentToText(msg.content);
    if (text) return text;
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

import { dirname } from 'node:path';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PluginApi,
  PluginConfig,
  PluginLogger,
  PluginHookBeforeModelResolveResult,
  ProviderModelEntry,
} from './types';
import {
  clearMainConversationSessionBindings,
  getUserOriginalModel,
  injectProviderConfig,
  updateRuntimeModelConfig,
} from './provider-inject';
import { startServer } from './server';
import { getCategories, restore } from './router-bridge';

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
let loggedResolveEventShape = false;

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
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch (err: unknown) {
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
    logger.info(`[openmark-router] Plugin API methods: ${Object.keys(api).join(', ')}`);

    const rt = (api as any).runtime;
    if (rt && typeof rt === 'object') {
      logger.info(`[openmark-router] runtime keys: ${Object.keys(rt).join(', ')}`);
      if (rt.subagent && typeof rt.subagent === 'object') {
        logger.info(`[openmark-router] runtime.subagent keys: ${Object.keys(rt.subagent).join(', ')}`);
      }
    }
    logger.info(`[openmark-router] Classifier: ${config.classifier_model || '(user default — resolved at runtime)'}`);
    logger.info(`[openmark-router] Passthrough: ${config.no_route_passthrough || '(user default — resolved at runtime)'}`);
    logger.info(`[openmark-router] Server port: ${config.port}, Gateway port: ${config.gateway_port}`);

    registerProvider(api, config, logger);

    injectProviderConfig(api, `http://127.0.0.1:${config.port}/v1`, config.port, logger, pluginDir);

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

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PluginLogger, OpenClawConfig, PluginApi } from './types';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG = join(OPENCLAW_DIR, 'openclaw.json');
const MAIN_SESSION_STORE = join(OPENCLAW_DIR, 'agents', 'main', 'sessions', 'sessions.json');
const AUTO_MODEL_ID = 'openmark/auto';

function loadJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  try {
    renameSync(tmp, path);
  } catch {
    copyFileSync(tmp, path);
    try { unlinkSync(tmp); } catch { /* best effort */ }
  }
}

let userOriginalModel: string | null = null;

/**
 * Get the user's real default model (the one they had before the
 * plugin set openmark/auto). Persisted to disk so it survives
 * gateway restarts and routing cycles.
 */
export function getUserOriginalModel(): string | null {
  return userOriginalModel;
}

export function updateRuntimeModelConfig(
  api: PluginApi,
  primary: string,
  fallbacks: string[] = [],
  logger?: PluginLogger,
): void {
  try {
    if (!api.config) {
      return;
    }

    if (!api.config.agents) api.config.agents = {};
    if (!api.config.agents.defaults) api.config.agents.defaults = {};
    if (!api.config.agents.defaults.model) api.config.agents.defaults.model = {};

    api.config.agents.defaults.model.primary = primary;
    api.config.agents.defaults.model.fallbacks = fallbacks;
    logger?.debug(`[openmark-router] Updated runtime default model to ${primary}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.debug(`[openmark-router] Runtime default-model update failed: ${msg}`);
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMainUserConversationSessionKey(sessionKey: string, entry: Record<string, unknown>): boolean {
  const normalizedKey = sessionKey.trim().toLowerCase();
  if (!normalizedKey.startsWith('agent:main:')) {
    return false;
  }

  if (normalizedKey.includes(':slash:') || normalizedKey.includes(':subagent:')) {
    return false;
  }

  if (normalizedKey === 'agent:main:main') {
    return true;
  }

  if (normalizedKey.includes(':direct:') || normalizedKey.includes(':group:') || normalizedKey.includes(':channel:')) {
    return true;
  }

  const origin = isObjectRecord(entry.origin) ? entry.origin : null;
  const originProvider = typeof origin?.provider === 'string' ? origin.provider.trim().toLowerCase() : '';
  return [
    'telegram',
    'discord',
    'slack',
    'matrix',
    'whatsapp',
    'line',
    'signal',
    'webchat',
    'web',
  ].includes(originProvider);
}

function clearSessionModelBinding(entry: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of [
    'modelOverride',
    'providerOverride',
    'model',
    'modelProvider',
    'contextTokens',
  ]) {
    if (key in entry) {
      delete entry[key];
      changed = true;
    }
  }
  return changed;
}

export function clearMainConversationSessionBindings(
  logger: PluginLogger,
  reason: 'startup' | 'restore' | 'timer-restore',
): number {
  if (!existsSync(MAIN_SESSION_STORE)) {
    return 0;
  }

  try {
    const store = loadJsonFile(MAIN_SESSION_STORE);
    if (!isObjectRecord(store)) {
      return 0;
    }

    let clearedCount = 0;
    for (const [sessionKey, rawEntry] of Object.entries(store)) {
      if (!isObjectRecord(rawEntry)) {
        continue;
      }
      if (!isMainUserConversationSessionKey(sessionKey, rawEntry)) {
        continue;
      }
      if (!clearSessionModelBinding(rawEntry)) {
        continue;
      }
      clearedCount += 1;
      logger.debug(`[openmark-router] Cleared stale session model binding for ${sessionKey}`);
    }

    if (clearedCount > 0) {
      atomicWriteJson(MAIN_SESSION_STORE, store);
      logger.info(`[openmark-router] Cleared ${clearedCount} main-session model binding(s) during ${reason}`);
    }

    return clearedCount;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] Failed to clear main-session model bindings during ${reason}: ${msg}`);
    return 0;
  }
}

export function clearSpecificSessionBinding(
  sessionKey: string,
  logger: PluginLogger,
  reason: 'cli-restore' | 'runtime-restore',
): boolean {
  if (!sessionKey || !existsSync(MAIN_SESSION_STORE)) {
    return false;
  }

  try {
    const store = loadJsonFile(MAIN_SESSION_STORE);
    if (!isObjectRecord(store)) {
      return false;
    }

    const entry = store[sessionKey];
    if (!isObjectRecord(entry) || !clearSessionModelBinding(entry)) {
      return false;
    }

    atomicWriteJson(MAIN_SESSION_STORE, store);
    logger.info(`[openmark-router] Cleared session model binding for ${sessionKey} during ${reason}`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] Failed to clear session model binding for ${sessionKey} during ${reason}: ${msg}`);
    return false;
  }
}

function originalModelPath(pluginDir: string): string {
  return join(pluginDir, '.user_default_model');
}

/**
 * Capture the user's default model on first install, persist it,
 * and load it back on subsequent startups. This is the model used
 * for classification and passthrough — the user's "real" default
 * that stays constant while openclaw.json's primary rotates between
 * openmark/auto and routed models.
 */
function captureUserDefault(pluginDir: string, logger: PluginLogger): void {
  const persistPath = originalModelPath(pluginDir);

  // Try loading from openclaw.json (first install or user changed their default)
  try {
    if (existsSync(OPENCLAW_CONFIG)) {
      const config = loadJsonFile(OPENCLAW_CONFIG) as OpenClawConfig;
      const currentPrimary = config.agents?.defaults?.model?.primary;

      if (currentPrimary && currentPrimary !== AUTO_MODEL_ID) {
        userOriginalModel = currentPrimary;
        writeFileSync(persistPath, currentPrimary, 'utf-8');
        logger.info(`[openmark-router] Captured user's default model: ${userOriginalModel}`);
        return;
      }
    }
  } catch {
    // fall through to persisted file
  }

  // On restart, openclaw.json says openmark/auto — read from persisted file
  try {
    if (existsSync(persistPath)) {
      userOriginalModel = readFileSync(persistPath, 'utf-8').trim();
      logger.info(`[openmark-router] Loaded persisted default model: ${userOriginalModel}`);
      return;
    }
  } catch {
    // fall through
  }

  logger.warn(
    '[openmark-router] Could not determine user\'s default model. ' +
    'Set classifier_model and no_route_passthrough in the plugin config or config.json, or ' +
    'temporarily set your preferred model in OpenClaw and restart the gateway.',
  );
}

/**
 * Write the openmark provider config into ~/.openclaw/openclaw.json
 * and set openmark/auto as the default model.
 */
export function injectProviderConfig(
  api: PluginApi,
  baseUrl: string,
  port: number,
  logger: PluginLogger,
  pluginDir: string,
): void {
  captureUserDefault(pluginDir, logger);

  const providerConfig = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    api: 'openai-completions',
    models: [{ id: 'auto', name: 'auto' }],
  };

  try {
    if (!existsSync(OPENCLAW_DIR)) {
      mkdirSync(OPENCLAW_DIR, { recursive: true });
    }

    let config: OpenClawConfig = {};
    if (existsSync(OPENCLAW_CONFIG)) {
      config = loadJsonFile(OPENCLAW_CONFIG) as OpenClawConfig;
    }

    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    config.models.providers['openmark'] = providerConfig;

    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.agents.defaults.model) config.agents.defaults.model = {};
    config.agents.defaults.model.primary = AUTO_MODEL_ID;
    config.agents.defaults.model.fallbacks = [];

    atomicWriteJson(OPENCLAW_CONFIG, config);
    logger.info('[openmark-router] Wrote provider config to openclaw.json');
    logger.info(`[openmark-router] Default model set to ${AUTO_MODEL_ID}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] Failed to write provider config: ${msg}`);
  }

  try {
    if (api.config) {
      if (!api.config.models) api.config.models = {};
      if (!api.config.models.providers) api.config.models.providers = {};
      api.config.models.providers['openmark'] = providerConfig;
      updateRuntimeModelConfig(api, AUTO_MODEL_ID, [], logger);
      logger.debug('[openmark-router] Injected provider into runtime config');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[openmark-router] Runtime config injection failed: ${msg}`);
  }

  clearMainConversationSessionBindings(logger, 'startup');
}

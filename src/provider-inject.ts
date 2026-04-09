import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PluginLogger, OpenClawConfig, PluginApi } from './types';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const OPENCLAW_CONFIG = join(OPENCLAW_DIR, 'openclaw.json');

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

      if (currentPrimary && currentPrimary !== 'openmark/auto') {
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
    'Set classifier_model and no_route_passthrough in config.json, or ' +
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
    config.agents.defaults.model.primary = 'openmark/auto';

    atomicWriteJson(OPENCLAW_CONFIG, config);
    logger.info('[openmark-router] Wrote provider config to openclaw.json');
    logger.info('[openmark-router] Default model set to openmark/auto');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] Failed to write provider config: ${msg}`);
  }

  try {
    if (api.config) {
      if (!api.config.models) api.config.models = {};
      if (!api.config.models.providers) api.config.models.providers = {};
      api.config.models.providers['openmark'] = providerConfig;
      logger.debug('[openmark-router] Injected provider into runtime config');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[openmark-router] Runtime config injection failed: ${msg}`);
  }
}

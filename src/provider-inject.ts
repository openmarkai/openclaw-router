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

/**
 * Write the openmark provider config into ~/.openclaw/openclaw.json
 * and set openmark/auto as the default model.
 */
export function injectProviderConfig(
  api: PluginApi,
  baseUrl: string,
  port: number,
  logger: PluginLogger,
): void {
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

/**
 * Read provider API keys from openclaw.json for forwarding requests.
 */
export function readProviderApiKey(providerName: string): string | null {
  try {
    if (!existsSync(OPENCLAW_CONFIG)) return null;
    const config = loadJsonFile(OPENCLAW_CONFIG) as OpenClawConfig;
    const provider = config.models?.providers?.[providerName];
    return provider?.apiKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the full openclaw.json config.
 */
export function readOpenClawConfig(): OpenClawConfig | null {
  try {
    if (!existsSync(OPENCLAW_CONFIG)) return null;
    return loadJsonFile(OPENCLAW_CONFIG) as OpenClawConfig;
  } catch {
    return null;
  }
}

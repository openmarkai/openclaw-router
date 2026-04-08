import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginApi, PluginConfig, PluginLogger, ProviderModelEntry } from './types';
import { injectProviderConfig } from './provider-inject';
import { startServer } from './server';
import { getCategories } from './router-bridge';

const AUTO_MODEL: ProviderModelEntry = {
  id: 'auto',
  name: 'OpenMark Auto Router',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 2_000_000,
  maxTokens: 128_000,
};

function parseConfig(raw: Record<string, unknown> | undefined): PluginConfig {
  const inner =
    raw && typeof raw === 'object' && 'config' in raw && raw.config != null && typeof raw.config === 'object'
      ? (raw.config as Record<string, unknown>)
      : (raw ?? {}) as Record<string, unknown>;

  return {
    classifier_model:
      typeof inner.classifier_model === 'string' && inner.classifier_model.length > 0
        ? inner.classifier_model
        : 'google/gemini-3.1-flash-lite-preview',
    no_route_passthrough:
      typeof inner.no_route_passthrough === 'string' && inner.no_route_passthrough.length > 0
        ? inner.no_route_passthrough
        : 'google/gemini-3-flash-preview',
    port:
      typeof inner.port === 'number' && inner.port > 0
        ? inner.port
        : 2098,
    show_routing_card:
      typeof inner.show_routing_card === 'boolean'
        ? inner.show_routing_card
        : true,
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

    const config = parseConfig(api.pluginConfig);
    const pluginDir = resolvePluginDir();

    logger.info(`[openmark-router] Initializing v7 provider-based router`);
    logger.info(`[openmark-router] Classifier: ${config.classifier_model}`);
    logger.info(`[openmark-router] Passthrough: ${config.no_route_passthrough}`);
    logger.info(`[openmark-router] Port: ${config.port}`);

    registerProvider(api, config, logger);

    injectProviderConfig(api, `http://127.0.0.1:${config.port}/v1`, config.port, logger);

    const routerPy = join(pluginDir, 'scripts', 'router.py');
    if (!existsSync(routerPy)) {
      logger.warn(`[openmark-router] router.py not found at ${routerPy} — routing will not work`);
    }

    api.registerService({
      id: 'openmark-router',
      start: async () => {
        startServer(config, pluginDir, logger);

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

export default plugin;
module.exports = plugin;

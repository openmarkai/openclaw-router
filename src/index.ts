import { dirname } from 'node:path';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginApi, PluginConfig, PluginLogger, ProviderModelEntry } from './types';
import { injectProviderConfig } from './provider-inject';
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

function parseConfig(raw: Record<string, unknown> | undefined): PluginConfig {
  const inner =
    raw && typeof raw === 'object' && 'config' in raw && raw.config != null && typeof raw.config === 'object'
      ? (raw.config as Record<string, unknown>)
      : (raw ?? {}) as Record<string, unknown>;

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

    const config = parseConfig(api.pluginConfig);
    const pluginDir = resolvePluginDir();

    logger.info('[openmark-router] Initializing v7 hybrid router');
    logger.info(`[openmark-router] Plugin API methods: ${Object.keys(api).join(', ')}`);
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
      async () => {
        const statePath = join(pluginDir, '.routing_state.json');

        if (!existsSync(statePath)) {
          return;
        }

        let state: { manual?: boolean; routed_model?: string };
        try {
          state = JSON.parse(readFileSync(statePath, 'utf-8'));
        } catch {
          return;
        }

        if (state.manual) {
          logger.debug('[openmark-router] Manual lock active — skipping restore');
          return;
        }

        logger.info(`[openmark-router] Routing state found (model: ${state.routed_model}) — restoring openmark/auto`);

        const result = await restore(pluginDir, logger);

        if (result && result.status === 'ok') {
          logger.info(`[openmark-router] Auto-restored to ${result.model_set ?? 'openmark/auto'}`);
        }

        try {
          unlinkSync(statePath);
        } catch {
          // state file cleaned up by router.py --restore
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

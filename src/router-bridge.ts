import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { PluginLogger, RouterRecommendation } from './types';

/**
 * Call router.py --route <category> as a subprocess.
 * This WRITES the routed model + fallbacks to ~/.openclaw/openclaw.json
 * and saves routing state for auto-restore.
 */
export async function routeCategory(
  category: string,
  pluginDir: string,
  logger: PluginLogger,
): Promise<RouterRecommendation | null> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.error(`[openmark-router] router.py not found at ${routerPath}`);
    return null;
  }

  try {
    const stdout = await execPython(
      [routerPath, '--route', category, '--config', configPath],
      logger,
    );

    const result = JSON.parse(stdout) as RouterRecommendation;
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] router.py --route failed: ${msg}`);
    return null;
  }
}

/**
 * Call router.py --task <category> to compute the recommended model and
 * routing card without mutating openclaw.json or writing routing state.
 */
export async function previewRouteCategory(
  category: string,
  pluginDir: string,
  logger: PluginLogger,
): Promise<RouterRecommendation | null> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.error(`[openmark-router] router.py not found at ${routerPath}`);
    return null;
  }

  try {
    const stdout = await execPython(
      [routerPath, '--task', category, '--config', configPath],
      logger,
    );

    const result = JSON.parse(stdout) as RouterRecommendation;
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] router.py --task failed: ${msg}`);
    return null;
  }
}

/**
 * Call router.py --set-passthrough <model> to write the passthrough model
 * as the default in openclaw.json and save state for auto-restore.
 */
export async function setPassthrough(
  passthroughModel: string,
  pluginDir: string,
  logger: PluginLogger,
): Promise<RouterRecommendation | null> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.error(`[openmark-router] router.py not found at ${routerPath}`);
    return null;
  }

  try {
    const stdout = await execPython(
      [routerPath, '--set-passthrough', passthroughModel, '--config', configPath],
      logger,
    );

    return JSON.parse(stdout) as RouterRecommendation;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] router.py --set-passthrough failed: ${msg}`);
    return null;
  }
}

/**
 * Call router.py --restore to restore the previous model after routing.
 */
export async function restore(
  pluginDir: string,
  logger: PluginLogger,
): Promise<RouterRecommendation | null> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.error(`[openmark-router] router.py not found at ${routerPath}`);
    return null;
  }

  try {
    const stdout = await execPython(
      [routerPath, '--restore', '--config', configPath],
      logger,
    );

    return JSON.parse(stdout) as RouterRecommendation;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] router.py --restore failed: ${msg}`);
    return null;
  }
}

/**
 * Call router.py --match <message> to do keyword-based classification
 * AND routing in a single call.  No LLM needed — runs entirely locally.
 *
 * If a match is found, this also writes the routed model + fallbacks
 * to openclaw.json and saves routing state (same as routeCategory).
 *
 * Returns the routing result or null if no match / error.
 */
export async function matchAndRoute(
  userMessage: string,
  pluginDir: string,
  logger: PluginLogger,
): Promise<RouterRecommendation | null> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.error(`[openmark-router] router.py not found at ${routerPath}`);
    return null;
  }

  try {
    const stdout = await execPython(
      [routerPath, '--match', userMessage, '--config', configPath],
      logger,
    );

    const result = JSON.parse(stdout) as RouterRecommendation;
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] router.py --match failed: ${msg}`);
    return null;
  }
}

/**
 * Call router.py --classify to get available categories.
 * Used by the classifier to build the classification prompt.
 */
export async function getCategories(
  pluginDir: string,
  logger: PluginLogger,
): Promise<Array<{ name: string; display_name: string | null; description: string | null }>> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.debug(`[openmark-router] router.py not found at ${routerPath}`);
    return [];
  }

  try {
    const stdout = await execPython(
      [routerPath, '--classify', '--config', configPath],
      logger,
    );

    const result = JSON.parse(stdout);
    if (result.action === 'classify' && Array.isArray(result.categories)) {
      return result.categories;
    }
    return [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[openmark-router] --classify failed: ${msg}`);
    return [];
  }
}

export async function describeCategories(
  pluginDir: string,
  logger: PluginLogger,
): Promise<Array<{
  name: string;
  display_name: string | null;
  description: string | null;
  models: number;
  export_date: string | null;
}>> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.debug(`[openmark-router] router.py not found at ${routerPath}`);
    return [];
  }

  try {
    const stdout = await execPython(
      [routerPath, '--describe', '--config', configPath],
      logger,
    );

    const result = JSON.parse(stdout);
    if (result.action === 'describe' && Array.isArray(result.categories)) {
      return result.categories;
    }
    if (Array.isArray(result.categories)) {
      return result.categories;
    }
    return [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[openmark-router] --describe failed: ${msg}`);
    return [];
  }
}

export async function detectAvailableProviders(
  pluginDir: string,
  logger: PluginLogger,
  force = false,
): Promise<{ providers: string[]; unmapped?: string[]; error?: string; cached_at?: string }> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');
  const configPath = join(pluginDir, 'config.json');

  if (!existsSync(routerPath)) {
    logger.debug(`[openmark-router] router.py not found at ${routerPath}`);
    return { providers: [] };
  }

  const args = [routerPath, '--detect-providers', '--config', configPath];
  if (force) {
    args.push('--force-detect');
  }

  try {
    const stdout = await execPython(args, logger);
    const result = JSON.parse(stdout) as {
      providers?: string[];
      unmapped?: string[];
      error?: string;
      cached_at?: string;
    };
    return {
      providers: Array.isArray(result.providers) ? result.providers : [],
      unmapped: Array.isArray(result.unmapped) ? result.unmapped : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
      cached_at: typeof result.cached_at === 'string' ? result.cached_at : undefined,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[openmark-router] --detect-providers failed: ${msg}`);
    return { providers: [], error: msg };
  }
}

export async function validateBenchmarkCsv(
  csvPath: string,
  pluginDir: string,
  logger: PluginLogger,
): Promise<{
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  summary?: Record<string, unknown>;
}> {
  const routerPath = join(pluginDir, 'scripts', 'router.py');

  if (!existsSync(routerPath)) {
    logger.debug(`[openmark-router] router.py not found at ${routerPath}`);
    return {
      valid: false,
      errors: ['router.py not found'],
      warnings: [],
      summary: {},
    };
  }

  try {
    const stdout = await execPython(
      [routerPath, '--validate', csvPath],
      logger,
    );

    const result = JSON.parse(stdout) as {
      valid?: boolean;
      errors?: string[];
      warnings?: string[];
      summary?: Record<string, unknown>;
    };
    return {
      valid: result.valid === true,
      errors: Array.isArray(result.errors) ? result.errors : [],
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      summary: result.summary && typeof result.summary === 'object' ? result.summary : {},
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[openmark-router] --validate failed: ${msg}`);
    return {
      valid: false,
      errors: [msg],
      warnings: [],
      summary: {},
    };
  }
}

let pythonBinary: string | null = null;

function findPython(): string {
  if (pythonBinary) return pythonBinary;

  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      require('node:child_process').execFileSync(cmd, ['--version'], {
        timeout: 5_000,
        stdio: 'pipe',
      });
      pythonBinary = cmd;
      return cmd;
    } catch {
      continue;
    }
  }

  throw new Error(
    'Python not found. Install Python 3.8+ and ensure it is in your PATH. ' +
    'The OpenMark Router requires Python for its routing engine.',
  );
}

function execPython(args: string[], logger: PluginLogger): Promise<string> {
  return new Promise((resolve, reject) => {
    let python: string;
    try {
      python = findPython();
    } catch (err) {
      reject(err);
      return;
    }

    execFile(python, args, { timeout: 30_000, encoding: 'utf-8' }, (err, stdout, stderr) => {
      if (stderr) {
        logger.debug(`[openmark-router] router.py stderr: ${stderr.slice(0, 500)}`);
      }
      if (err) {
        reject(new Error(`${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

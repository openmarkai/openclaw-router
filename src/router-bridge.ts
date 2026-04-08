import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { PluginLogger, RouterRecommendation } from './types';

/**
 * Call router.py --recommend <category> as a subprocess.
 * Returns the routing recommendation (model, card, fallbacks) without
 * writing to openclaw.json or saving routing state.
 */
export async function recommend(
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
      [routerPath, '--recommend', category, '--config', configPath],
      logger,
    );

    const result = JSON.parse(stdout) as RouterRecommendation;
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] router.py --recommend failed: ${msg}`);
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

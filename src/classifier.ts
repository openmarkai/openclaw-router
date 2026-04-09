import { request as httpRequest } from 'node:http';
import type {
  PluginLogger,
  PluginConfig,
  ClassifierResult,
  CategoryInfo,
} from './types';
import { getCategories } from './router-bridge';
import { getUserOriginalModel } from './provider-inject';

let cachedCategories: CategoryInfo[] | null = null;
let categoryCacheTime = 0;
const CATEGORY_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Classify the user's message into a benchmark category.
 *
 * Uses the OpenClaw gateway loopback (http://127.0.0.1:<gateway_port>) so
 * that OpenClaw handles auth and format normalization. The plugin never
 * touches API keys.
 *
 * Fallback chain if gateway is unreachable:
 *   1. Gateway loopback (primary)
 *   2. Skip classification → treat as no-match (passthrough)
 *
 * Returns null category if no match, classification fails, or message is
 * too short / a greeting.
 */
export async function classify(
  userMessage: string | null,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): Promise<ClassifierResult> {
  const noMatch: ClassifierResult = { category: null, confidence: 0, raw_response: '' };

  if (!userMessage || userMessage.trim().length < 10) {
    return noMatch;
  }

  const categories = await loadCategories(pluginDir, logger);
  if (categories.length === 0) {
    logger.debug('[openmark-router] No categories available for classification');
    return noMatch;
  }

  const categoryList = categories
    .map((c) => {
      const desc = c.description ? `: ${c.description}` : '';
      const display = c.display_name ? ` (${c.display_name})` : '';
      return `- ${c.name}${display}${desc}`;
    })
    .join('\n');

  const systemPrompt = `You are a task classifier. Given a user message, determine which task category it matches. Return ONLY the exact category name from the list below, or "none" if no category matches.

Categories:
${categoryList}

Rules:
- Return ONLY the category name (e.g., "contentcreation_complex_benchmark")
- Return "none" for greetings, follow-ups, casual chat, or messages that don't match any category
- Do not explain your reasoning
- Do not add quotes or formatting`;

  const classifierModel = config.classifier_model || getUserOriginalModel();
  if (!classifierModel) {
    logger.warn('[openmark-router] No classifier model available (no config override, no captured default)');
    return noMatch;
  }

  try {
    const response = await callGateway(
      config.gateway_port,
      classifierModel,
      systemPrompt,
      userMessage,
      logger,
    );

    const cleaned = response.trim().toLowerCase().replace(/['"]/g, '');

    const matchedCategory = categories.find(
      (c) => c.name.toLowerCase() === cleaned,
    );

    if (matchedCategory) {
      return { category: matchedCategory.name, confidence: 1, raw_response: response };
    }

    if (cleaned !== 'none') {
      logger.debug(`[openmark-router] Classifier returned unknown category: ${cleaned}`);
    }

    return noMatch;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[openmark-router] Classification failed: ${msg}`);
    logger.warn('[openmark-router] Falling back to passthrough (no classification)');
    return noMatch;
  }
}

async function loadCategories(
  pluginDir: string,
  logger: PluginLogger,
): Promise<CategoryInfo[]> {
  const now = Date.now();
  if (cachedCategories && (now - categoryCacheTime) < CATEGORY_CACHE_TTL_MS) {
    return cachedCategories;
  }

  cachedCategories = await getCategories(pluginDir, logger);
  categoryCacheTime = now;
  return cachedCategories;
}

/**
 * Call the OpenClaw gateway's local OpenAI-compatible endpoint for
 * classification. Uses a specific model (not openmark/auto) to avoid
 * recursion. OpenClaw handles auth and provider format normalization.
 */
function callGateway(
  gatewayPort: number,
  classifierModel: string,
  systemPrompt: string,
  userMessage: string,
  logger: PluginLogger,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: classifierModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 30,
      temperature: 0,
      stream: false,
    });

    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: gatewayPort,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Gateway returned ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content ?? '';
            resolve(content);
          } catch {
            reject(new Error(`Failed to parse gateway response: ${data.slice(0, 300)}`));
          }
        });
      },
    );

    req.on('error', (err) => {
      reject(new Error(`Gateway connection failed (port ${gatewayPort}): ${err.message}`));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Gateway request timed out (port ${gatewayPort})`));
    });

    req.write(body);
    req.end();
  });
}

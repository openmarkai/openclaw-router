import { request as httpsRequest } from 'node:https';
import type {
  PluginLogger,
  PluginConfig,
  ClassifierResult,
  CategoryInfo,
} from './types';
import { PROVIDER_ENDPOINTS } from './types';
import { readProviderApiKey } from './provider-inject';
import { getCategories } from './router-bridge';

let cachedCategories: CategoryInfo[] | null = null;
let categoryCacheTime = 0;
const CATEGORY_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Classify the user's message into a benchmark category using an isolated
 * LLM call. The classifier uses minimal tokens (~400 input, ~5 output) and
 * has no access to OpenClaw's system prompt or conversation history.
 *
 * Returns null category if no match, classification fails, or message is
 * a greeting/follow-up.
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

  const classifierModel = config.classifier_model;
  const providerName = classifierModel.split('/')[0];
  const apiKey = readProviderApiKey(providerName);

  if (!apiKey) {
    logger.warn(`[openmark-router] No API key for classifier provider "${providerName}", skipping classification`);
    return noMatch;
  }

  const baseUrl = PROVIDER_ENDPOINTS[providerName];
  if (!baseUrl) {
    logger.warn(`[openmark-router] Unknown classifier provider: ${providerName}`);
    return noMatch;
  }

  const modelSlug = classifierModel.split('/').slice(1).join('/');

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

  try {
    const response = await callLLM(baseUrl, apiKey, providerName, modelSlug, systemPrompt, userMessage, logger);
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

function callLLM(
  baseUrl: string,
  apiKey: string,
  provider: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  logger: PluginLogger,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/chat/completions`);

    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 30,
      temperature: 0,
      stream: false,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      delete headers['Authorization'];
    }

    const req = httpsRequest(
      url,
      { method: 'POST', headers, timeout: 10_000 },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Classifier API ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content ?? '';
            resolve(content);
          } catch {
            reject(new Error(`Failed to parse classifier response: ${data.slice(0, 300)}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Classifier request timed out'));
    });

    req.write(body);
    req.end();
  });
}

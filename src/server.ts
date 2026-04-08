import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import type {
  PluginLogger,
  PluginConfig,
  ChatCompletionRequest,
  RouterRecommendation,
} from './types';
import { PROVIDER_ENDPOINTS } from './types';
import { readProviderApiKey } from './provider-inject';
import { classify } from './classifier';
import { recommend } from './router-bridge';

let serverInstance: ReturnType<typeof createServer> | null = null;

/**
 * Start the embedded HTTP server that proxies OpenAI-compatible requests.
 * Handles POST /v1/chat/completions — classifies, routes, forwards, streams.
 */
export function startServer(
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): void {
  if (serverInstance) {
    logger.debug('[openmark-router] Server already running');
    return;
  }

  const port = config.port;
  const host = '127.0.0.1';

  serverInstance = createServer((req, res) => {
    handleRequest(req, res, config, pluginDir, logger).catch((err) => {
      logger.error(`[openmark-router] Request error: ${err}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: 'Internal server error', type: 'server_error' } }));
    });
  });

  serverInstance.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`[openmark-router] Port ${port} already in use — reusing existing server`);
    } else {
      logger.error(`[openmark-router] Server error: ${err.message}`);
    }
  });

  serverInstance.listen(port, host, () => {
    logger.info(`[openmark-router] Server listening on http://${host}:${port}`);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): Promise<void> {
  if (req.method === 'GET' && req.url === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '7.0.0' }));
    return;
  }

  if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not found', type: 'invalid_request' } }));
    return;
  }

  const body = await readBody(req);
  let chatReq: ChatCompletionRequest;
  try {
    chatReq = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request' } }));
    return;
  }

  const userMessage = extractLastUserMessage(chatReq);
  logger.debug(`[openmark-router] Incoming request — user message: ${userMessage?.slice(0, 80)}...`);

  let targetModel = config.no_route_passthrough;
  let routingCard: string | null = null;

  const classResult = await classify(userMessage, config, pluginDir, logger);

  if (classResult.category) {
    logger.info(`[openmark-router] Classified as: ${classResult.category}`);
    const rec = await recommend(classResult.category, pluginDir, logger);

    if (rec && rec.status === 'ok' && rec.model) {
      targetModel = rec.model;
      routingCard = config.show_routing_card ? (rec.card ?? null) : null;
      logger.info(`[openmark-router] Routing to: ${targetModel}`);
    } else {
      logger.info(`[openmark-router] No route found for ${classResult.category}, using passthrough: ${targetModel}`);
    }
  } else {
    logger.debug(`[openmark-router] No category match, using passthrough: ${targetModel}`);
  }

  const providerName = targetModel.split('/')[0];
  const apiKey = readProviderApiKey(providerName);

  if (!apiKey) {
    logger.error(`[openmark-router] No API key for provider: ${providerName}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: `No API key configured for provider "${providerName}". Configure it in OpenClaw.`,
        type: 'auth_error',
      },
    }));
    return;
  }

  const baseUrl = PROVIDER_ENDPOINTS[providerName];
  if (!baseUrl) {
    logger.error(`[openmark-router] Unknown provider: ${providerName}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: `Unknown provider: "${providerName}"`,
        type: 'provider_error',
      },
    }));
    return;
  }

  const modelSlug = targetModel.includes('/') ? targetModel.split('/').slice(1).join('/') : targetModel;

  const forwardBody: ChatCompletionRequest = {
    ...chatReq,
    model: modelSlug,
  };

  const isStream = chatReq.stream !== false;
  forwardBody.stream = isStream;

  if (isStream) {
    await forwardStreaming(baseUrl, apiKey, providerName, forwardBody, routingCard, res, logger);
  } else {
    await forwardNonStreaming(baseUrl, apiKey, providerName, forwardBody, routingCard, res, logger);
  }
}

function extractLastUserMessage(req: ChatCompletionRequest): string | null {
  if (!req.messages || !Array.isArray(req.messages)) return null;
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user' && req.messages[i].content) {
      return req.messages[i].content as string;
    }
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function forwardStreaming(
  baseUrl: string,
  apiKey: string,
  provider: string,
  body: ChatCompletionRequest,
  routingCard: string | null,
  res: ServerResponse,
  logger: PluginLogger,
): Promise<void> {
  const url = new URL(`${baseUrl}/chat/completions`);
  const headers = buildProviderHeaders(apiKey, provider);
  headers['Content-Type'] = 'application/json';

  const payload = JSON.stringify(body);

  return new Promise<void>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

    const proxyReq = transport(
      url,
      { method: 'POST', headers, timeout: 120_000 },
      (proxyRes) => {
        if (!proxyRes.statusCode || proxyRes.statusCode >= 400) {
          let errBody = '';
          proxyRes.on('data', (c: Buffer) => { errBody += c.toString(); });
          proxyRes.on('end', () => {
            logger.error(`[openmark-router] Provider returned ${proxyRes.statusCode}: ${errBody.slice(0, 500)}`);
            if (!res.headersSent) {
              res.writeHead(proxyRes.statusCode ?? 502, { 'Content-Type': 'application/json' });
            }
            res.end(errBody);
            resolve();
          });
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        if (routingCard) {
          const cardChunk = buildSSECardChunks(routingCard);
          res.write(cardChunk);
        }

        proxyRes.on('data', (chunk: Buffer) => {
          res.write(chunk);
        });

        proxyRes.on('end', () => {
          res.end();
          resolve();
        });

        proxyRes.on('error', (err) => {
          logger.error(`[openmark-router] Proxy response error: ${err.message}`);
          res.end();
          resolve();
        });
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      logger.error('[openmark-router] Proxy request timed out (120s)');
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: 'Provider request timed out', type: 'timeout_error' } }));
      resolve();
    });

    proxyReq.on('error', (err) => {
      logger.error(`[openmark-router] Proxy request error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: `Provider connection failed: ${err.message}`, type: 'proxy_error' } }));
      resolve();
    });

    proxyReq.write(payload);
    proxyReq.end();
  });
}

async function forwardNonStreaming(
  baseUrl: string,
  apiKey: string,
  provider: string,
  body: ChatCompletionRequest,
  routingCard: string | null,
  res: ServerResponse,
  logger: PluginLogger,
): Promise<void> {
  const url = new URL(`${baseUrl}/chat/completions`);
  const headers = buildProviderHeaders(apiKey, provider);
  headers['Content-Type'] = 'application/json';

  const payload = JSON.stringify(body);

  return new Promise<void>((resolve) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

    const proxyReq = transport(
      url,
      { method: 'POST', headers, timeout: 120_000 },
      (proxyRes) => {
        let responseBody = '';
        proxyRes.on('data', (c: Buffer) => { responseBody += c.toString(); });
        proxyRes.on('end', () => {
          if (!proxyRes.statusCode || proxyRes.statusCode >= 400) {
            logger.error(`[openmark-router] Provider returned ${proxyRes.statusCode}: ${responseBody.slice(0, 500)}`);
            if (!res.headersSent) {
              res.writeHead(proxyRes.statusCode ?? 502, { 'Content-Type': 'application/json' });
            }
            res.end(responseBody);
            resolve();
            return;
          }

          if (routingCard) {
            try {
              const parsed = JSON.parse(responseBody);
              if (parsed.choices?.[0]?.message?.content) {
                parsed.choices[0].message.content = routingCard + '\n\n' + parsed.choices[0].message.content;
              }
              responseBody = JSON.stringify(parsed);
            } catch {
              logger.debug('[openmark-router] Could not inject card into non-streaming response');
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(responseBody);
          resolve();
        });
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      logger.error('[openmark-router] Proxy request timed out (120s)');
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: 'Provider request timed out', type: 'timeout_error' } }));
      resolve();
    });

    proxyReq.on('error', (err) => {
      logger.error(`[openmark-router] Proxy request error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message: `Provider connection failed: ${err.message}`, type: 'proxy_error' } }));
      resolve();
    });

    proxyReq.write(payload);
    proxyReq.end();
  });
}

/**
 * Build SSE data chunks that prepend the routing card before the model response.
 * Each line of the card is sent as a separate content delta.
 */
function buildSSECardChunks(card: string): string {
  const id = `openmark-${Date.now()}`;
  const lines = card.split('\n');
  let sse = '';

  for (const line of lines) {
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'openmark/auto',
      choices: [{
        index: 0,
        delta: { content: line + '\n' },
        finish_reason: null,
      }],
    };
    sse += `data: ${JSON.stringify(chunk)}\n\n`;
  }

  const separator = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'openmark/auto',
    choices: [{
      index: 0,
      delta: { content: '\n' },
      finish_reason: null,
    }],
  };
  sse += `data: ${JSON.stringify(separator)}\n\n`;

  return sse;
}

function buildProviderHeaders(apiKey: string, provider: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
  };

  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    delete headers['Authorization'];
  }

  return headers;
}

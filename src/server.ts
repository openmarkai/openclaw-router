import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type {
  PluginLogger,
  PluginConfig,
} from './types';
import { classify } from './classifier';
import { routeCategory, setPassthrough } from './router-bridge';
import { getUserOriginalModel } from './provider-inject';

let serverInstance: ReturnType<typeof createServer> | null = null;

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
  let chatReq: { messages?: Array<{ role: string; content?: string | null }> };
  try {
    chatReq = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request' } }));
    return;
  }

  const userMessage = extractLastUserMessage(chatReq);
  logger.debug(`[openmark-router] Incoming request — user message: ${userMessage?.slice(0, 80)}...`);

  const classResult = await classify(userMessage, config, pluginDir, logger);

  if (classResult.category) {
    logger.info(`[openmark-router] Classified as: ${classResult.category}`);
    const rec = await routeCategory(classResult.category, pluginDir, logger);

    if (rec && rec.status === 'ok' && rec.model) {
      logger.info(`[openmark-router] Routed to: ${rec.model}`);

      const card = config.show_routing_card ? (rec.card ?? '') : '';
      const responseText = card || `Routed to ${rec.model}. Send your message again to get a response from the routed model.`;
      sendTextResponse(res, responseText);
      return;
    }

    logger.info(`[openmark-router] No route found for ${classResult.category}, setting passthrough`);
  } else {
    logger.debug('[openmark-router] No category match, setting passthrough');
  }

  const passthroughModel = getUserOriginalModel() || config.no_route_passthrough;
  await setPassthrough(passthroughModel, pluginDir, logger);

  sendTextResponse(
    res,
    `No specific routing needed. Your next message will be handled by ${passthroughModel}.`,
  );
}

function sendTextResponse(res: ServerResponse, text: string): void {
  const responseBody = {
    id: `openmark-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'openmark/auto',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseBody));
}

function extractLastUserMessage(
  req: { messages?: Array<{ role: string; content?: string | null }> },
): string | null {
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

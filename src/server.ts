import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type {
  PluginLogger,
  PluginConfig,
} from './types';
import { routeCategory, setPassthrough, restore, getCategories } from './router-bridge';
import { clearMainConversationSessionBindings, getUserOriginalModel } from './provider-inject';

let serverInstance: ReturnType<typeof createServer> | null = null;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let cachedCategories: Array<{ name: string; display_name: string | null; description: string | null }> = [];
let cachedCategoriesAt = 0;
const CATEGORY_CACHE_TTL_MS = 300_000;
const INTERNAL_PROMPT_MARKERS = [
  'generate a short 1-2 word filename slug',
  'filename slug',
  'a new session was started via /new or /reset',
  'run your session startup sequence',
  'continue where you left off. the previous model attempt failed or timed out',
  'the previous model attempt failed or timed out',
  'openmark_classifier_internal',
];

/* eslint-disable @typescript-eslint/no-explicit-any */
let _runtime: any = null;
let _agentRuntimeBridge: any | null | undefined = undefined;

type ClassificationDecision =
  | { kind: 'match'; category: string }
  | { kind: 'none' }
  | { kind: 'error'; reason: string };

export function startServer(
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
  runtime?: any,
): void {
  _runtime = runtime ?? null;
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
  let chatReq: {
    stream?: boolean;
    messages?: Array<{ role: string; content?: string | null }>;
  };
  try {
    chatReq = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request' } }));
    return;
  }

  const userMessage = extractLastUserMessage(chatReq);
  logger.info(`[openmark-router] Incoming request — user message: ${userMessage?.slice(0, 80)}...`);

  if (!userMessage) {
    logger.debug('[openmark-router] No user message found — bypassing without state change');
    sendTextResponse(res, '', Boolean(chatReq.stream));
    return;
  }

  if (isInternalSystemPrompt(userMessage)) {
    logger.debug('[openmark-router] Internal OpenClaw prompt detected — bypassing without state change');
    sendTextResponse(res, '', Boolean(chatReq.stream));
    return;
  }

  if (userMessage.length < 10) {
    logger.debug('[openmark-router] Message too short for routing — treating as no-match');
    const passthroughModel = getUserOriginalModel() || config.no_route_passthrough;
    await setPassthrough(passthroughModel, pluginDir, logger);
    scheduleRestore(config, pluginDir, logger);
    sendTextResponse(res, `No routing match. Your next message will be handled by ${passthroughModel}.`, Boolean(chatReq.stream));
    return;
  }

  const decision = await classifyMessage(userMessage, config, pluginDir, logger);

  if (decision.kind === 'match') {
    logger.info(`[openmark-router] Classified as: ${decision.category}`);
    const rec = await routeCategory(decision.category, pluginDir, logger);

    if (rec && rec.status === 'ok' && rec.card) {
      logger.info(`[openmark-router] Routed to: ${rec.model_set ?? rec.model}`);
      scheduleRestore(config, pluginDir, logger);

      const card = config.show_routing_card ? rec.card : '';
      const responseText = card || `Routed to ${rec.model_set ?? rec.model}. Send your message again.`;
      sendTextResponse(res, responseText, Boolean(chatReq.stream));
      return;
    }

    logger.warn('[openmark-router] Routing command failed after successful classification');
    sendTextResponse(res, 'Routing failed for this request. Please send your message again.', Boolean(chatReq.stream));
    return;
  }

  if (decision.kind === 'error') {
    logger.warn(`[openmark-router] Classification failed without passthrough: ${decision.reason}`);
    sendTextResponse(res, 'Routing is temporarily unavailable. Please send your message again.', Boolean(chatReq.stream));
    return;
  }

  logger.info('[openmark-router] No classification match — setting passthrough');
  const passthroughModel = getUserOriginalModel() || config.no_route_passthrough;
  await setPassthrough(passthroughModel, pluginDir, logger);
  scheduleRestore(config, pluginDir, logger);
  sendTextResponse(res, `No routing match. Your next message will be handled by ${passthroughModel}.`, Boolean(chatReq.stream));
}

async function classifyMessage(
  userMessage: string,
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): Promise<ClassificationDecision> {
  const categories = await loadCategories(pluginDir, logger);
  if (categories.length === 0) {
    return { kind: 'error', reason: 'No benchmark categories available' };
  }

  const classifierModel = config.classifier_model || getUserOriginalModel();
  if (!classifierModel) {
    logger.warn('[openmark-router] No classifier model available');
    return { kind: 'error', reason: 'No classifier model available' };
  }

  if (isRouterAliasModel(classifierModel)) {
    logger.warn('[openmark-router] Classifier model resolved to openmark/auto — refusing to recurse');
    return { kind: 'error', reason: 'Classifier model cannot be openmark/auto' };
  }

  if (hasSimpleCompletionRuntime()) {
    return classifyViaSimpleCompletion(userMessage, categories, classifierModel, logger);
  }

  if (_runtime?.subagent?.run) {
    logger.warn('[openmark-router] Falling back to subagent classifier path');
    return classifyViaSubagent(userMessage, categories, classifierModel, logger);
  }

  logger.warn('[openmark-router] No OpenClaw classifier runtime available');
  return { kind: 'error', reason: 'No OpenClaw classifier runtime available' };
}

function hasSimpleCompletionRuntime(): boolean {
  return Boolean(resolveAgentRuntimeBridge());
}

function resolveAgentRuntimeBridge(): any | null {
  if (_agentRuntimeBridge !== undefined) {
    return _agentRuntimeBridge;
  }

  const probeSpecifiers = [
    process.argv[1],
    require.main?.filename,
    __filename,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  for (const specifier of probeSpecifiers) {
    try {
      const runtimeRequire = createRequire(specifier);
      _agentRuntimeBridge = runtimeRequire('openclaw/plugin-sdk/agent-runtime');
      return _agentRuntimeBridge;
    } catch {
      // Try the next host entrypoint.
    }
  }

  _agentRuntimeBridge = null;
  return null;
}

function buildClassifierPrompt(
  userMessage: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
): string {
  const categoryList = categories
    .map(c => `- ${c.name}: ${c.description || c.display_name || c.name}`)
    .join('\n');

  return (
    `OPENMARK_CLASSIFIER_INTERNAL\n` +
    `You are a task classifier. Given the user message below, determine which benchmark category it best matches.\n` +
    `Reply with ONLY the category name, nothing else. If no category matches, reply "none".\n\n` +
    `Categories:\n${categoryList}\n\n` +
    `User message: "${userMessage}"\n\nCategory:`
  );
}

function parseClassifierResponse(
  assistantText: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
  logger: PluginLogger,
  sourceLabel: string,
): ClassificationDecision {
  const raw = assistantText.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  logger.info(`[openmark-router] ${sourceLabel} response: "${assistantText.trim()}" -> parsed: "${raw}"`);

  const validNames = categories.map(c => c.name);
  if (validNames.includes(raw)) return { kind: 'match', category: raw };

  for (const name of validNames) {
    if (raw.includes(name) || name.includes(raw)) {
      return { kind: 'match', category: name };
    }
  }

  if (raw === 'none' || raw === '') return { kind: 'none' };
  logger.debug(`[openmark-router] ${sourceLabel} response "${raw}" did not match any category`);
  return { kind: 'none' };
}

function summarizeAssistantMessage(message: any): string {
  if (!message || typeof message !== 'object') {
    return 'missing';
  }

  const content = Array.isArray(message.content) ? message.content : [];
  const contentTypes = content
    .filter((part: unknown): part is Record<string, unknown> => typeof part === 'object' && part !== null)
    .map((part: Record<string, unknown>) => String(part.type ?? 'unknown'));

  return JSON.stringify({
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    provider: message.provider,
    model: message.model,
    contentTypes,
    contentItems: content.length,
  });
}

async function classifyViaSimpleCompletion(
  userMessage: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
  classifierModel: string,
  logger: PluginLogger,
): Promise<ClassificationDecision> {
  const agentRuntimeBridge = resolveAgentRuntimeBridge();
  if (!agentRuntimeBridge) {
    return { kind: 'error', reason: 'openclaw/plugin-sdk/agent-runtime not resolvable' };
  }

  const { provider, model } = splitModelId(classifierModel);
  if (!provider || !model) {
    return { kind: 'error', reason: `Invalid classifier model: ${classifierModel}` };
  }

  const prompt = buildClassifierPrompt(userMessage, categories);

  try {
    const cfg = typeof _runtime?.config?.loadConfig === 'function'
      ? await _runtime.config.loadConfig()
      : undefined;
    const agentDir = cfg && typeof _runtime?.agent?.resolveAgentDir === 'function'
      ? _runtime.agent.resolveAgentDir(cfg)
      : undefined;

    logger.info(`[openmark-router] Classifying via simple completion (model: ${classifierModel}, isolated prompt)`);

    const prepared = await agentRuntimeBridge.prepareSimpleCompletionModel({
      cfg,
      provider,
      modelId: model,
      agentDir,
    });

    if (!prepared || typeof prepared !== 'object' || 'error' in prepared) {
      const reason = prepared && typeof prepared.error === 'string'
        ? prepared.error
        : 'Failed to prepare simple completion model';
      logger.warn(`[openmark-router] Simple completion preparation failed: ${reason}`);
      return { kind: 'error', reason };
    }

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const assistantMsg = await agentRuntimeBridge.completeWithPreparedSimpleCompletionModel({
        model: prepared.model,
        auth: prepared.auth,
        context: {
          messages: [{
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
          }],
        },
        options: {
          temperature: 0,
          maxTokens: 40,
          reasoning: 'minimal',
        },
      });

      const assistantText = contentToText(assistantMsg?.content);
      if (assistantText) {
        return parseClassifierResponse(assistantText, categories, logger, 'Simple completion');
      }

      logger.warn(
        `[openmark-router] Simple completion attempt ${attempt}/${maxAttempts} returned no text; summary=${summarizeAssistantMessage(assistantMsg)}`,
      );
      if (attempt < maxAttempts) {
        logger.info('[openmark-router] Retrying simple completion classifier once');
      }
    }

    return { kind: 'error', reason: 'Simple completion returned no content' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] Simple completion classification failed: ${msg}`);
    return { kind: 'error', reason: msg };
  }
}

async function classifyViaSubagent(
  userMessage: string,
  categories: Array<{ name: string; display_name: string | null; description: string | null }>,
  classifierModel: string,
  logger: PluginLogger,
): Promise<ClassificationDecision> {
  const prompt = buildClassifierPrompt(userMessage, categories);

  const sessionKey = `openmark-classify-${Date.now()}-${randomUUID()}`;
  const idempotencyKey = `openmark-classify:${sessionKey}`;
  const { provider, model } = splitModelId(classifierModel);

  try {
    logger.info(`[openmark-router] Classifying via subagent (model: ${classifierModel})`);

    const { runId } = await _runtime.subagent.run({
      sessionKey,
      idempotencyKey,
      message: prompt,
      provider,
      model,
      deliver: false,
    });

    await _runtime.subagent.waitForRun({ runId, timeoutMs: 15_000 });

    const sessionResult = await _runtime.subagent.getSessionMessages({ sessionKey, limit: 5 });
    const messages = Array.isArray(sessionResult?.messages) ? sessionResult.messages : [];
    const assistantMsg = messages?.filter((m: any) => m.role === 'assistant').pop();

    try { await _runtime.subagent.deleteSession({ sessionKey }); } catch { /* cleanup */ }

    const assistantText = contentToText(assistantMsg?.content);
    if (!assistantText) {
      logger.warn('[openmark-router] Subagent returned no content');
      return { kind: 'error', reason: 'Subagent returned no content' };
    }

    return parseClassifierResponse(assistantText, categories, logger, 'Subagent');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[openmark-router] Subagent classification failed: ${msg}`);
    return { kind: 'error', reason: msg };
  }
}

async function loadCategories(
  pluginDir: string,
  logger: PluginLogger,
): Promise<Array<{ name: string; display_name: string | null; description: string | null }>> {
  const now = Date.now();
  if (cachedCategories.length > 0 && now - cachedCategoriesAt < CATEGORY_CACHE_TTL_MS) {
    return cachedCategories;
  }
  cachedCategories = await getCategories(pluginDir, logger);
  cachedCategoriesAt = now;
  return cachedCategories;
}

function scheduleRestore(
  config: PluginConfig,
  pluginDir: string,
  logger: PluginLogger,
): void {
  if (restoreTimer) {
    clearTimeout(restoreTimer);
  }

  const delayMs = (config.restore_delay_s || 30) * 1000;
  logger.debug(`[openmark-router] Scheduling timer restore in ${config.restore_delay_s || 30}s`);

  restoreTimer = setTimeout(async () => {
    restoreTimer = null;
    try {
      const result = await restore(pluginDir, logger);
      if (result && result.status === 'ok') {
        clearMainConversationSessionBindings(logger, 'timer-restore');
        logger.info(`[openmark-router] Timer-restored to ${result.model_set ?? 'openmark/auto'}`);
      } else if (result && result.status === 'no_state') {
        logger.debug('[openmark-router] Timer restore: no state (hook already restored)');
      } else {
        logger.warn(`[openmark-router] Timer restore returned: ${JSON.stringify(result)}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[openmark-router] Timer restore failed: ${msg}`);
    }
  }, delayMs);
}

function sendTextResponse(res: ServerResponse, text: string, stream = false): void {
  if (stream && text.length > 0) {
    sendStreamingTextResponse(res, text);
    return;
  }

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

function sendStreamingTextResponse(res: ServerResponse, text: string): void {
  const created = Math.floor(Date.now() / 1000);
  const id = `openmark-${Date.now()}`;
  const model = 'openmark/auto';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const startChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{
      index: 0,
      delta: { role: 'assistant' },
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(startChunk)}\n\n`);

  if (text) {
    const contentChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: { content: text },
        finish_reason: null,
      }],
    };
    res.write(`data: ${JSON.stringify(contentChunk)}\n\n`);
  }

  const stopChunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: text ? 1 : 0,
      total_tokens: text ? 1 : 0,
    },
  };
  res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}

function isInternalSystemPrompt(text: string): boolean {
  const normalized = text.toLowerCase();
  return INTERNAL_PROMPT_MARKERS.some(marker => normalized.includes(marker));
}

function isRouterAliasModel(modelId: string): boolean {
  return modelId.trim().toLowerCase() === 'openmark/auto';
}

function splitModelId(modelId: string): { provider?: string; model: string } {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) {
    return { model: modelId };
  }

  return {
    provider: modelId.slice(0, slashIdx),
    model: modelId.slice(slashIdx + 1),
  };
}

function contentToText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .filter((part): part is { type?: string; text?: string } => typeof part === 'object' && part !== null)
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string);
    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  return null;
}

function extractLastUserMessage(
  req: { messages?: Array<{ role: string; content?: string | null }> },
): string | null {
  if (!req.messages || !Array.isArray(req.messages)) return null;
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const msg = req.messages[i];
    if (msg.role !== 'user' || !msg.content) continue;

    const text = contentToText(msg.content);
    if (text) return text;
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

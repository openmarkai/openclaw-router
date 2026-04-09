/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PluginLogger {
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface PluginConfig {
  classifier_model: string;
  no_route_passthrough: string;
  port: number;
  gateway_port: number;
  show_routing_card: boolean;
  restore_delay_s: number;
}

export interface PluginApi {
  logger: PluginLogger;
  pluginConfig: Record<string, unknown>;
  registerProvider: (opts: ProviderRegistration) => void;
  registerService: (opts: ServiceRegistration) => void;
  on: (event: string, handler: (event: any) => Promise<void> | void, opts?: { priority?: number }) => void;
  config?: any;
  runtime?: {
    modelAuth?: {
      getApiKeyForModel?: (modelId: string) => string | undefined;
    };
  };
}

export interface ProviderRegistration {
  id: string;
  label: string;
  envVars?: string[];
  auth?: ProviderAuth[];
  models: ProviderModels;
}

export interface ProviderAuth {
  id: string;
  label: string;
  hint: string;
  kind: string;
  run?: (ctx: any) => Promise<any>;
}

export interface ProviderModels {
  baseUrl: string;
  api: 'openai-completions';
  models: ProviderModelEntry[];
}

export interface ProviderModelEntry {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

export interface ServiceRegistration {
  id: string;
  start: () => void | Promise<void>;
}

export interface OpenClawConfig {
  models?: {
    providers?: Record<string, ProviderConfig>;
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      models?: Record<string, unknown> | string[];
    };
  };
  [key: string]: unknown;
}

export interface ProviderConfig {
  baseUrl: string;
  api: string;
  apiKey?: string;
  models?: { id: string; name: string }[];
}

export interface RouterRecommendation {
  status: string;
  task?: string;
  model?: string;
  card?: string;
  fallbacks?: string[];
  display_name?: string;
  strategy?: string;
  model_set?: string;
  primary?: {
    model: string;
    provider: string;
    score_pct: number;
    cost: number;
    time_s: number;
    [key: string]: unknown;
  };
  message?: string;
}

export interface ClassifierResult {
  category: string | null;
  confidence: number;
  raw_response: string;
}

export interface CategoryInfo {
  name: string;
  display_name: string | null;
  description: string | null;
}

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const CACHE_TTL_MS = 60_000;
let cachedCategories: Array<{
  name: string;
  display_name: string;
  description: string;
}> | null = null;
let cacheTimestamp = 0;

function getBaseDir(): string | null {
  const candidates = [
    __dirname,
    resolve(
      process.env.OPENCLAW_WORKSPACE_DIR ||
        join(
          process.env.HOME || process.env.USERPROFILE || "",
          ".openclaw",
          "workspace",
        ),
      "skills",
      "openmark-router",
    ),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "scripts", "router.py"))) return dir;
  }
  return null;
}

function runRouter(
  baseDir: string,
  args: string[],
): { ok: boolean; data: Record<string, unknown> } {
  const configPath = join(baseDir, "config.json");
  try {
    const stdout = execFileSync(
      "python3",
      [join(baseDir, "scripts", "router.py"), ...args, "--config", configPath],
      {
        timeout: 60_000,
        encoding: "utf-8",
        cwd: baseDir,
        shell: process.platform === "win32",
      },
    );
    return { ok: true, data: JSON.parse(stdout.trim()) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, data: { error: message } };
  }
}

function getCategories(baseDir: string) {
  const now = Date.now();
  if (cachedCategories !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCategories;
  }

  const result = runRouter(baseDir, ["--classify"]);
  if (
    result.ok &&
    (result.data as { action?: string }).action === "classify" &&
    Array.isArray((result.data as { categories?: unknown[] }).categories)
  ) {
    cachedCategories = (result.data as { categories: typeof cachedCategories })
      .categories;
  } else {
    cachedCategories = null;
  }
  cacheTimestamp = now;
  return cachedCategories;
}

function isGreeting(text: string): boolean {
  if (!text || text.length < 3) return true;
  const t = text.trim().toLowerCase();
  if (t.length > 80) return false;
  const patterns = [
    /^(hi|hey|hello|yo|sup|hola|howdy|hiya|morning|evening|afternoon)\b/,
    /^(thanks|thank you|thx|ty|cheers|ok|okay|k|sure|yep|yes|no|nah|bye|goodbye|later|cya)\b/,
    /^(good morning|good evening|good night|good afternoon)\b/,
    /^\//,
  ];
  return patterns.some((r) => r.test(t));
}

export default definePluginEntry({
  id: "openmark-router",
  name: "OpenMark AI Router",
  description:
    "Benchmark-driven model routing. Routes tasks to optimal models using real evaluation data from OpenMark AI.",

  register(api) {
    const baseDir = getBaseDir();

    api.registerTool({
      name: "route_task",
      description:
        "Route to the optimal model for a benchmark category. " +
        "Call this when a user message matches one of the benchmark " +
        "categories injected into the conversation. Pass the category " +
        "name and optionally a strategy override.",
      parameters: Type.Object({
        category: Type.String({
          description:
            "The benchmark category name to route to (e.g. 'academic_research_potential')",
        }),
        strategy: Type.Optional(
          Type.String({
            description:
              "Routing strategy override: balanced, best_score, best_cost_efficiency, best_under_budget, best_under_latency",
          }),
        ),
      }),

      async execute(_id, params) {
        if (!baseDir) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "error",
                  message:
                    "OpenMark Router scripts not found. Ensure the plugin is installed correctly.",
                }),
              },
            ],
          };
        }

        const args = ["--route", params.category];
        if (params.strategy) {
          args.push("--strategy", params.strategy);
        }

        const result = runRouter(baseDir, args);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      },
    });

    api.registerHook({
      event: "message:preprocessed",
      async handler(event) {
        if (event.type !== "message" || event.action !== "preprocessed") return;
        const body = (event.context as { bodyForAgent?: string })?.bodyForAgent;
        if (!body || typeof body !== "string") return;
        if (isGreeting(body)) return;
        if (!baseDir) return;

        const categories = getCategories(baseDir);
        if (!categories || categories.length === 0) return;

        const lines = [
          "[OPENMARK ROUTER: Benchmark categories available. If the user's message matches a category, call the route_task tool with the category name. If none match, respond normally.]",
          "",
        ];
        for (const cat of categories) {
          lines.push(
            `- ${cat.name}: ${cat.display_name} — ${cat.description}`,
          );
        }
        lines.push("");

        (event.context as { bodyForAgent: string }).bodyForAgent =
          lines.join("\n") + body;
      },
    });
  },
});

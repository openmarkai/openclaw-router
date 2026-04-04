import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

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

function loadCategories(baseDir: string): Array<{
  name: string;
  display_name: string;
  description: string;
}> {
  const result = runRouter(baseDir, ["--classify"]);
  if (
    result.ok &&
    (result.data as { action?: string }).action === "classify" &&
    Array.isArray((result.data as { categories?: unknown[] }).categories)
  ) {
    return (
      result.data as {
        categories: Array<{
          name: string;
          display_name: string;
          description: string;
        }>;
      }
    ).categories;
  }
  return [];
}

function buildToolDescription(
  categories: Array<{
    name: string;
    display_name: string;
    description: string;
  }>,
): string {
  const base =
    "Route to the optimal model for a task. " +
    "BEFORE answering any substantive user message, check if it matches one of " +
    "the benchmark categories below. If it does, call this tool with the " +
    "category name. Display the routing card from the result, then answer " +
    "the user's request. If no category matches, skip this tool and respond normally. " +
    "Do NOT call this for greetings, follow-ups, or casual chat.";

  if (categories.length === 0) {
    return base + "\n\nNo benchmark categories are currently loaded.";
  }

  const catLines = categories
    .map((c) => `- ${c.name}: ${c.display_name} — ${c.description}`)
    .join("\n");

  return `${base}\n\nAvailable benchmark categories:\n${catLines}`;
}

export default definePluginEntry({
  id: "openmark-router",
  name: "OpenMark AI Router",
  description:
    "Benchmark-driven model routing. Routes tasks to optimal models using real evaluation data from OpenMark AI.",

  register(api) {
    const baseDir = getBaseDir();
    const categories = baseDir ? loadCategories(baseDir) : [];

    api.logger.info(
      `[openmark-router] loaded ${categories.length} benchmark categories`,
    );

    api.registerTool({
      name: "route_task",
      description: buildToolDescription(categories),
      parameters: {
        type: "object" as const,
        properties: {
          category: {
            type: "string" as const,
            description:
              "The benchmark category name to route to (e.g. 'academic_research_potential')",
          },
          strategy: {
            type: "string" as const,
            description:
              "Routing strategy override: balanced, best_score, best_cost_efficiency, best_under_budget, best_under_latency",
          },
        },
        required: ["category"],
      },

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
  },
});

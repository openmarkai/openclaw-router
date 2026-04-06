import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_MAX_AGE_MS = 3600_000; // 1 hour

function findSkillDir() {
  const home = homedir();
  const workspaceDir =
    process.env.OPENCLAW_WORKSPACE_DIR ||
    join(home, ".openclaw", "workspace");

  const candidates = [
    join(workspaceDir, "skills", "openmark-router"),
    join(home, ".openclaw", "skills", "openmark-router"),
  ];

  for (const dir of candidates) {
    if (existsSync(join(dir, "scripts", "router.py"))) {
      return dir;
    }
  }
  return null;
}

function readRoutingState(skillDir) {
  const statePath = join(skillDir, ".routing_state.json");
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

function cacheIsFresh(skillDir) {
  const cachePath = join(skillDir, "categories.json");
  if (!existsSync(cachePath)) return false;
  try {
    const stat = statSync(cachePath);
    return Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function readCachedCategories(skillDir) {
  try {
    const raw = readFileSync(join(skillDir, "categories.json"), "utf-8");
    const data = JSON.parse(raw);
    if (data.action === "classify" && Array.isArray(data.categories)) {
      return data.categories;
    }
  } catch {
    // fall through
  }
  return null;
}

function runClassify(skillDir) {
  const routerPath = join(skillDir, "scripts", "router.py");
  const configPath = join(skillDir, "config.json");
  try {
    const stdout = execFileSync("python3", [
      routerPath, "--classify", "--config", configPath,
    ], { encoding: "utf-8", timeout: 30_000 });

    const data = JSON.parse(stdout);
    if (data.action === "classify" && Array.isArray(data.categories)) {
      return data.categories;
    }
  } catch {
    // Python not available or script error — fall through to cache
  }
  return null;
}

function buildCategoryBlock(cat, routerPath, configPath) {
  const desc = cat.description || "";
  const name = cat.display_name || cat.name;
  const cmd =
    `exec python3 ${routerPath} --route ${cat.name} --card --config ${configPath}`;

  return `- **${name}** — ${desc}\n\n      ${cmd}`;
}

const handler = async (event) => {
  const files = event.context?.bootstrapFiles;
  if (!Array.isArray(files)) return;

  const skillDir = findSkillDir();
  if (!skillDir) return;

  const routingState = readRoutingState(skillDir);

  if (routingState?.manual) {
    return;
  }

  let categories = null;

  if (routingState || !cacheIsFresh(skillDir)) {
    categories = runClassify(skillDir);
    if (!categories) {
      categories = readCachedCategories(skillDir);
    }
  } else {
    categories = readCachedCategories(skillDir);
  }

  if (!categories || categories.length === 0) return;

  const routerPath = skillDir.replace(/\\/g, "/") + "/scripts/router.py";
  const configPath = skillDir.replace(/\\/g, "/") + "/config.json";

  const categoryBlocks = categories
    .map((c) => buildCategoryBlock(c, routerPath, configPath))
    .join("\n\n");

  const routingMd = `# Model Routing — ROUTING.md

Task categories loaded from benchmarks. For every substantive user message,
match it to one of these categories. If it matches, run the exact command
shown. Include the command output verbatim at the top of your reply.

${categoryBlocks}

Skip routing for greetings, follow-ups, yes/no answers, or casual chat.`;

  files.push({
    path: "virtual://openmark-router/ROUTING.md",
    baseName: "ROUTING.md",
    content: routingMd,
  });
};

export default handler;

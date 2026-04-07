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

function buildCategoryLine(cat) {
  const desc = cat.description || "";
  const displayName = cat.display_name || cat.name;
  return `- \`${cat.name}\` — ${displayName}: ${desc}`;
}

const handler = async (event) => {
  const tag = `[openmark-router]`;
  console.log(`${tag} agent:bootstrap fired — agentId=${event.context?.agentId ?? "unknown"}`);

  const files = event.context?.bootstrapFiles;
  if (!Array.isArray(files)) {
    console.log(`${tag} SKIP — no bootstrapFiles array`);
    return;
  }

  const skillDir = findSkillDir();
  if (!skillDir) {
    console.log(`${tag} SKIP — skill dir not found`);
    return;
  }
  console.log(`${tag} skill dir: ${skillDir}`);

  const routingState = readRoutingState(skillDir);

  if (routingState?.manual) {
    files.push({
      path: "virtual://openmark-router/ROUTING.md",
      baseName: "ROUTING.md",
      content: `# ROUTING.md — Model Routing\n\nManual lock active: model is locked to \`${routingState.routed_category || "unknown"}\`.\nDo NOT run any routing commands. Reply normally.\nTo unlock, the user can send \`/openmark_router off\`.`,
    });
    return;
  }

  let stateAge = Infinity;
  if (routingState) {
    try {
      stateAge = Date.now() - statSync(join(skillDir, ".routing_state.json")).mtimeMs;
    } catch {}
  }

  const shouldRestore = routingState && !routingState.manual && stateAge > 60_000;

  let categories;
  if (shouldRestore) {
    console.log(`${tag} state is ${Math.round(stateAge / 1000)}s old — auto-restoring`);
    categories = runClassify(skillDir);
    if (!categories) categories = readCachedCategories(skillDir);
  } else {
    if (routingState) {
      console.log(`${tag} state is ${Math.round(stateAge / 1000)}s old — skipping restore (same turn)`);
    }
    categories = readCachedCategories(skillDir);
    if (!categories) {
      console.log(`${tag} cache miss — running classify to generate cache`);
      categories = runClassify(skillDir);
    }
  }

  if (!categories || categories.length === 0) {
    console.log(`${tag} SKIP — no categories loaded`);
    return;
  }

  console.log(`${tag} ${categories.length} categories loaded — injecting ROUTING.md`);
  const routePath = skillDir.replace(/\\/g, "/") + "/scripts/route.py";

  const categoryLines = categories.map((c) => buildCategoryLine(c)).join("\n");

  const routingMd = `# ROUTING.md — Model Routing

Match the user message to a task below.

## Tasks

${categoryLines}

## Action

If a task matches, run:

    exec python3 ${routePath} TASK_NAME

Replace TASK_NAME with the matching task name (the backtick-quoted value).
Include the command output verbatim at the top of your reply.
Skip routing for greetings, or if no task matches.

## Manual Commands

When the user sends \`/openmark_router\`:
- Without args: list the tasks above.
- With a task name: run \`exec python3 ${routePath} TASK_NAME --lock\`
  This locks the model so it stays active across messages.
- \`/openmark_router off\`: run \`exec python3 ${routePath} --unlock\``;

  files.push({
    path: "virtual://openmark-router/ROUTING.md",
    baseName: "ROUTING.md",
    content: routingMd,
  });
};

export default handler;

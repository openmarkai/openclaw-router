import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CACHE_TTL_MS = 60_000;
let cachedCategories = null;
let cacheTimestamp = 0;

function findSkillDir(workspaceDir) {
  const candidates = [
    join(workspaceDir, "skills", "openmark-router"),
    join(workspaceDir, "skills", "openclaw-router"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "scripts", "router.py"))) return dir;
  }
  return null;
}

function getCategories(skillDir) {
  const now = Date.now();
  if (cachedCategories && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCategories;
  }

  const configPath = join(skillDir, "config.json");
  try {
    const result = execFileSync("python3", [
      join(skillDir, "scripts", "router.py"),
      "--classify",
      "--config",
      configPath,
    ], {
      timeout: 30_000,
      encoding: "utf-8",
      cwd: skillDir,
    });

    const parsed = JSON.parse(result.trim());
    if (parsed.action === "classify" && parsed.categories?.length > 0) {
      cachedCategories = parsed.categories;
    } else {
      cachedCategories = null;
    }
  } catch {
    cachedCategories = null;
  }

  cacheTimestamp = now;
  return cachedCategories;
}

function isGreeting(text) {
  if (!text || text.length < 3) return true;
  const t = text.trim().toLowerCase();
  if (t.length > 80) return false;
  const greetings = [
    /^(hi|hey|hello|yo|sup|hola|howdy|hiya|morning|evening|afternoon)\b/,
    /^(thanks|thank you|thx|ty|cheers|ok|okay|k|sure|yep|yes|no|nah|bye|goodbye|later|cya)\b/,
    /^(good morning|good evening|good night|good afternoon)\b/,
    /^\//, // slash commands
  ];
  return greetings.some((r) => r.test(t));
}

function buildInjection(categories) {
  const lines = [
    "[OPENMARK ROUTER — benchmark categories detected. If the user's message matches a category below, call the route_task tool with the category name. Display the card from the result, then answer. If no category matches, respond normally.]",
    "",
  ];

  for (const cat of categories) {
    lines.push(`- ${cat.name}: ${cat.display_name} — ${cat.description}`);
  }

  lines.push("");
  return lines.join("\n");
}

const handler = async (event) => {
  if (event.type !== "message" || event.action !== "preprocessed") {
    return;
  }

  const body = event.context?.bodyForAgent;
  if (!body || typeof body !== "string") return;
  if (isGreeting(body)) return;

  const workspaceDir = event.context?.workspaceDir
    || process.env.OPENCLAW_WORKSPACE_DIR
    || join(process.env.HOME || process.env.USERPROFILE || "", ".openclaw", "workspace");

  const skillDir = findSkillDir(workspaceDir);
  if (!skillDir) return;

  const categories = getCategories(skillDir);
  if (!categories || categories.length === 0) return;

  const injection = buildInjection(categories);
  event.context.bodyForAgent = injection + body;
};

export default handler;

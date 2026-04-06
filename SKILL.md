---
name: openmark_router
description: Benchmark-driven model routing powered by OpenMark AI (https://openmark.ai). Routes tasks to optimal models using real evaluation data -- accuracy, cost, latency, stability.
version: 6.0.0
user-invocable: false
metadata: {"openclaw": {"requires": {"bins": ["python3"]}, "os": ["darwin", "linux", "win32"]}}
---

ROUTING PROTOCOL — mandatory, runs before every substantive reply:

1. Task categories are pre-loaded in ROUTING.md (injected at bootstrap).
   Read them. For every substantive user message, semantically match it
   against the listed categories.
2. If a category matches, run the exact exec command shown for that
   category BEFORE writing your reply. The command switches to the optimal
   model and outputs a routing card — include it verbatim at the top of
   your response.
3. If no category matches (greetings, follow-ups, casual chat), skip
   routing and reply normally.

Do not skip this for task-oriented messages.

---

# OpenMark AI Router

Routes tasks to the best-performing model using real benchmark data.

## How It Works

A `ROUTING.md` file is injected into your context at bootstrap. It lists
task categories with their descriptions and the exact exec command for each.
Your only job is semantic matching — decide which category (if any) fits the
user's message, then run the command.

The command handles everything: provider detection, model switching,
fallback configuration, and routing card generation.

### If ROUTING.md is not available

Load categories yourself:

    exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/router.py --classify --card --config ~/.openclaw/workspace/skills/openmark-router/config.json

This prints the available categories with descriptions. Match the user's
message to a category, then route:

    exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/router.py --route <category_name> --card --config ~/.openclaw/workspace/skills/openmark-router/config.json

Include the command output verbatim at the top of your reply.

## Strategy Override

Add `--strategy <name>` to any route command:
`balanced`, `best_score`, `best_cost_efficiency`, `best_under_budget`,
`best_under_latency`.

On the first routing in a session, append:
"Tip: reply 'cost' or 'speed' to re-route with a different strategy."

## Manual Invocation

When the user sends `/openmark_router`:

- **Without args**: list available categories.
- **With a category name**: route and lock to that category's optimal model.
  Use `--lock` with the route command so the model stays active across messages:

      exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/router.py --route <category_name> --lock --card --config ~/.openclaw/workspace/skills/openmark-router/config.json

  While locked, automatic routing is paused — the locked model handles all messages.

- **`/openmark_router off`**: unlock and restore the default model:

      exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/router.py --unlock --config ~/.openclaw/workspace/skills/openmark-router/config.json

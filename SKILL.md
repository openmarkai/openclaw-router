---
name: openmark_router
description: Benchmark-driven model routing powered by OpenMark AI (https://openmark.ai). Routes tasks to optimal models using real evaluation data -- accuracy, cost, latency, stability.
version: 6.0.0
user-invocable: false
metadata: {"openclaw": {"requires": {"bins": ["python3"]}, "os": ["darwin", "linux", "win32"]}}
---

ROUTING PROTOCOL — mandatory, runs before every substantive reply:

1. Task categories are pre-loaded in ROUTING.md (injected at bootstrap).
   For every substantive user message, semantically match it against the
   listed tasks.
2. If a task matches, run the exec command shown in ROUTING.md, replacing
   TASK_NAME with the matching task name. The command switches to the
   optimal model and outputs a routing card — include it verbatim at the
   top of your response.
3. If no task matches (greetings, follow-ups, casual chat), skip routing
   and reply normally.

Do not skip this for task-oriented messages.

---

# OpenMark AI Router

Routes tasks to the best-performing model using real benchmark data.

## How It Works

A `ROUTING.md` file is injected into your context at bootstrap. It shows
one command template and a list of tasks with their `task_name` and
description. Your only job is semantic matching — decide which task (if any)
fits the user's message, then run the command with that task_name.

The command handles everything: provider detection, model switching,
fallback configuration, and routing card generation.

### If ROUTING.md is not available

Load categories yourself:

    exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/route.py --classify

Then match the user's message to a task name, and route:

    exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/route.py TASK_NAME

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
- **With a task name**: route and lock to that task's optimal model:

      exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/route.py TASK_NAME --lock

  While locked, automatic routing is paused — the locked model handles all messages.

- **`/openmark_router off`**: unlock and restore the default model:

      exec python3 ~/.openclaw/workspace/skills/openmark-router/scripts/route.py --unlock

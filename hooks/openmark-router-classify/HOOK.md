---
name: openmark-router-classify
description: Injects OpenMark benchmark categories into every substantive message so the agent can call route_task.
metadata:
  { "openclaw": { "emoji": "🔗", "events": ["message:preprocessed"], "requires": { "bins": ["python3"] } } }
---

Runs `--classify` on every non-greeting message, caches results for 60 seconds,
and prepends available benchmark categories to `bodyForAgent`. The agent then
calls the `route_task` plugin tool with the matching category name.

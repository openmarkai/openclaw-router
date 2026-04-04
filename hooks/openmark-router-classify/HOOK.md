---
name: openmark-router-classify
event: message:preprocessed
description: Injects OpenMark benchmark categories into every substantive message so the agent can call route_task.
priority: 100
enabled: true
---

Runs `--classify` on every non-greeting message, caches results for 60 seconds,
and prepends available benchmark categories to `bodyForAgent`. The agent then
calls the `route_task` plugin tool with the matching category name.

---
name: openmark_router
description: Benchmark-driven model routing powered by OpenMark AI. Routes tasks to optimal models using real evaluation data.
version: 3.0.0
user-invocable: false
metadata: {"openclaw": {"requires": {"bins": ["python3"]}, "os": ["darwin", "linux", "win32"]}}
---

# OpenMark AI Router

Routes your agent to the best model for each task using benchmark data from
[OpenMark AI](https://openmark.ai). Accuracy, cost, latency, and stability --
measured on your actual tasks, not generic leaderboards.

This skill provides discovery metadata. All routing logic is handled by the
`openmark-router` plugin, which registers the `route_task` tool and
automatically injects benchmark categories into every message.

Install the plugin: `openclaw plugins install openmark-router`

See the [README](https://github.com/openmarkai/openclaw-router) for setup,
configuration, and how the routing engine works.

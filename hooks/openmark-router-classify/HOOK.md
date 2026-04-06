---
name: openmark-router-classify
description: Loads benchmark categories and injects routing rules into agent bootstrap context.
metadata:
  { "openclaw": { "events": ["agent:bootstrap"] } }
---

At bootstrap, loads benchmark categories (from cache or by running
`router.py --classify`) and injects a virtual `ROUTING.md` file into the
agent's context. Each category entry includes the exact `exec` command
for routing, so the agent can route with a single tool call.

Also handles auto-restore: if a previous routing state exists, calling
`--classify` restores the default model before returning categories.

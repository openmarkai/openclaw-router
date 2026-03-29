---
name: openmark_router
description: Benchmark-driven model routing powered by OpenMark AI. Routes tasks to optimal models based on real evaluation data — accuracy, cost, latency, stability — not keyword heuristics or complexity tiers.
version: 1.0.0
user-invocable: true
metadata: {"openclaw": {"requires": {"bins": ["python3"]}, "os": ["darwin", "linux", "win32"]}}
---

# OpenMark AI Router

## What This Skill Does

Routes your agent to the best model for each task type, using benchmark
results from OpenMark AI (https://openmark.ai) instead of guessing by
complexity tier.

Every existing routing approach classifies tasks into tiers like "simple" or
"complex" and maps them to hardcoded models. This fails because model
performance is task-specific, not complexity-specific. A model that wins on
email classification may lose on legal document extraction, even if both are
"medium" complexity.

This skill uses real benchmark data from your actual tasks to make routing
decisions based on accuracy, cost-efficiency, latency, and stability.

## Setup

1. Benchmark your recurring tasks on OpenMark AI (https://openmark.ai)
2. Export results as CSV from the Results tab
3. Place each CSV in this skill's `{baseDir}/benchmarks/` folder
   - Name each file after the task category (e.g., `email_classification.csv`)
4. Edit `{baseDir}/config.json` to set your available providers and routing strategy

## Available Task Categories

To see which task categories have benchmark data loaded:

```bash
python3 {baseDir}/scripts/router.py --list-categories --config {baseDir}/config.json
```

## How to Route

### Automatic (agent classifies the task)

Before executing a task, determine which benchmark category it best matches
from the available categories above. Then call the router:

```bash
python3 {baseDir}/scripts/router.py --task "category_name" --config {baseDir}/config.json
```

### Manual (user specifies the task category)

When the user invokes this skill directly with a task category name:

```bash
python3 {baseDir}/scripts/router.py --task "user_provided_category" --config {baseDir}/config.json
```

### With a specific strategy

Override the default routing strategy:

```bash
python3 {baseDir}/scripts/router.py --task "category_name" --strategy best_cost_efficiency --config {baseDir}/config.json
```

## Reading the Output

The router returns JSON with these fields:

- `status`: "ok" (match found), "no_match" (no benchmark data), "no_models" (all filtered)
- `primary.model`: The recommended OpenClaw model ID — use this with `/model`
- `fallbacks`: 1-2 alternative models ranked next-best
- `primary.score_pct`: Benchmark accuracy percentage
- `primary.cost`: Actual benchmark cost per run
- `primary.acc_per_dollar`: Cost-efficiency metric (higher = better)
- `primary.stability`: Score variance across stability runs (lower = more consistent)
- `freshness.stale`: Whether the benchmark data is older than the configured warning threshold
- `reason`: Why this model was selected

## After Getting a Recommendation

1. If `status` is "ok": switch to the recommended model using `/model <primary.model>`
2. Tell the user which model was selected and why (include score, cost, and strategy)
3. If `freshness.stale` is true: warn the user that benchmark data may be outdated
4. Proceed with the task using the selected model

## Routing Strategies

- `best_score` — Highest accuracy
- `best_cost_efficiency` — Best accuracy per dollar (Acc/$)
- `best_under_budget` — Highest score under cost ceiling
- `best_under_latency` — Highest score under latency ceiling
- `balanced` — Weighted: accuracy (40%), cost-efficiency (30%), speed (20%), stability (10%)

## When No Category Matches

If `status` is "no_match", use the default model from config.json. Tell the user:

"No benchmark data for this task type. Using default model. Consider
benchmarking this task on OpenMark AI (https://openmark.ai) to get
data-driven routing."

## Manual Override

If the user says "use [model]" or specifies a model directly, skip routing
and use the requested model. Do not override explicit user model choices.

## Freshness

If `freshness.stale` is true, tell the user: "Benchmark data for this task
is [X] days old. Results may not reflect current model performance. Consider
re-benchmarking on OpenMark AI."

## Config Reference

`{baseDir}/config.json` fields:

- `available_providers`: List of providers you have API keys for
- `default_model`: Fallback when no benchmark matches
- `routing_strategy`: Default strategy (balanced, best_score, best_cost_efficiency, best_under_budget, best_under_latency)
- `cost_ceiling`: Max cost per run for best_under_budget strategy
- `latency_ceiling_s`: Max seconds for best_under_latency strategy
- `freshness_warning_days`: Days before showing stale data warning (default: 30)
- `min_completion_pct`: Skip models below this completion rate (default: 80)
- `min_stability_threshold`: Skip models with variance above this (default: 10.0)
- `fallback_count`: Number of fallback models to return (default: 2)

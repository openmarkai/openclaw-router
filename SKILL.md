---
name: openmark_router
description: Benchmark-driven model routing powered by OpenMark AI. Routes tasks to optimal models based on real evaluation data — accuracy, cost, latency, stability — not keyword heuristics or complexity tiers.
version: 2.0.0
user-invocable: true
metadata: {"openclaw": {"requires": {"bins": ["python3"]}, "os": ["darwin", "linux", "win32"]}}
---

# OpenMark AI Router

## What This Skill Does

Routes your agent to the best model for each task type, using benchmark
results from OpenMark AI (https://openmark.ai) instead of guessing by
complexity tier.

The router uses deterministic scripts for all control flow. The LLM's
only job is to match user intent to a benchmark category. Everything
else — provider detection, routing math, model switching, fallback setup,
card formatting, auto-restore — is handled by code.

## Setup

1. Benchmark your recurring tasks on OpenMark AI (https://openmark.ai)
2. From the Results tab, click **Export → OpenClaw** to download the CSV
3. Send the CSV file to your agent in chat (Telegram, Discord, etc.)
   — the agent will save it to the benchmarks folder automatically
4. Optionally edit `{baseDir}/config.json` to override defaults

**Tip:** Use a fast, low-cost model as your OpenClaw default (e.g. Gemini
flash-lite, Claude Haiku, GPT-5.4-mini, Mistral Small). The router switches
to the optimal model for each task, so your default only needs to handle
classification and general conversation.

## Adding Benchmarks via Chat

When a user sends a CSV file attachment in chat:

1. Save the file to a temporary location using the write tool.
2. Validate the file format:

```bash
python3 {baseDir}/scripts/router.py --validate <temp_path>
```

3. If validation fails (`valid: false`), show the errors to the user and
   do NOT save the file to benchmarks. Example: "This CSV is missing
   required columns: Score (%), Status. Please re-export from OpenMark AI
   using Export → OpenClaw."

4. If validation passes, extract the `task_name` from the summary. If no
   task_name in metadata, derive from the filename (lowercase, underscores).

5. Check if `{baseDir}/benchmarks/<task_name>.csv` already exists. If so,
   ask the user before overwriting: "A benchmark for '<display_name>'
   already exists (exported <old_date>). Replace with this newer export
   (exported <new_date>)?"

6. Save the file to `{baseDir}/benchmarks/<task_name>.csv`.

7. Confirm to the user:
   "Added benchmark: <display_name> (<N> models, exported <date>).
   You now have <total> benchmark categories loaded."

8. If validation returned warnings, mention them briefly:
   "Note: <warning_text>"

Users can also place CSV files manually:
`{baseDir}/benchmarks/` — one CSV per task category.

## Duplicate Benchmark Detection

If the router output contains a `duplicates` field, two or more CSV files
share the same `task_name`. This causes only the first file (alphabetically)
to be used for routing. Notify the user:

"Found duplicate benchmarks for '<task_name>':
  - <filename_1> (exported <date_1>, <N> models)
  - <filename_2> (exported <date_2>, <N> models)
Which one should I keep? I'll remove the other."

After the user chooses, delete the unwanted file(s) from `{baseDir}/benchmarks/`.

## Removing Benchmarks

When a user asks to remove or delete a benchmark category:

1. Run `--classify` to see available categories.
2. Confirm with the user which category to remove.
3. Delete the file from `{baseDir}/benchmarks/<task_name>.csv`.
4. Confirm: "Removed benchmark: <display_name>. You now have <remaining>
   benchmark categories."

## First-Run Setup

On the first message in a new session, run:

```bash
python3 {baseDir}/scripts/router.py --classify --config {baseDir}/config.json
```

If the output shows `"action": "skip"`, this user hasn't added any benchmark
data yet. Proactively help them get started:

"To get started with benchmark-driven routing:
1. Benchmark your tasks on OpenMark AI (https://openmark.ai)
2. Export using Export → OpenClaw on the Results tab
3. Send the CSV file here in chat — I'll handle the rest"

Only show this guidance once per session.

## How to Route

There are two flows: automatic (you classify the task) and manual (user
invokes the skill directly). Both use two deterministic commands.

### Auto-routing flow

On every user message that looks like a substantive task (not greetings,
follow-ups, or casual chat):

**Step 1 — Classify:**

```bash
python3 {baseDir}/scripts/router.py --classify --config {baseDir}/config.json
```

If the result is `"action": "skip"`, there are no benchmarks. Use the
default model and proceed normally.

If `"action": "classify"`, read the `categories` array. Each has a `name`,
`display_name`, and `description`. Match the user's message to the best
category by understanding what each benchmark covers. Do NOT use keyword
matching — understand the intent.

If no category is a reasonable match, proceed with the default model.
Optionally mention: "No benchmark data for this task type. Using default
model."

**Step 2 — Route:**

If a category matches:

```bash
python3 {baseDir}/scripts/router.py --route <category_name> --config {baseDir}/config.json
```

This command handles everything internally:
- Detects available providers (cached)
- Runs the routing algorithm
- Executes `openclaw models set` and `openclaw models fallbacks` commands
- Saves routing state for auto-restore
- Returns a pre-formatted routing card

Display the `card` field from the output verbatim, then proceed with the
user's task on the new model.

To use a specific strategy, add `--strategy <name>`:

```bash
python3 {baseDir}/scripts/router.py --route <category> --strategy best_cost_efficiency --config {baseDir}/config.json
```

**Auto-restore:**

You do NOT need to call `--restore` manually. The `--classify` command
automatically restores the previous model if a routing state exists from a
prior `--route` call. This means every classify call starts from a clean
state. The `--restore` command still exists for manual use if needed.

### Manual routing flow

When the user invokes `/openmark_router`:

**Without a task name** — run `--classify` and present the categories as
a menu:
- If 10 or fewer categories:
  - On Telegram: use inline buttons. Each button's text = `display_name`,
    `callback_data` = `route:<category_name>`.
  - On other channels: present a numbered list with display names.
- If more than 10 categories: present a numbered list on all channels.
  The user replies with a number or name.

**With a task name** (e.g. `/openmark_router chatbot_potential`):
run `--route <task_name>` directly.

For manual routing, do NOT run `--restore` afterward. The user chose this
mode intentionally. Only switch when:
- The user starts a new session (`/new`)
- The user explicitly routes to a different task
- You auto-classify a clearly different task type later

## Strategy Quickswitch

On the FIRST routing result in a session, append after the card:

```
Tip: reply "cost" or "speed" to re-route with a different strategy
```

- "cost" → re-run `--route <same_category> --strategy best_cost_efficiency`
- "speed" → re-run `--route <same_category> --strategy best_under_latency`

Do NOT show the tip after the first time.

## Routing Strategies

- `best_score` — Highest accuracy
- `best_cost_efficiency` — Best accuracy per dollar (Acc/$)
- `best_under_budget` — Highest score under cost ceiling
- `best_under_latency` — Highest score under latency ceiling
- `balanced` — Weighted: accuracy (40%), cost-efficiency (30%), speed (20%), stability (10%)

## Manual Override

If the user says "use [model]" or specifies a model directly, skip routing
and use the requested model. Do not override explicit user model choices.

## Changing Settings via Chat

Users can change router settings by asking in natural language (e.g. "set
my routing strategy to best_cost_efficiency" or "set cost ceiling to 0.01").

When a user requests a config change:

1. Read the current config:

```bash
cat {baseDir}/config.json
```

2. Identify which field to change. Valid fields and their expected types:
   - `routing_strategy`: one of `balanced`, `best_score`,
     `best_cost_efficiency`, `best_under_budget`, `best_under_latency`
   - `cost_ceiling`: number or null
   - `latency_ceiling_s`: number or null
   - `default_model`: string (provider/model format)
   - `freshness_warning_days`: integer
   - `min_completion_pct`: number (0-100)
   - `min_stability_threshold`: number
   - `fallback_count`: integer
   - `available_providers`: list of strings, or empty list for auto-detect

3. Update the JSON file with the new value using the write tool. Preserve
   all other fields unchanged.

4. Confirm: "Updated <field> to <value>."

Do NOT allow changes to fields not listed above.

## Config Reference

`{baseDir}/config.json` fields:

- `available_providers`: List of providers to restrict to. Empty `[]` means
  auto-detect from OpenClaw (recommended). Non-empty = manual override.
- `default_model`: Fallback when no benchmark matches
- `routing_strategy`: Default strategy
- `cost_ceiling`: Max cost per run for best_under_budget strategy
- `latency_ceiling_s`: Max seconds for best_under_latency strategy
- `freshness_warning_days`: Days before showing stale data warning (default: 30)
- `min_completion_pct`: Skip models below this completion rate (default: 80)
- `min_stability_threshold`: Skip models with variance above this (default: 10.0)
- `fallback_count`: Number of fallback models to return (default: 2)

## CSV Format

The router accepts two CSV formats:

**OpenClaw-format CSV** (recommended): Includes `#` comment headers with
task metadata and two model key columns. Use "Export for OpenClaw" on
OpenMark AI.

```
# task_name: email_classification
# display_name: Email Classification Benchmark
# description: Classifies emails by intent, priority, and category.
"Model","Provider","OC Key","OC OR Key","Score (%)",...
"gemini-3.1-flash-lite","gemini","google/gemini-3.1-flash-lite-preview","openrouter/google/gemini-3.1-flash-lite-preview",...
```

- `OC Key`: direct provider model key (e.g. `openai/gpt-5.4`,
  `together/moonshotai/Kimi-K2.5`). Used when the provider is configured.
- `OC OR Key`: OpenRouter model key (e.g. `openrouter/openai/gpt-5.4`).
  Used as fallback when the direct provider is not configured but
  OpenRouter is.

The router tries `OC Key` first, then `OC OR Key`. Both direct API
providers and OpenRouter are supported.

**Regular CSV**: Standard OpenMark export without OC Key columns. The
Provider column is used to construct a best-guess model key. Works for
models where OpenMark and OpenClaw use the same name, but may fail for
models with naming differences.

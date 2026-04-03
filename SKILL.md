---
name: openmark_router
description: Benchmark-driven model routing powered by OpenMark AI. Routes tasks to optimal models based on real evaluation data — accuracy, cost, latency, stability — not keyword heuristics or complexity tiers.
version: 1.2.0
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
2. From the Results tab, click **Export → OpenClaw** to download the CSV
3. Send the CSV file to your agent in chat (Telegram, Discord, etc.)
   — the agent will save it to the benchmarks folder automatically
4. Optionally edit `{baseDir}/config.json` to override defaults

**Tip:** Use a fast, low-cost model as your OpenClaw default (e.g. Gemini
flash-lite, Claude Haiku, GPT-5.4-mini, Mistral Small). The router switches
to the optimal model for each task, so your default only needs to handle
classification and general conversation.

The router auto-detects which providers are available in your OpenClaw
config. No need to manually list them unless you want to restrict further.

For Telegram inline buttons (task picker), ensure
`channels.telegram.capabilities.inlineButtons` is enabled in your OpenClaw
config (default: `allowlist`).

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

1. Run `--describe` to show available categories with their names.
2. Confirm with the user which category to remove.
3. Delete the file:

```bash
rm {baseDir}/benchmarks/<task_name>.csv
```

4. Confirm: "Removed benchmark: <display_name>. You now have <remaining>
   benchmark categories."

## First-Run Setup

On the first message in a new session, check if benchmarks are loaded:

```bash
python3 {baseDir}/scripts/router.py --list-categories --config {baseDir}/config.json
```

If the output shows zero categories, this user hasn't added any benchmark
data yet. Proactively help them get started:

1. Check their current default model:

```bash
openclaw models list --json
```

   The default model has the `"default"` tag. This command (without `--all`)
   returns only configured models, which is a small list — fine here.

2. If the default model is a high-cost model (e.g. gemini-3.1-pro,
   claude-opus-4.6, gpt-5.4-pro), suggest switching to a lighter default:
   "Your current default model is <model>. Since this routing skill
   switches to the optimal model per task, a lighter default like
   gemini-3.1-flash-lite or claude-haiku-4.5 keeps costs low for
   classification and general chat. Want me to switch it?"

3. Guide them to add benchmarks:
   "To get started with benchmark-driven routing:
   1. Benchmark your tasks on OpenMark AI (https://openmark.ai)
   2. Export using Export → OpenClaw on the Results tab
   3. Send the CSV file here in chat — I'll handle the rest"

Only show this guidance once. After the user has at least one benchmark
loaded, skip this section entirely.

## How to Route

There are two routing flows: automatic (you classify the task) and manual
(the user selects a task directly). Both follow the same provider-probing
and model-switching steps.

### Step 1: Discover available providers

Provider detection is automatic. When you run the router in Step 3 without
`--providers`, it auto-detects configured providers (cached for 1 hour).
You can skip this step entirely — the router handles it.

If you need to check providers explicitly or the cache seems stale:

```bash
python3 {baseDir}/scripts/router.py --detect-providers --config {baseDir}/config.json
```

To force a fresh detection (ignores cache):

```bash
python3 {baseDir}/scripts/router.py --detect-providers --force-detect --config {baseDir}/config.json
```

This returns a compact JSON like `{"providers": ["anthropic", "google", "openai"]}`.
You can optionally pass `--providers` in Step 3 to override auto-detection.

### Step 2a: Auto-routing (agent classifies the task)

When a user sends a task and you need to determine which benchmark category
it matches:

1. Load category descriptions:

```bash
python3 {baseDir}/scripts/router.py --describe --config {baseDir}/config.json
```

2. Read the `display_name` and `description` of each category in the output.
   Match the user's request to the best category by understanding what each
   benchmark covers. Do NOT use keyword matching — understand the intent.

3. If no category is a reasonable match, skip routing. Use the default model
   from config.json and tell the user: "No benchmark data for this task type.
   Using default model. Consider benchmarking this task on OpenMark AI
   (https://openmark.ai) to get data-driven routing."

4. If a category matches, proceed to Step 3.

### Step 2b: Manual routing (user invokes the skill)

When the user invokes `/openmark_router`:

**Without a task name** — present available categories as a menu:
- If 10 or fewer categories:
  - On Telegram: use inline buttons via the message tool. Each button's text
    should be the `display_name` and `callback_data` should be the category
    `name`. Example buttons format:
    `[{"text": "Chat Bot Potential", "callback_data": "route:chatbot_potential_benchmark"}]`
  - On other channels: present a numbered list with display names.
- If more than 10 categories: present a numbered list on all channels
  (too many buttons degrades UX). The user replies with a number or name.

**With a task name** (e.g. `/openmark_router chatbot_potential_benchmark`):
skip the menu and proceed directly to Step 3 with the provided category.

### Step 3: Run the router

```bash
python3 {baseDir}/scripts/router.py --task "<category>" --providers <provider_list> --config {baseDir}/config.json
```

Replace `<category>` with the matched category name and `<provider_list>`
with the comma-separated providers from Step 1.

### Step 4: Execute the model switch

If the router returns `status: "ok"`:

1. Switch to the recommended model:

```bash
openclaw models set <primary.model>
```

2. Set fallbacks from the router output:

```bash
openclaw models fallbacks clear
openclaw models fallbacks add <fallback_1.model>
openclaw models fallbacks add <fallback_2.model>
```

3. Present the routing card to the user (see Routing Card Format below).
4. Proceed with the task on the new model.

If the router returns `status: "no_match"` or `status: "no_models"`, use
the `default_model` from the output and inform the user.

### Step 5: Auto-restore after task completion

The restore behavior depends on how routing was triggered:

**Auto-routed** (you classified the task in Step 2a): After the task is
complete, switch back to the default model:

```bash
openclaw models set <default_model_from_config>
```

This keeps routing scoped to the task. The next message gets re-classified.

**Manually routed** (user invoked `/openmark_router` in Step 2b): Stay on
the routed model. Do NOT switch back automatically. The user chose this
task mode intentionally. Only switch when:
- The user starts a new session (`/new`)
- The user explicitly routes to a different task
- You auto-classify a clearly different task type in a subsequent message

## Routing Card Format

Present routing results in this compact format:

```
Routed to <model_name> (<provider>) — <display_name>
Score: <score_pct>%  |  $<cost>/call  |  <time_s>s

Alternative: <alt_model> — <alt_score>% score, <savings_pct>% cheaper
  Over 10K calls: $<projected_10k_alt> vs $<projected_10k_top>

Strategy: <strategy>  |  Data: <freshness>
```

Rules:
- Show the "Alternative" section only if `best_alternative` exists in the
  router output.
- Show the "Over 10K calls" line only when the dollar difference exceeds $1.
- If `best_alternative.vs_top.alt_faster` is true, append the speed ratio:
  ", <speed_ratio>x faster"
- If `best_alternative.vs_top.alt_faster` is false, append:
  ", <speed_ratio>x slower"
- For freshness: show "fresh" if not stale, or "<days_old>d old" if stale.
- If `freshness.stale` is true, add a warning: "Benchmark data may be
  outdated. Consider re-benchmarking on OpenMark AI."

## Strategy Quickswitch

On the FIRST routing result in a session, append this line after the card:

```
Tip: reply "cost" or "speed" to re-route with a different strategy
```

- "cost" → re-route with `best_cost_efficiency` strategy
- "speed" → re-route with `best_under_latency` strategy

Do NOT show this hint after the first time. The user has seen it.

When the user replies with "cost" or "speed", re-run Step 3 with the
corresponding `--strategy` flag and repeat Step 4.

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

Do NOT allow changes to fields not listed above. If the user asks to change
something else, explain what settings are available.

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

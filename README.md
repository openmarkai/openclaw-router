# OpenMark AI Router

**Benchmark-driven model routing for [OpenClaw](https://github.com/openclaw/openclaw), powered by [OpenMark AI](https://openmark.ai).**

Routes your agent to the optimal model for each task type using real evaluation data -- not keyword heuristics, not complexity tiers, not generic leaderboard scores. Accuracy, cost-efficiency, latency, and stability, measured on **your actual tasks**.

<!-- Screenshot: OpenMark Export for OpenClaw button -->

## Why Custom Benchmarking Matters

Every routing solution -- from ClawHub skills to OpenRouter's auto-classifier -- does some form of blanket classification: "this looks like a coding task" → send to the code model. This approach has fundamental problems at every layer.

### Generic classification is too broad

A classifier that routes "email tasks" to one model treats cold sales outreach, customer complaint triage, internal status updates, and legal notice drafting as the same thing. They're not. Model performance varies dramatically across these subtypes, and a blanket classifier can't distinguish between them.

### Generic benchmarks are equally broad

Even if you move past classification tiers and look at benchmark data, public leaderboards (MMLU, Arena Elo, HumanEval) test general capabilities. A model scoring well on "writing" tells you nothing about how it handles *your* email templates with *your* tone requirements and *your* edge cases. Benchmark results are inseparable from the evaluation methodology -- the prompts used, the criteria applied, the specific scenarios tested. A benchmark that says "model X is the best at writing emails" is only as meaningful as the exact definition of "writing emails" that was tested.

### Real cost is invisible in published pricing

Published $/M token pricing is misleading. Models tokenize differently -- the same prompt produces different token counts across providers. Chain-of-thought models output thousands of reasoning tokens that inflate costs far beyond the advertised rate. A model listed at $0.60/M tokens can cost more per call than one listed at $3/M tokens if it generates 10x more output. You only discover real cost by measuring it on your actual workload.

### Stability matters more than peak scores

A model scoring 80% +/- 10 is unreliable. One scoring 78% +/- 1 delivers consistent results. Generic benchmarks don't measure variance on your workload.

### What custom benchmarking changes

When you benchmark on [OpenMark AI](https://openmark.ai), you're testing models on **your specific task**, with **your specific prompts**, against **your specific evaluation criteria**. The resulting data captures real accuracy, real cost, real latency, and real stability for that exact workload. The router then uses that data -- not heuristics, not leaderboard scores, not blanket categories.

Routing is only as good as the evaluation data behind it. Generic evaluation data produces generic routing.

## How It Works

```
Your OpenMark AI benchmarks
        |
        v
  Export -> OpenClaw (CSV with metadata headers)
        |
        v
  Send CSV to your agent in chat
        |
        v
  --classify: agent reads category descriptions, matches your task
        |
        v
  --route: script detects providers, runs routing math,
  switches model, sets fallbacks, returns card (all deterministic)
        |
        v
  Task executes on the optimal model
        |
        v
  --restore: script resets to default model when done
```

1. **Benchmark** your recurring tasks on [OpenMark AI](https://openmark.ai) (100+ models available)
2. **Export** -- click **Export -> OpenClaw** on the Results tab
3. **Send** the CSV to your agent in chat (drag-and-drop on Telegram, Discord, WhatsApp, etc.)
4. The router handles the rest -- validates the file, auto-detects your providers, classifies tasks, switches models, sets fallbacks

### What happens under the hood

The architecture follows a strict principle: **LLM decides WHAT, code decides HOW.** The LLM's only job is to classify user intent against benchmark descriptions. All other control flow is deterministic Python.

- **Two-command flow**: The agent runs `--classify` (get category list) then `--route <category>` (execute everything). No multi-step orchestration, no parsing, no manual command execution.
- **Provider auto-discovery**: The `--route` command internally detects configured providers (cached for 1 hour). Only recommends models you can actually use. No API keys are accessed.
- **Intelligent classification**: The agent reads benchmark task descriptions and classifies your request by understanding intent -- not by matching keywords. No heuristic triggers.
- **Classification only when needed**: Greetings, follow-ups, and non-task messages skip classification. The agent uses judgment, not rules.
- **Deterministic model selection**: Once a task is classified, `--route` ranks models using fixed rules and math. Zero LLM involvement in the ranking. Same data, same result, every time.
- **Actual model switching**: The `--route` command executes `openclaw models set` and sets benchmark-ranked fallback models internally via subprocess. The LLM never runs these commands directly.
- **Auto-restore**: After an auto-routed task completes, the agent runs `--restore` which resets the model deterministically. Manually routed tasks persist until you choose differently.

## Quick Start

### 1. Install the skill

```bash
openclaw skills install openmark-router
```

Or clone this repo into your OpenClaw workspace skills folder:

```bash
cd ~/.openclaw/workspace/skills
git clone https://github.com/openmarkai/openclaw-router.git openmark-router
```

### 2. Add your benchmark data

**Option A -- Send via chat (recommended):**
Export from [OpenMark AI](https://openmark.ai) using **Export -> OpenClaw** on the Results tab. Then drag-and-drop the CSV into your agent chat (Telegram, Discord, WhatsApp, etc.). The agent validates the format and saves it to the benchmarks folder automatically.

**Option B -- Manual placement:**

```bash
cp ~/Downloads/benchmark_xxx_openclaw.csv ~/.openclaw/workspace/skills/openmark-router/benchmarks/
```

A sample CSV is included at `benchmarks/examples/chatbot_potential.csv` showing the expected format with metadata headers.

### 3. Configure (optional)

The router auto-detects your available providers from OpenClaw. You only need to edit `config.json` if you want to:

- Restrict to specific providers (default: use all configured)
- Change the default strategy (default: `balanced`)
- Set cost or latency ceilings
- Adjust quality filters

You can also change settings via chat -- just tell the agent (e.g. "set routing strategy to best_cost_efficiency").

> **Tip:** Use a fast, low-cost model as your OpenClaw default (e.g. Gemini flash-lite, Claude Haiku, GPT-5.4-mini, Mistral Small). The router switches to the optimal model for each task, so your default only needs to handle classification and general conversation.

### 4. Enable streaming (recommended)

For Telegram, Discord, or any channel that supports it, enable streaming so responses appear progressively instead of as a single block:

```bash
openclaw config set channels.telegram.streaming true
```

The initial routing step takes ~10-20 seconds (provider detection + model switch), after which the response streams in. First route in a session may be slower while the provider cache warms up; subsequent routes are faster.

### 5. Start using it

```bash
/new
```

The agent picks up the skill and routes automatically. Or test the router directly:

```bash
python3 scripts/router.py --classify                          # list categories for classification
python3 scripts/router.py --route "chatbot_potential_benchmark"  # full route + model switch
python3 scripts/router.py --restore                            # reset to previous model
python3 scripts/router.py --validate path/to/file.csv          # validate a CSV
```

## Two Routing Modes

### Automatic routing (agent classifies the task)

The agent runs `--classify` to get benchmark categories, matches your request to the best one using its own reasoning, then runs `--route` which handles everything deterministically — provider detection, model switching, fallback setup, and routing card generation. After the task, `--restore` resets to the default model. No action needed from you.

### Manual routing (you select the task)

Use the slash command:

```
/openmark_router                            <- shows task picker menu
/openmark_router chatbot_potential_benchmark <- routes directly
```

On Telegram, available tasks appear as inline buttons. On other channels, you get a numbered list. When manually routed, the agent stays on the selected model until you start a new session or route to a different task.

## Routing Card

After routing, the agent presents a compact summary with real data:

```
Routed to codestral-latest (Mistral) -- Chat Bot Potential
Score: 75.4%  |  $0.00056/call  |  10.6s

Alternative: deepseek-chat -- 78% score, 97% cheaper
  Over 10K calls: $4.13 vs $156.96, 2.6x faster

Strategy: balanced  |  Data: fresh
Tip: reply "cost" or "speed" to re-route with a different strategy
```

The best alternative shows a model that's nearly as good as the top scorer but significantly cheaper -- with projected savings over 10,000 calls. Speed ratios are shown when the difference exceeds 1.2x. After the first routing, you can reply "cost" or "speed" to quickly re-route with a different strategy.

The routing card is generated entirely by the Python script -- the LLM just displays it verbatim. Zero creative generation cost for the card itself.

## Routing Engine

The model selection logic is fully deterministic -- no LLM involvement, no randomness. It mirrors [OpenMark AI](https://openmark.ai)'s internal ranking engine.

### 6-Step Cascade Sort

Models are ranked by a strict priority cascade:

1. Incomplete models (< 100% completion) pushed to bottom
2. Score descending -- accuracy is the primary criterion
3. Accuracy per dollar descending -- cost-efficiency as tiebreaker
4. Accuracy per minute descending -- speed as second tiebreaker
5. Cost ascending -- cheapest wins among equals
6. Model name alphabetical -- deterministic final tiebreaker

### Viability Floor

Not every model should be considered. The floor formula `max(top_score - 15pp, top_score * 0.5)` ensures:

- At high scores (e.g. top = 80%): floor is 65%. Standard 15 percentage-point gap.
- At low scores (e.g. top = 15%): floor is 7.5%. Proportional, preventing 0% models from qualifying.
- At zero: floor is 0%, all models equal, differentiated by cost and speed.

### Tie Detection

When 80% or more of models score within 1 percentage point of each other, accuracy is meaningless as a differentiator. All strategies automatically switch to cost-then-speed ranking.

### Best Alternative

The router always identifies the model that's nearly as good but much cheaper:

- Within the viability floor of the top scorer
- At least 30% cheaper
- Among candidates, picks the highest accuracy-per-dollar

Includes projected savings over 10,000 calls and speed comparison.

### Five Strategies

| Strategy | What It Optimizes |
|----------|------------------|
| `balanced` | Weighted: accuracy (40%) + cost-efficiency (30%) + speed (20%) + stability (10%) |
| `best_score` | Highest benchmark accuracy (6-step cascade sort) |
| `best_cost_efficiency` | Best accuracy per dollar among viable models |
| `best_under_budget` | Highest score within your cost ceiling |
| `best_under_latency` | Highest score within your latency ceiling |

### Fallbacks and Rate Limits

The router sets fallback models ranked by the same benchmark data. If the primary model hits a rate limit or is temporarily unavailable, OpenClaw's gateway automatically falls through to the next-best model -- not a random one. This makes the routing resilient to provider outages and rate limits without degrading to an unranked fallback.

## Trust and Security

- **Clean install**: Python stdlib only. No pip dependencies. No external packages.
- **No API key access**: Uses `openclaw models list` (official CLI) for provider discovery via a helper script. Never reads `~/.openclaw/openclaw.json` or any system files directly.
- **No file modifications outside its own directory**: Does not patch AGENTS.md or other global files.
- **No network requests**: All data is local CSV files. No telemetry, no phoning home.
- **Agent is the classifier**: No separate classifier model, no hidden API calls. Classification uses the agent's own model with your benchmark descriptions.
- **No keyword heuristics**: Classification is based on full task descriptions auto-exported from OpenMark AI. The LLM understands context, not pattern-matched keywords.
- **Prompt caching compatible**: The SKILL.md instructions in the system prompt benefit from provider prompt caching (Anthropic, OpenAI, Google), reducing input token costs on repeated calls.
- **Minimal token overhead**: Classification adds ~200-400 tokens per routed message (the benchmark category descriptions). Non-matching messages add zero overhead beyond the classify call. The routing card is script-generated, not LLM-generated.

## Supported Modalities

OpenMark AI benchmarks currently support:

- **Text-extractable input**: `.txt`, `.md`, `.csv`, `.json`, `.xlsx`, `.pdf`, `.docx`, `.rtf`, and code files (`.py`, `.js`, `.ts`, `.java`, `.c`, etc.)
- **Vision input**: `.jpg`, `.png`, `.webp`, `.gif`, `.bmp` (vision-capable models only)
- **Output**: Text

The router works with any benchmark task that fits these modalities. Tasks involving audio, video, or non-text output are not yet supported for benchmarking.

## Configuration Reference

| Field | Default | Description |
|-------|---------|-------------|
| `available_providers` | `[]` | Empty = auto-detect from OpenClaw (recommended). Non-empty = manual override. |
| `default_model` | `"google/gemini-3-flash"` | Fallback when no benchmark matches the task |
| `routing_strategy` | `"balanced"` | Default ranking strategy |
| `cost_ceiling` | `null` | Max cost per run (for `best_under_budget`) |
| `latency_ceiling_s` | `null` | Max seconds per run (for `best_under_latency`) |
| `freshness_warning_days` | `30` | Warn when benchmark data is older than this |
| `min_completion_pct` | `80` | Skip models that completed less than this % of tests |
| `min_stability_threshold` | `10.0` | Skip models with stability variance above this |
| `fallback_count` | `2` | Number of fallback models to set |

All settings can also be changed via chat (e.g. "set cost ceiling to 0.01").

## CSV Format

### OpenClaw-format CSV (recommended)

Use **Export -> OpenClaw** on [OpenMark AI](https://openmark.ai). The CSV includes `#` comment headers with task metadata:

```csv
# task_name: email_classification
# display_name: Email Classification Benchmark
# description: Classifies emails by intent, priority, and category.
"Model","Provider","OC Key","OC OR Key","Score (%)",...
"gemini-3.1-flash-lite","gemini","google/gemini-3.1-flash-lite-preview","openrouter/google/gemini-3.1-flash-lite-preview",...
"qwen-plus","qwen","together/qwen/qwen-plus","openrouter/qwen/qwen-plus",...
```

The `task_name` becomes the routing category. The `display_name` appears in menus and routing cards. The `description` helps the agent classify your tasks intelligently.

Two model key columns handle all provider scenarios:

- **`OC Key`**: the direct provider model key (e.g., `openai/gpt-5.4`, `together/moonshotai/Kimi-K2.5`). Used when the user has the provider's API key configured.
- **`OC OR Key`**: the OpenRouter model key (e.g., `openrouter/openai/gpt-5.4`). Used as fallback when the direct provider isn't configured but OpenRouter is.

The router tries `OC Key` first, then falls back to `OC OR Key`. Both direct API providers and OpenRouter are supported. No name translation or fuzzy matching -- both keys come directly from the model registry.

### Regular CSV (also supported)

Standard OpenMark CSV exports without the OC Key columns also work. The Provider column is used to construct a best-guess model key. This works for models where OpenMark and OpenClaw names match, but may not resolve correctly for models with naming differences.

### Validation

The router validates CSV files before importing:

```bash
python3 scripts/router.py --validate path/to/file.csv
```

Checks for required columns, data types, completed model entries, and metadata format. When importing via chat, validation runs automatically.

## Provider Mapping

The router uses two CSV columns for model identification: `OC Key` (direct provider key) and `OC OR Key` (OpenRouter key). Both are populated from the OpenMark AI model registry, giving exact model keys for each platform -- no name translation or heuristic matching.

The router tries the direct key first. If that provider isn't configured, it falls back to the OpenRouter key. This means users can access any benchmarked model through either their direct API key or through OpenRouter.

**Model keys are not limited to OpenClaw's built-in catalog.** OpenClaw accepts any model key as long as the provider's API key is configured -- the catalog is for discovery, not an allowlist. This means every model in the OpenMark AI roster can be routed, even if OpenClaw hasn't cataloged it yet. If a provider doesn't support a specific model at runtime, OpenClaw falls through to the benchmark-ranked fallback models automatically.

For older CSVs without these columns, the "Provider" column is used with a fallback mapping in `scripts/adapter.py`. This works for self-hosted providers but may not resolve correctly for all models.

## Local Models

If a local model is in [OpenMark AI's roster](https://openmark.ai) (100+ models), you can benchmark it directly on the platform and export the results. Technically savvy users can also create CSVs manually in the expected format with their own benchmark data -- the router doesn't care where the data comes from, it just reads CSVs.

Want more models added to OpenMark AI? Contact [support@openmark.ai](mailto:support@openmark.ai).

## Project Structure

```
openmark-router/
├── SKILL.md              # Agent instructions (loaded by OpenClaw)
├── README.md             # This file
├── config.json           # Routing configuration
├── clawhub.json          # ClawHub marketplace metadata
├── LICENSE               # MIT
├── scripts/
│   ├── router.py         # Core routing engine
│   ├── loader.py         # OpenMark CSV parser (with metadata + validation)
│   └── adapter.py        # Model ID translation (OpenMark -> OpenClaw)
└── benchmarks/
    ├── examples/
    │   └── chatbot_potential.csv   # Sample CSV with metadata headers
    └── (your CSVs go here)
```

## Future Roadmap

- **Subfolder/subcategory support**: Organize benchmarks into groups (e.g. `benchmarks/marketing/`, `benchmarks/engineering/`) with grouped menus.
- **Direct API/MCP integration**: The agent will be able to run benchmarks on OpenMark AI directly, without manual export/import.

## Requirements

- Python 3.8+ (stdlib only -- no pip install needed)
- OpenClaw (for agent integration)

## Links

- **OpenMark AI** (benchmark platform): [openmark.ai](https://openmark.ai)
- **OpenClaw** (agent framework): [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **ClawHub** (skill marketplace): [clawhub.ai](https://clawhub.ai)

## License

MIT -- see [LICENSE](LICENSE).

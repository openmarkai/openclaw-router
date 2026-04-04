# OpenMark AI Router

**Benchmark-driven model routing for [OpenClaw](https://github.com/openclaw/openclaw), powered by [OpenMark AI](https://openmark.ai).**

Stop guessing which model to use. Route every task to the optimal model using real evaluation data -- accuracy, cost-efficiency, latency, and stability -- measured on **your actual tasks**.

## Install

```bash
openclaw plugins install openmark-router
```

## Quick Start

1. **Benchmark** your recurring tasks on [OpenMark AI](https://openmark.ai) (100+ models)
2. **Export** -- click **Export -> OpenClaw** on the Results tab
3. **Send** the CSV to your agent in chat (drag-and-drop on Telegram, Discord, etc.)
4. **Done** -- the plugin routes automatically from here

### Example

You send: "Write me a LinkedIn post about our product launch"

The plugin detects a matching benchmark, routes to the best model, and shows:

```
Routed to gpt-5.4-nano (openai) -- Content Creation Benchmark
Score: 92.9%  |  $0.002731/call  |  30.28s

Alternative: deepseek-chat -- 81.9% score, 72.3% cheaper
  Over 10K calls: $7.57 vs $27.31

Strategy: balanced  |  Data: fresh
```

Your task then executes on the optimal model. No manual switching. No heuristics.

## Why Custom Benchmarking Matters

Every routing solution -- from ClawHub skills to OpenRouter's auto-classifier -- does blanket classification: "this looks like a coding task" -> send to the code model. This breaks at every layer.

### Generic classification is too broad

A classifier that routes "email tasks" to one model treats cold sales outreach, customer complaint triage, internal status updates, and legal notice drafting as the same thing. They're not. Model performance varies dramatically across these subtypes, and a blanket classifier can't distinguish between them.

### Generic benchmarks are equally broad

Public leaderboards (MMLU, Arena Elo, HumanEval) test general capabilities. A model scoring well on "writing" tells you nothing about how it handles *your* email templates with *your* tone requirements and *your* edge cases. Benchmark results are inseparable from the evaluation methodology -- the prompts used, the criteria applied, the specific scenarios tested.

### Real cost is invisible in published pricing

Published $/M token pricing is misleading. Models tokenize differently -- the same prompt produces different token counts across providers. Chain-of-thought models output thousands of reasoning tokens that inflate costs far beyond the advertised rate. A model listed at $0.60/M tokens can cost more per call than one listed at $3/M tokens. You only discover real cost by measuring it on your actual workload.

### What custom benchmarking changes

When you benchmark on [OpenMark AI](https://openmark.ai), you're testing models on **your specific task**, with **your specific prompts**, against **your specific evaluation criteria**. The router then uses that data -- not heuristics, not leaderboard scores, not blanket categories.

## How It Works

The plugin registers two things in OpenClaw:

1. **A `route_task` tool** -- the LLM calls this with a benchmark category name to trigger routing. The tool handler runs the routing engine, switches the model, sets fallbacks, and returns the routing card. All deterministic.

2. **A `message:preprocessed` hook** -- fires on every incoming message, runs the classification engine, and injects available benchmark categories into the agent's context. The LLM always sees the categories without needing to remember anything.

```
User message arrives
    |
    v
Hook runs --classify (code, deterministic)
    |
    v
Categories injected into agent context
    |
    v
LLM sees categories, calls route_task("content_creation")
    |
    v
Tool handler runs --route (code, deterministic):
  - detects providers (cached)
  - runs routing math
  - switches model (openclaw models set)
  - sets benchmark-ranked fallbacks
  - generates routing card
    |
    v
Card returned to LLM -> displayed to user
    |
    v
Task executes on optimal model
```

**The LLM's only job is classification** -- matching the user's intent to a benchmark category. Everything else is deterministic code. Same data, same result, every time.

### Why a plugin, not a skill

Skills rely on the LLM reading SKILL.md instructions and choosing to run commands. This is unreliable -- lightweight models skip steps, accumulated conversation context drowns out instructions, and different models follow instructions differently. A plugin registers a native tool that the LLM simply *calls*. The classification choice IS the trigger. No second step, no "decide to run a command."

## Routing Engine

The model selection logic is fully deterministic -- no LLM involvement, no randomness.

### 6-Step Cascade Sort

1. Incomplete models (< 100% completion) pushed to bottom
2. Score descending -- accuracy is the primary criterion
3. Accuracy per dollar descending -- cost-efficiency as tiebreaker
4. Accuracy per minute descending -- speed as second tiebreaker
5. Cost ascending -- cheapest wins among equals
6. Model name alphabetical -- deterministic final tiebreaker

### Viability Floor

`floor = max(top_score - 15pp, top_score * 0.5)`

At high scores (top = 80%): floor is 65%. Standard 15 percentage-point gap.
At low scores (top = 15%): floor is 7.5%. Proportional, preventing 0% models from qualifying.

### Tie Detection

When 80%+ of models score within 1 percentage point of each other, all strategies switch to cost-then-speed ranking.

### Best Alternative

Always identifies the model that's nearly as good but much cheaper -- within the viability floor, at least 30% cheaper, highest accuracy-per-dollar. Includes projected savings over 10,000 calls and speed comparison.

### Five Strategies

| Strategy | What It Optimizes |
|----------|------------------|
| `balanced` | Weighted: accuracy (40%) + cost-efficiency (30%) + speed (20%) + stability (10%) |
| `best_score` | Highest benchmark accuracy |
| `best_cost_efficiency` | Best accuracy per dollar among viable models |
| `best_under_budget` | Highest score within your cost ceiling |
| `best_under_latency` | Highest score within your latency ceiling |

### Fallbacks and Rate Limits

The router sets fallback models ranked by the same benchmark data. If the primary model hits a rate limit, OpenClaw's gateway falls through to the next-best model -- not a random one.

## Routing Card

Generated entirely by the Python script -- zero LLM generation cost. The LLM just displays the tool result.

```
Routed to codestral-latest (Mistral) -- Chat Bot Potential
Score: 75.4%  |  $0.00056/call  |  10.6s

Alternative: deepseek-chat -- 78% score, 97% cheaper
  Over 10K calls: $4.13 vs $156.96, 2.6x faster

Strategy: balanced  |  Data: fresh
```

After the first routing, reply "cost" or "speed" to re-route with a different strategy.

## Trust and Security

- **Clean install**: Python stdlib only. No pip dependencies.
- **No API key access**: Uses `openclaw models status` for provider discovery. Never reads system files.
- **No file modifications outside its own directory**.
- **No network requests**: All data is local CSV files. No telemetry.
- **Agent is the classifier**: No separate classifier model, no hidden API calls.
- **No keyword heuristics**: Classification is based on full task descriptions from OpenMark AI.
- **Minimal token overhead**: ~200-400 tokens per routed message (category descriptions). Non-matching messages add zero overhead.

## Configuration

Edit `config.json` in the plugin directory, or tell the agent (e.g. "set routing strategy to best_cost_efficiency").

| Field | Default | Description |
|-------|---------|-------------|
| `available_providers` | `[]` | Empty = auto-detect (recommended) |
| `default_model` | `"google/gemini-3-flash"` | Fallback when no benchmark matches |
| `routing_strategy` | `"balanced"` | Default ranking strategy |
| `cost_ceiling` | `null` | Max cost per run (for `best_under_budget`) |
| `latency_ceiling_s` | `null` | Max seconds per run (for `best_under_latency`) |
| `freshness_warning_days` | `30` | Warn when benchmark data is older than this |
| `min_completion_pct` | `80` | Skip models below this completion rate |
| `min_stability_threshold` | `10.0` | Skip models with variance above this |
| `fallback_count` | `2` | Number of fallback models to set |

**Tip:** Use a fast, low-cost model as your OpenClaw default (e.g. Gemini flash-lite, Claude Haiku, GPT-5.4-mini). The router switches to the optimal model for each task, so your default only needs to handle classification and general conversation.

## CSV Format

Use **Export -> OpenClaw** on [OpenMark AI](https://openmark.ai). The CSV includes metadata headers and dual model keys:

```csv
# task_name: email_classification
# display_name: Email Classification Benchmark
# description: Classifies emails by intent, priority, and category.
"Model","Provider","OC Key","OC OR Key","Score (%)",...
```

- **`OC Key`**: direct provider model key (e.g., `openai/gpt-5.4`). Used when the provider's API key is configured.
- **`OC OR Key`**: OpenRouter model key (e.g., `openrouter/openai/gpt-5.4`). Fallback when direct provider isn't configured.

Both direct API providers and OpenRouter are supported.

## Provider Mapping

Model keys are not limited to OpenClaw's built-in catalog. OpenClaw accepts any model key as long as the provider's API key is configured -- the catalog is for discovery, not an allowlist. Every model in the OpenMark AI roster can be routed.

Supported direct providers: Google (Gemini), Anthropic, OpenAI, DeepSeek, Mistral, xAI, MiniMax, Together AI. Plus any model available via OpenRouter.

## Supported Modalities

- **Input**: Text-extractable files (.txt, .md, .csv, .json, .xlsx, .pdf, .docx, .rtf, code files) and vision images (.jpg, .png, .webp, .gif, .bmp)
- **Output**: Text

## Project Structure

```
openmark-router/
  index.ts                # Plugin entry point (route_task tool + hook)
  openclaw.plugin.json    # Plugin manifest
  package.json            # npm package config
  config.json             # Routing configuration
  clawhub.json            # ClawHub marketplace metadata
  SKILL.md                # Discovery metadata (tiny)
  README.md               # This file
  LICENSE                 # MIT
  scripts/
    router.py             # Core routing engine
    loader.py             # OpenMark CSV parser
    adapter.py            # Model ID translation
  benchmarks/
    examples/
      chatbot_potential.csv   # Sample CSV
```

## Local Models

If a local model is in [OpenMark AI's roster](https://openmark.ai) (100+ models), benchmark it on the platform and export. Technically savvy users can also create CSVs manually in the expected format.

Want more models added? Contact [support@openmark.ai](mailto:support@openmark.ai).

## Future Roadmap

- **Direct API/MCP integration**: The plugin will call the OpenMark AI API directly -- benchmark tasks and route without manual CSV export.
- **Subfolder/subcategory support**: Organize benchmarks into groups with grouped menus.

## Requirements

- Python 3.8+ (stdlib only -- no pip install)
- OpenClaw 2026.3.28+

## Links

- **OpenMark AI** (benchmark platform): [openmark.ai](https://openmark.ai)
- **OpenClaw** (agent framework): [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **ClawHub** (marketplace): [clawhub.ai](https://clawhub.ai)

## License

MIT -- see [LICENSE](LICENSE).

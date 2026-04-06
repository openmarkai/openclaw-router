# OpenMark AI Router

**Benchmark-driven model routing for [OpenClaw](https://github.com/openclaw/openclaw), powered by [OpenMark AI](https://openmark.ai).**

Stop guessing which model to use. Route every task to the optimal model using real evaluation data -- accuracy, cost-efficiency, latency, and stability -- measured on **your actual tasks**.

## Install

```bash
openclaw skills install openmark-router
```

Then enable the routing hook (one-time):

```bash
cp -r ~/.openclaw/workspace/skills/openmark-router/hooks/openmark-router-classify ~/.openclaw/workspace/hooks/openmark-router-classify
```

Restart the gateway or start a new session.

## Quick Start

1. **Benchmark** your recurring tasks on [OpenMark AI](https://openmark.ai) (100+ models)
2. **Export** -- click **Export -> OpenClaw** on the Results tab
3. **Send** the CSV to your agent in chat (drag-and-drop on Telegram, Discord, etc.)
4. **Done** -- the router activates automatically from here

### Example

You send: "Write me a LinkedIn post about our product launch"

The router detects a matching benchmark, routes to the best model, and shows:

```
Routed to gpt-5.4-nano (openai) -- Content Creation Benchmark
Score: 92.9%  |  $0.002731/call  |  30.28s

Alternative: deepseek-chat -- 81.9% score, 72.3% cheaper
  Over 10K calls: $7.57 vs $27.31

Strategy: balanced  |  Data: fresh
```

Your task then executes on the optimal model. No manual switching. No heuristics.

## How It Works

The skill installs two components:

1. **An `agent:bootstrap` hook** -- fires at the start of every agent session. Loads benchmark categories (from a smart cache or by running `router.py --classify`), handles auto-restore of previous routing state, and injects a virtual `ROUTING.md` file into the agent's bootstrap context. The agent always sees the available categories without needing to run any commands.

2. **SKILL.md instructions** -- tell the agent to semantically match the user's message to a category and run `exec python3 router.py --route <category> --card`. The routing script handles everything deterministically: provider detection, routing math, model switching, fallback setup, and card formatting.

```
Agent session starts
    |
    v
Hook fires (agent:bootstrap):
  - auto-restores previous model if needed
  - loads categories (cached or via --classify)
  - injects ROUTING.md into agent context
    |
    v
LLM reads ROUTING.md, semantically matches user intent
    |
    v
LLM calls: exec python3 router.py --route <category> --card
    |
    v
Script runs --route (deterministic):
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

**The LLM's only job is semantic matching** -- deciding which category (if any) fits the user's message. Everything else is deterministic code. Same data, same result, every time.

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

Generated entirely by the Python script -- zero LLM generation cost. The LLM just displays the result.

```
Routed to codestral-latest (Mistral) -- Chat Bot Potential
Score: 75.4%  |  $0.00056/call  |  10.6s

Alternative: deepseek-chat -- 78% score, 97% cheaper
  Over 10K calls: $4.13 vs $156.96, 2.6x faster

Strategy: balanced  |  Data: fresh
```

After the first routing, reply "cost" or "speed" to re-route with a different strategy.

## Adding Benchmarks

### Via chat (recommended)

Send the CSV file to your agent in chat (Telegram, Discord, etc.). The agent validates the format, extracts the task name, and saves it to the benchmarks folder.

### Manually

Place CSV files in the `benchmarks/` directory inside the skill folder. Use **Export -> OpenClaw** on [OpenMark AI](https://openmark.ai) for the correct format.

## Manual Lock

By default, the router dynamically selects the best model per message. For extended work on a specific task, you can lock to a category:

- **Lock**: Tell the agent `/openmark_router <category>` or ask it to lock to a task. The `--lock` flag keeps the optimal model active across all messages until you unlock.
- **Unlock**: Tell the agent `/openmark_router off`. This restores the default model and resumes dynamic routing.

While locked, the bootstrap hook skips category injection and auto-restore -- the locked model handles everything.

## Trust and Security

- **Clean install**: Python stdlib only. No pip dependencies.
- **No API key access**: Uses `openclaw models status` for provider discovery. Never reads system files.
- **No file modifications outside its own directory**.
- **No network requests**: All data is local CSV files. No telemetry.
- **Agent is the classifier**: No separate classifier model, no hidden API calls.
- **No keyword heuristics**: Classification is based on full task descriptions from OpenMark AI.
- **Minimal token overhead**: ~200-400 tokens for injected category descriptions (via bootstrap). Present in every session, not per-message.

## Configuration

Edit `config.json` in the skill directory, or tell the agent (e.g. "set routing strategy to best_cost_efficiency").

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

## Project Structure

```
openmark-router/
  SKILL.md                # Agent instructions
  config.json             # Routing configuration
  clawhub.json            # ClawHub marketplace metadata
  README.md               # This file
  LICENSE                 # MIT
  scripts/
    router.py             # Core routing engine
    loader.py             # OpenMark CSV parser
    adapter.py            # Model ID translation
  hooks/
    openmark-router-classify/
      HOOK.md             # Hook metadata
      handler.js          # Category injection hook
  benchmarks/
    examples/
      chatbot_potential.csv   # Sample CSV
```

## Provider Mapping

Supported direct providers: Google (Gemini), Anthropic, OpenAI, DeepSeek, Mistral, xAI, MiniMax, Together AI. Plus any model available via OpenRouter. OpenClaw accepts any model key as long as the provider's API key is configured.

## Local Models

If a local model is in [OpenMark AI's roster](https://openmark.ai) (100+ models), benchmark it on the platform and export. Technically savvy users can also create CSVs manually in the expected format.

Want more models added? Contact [support@openmark.ai](mailto:support@openmark.ai).

## Future Roadmap

- **Direct API/MCP integration**: Call the OpenMark AI API directly -- benchmark tasks and route without manual CSV export.
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

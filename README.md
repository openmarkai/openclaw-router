# OpenMark AI Router

**Benchmark-driven model routing for [OpenClaw](https://github.com/openclaw/openclaw), powered by [OpenMark AI](https://openmark.ai).**

Routes your agent to the optimal model for each task type using real evaluation data — accuracy, cost-efficiency, latency, and stability — not keyword heuristics or complexity tiers.

## Why This Exists

Every routing skill on ClawHub classifies tasks into tiers like "simple" or "complex" and maps them to hardcoded models. This fails because:

- **Model performance is task-specific, not complexity-specific.** A model that wins on email classification may lose on legal document extraction, even if both are "medium" complexity.
- **Keyword scoring tells you nothing** about which model actually performs best on your real workload.
- **Generic benchmarks (MMLU, Arena Elo) don't predict performance** on arbitrary production tasks.

This skill uses **real benchmark results from your actual tasks** to make routing decisions. You benchmark your recurring workflows on [OpenMark AI](https://openmark.ai), export the results, and the router picks the best model based on empirical data.

## How It Works

```
Your OpenMark AI benchmarks
        |
        v
  Export CSV from Results tab
        |
        v
  benchmarks/
  ├── email_classification.csv      <- one CSV per task category
  ├── code_review.csv
  └── customer_support.csv
        |
        v
  router.py reads CSVs, filters by your config, ranks models
        |
        v
  Agent switches to the best model for the current task
```

1. **Benchmark** your recurring tasks on [OpenMark AI](https://openmark.ai)
2. **Export** results as CSV from the Results tab
3. **Drop** each CSV into the `benchmarks/` folder (filename = task category)
4. **Configure** your available providers in `config.json`
5. The router handles the rest — your agent calls it before each task

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

Export CSVs from [OpenMark AI](https://openmark.ai) and place them in the `benchmarks/` folder:

```bash
cp ~/Downloads/email_classification.csv ~/.openclaw/workspace/skills/openmark-router/benchmarks/
```

A sample CSV is included at `benchmarks/examples/chatbot_potential.csv` so you can see the expected format.

### 3. Configure your providers

Edit `config.json` to list the providers you have API keys for:

```json
{
  "available_providers": ["openai", "anthropic", "google", "deepseek", "mistral"],
  "default_model": "google/gemini-3-flash",
  "routing_strategy": "balanced"
}
```

### 4. Test the router

```bash
# List available task categories
python3 scripts/router.py --list-categories

# Get a routing recommendation
python3 scripts/router.py --task "chatbot_potential"

# Try a specific strategy
python3 scripts/router.py --task "chatbot_potential" --strategy best_cost_efficiency
```

### 5. Start a new session

```bash
/new
```

The agent will pick up the skill and start routing automatically.

## Routing Strategies

| Strategy | What It Optimizes |
|----------|------------------|
| `balanced` | Weighted: accuracy (40%) + cost-efficiency (30%) + speed (20%) + stability (10%) |
| `best_score` | Highest benchmark accuracy |
| `best_cost_efficiency` | Best accuracy per dollar (Acc/$) |
| `best_under_budget` | Highest score under your cost ceiling |
| `best_under_latency` | Highest score under your latency ceiling |

## Usage

### Automatic routing (agent classifies the task)

The agent reads your available task categories from the loaded benchmarks and matches the current task to the best category. No manual intervention needed.

### Manual routing (you specify the task)

Use the skill's slash command to route by task name:

```
/openmark_router email_classification
```

The router returns the best model for that task and the agent switches automatically.

### Strategy override

```
/openmark_router email_classification --strategy best_cost_efficiency
```

## Example Output

```json
{
  "status": "ok",
  "task": "chatbot_potential",
  "strategy": "balanced",
  "primary": {
    "model": "mistral/codestral-latest",
    "score_pct": 75.4,
    "cost": 0.00056,
    "acc_per_dollar": 79407.57,
    "stability": "±0.000",
    "time_s": 10.62
  },
  "fallbacks": [
    {"model": "deepseek/deepseek-chat", "score_pct": 78.0, "cost": 0.000413},
    {"model": "cohere/command-r", "score_pct": 66.9, "cost": 0.000302}
  ],
  "freshness": {"export_date": "2026-03-29", "days_old": 0, "stale": false},
  "reason": "Best weighted combination of accuracy, cost-efficiency, speed, and stability"
}
```

## Configuration Reference

| Field | Default | Description |
|-------|---------|-------------|
| `available_providers` | `[]` | Providers you have API keys for. Only models from these providers are considered. |
| `default_model` | `"google/gemini-3-flash"` | Fallback when no benchmark matches the task |
| `routing_strategy` | `"balanced"` | Default ranking strategy |
| `cost_ceiling` | `null` | Max cost per run (for `best_under_budget`) |
| `latency_ceiling_s` | `null` | Max seconds per run (for `best_under_latency`) |
| `freshness_warning_days` | `30` | Warn when benchmark data is older than this |
| `min_completion_pct` | `80` | Skip models that completed less than this % of tests |
| `min_stability_threshold` | `10.0` | Skip models with stability variance above this |
| `fallback_count` | `2` | Number of fallback models to return |

## Project Structure

```
openmark-router/
├── SKILL.md              # Agent instructions (loaded by OpenClaw)
├── README.md             # This file
├── config.json           # Your routing configuration
├── clawhub.json          # ClawHub marketplace metadata
├── LICENSE               # MIT
├── scripts/
│   ├── router.py         # Core routing engine
│   ├── loader.py         # OpenMark CSV parser
│   └── adapter.py        # Model ID translation (OpenMark → OpenClaw)
└── benchmarks/
    ├── examples/
    │   └── chatbot_potential.csv   # Sample CSV showing expected format
    └── (your CSVs go here)
```

## CSV Format

The router parses the exact CSV format that [OpenMark AI](https://openmark.ai) exports. No modifications needed — just export and drop.

Expected columns:

```
Model, Provider, Score (%), Score (Raw), Max Score, Stability, Rec. Temp,
Pricing Tier, Cost ($), Time (s), Acc/$, Acc/min, Completion (%),
Input Tokens (avg/run), Output Tokens (avg/run), Status
```

See `benchmarks/examples/chatbot_potential.csv` for a working example.

## Requirements

- Python 3.8+ (uses stdlib only — no pip install needed)
- OpenClaw (for agent integration)

## Security

This skill:

- Does **not** read `~/.openclaw/openclaw.json` or any OpenClaw system files
- Does **not** require API keys or credentials
- Does **not** modify files outside its own directory
- Does **not** make network requests
- All configuration is self-contained in `config.json`

## Links

- **OpenMark AI** (benchmark platform): [openmark.ai](https://openmark.ai)
- **OpenClaw** (agent framework): [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **ClawHub** (skill marketplace): [clawhub.ai](https://clawhub.ai)

## License

MIT — see [LICENSE](LICENSE).

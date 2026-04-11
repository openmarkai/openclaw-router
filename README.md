# OpenMark AI Router

**Benchmark-driven model routing for [OpenClaw](https://github.com/openclaw/openclaw), powered by [OpenMark AI](https://openmark.ai).**

Use benchmark-driven routing instead of guessing, complexity heuristics, or manual model switching. The router uses one lightweight semantic classification call to identify the task category, then deterministically picks the best model and fallbacks from your OpenMark benchmark data and lets the routed model generate the real reply.

## Normal Install (recommended)

```bash
openclaw plugins install openmark-router
openclaw gateway restart
```

For normal published-plugin installs, that's it. The plugin auto-registers as a provider, sets `openmark/auto` as your default model, and starts routing.

### Install From Source (development)

Ignore this subsection unless you intentionally cloned this repository and want to run the plugin from source instead of installing the published plugin.

```bash
npm install
npm run build
openclaw gateway restart
```

### After any install or update, restart the OpenClaw gateway so the newly built plugin files are loaded.
If you change your real default model and want the router to use it for classification or passthrough, restart the gateway again so the plugin captures the new value.

## 30-Second Example

You send:

> Write me a LinkedIn post about our product launch

The router classifies the task, checks your benchmark results, chooses the best model for that category, and you see:

```
Routed to gpt-5.4-nano (openai) — Content Creation Benchmark
Score: 92.9%  |  $0.002731/call  |  30.28s

Alternative: deepseek-chat — 81.9% score, 72.3% cheaper
  Over 10K calls: $7.57 vs $27.31

Strategy: balanced  |  Data: fresh

[actual response from gpt-5.4-nano follows here...]
```

The routed model genuinely answers. The classifier does not generate the final user-visible answer.

## Why This Is Useful

- **Benchmark-driven, not heuristic routing**: task selection is based on semantic classification plus benchmark results on your own tasks, not on a simplistic `simple vs complex` split.
- **Better model choice without manual switching**: the router picks the best benchmarked candidate and fallbacks on the fly.
- **Routing adapts to what the user actually has configured**: it detects available providers/hosts, prefers direct provider keys first, and can fall back to OpenRouter keys when benchmark rows include them and OpenRouter is available.
- **Classifier cost can stay negligible**: the classifier call is isolated and lightweight.
- **A safe default path still exists**: Messages that don't have corresponding benchmarked tasks continue through the passthrough/default model path.
- **Routing cards add useful visibility**: users can see which model was chosen, why, and when routing happened.
- **No plugin-side API key handling**: OpenClaw handles authentication, provider formatting, and model execution, the plugin does NOT access any API keys.
- **Your real default model is preserved**: the plugin captures your existing OpenClaw default model before switching the runtime default to `openmark/auto`.

## Quick Start

1. **Benchmark** your recurring tasks on [OpenMark AI](https://openmark.ai) (100+ models)
2. **Export** -- click **Export -> OpenClaw** on the Results tab
3. **Place** the CSV in `~/.openclaw/workspace/plugins/openmark-router/benchmarks/`
4. **Done** -- the router activates automatically

Today, benchmark import is file-based. A dashboard import flow is planned for a future version.

## How It Works

The plugin uses an **internal two-phase architecture**: Phase 1 classifies and routes, Phase 2 generates the real reply from the optimal model. To the user, this still appears as a single reply. OpenClaw handles all authentication and API formatting — the plugin never touches your API keys.

```
Turn 1 — Classification & Routing
──────────────────────────────────
User sends message
    |
    v
OpenClaw routes to openmark/auto (registered provider)
    |
    v
Embedded server classifies via OpenClaw gateway loopback:
  - Sends ONLY the current user message + category names
  - Uses your configured classifier model, or your captured default model if unset
  - Returns the matching category name
    |
    v
Deterministic model selection (router.py, ~60ms after classification):
  - Loads benchmark data, ranks models by strategy
  - Computes optimal model + fallbacks for this run
  - Returns pre-formatted routing card
    |
    v
OpenClaw immediately runs the real reply with the routed model stack
  - Full session context, system prompt, conversation history
  - Authentication and streaming handled by OpenClaw
    |
    v
User receives one reply containing the routing card plus the answer from the best model for their task
    |
    v
Compatibility fallback only: if the internal rerun path is unavailable, the plugin can still persist the route and ask for a follow-up message
```

**Zero API key access.** Classification goes through the OpenClaw gateway. The seamless hot path uses in-memory model overrides for the internal rerun, and the compatibility fallback can still write to OpenClaw's config. The plugin never makes direct calls to any provider API.

## What Happens Per Message

- **Route match**: the plugin classifies the message, chooses the benchmark winner plus fallbacks, and the routed model answers in the same visible reply flow.
- **No route match**: the plugin keeps the message on the passthrough/default path. The answer still happens on the same turn.
- **Short messages**: very short messages skip the classifier and stay on the passthrough/default path.
- **Slash commands and internal OpenClaw prompts**: bypass routing completely.
- **Compatibility fallback**: only used when the seamless internal rerun path is unavailable.

## Why Custom Benchmarking Matters

Every routing solution -- from complexity tiering to auto-classifiers -- does blanket categorization. This breaks because:

- **Generic classification is too broad**: "email tasks" lumps cold outreach, complaint triage, and legal notices together. Model performance varies dramatically across these subtypes.
- **Generic benchmarks are equally broad**: MMLU, Arena Elo, and HumanEval test general capabilities. A model scoring well on "writing" tells you nothing about *your* email templates with *your* tone requirements.
- **Real cost is invisible in pricing**: Published $/M token rates are misleading. Tokenization differs, chain-of-thought inflates output tokens. A model at $0.60/M can cost more per call than one at $3/M.

When you benchmark on [OpenMark AI](https://openmark.ai), you test models on **your specific task**, with **your prompts**, against **your criteria**.

## Routing Engine

The full system is **not** a heuristic router. An LLM first performs semantic task classification on the current message. After that category is known, the model-selection step is fully deterministic and uses benchmark data plus the selected strategy to rank the available candidates. The deterministic model-selection phase itself completes in **~60ms**.

### 6-Step Cascade Sort

1. Incomplete models pushed to bottom
2. Score descending
3. Accuracy per dollar descending
4. Accuracy per minute descending
5. Cost ascending
6. Model name alphabetical (deterministic tiebreaker)

### Five Strategies

| Strategy | What It Optimizes |
|----------|------------------|
| `balanced` | Weighted: accuracy (40%) + cost-efficiency (20%) + speed (25%) + stability (15%) |
| `best_score` | Highest benchmark accuracy |
| `best_cost_efficiency` | Best accuracy per dollar among viable models |
| `best_under_budget` | Highest score within your cost ceiling |
| `best_under_latency` | Highest score within your latency ceiling |

### Viability Floor

`floor = max(top_score - 15pp, top_score * 0.5)` -- models below the floor are excluded from routing.

### Fallbacks

The router provides ranked fallback models from the same benchmark. On the seamless hot path, those fallbacks are injected into the effective OpenClaw model config for that reply run. If the internal rerun path is unavailable, the compatibility fallback still persists the routed primary + fallbacks to OpenClaw's config.

## Configuration

Edit `config.json` in the plugin directory.

`config.json` is the source of truth for routing behavior. The plugin metadata schema exposes the core knobs, but the full router configuration lives in `config.json`.

| Field | Default | Description |
|-------|---------|-------------|
| `classifier_model` | `""` (your default model) | Override: model for the isolated classification call. Leave empty to use your captured default model. |
| `no_route_passthrough` | `""` (your default model) | Override: model for unrouted messages and short-message passthrough. Leave empty to use your captured default model. |
| `routing_strategy` | `balanced` | Default ranking strategy |
| `port` | `2098` | Embedded server port |
| `gateway_port` | `18789` | OpenClaw gateway port (for classification calls via loopback) |
| `show_routing_card` | `true` | Prepend routing card to responses |
| `restore_delay_s` | `30` | Fallback restore timer (used only if hook-based restore is unavailable) |
| `benchmarks_dir` | `benchmarks` | Benchmark directory relative to the plugin root |
| `cost_ceiling` | `null` | Max cost per run (for `best_under_budget`) |
| `latency_ceiling_s` | `null` | Max seconds per run (for `best_under_latency`) |
| `freshness_warning_days` | `30` | Warn when benchmark data is older than this |
| `min_completion_pct` | `80` | Skip models below this completion rate |
| `min_stability_threshold` | `10.0` | Skip models with variance above this |
| `fallback_count` | `2` | Number of fallback models |

By default, the router uses **your existing default model** for both classification and passthrough. The plugin captures your default model on startup (before setting `openmark/auto`).
The TypeScript plugin reads the runtime-facing fields such as ports, classifier/passthrough models, routing-card display, and restore timing. The Python routing engine reads the benchmark-selection fields such as strategy, ceilings, freshness, benchmark directory, stability filters, and fallback count from the same `config.json`.

### Classifier Recommendations

The plugin does **not** prefer expensive models for classification. The classifier call is intentionally isolated and lightweight, so a small cheap model is usually the right choice.

Good classifier candidates include:

- `google/gemini-3.1-flash-lite-preview`
- `openai/gpt-5.4-nano`
- `openai/gpt-5.4-mini`
- `anthropic/claude-haiku-4-5`

Other models can work too. The important rule is: use a model id that **OpenClaw itself can resolve**.

For example, this mattered during validation:

- `anthropic/claude-haiku-4-5` worked
- `anthropic/claude-haiku-4.5` failed because OpenClaw did not recognize that id

If you leave `classifier_model` empty, the plugin uses your captured default model instead.

### Provider Access And OpenRouter Fallback

The router does not blindly trust every model listed in a benchmark CSV.

- It first tries to detect which providers/hosts your OpenClaw install can currently use.
- When a benchmark row includes both a direct provider key and an OpenRouter key, the router prefers the direct provider key first.
- If that direct provider is not available but `openrouter` is available, the router falls back to the OpenRouter key for that same model.

In practice, this means:

- direct provider access is preferred when you already have it configured
- OpenRouter can expand coverage when the benchmark includes `OC OR Key` values and your OpenClaw setup has OpenRouter access
- users do **not** need every benchmarked model to be available through direct APIs if an OpenRouter path exists for those rows

Important limitation:

- provider detection is **best-effort**
- it is based on what OpenClaw reports for configured providers/hosts
- exact model execution still depends on OpenClaw accepting the exact model id string

So provider/host access is the first filter, but canonical model ids still matter. A provider may be available while a specific model string is still rejected if the id is not the exact OpenClaw-supported form.

## Troubleshooting Notes

### Classifier Fallback Chain

The normal classifier path is:

1. isolated simple-completion call through OpenClaw
2. subagent fallback only if that isolated path fails

The subagent path exists as a resilience fallback, not as the preferred architecture. If you see subagent-related classifier logs, treat that as a troubleshooting clue that the isolated simple-completion path could not prepare or execute the selected classifier model cleanly.

### Provider Detection Commands

These are the commands used to inspect provider/host availability:

```bash
openclaw models status --json
python scripts/router.py --detect-providers --force-detect
```

Run the Python command from the plugin root:

```bash
cd /path/to/openmark-router
python scripts/router.py --detect-providers --force-detect
```

Or, without changing directories, pass an absolute path to the script:

```bash
python /absolute/path/to/openmark-router/scripts/router.py --detect-providers --force-detect
```

### Future Dashboard Scope

The planned dashboard should stay focused on high-signal controls and diagnostics:

- detected providers/hosts currently available in OpenClaw
- active benchmark categories and freshness
- routing strategy selection
- manual routed-model lock/unlock
- benchmark import status and validation hints

## CSV Format

Use **Export -> OpenClaw** on [OpenMark AI](https://openmark.ai). The CSV includes metadata headers and dual model keys:

```csv
# task_name: email_classification
# display_name: Email Classification Benchmark
# description: Classifies emails by intent, priority, and category.
"Model","Provider","OC Key","OC OR Key","Score (%)",...
```

- **`OC Key`**: direct provider model key (e.g., `openai/gpt-5.4`)
- **`OC OR Key`**: OpenRouter model key (e.g., `openrouter/openai/gpt-5.4`)

## Project Structure

```
openmark-router/
  src/
    index.ts               # Plugin entry: registerProvider + registerService
    server.ts              # Embedded HTTP server (OpenAI-compatible)
    classifier.ts          # Isolated LLM classifier
    provider-inject.ts     # Auto-configure provider in openclaw.json
    router-bridge.ts       # TypeScript bridge to router.py subprocess
    types.ts               # Shared types
  scripts/
    router.py              # Core routing engine (1200+ lines)
    loader.py              # OpenMark CSV parser
    adapter.py             # Model ID translation
  dist/                    # Compiled JS
  benchmarks/
    examples/
      chatbot_potential.csv  # Sample CSV
  config.json              # Routing configuration
  package.json             # Plugin package
  openclaw.plugin.json     # Plugin metadata
  clawhub.json             # ClawHub metadata
  LICENSE                  # Apache-2.0
```

## Trust and Security

- **Zero API key access**: The plugin never reads or stores API keys. All LLM calls go through the OpenClaw gateway.
- **Clean install**: Python stdlib only for routing engine. No pip dependencies.
- **Minimal file writes**: Writes provider config and model selection to `openclaw.json`. No other system modifications.
- **No network requests** from routing engine: All benchmark data is local CSV files.
- **Isolated classification**: The classifier call uses only the current user message and category names -- no main-session history, no routed-model context, no borrowed system prompt state.
- **No provider preference**: Classification and passthrough can use any model that OpenClaw can resolve. Small cheap models are encouraged.
- **Best-effort provider filtering**: The router attempts to detect which providers/hosts are available in OpenClaw and filters benchmark candidates accordingly. Direct provider keys are preferred first, with OpenRouter fallback when available for the same row.

## Requirements

- Python 3.8+ (stdlib only)
- Node.js 18+ (for plugin runtime)
- OpenClaw 2026.3.28+

## Links

- **OpenMark AI** (benchmark platform): [openmark.ai](https://openmark.ai)
- **OpenClaw** (agent framework): [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **ClawHub** (marketplace): [clawhub.ai](https://clawhub.ai)

## License

The repository is currently Apache-2.0 licensed -- see [LICENSE](LICENSE).

Additional repo notes:

- [TRADEMARK.md](TRADEMARK.md): OpenMark brand and affiliation note

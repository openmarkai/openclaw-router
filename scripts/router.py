#!/usr/bin/env python3
"""
OpenMark AI Router — Core routing engine.

Reads benchmark CSVs, filters by user config, ranks models by strategy,
and outputs a JSON recommendation to stdout.

Ranking logic mirrors OpenMark AI's internal model selection:
- 6-step cascade sort (score → Acc/$ → Acc/min → cost → name)
- Viability floor (within 15pp of top scorer) for cost-efficiency strategies
- Tie detection (when ≥80% of models score within 1pp, differentiate on cost)
- Best alternative identification (nearly as good, much cheaper)

Usage:
    python3 router.py --task <category> [--strategy <strategy>] [--config <path>]
    python3 router.py --list-categories [--config <path>]
"""

import argparse
import json
import sys
import os
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from loader import load_csv, load_benchmarks_dir
from adapter import to_openclaw_id, get_openclaw_provider

VIABILITY_GAP_PP = 15
ALTERNATIVE_MIN_SAVINGS_PCT = 30
TIE_THRESHOLD_PP = 1
TIE_QUORUM_PCT = 0.8


def load_config(config_path: str) -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def filter_entries(entries: list[dict], config: dict) -> list[dict]:
    """Filter models by provider availability, completion %, and stability."""
    available = set(config.get("available_providers", []))
    min_completion = config.get("min_completion_pct", 0)
    max_stability = config.get("min_stability_threshold", float("inf"))

    filtered = []
    for e in entries:
        openclaw_provider = get_openclaw_provider(e["provider"])
        if available and openclaw_provider not in available:
            continue
        if e["completion_pct"] < min_completion:
            continue
        if e["stability"] > max_stability:
            continue
        filtered.append(e)

    return filtered


# ---------------------------------------------------------------------------
# Sorting primitives
# ---------------------------------------------------------------------------

def cascade_sort(entries: list[dict]) -> list[dict]:
    """
    OpenMark's 6-step cascade sort. Accuracy is king; Acc/$ is a tiebreaker.

    1. Incomplete models pushed to bottom (completion < 100%)
    2. Score descending
    3. Acc/$ descending (tiebreaker)
    4. Acc/min descending (second tiebreaker)
    5. Cost ascending (third tiebreaker)
    6. Model name alphabetical (deterministic final tiebreaker)
    """
    return sorted(
        entries,
        key=lambda e: (
            1 if e["completion_pct"] >= 100.0 else 0,
            e["score_pct"],
            e["acc_per_dollar"],
            e["acc_per_min"],
            -e["cost"],
            # Reverse alpha: sorted() is ascending, we want A before Z
        ),
        reverse=True,
    )


def detect_tie(entries: list[dict]) -> bool:
    """
    When ≥80% of models score within 1pp of each other, it's a tie.
    In ties, accuracy is meaningless as a differentiator.
    """
    if len(entries) < 2:
        return False
    top_score = max(e["score_pct"] for e in entries)
    tied_count = sum(1 for e in entries if abs(e["score_pct"] - top_score) <= TIE_THRESHOLD_PP)
    return tied_count >= len(entries) * TIE_QUORUM_PCT


def cost_speed_sort(entries: list[dict]) -> list[dict]:
    """Sort by cost ascending, then speed ascending. Used when scores are tied."""
    return sorted(entries, key=lambda e: (e["cost"], e["time_s"]))


def apply_viability_floor(entries: list[dict]) -> list[dict]:
    """
    Filter to models within 15pp of the top scorer.
    The floor is RELATIVE to the best model — not an absolute threshold.
    If top model scores 45%, the floor is 30%.
    """
    if not entries:
        return entries
    top_score = max(e["score_pct"] for e in entries)
    floor = top_score - VIABILITY_GAP_PP
    return [e for e in entries if e["score_pct"] >= floor]


# ---------------------------------------------------------------------------
# Best alternative identification
# ---------------------------------------------------------------------------

def find_best_alternative(entries: list[dict]) -> dict | None:
    """
    Find the model that's nearly as good but much cheaper than the top scorer.

    Constraints (from OpenMark's insights logic):
    - Within 15pp of the top-scoring model
    - At least 30% cheaper than the top model
    - Among candidates, pick the one with highest Acc/$
    """
    if len(entries) < 2:
        return None

    sorted_by_score = cascade_sort(entries)
    top = sorted_by_score[0]
    top_score = top["score_pct"]
    top_cost = top["cost"]

    if top_cost <= 0:
        return None

    cost_ceiling = top_cost * (1 - ALTERNATIVE_MIN_SAVINGS_PCT / 100)

    candidates = [
        e for e in entries
        if e["model"] != top["model"]
        and (top_score - e["score_pct"]) <= VIABILITY_GAP_PP
        and (top_score - e["score_pct"]) >= 0
        and e["cost"] < cost_ceiling
    ]

    if not candidates:
        return None

    return max(candidates, key=lambda e: e["acc_per_dollar"])


def compute_savings(top_entry: dict, alt_entry: dict) -> dict:
    """Compute projected savings between top model and alternative."""
    result = {}
    if top_entry["cost"] > 0:
        result["savings_pct"] = round(
            (1 - alt_entry["cost"] / top_entry["cost"]) * 100, 1
        )
        result["cost_ratio"] = round(top_entry["cost"] / max(alt_entry["cost"], 0.000001), 1)
        result["projected_10k_top"] = round(top_entry["cost"] * 10000, 2)
        result["projected_10k_alt"] = round(alt_entry["cost"] * 10000, 2)

    if alt_entry["time_s"] > 0 and top_entry["time_s"] / alt_entry["time_s"] >= 1.2:
        result["speed_ratio"] = round(top_entry["time_s"] / alt_entry["time_s"], 1)

    return result


# ---------------------------------------------------------------------------
# Normalization for balanced strategy
# ---------------------------------------------------------------------------

def normalize(values: list[float]) -> list[float]:
    """Min-max normalize a list of values to [0, 1]."""
    if not values:
        return values
    lo, hi = min(values), max(values)
    if hi == lo:
        return [1.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


# ---------------------------------------------------------------------------
# Strategy implementations
# ---------------------------------------------------------------------------

def rank_by_strategy(entries: list[dict], strategy: str, config: dict) -> list[dict]:
    if not entries:
        return entries

    is_tied = detect_tie(entries)

    if strategy == "best_score":
        if is_tied:
            return cost_speed_sort(entries)
        return cascade_sort(entries)

    elif strategy == "best_cost_efficiency":
        viable = apply_viability_floor(entries)
        if not viable:
            viable = entries
        if is_tied:
            return cost_speed_sort(viable)
        return sorted(viable, key=lambda e: e["acc_per_dollar"], reverse=True)

    elif strategy == "best_under_budget":
        ceiling = config.get("cost_ceiling")
        if ceiling is not None:
            entries = [e for e in entries if e["cost"] <= ceiling]
        if not entries:
            return entries
        if detect_tie(entries):
            return cost_speed_sort(entries)
        return cascade_sort(entries)

    elif strategy == "best_under_latency":
        ceiling = config.get("latency_ceiling_s")
        if ceiling is not None:
            entries = [e for e in entries if e["time_s"] <= ceiling]
        if not entries:
            return entries
        if detect_tie(entries):
            return cost_speed_sort(entries)
        return cascade_sort(entries)

    elif strategy == "balanced":
        viable = apply_viability_floor(entries)
        if not viable:
            viable = entries

        if is_tied:
            return cost_speed_sort(viable)

        scores = normalize([e["score_pct"] for e in viable])
        efficiencies = normalize([e["acc_per_dollar"] for e in viable])
        speeds = normalize([1.0 / max(e["time_s"], 0.01) for e in viable])
        stabilities = normalize([1.0 / max(e["stability"], 0.001) for e in viable])

        ranked = []
        for i, e in enumerate(viable):
            composite = (
                0.4 * scores[i]
                + 0.3 * efficiencies[i]
                + 0.2 * speeds[i]
                + 0.1 * stabilities[i]
            )
            ranked.append((composite, e))

        ranked.sort(key=lambda x: x[0], reverse=True)
        return [e for _, e in ranked]

    else:
        print(
            f"Warning: Unknown strategy '{strategy}', falling back to 'balanced'",
            file=sys.stderr,
        )
        return rank_by_strategy(entries, "balanced", config)


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def check_freshness(export_date: str | None, warning_days: int) -> dict:
    if not export_date:
        return {"export_date": None, "days_old": None, "stale": False}

    try:
        dt = datetime.strptime(export_date, "%Y-%m-%d")
        days_old = (datetime.now() - dt).days
        return {
            "export_date": export_date,
            "days_old": days_old,
            "stale": days_old > warning_days,
        }
    except ValueError:
        return {"export_date": export_date, "days_old": None, "stale": False}


def format_model_entry(entry: dict) -> dict:
    openclaw_id = to_openclaw_id(entry["provider"], entry["model"])
    return {
        "model": openclaw_id,
        "openmark_model": entry["model"],
        "provider": entry["provider"],
        "score_pct": entry["score_pct"],
        "cost": entry["cost"],
        "acc_per_dollar": entry["acc_per_dollar"],
        "stability": f"±{entry['stability']:.3f}",
        "time_s": entry["time_s"],
        "pricing_tier": entry["pricing_tier"],
        "completion_pct": entry["completion_pct"],
    }


STRATEGY_REASONS = {
    "best_score": "Highest accuracy score in benchmark (6-step cascade sort)",
    "best_cost_efficiency": "Best accuracy per dollar among viable models (within {gap}pp of top scorer)",
    "best_under_budget": "Highest score within cost ceiling",
    "best_under_latency": "Highest score within latency ceiling",
    "balanced": "Best weighted combination of accuracy, cost-efficiency, speed, and stability among viable models",
}


# ---------------------------------------------------------------------------
# Core routing
# ---------------------------------------------------------------------------

def route(task: str, config: dict, base_dir: str) -> dict:
    """Core routing logic. Returns a recommendation dict."""
    benchmarks_dir = os.path.join(base_dir, config.get("benchmarks_dir", "benchmarks"))
    all_benchmarks = load_benchmarks_dir(benchmarks_dir)
    categories = [b["category"] for b in all_benchmarks]

    target = None
    task_lower = task.strip().lower().replace(" ", "_").replace("-", "_")
    for b in all_benchmarks:
        if b["category"] == task_lower:
            target = b
            break

    if not target:
        return {
            "status": "no_match",
            "task": task,
            "message": f"No benchmark data for task '{task}'. Using default model.",
            "default_model": config.get("default_model", "google/gemini-3-flash"),
            "available_categories": categories,
            "suggestion": "Benchmark this task on OpenMark AI (https://openmark.ai) to get data-driven routing.",
        }

    entries = filter_entries(target["entries"], config)
    if not entries:
        return {
            "status": "no_models",
            "task": task,
            "message": "All models filtered out by provider/quality constraints.",
            "default_model": config.get("default_model", "google/gemini-3-flash"),
            "available_categories": categories,
        }

    strategy = config.get("routing_strategy", "balanced")
    ranked = rank_by_strategy(entries, strategy, config)

    if not ranked:
        return {
            "status": "no_models",
            "task": task,
            "message": "No models remaining after applying strategy constraints.",
            "default_model": config.get("default_model", "google/gemini-3-flash"),
            "available_categories": categories,
        }

    fallback_count = config.get("fallback_count", 2)
    primary = format_model_entry(ranked[0])
    fallbacks = [format_model_entry(e) for e in ranked[1 : 1 + fallback_count]]
    freshness = check_freshness(
        target["export_date"], config.get("freshness_warning_days", 30)
    )

    is_tied = detect_tie(entries)
    top_score = max(e["score_pct"] for e in entries)

    reason = STRATEGY_REASONS.get(strategy, "Ranked by selected strategy")
    reason = reason.replace("{gap}", str(VIABILITY_GAP_PP))
    if is_tied:
        reason += " (scores tied — differentiated by cost and speed)"

    result = {
        "status": "ok",
        "task": target["category"],
        "strategy": strategy,
        "primary": primary,
        "fallbacks": fallbacks,
        "freshness": freshness,
        "available_categories": categories,
        "total_models_evaluated": len(target["entries"]),
        "models_after_filtering": len(entries),
        "scores_tied": is_tied,
        "viability_floor": round(top_score - VIABILITY_GAP_PP, 1),
        "reason": reason,
    }

    alt_entry = find_best_alternative(entries)
    if alt_entry:
        top_entry = cascade_sort(entries)[0]
        result["best_alternative"] = format_model_entry(alt_entry)
        result["best_alternative"]["vs_top"] = compute_savings(top_entry, alt_entry)

    return result


def list_categories(config: dict, base_dir: str) -> dict:
    benchmarks_dir = os.path.join(base_dir, config.get("benchmarks_dir", "benchmarks"))
    all_benchmarks = load_benchmarks_dir(benchmarks_dir)
    categories = []
    for b in all_benchmarks:
        categories.append({
            "name": b["category"],
            "models": len(b["entries"]),
            "export_date": b["export_date"],
        })
    return {"categories": categories}


def resolve_base_dir(config_path: str | None) -> str:
    """Determine the skill's base directory."""
    if config_path:
        return str(Path(config_path).parent)
    scripts_dir = Path(__file__).parent
    return str(scripts_dir.parent)


def main():
    parser = argparse.ArgumentParser(
        description="OpenMark AI Router — benchmark-driven model routing"
    )
    parser.add_argument("--task", "-t", help="Task category to route")
    parser.add_argument(
        "--strategy",
        "-s",
        choices=[
            "best_score",
            "best_cost_efficiency",
            "best_under_budget",
            "best_under_latency",
            "balanced",
        ],
        help="Override routing strategy from config",
    )
    parser.add_argument("--config", "-c", help="Path to config.json")
    parser.add_argument(
        "--list-categories", action="store_true", help="List available task categories"
    )

    args = parser.parse_args()

    base_dir = resolve_base_dir(args.config)
    config_path = args.config or os.path.join(base_dir, "config.json")

    try:
        config = load_config(config_path)
    except FileNotFoundError:
        print(
            json.dumps({"status": "error", "message": f"Config not found: {config_path}"}),
            file=sys.stdout,
        )
        sys.exit(1)

    if args.strategy:
        config["routing_strategy"] = args.strategy

    if args.list_categories:
        result = list_categories(config, base_dir)
    elif args.task:
        result = route(args.task, config, base_dir)
    else:
        parser.print_help()
        sys.exit(1)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

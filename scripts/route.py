#!/usr/bin/env python3
"""
Thin routing wrapper — accepts just a task_name, auto-resolves all paths.

Usage (what the LLM actually runs):
    route.py <task_name>              Route to optimal model, print card
    route.py <task_name> --lock       Route and lock (persist across messages)
    route.py --unlock                 Clear lock, restore default model
    route.py --classify               List available task categories

All paths (config.json, benchmarks/) are resolved relative to this script's
location, so callers never need to pass --config or full paths.
"""

import json
import sys
import os

scripts_dir = os.path.dirname(os.path.abspath(__file__))
base_dir = os.path.dirname(scripts_dir)
sys.path.insert(0, scripts_dir)

from router import (
    load_config,
    execute_route,
    execute_restore,
    classify,
    format_classify_card,
)

config_path = os.path.join(base_dir, "config.json")


def main():
    args = sys.argv[1:]

    if not args:
        print("Usage: route.py <task_name> | --unlock | --classify", file=sys.stderr)
        sys.exit(1)

    try:
        config = load_config(config_path)
    except FileNotFoundError:
        print(json.dumps({"status": "error", "message": f"Config not found: {config_path}"}))
        sys.exit(1)

    if args[0] == "--classify":
        result = classify(config, base_dir)
        cache_path = os.path.join(base_dir, "categories.json")
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception:
            pass
        print(format_classify_card(result, base_dir))
        sys.exit(0)

    if args[0] == "--unlock":
        result = execute_restore(base_dir)
        if result.get("status") == "ok":
            print(result.get("message", "Unlocked."))
        else:
            print(json.dumps(result, indent=2))
        sys.exit(0 if result.get("status") == "ok" else 1)

    task_name = args[0]
    lock = "--lock" in args

    strategy = None
    if "--strategy" in args:
        idx = args.index("--strategy")
        if idx + 1 < len(args):
            strategy = args[idx + 1]

    result = execute_route(
        task_name, config, base_dir,
        strategy_override=strategy,
        manual=lock,
    )

    if result.get("status") == "ok" and result.get("card"):
        card = result["card"]
        if lock:
            card += "\n\n(Locked — this model stays active until you send /openmark_router off)"
        print(card)
    else:
        print(json.dumps(result, indent=2))
        sys.exit(1 if result.get("status") != "ok" else 0)


if __name__ == "__main__":
    main()

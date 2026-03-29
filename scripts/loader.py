"""
Parses OpenMark AI CSV benchmark exports into structured routing entries.

Handles the exact CSV format that OpenMark exports today:
- Quoted headers with spaces and special chars
- Stability as ±float
- Export date in the last row
- Status field for filtering
"""

import csv
import re
import os
from datetime import datetime
from pathlib import Path
from typing import Optional


def parse_stability(value: str) -> float:
    """Parse '±2.500' into 2.5 as a float."""
    cleaned = value.strip().lstrip("±").lstrip("+").lstrip("-")
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return float("inf")


def parse_float(value: str, default: float = 0.0) -> float:
    try:
        return float(value.strip())
    except (ValueError, TypeError):
        return default


def parse_export_date(filepath: str) -> Optional[str]:
    """
    Extract the export date from the last line of an OpenMark CSV.
    Format: 'Exported from benchmark on 3/29/2026, 2:48:22 PM'
    Returns ISO date string or None.
    """
    last_line = ""
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip().strip('"')
            if stripped:
                last_line = stripped

    match = re.search(
        r"Exported from benchmark on (\d{1,2}/\d{1,2}/\d{4})", last_line
    )
    if match:
        try:
            dt = datetime.strptime(match.group(1), "%m/%d/%Y")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def load_csv(filepath: str) -> dict:
    """
    Parse an OpenMark CSV export into a routing data structure.

    Returns:
        {
            "category": str,        # derived from filename
            "export_date": str|None, # ISO date
            "entries": [             # list of model routing entries
                {
                    "model": str,
                    "provider": str,
                    "score_pct": float,
                    "score_raw": float,
                    "max_score": float,
                    "stability": float,
                    "rec_temp": str,
                    "pricing_tier": str,
                    "cost": float,
                    "time_s": float,
                    "acc_per_dollar": float,
                    "acc_per_min": float,
                    "completion_pct": float,
                    "input_tokens_avg": float,
                    "output_tokens_avg": float,
                    "status": str,
                }
            ]
        }
    """
    path = Path(filepath)
    category = path.stem.lower().replace(" ", "_").replace("-", "_")
    export_date = parse_export_date(filepath)

    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            model = row.get("Model", "").strip()
            if not model or model.startswith("Exported from"):
                continue

            status = row.get("Status", "").strip().lower()
            if status != "completed":
                continue

            entries.append({
                "model": model,
                "provider": row.get("Provider", "").strip(),
                "score_pct": parse_float(row.get("Score (%)", "0")),
                "score_raw": parse_float(row.get("Score (Raw)", "0")),
                "max_score": parse_float(row.get("Max Score", "0")),
                "stability": parse_stability(row.get("Stability", "0")),
                "rec_temp": row.get("Rec. Temp", "N/A").strip(),
                "pricing_tier": row.get("Pricing Tier", "").strip(),
                "cost": parse_float(row.get("Cost ($)", "0")),
                "time_s": parse_float(row.get("Time (s)", "0")),
                "acc_per_dollar": parse_float(row.get("Acc/$", "0")),
                "acc_per_min": parse_float(row.get("Acc/min", "0")),
                "completion_pct": parse_float(row.get("Completion (%)", "0")),
                "input_tokens_avg": parse_float(
                    row.get("Input Tokens (avg/run)", "0")
                ),
                "output_tokens_avg": parse_float(
                    row.get("Output Tokens (avg/run)", "0")
                ),
                "status": status,
            })

    return {
        "category": category,
        "export_date": export_date,
        "entries": entries,
    }


def load_benchmarks_dir(benchmarks_dir: str) -> list[dict]:
    """Load all CSV files from a benchmarks directory."""
    results = []
    bench_path = Path(benchmarks_dir)
    if not bench_path.exists():
        return results

    for csv_file in sorted(bench_path.glob("*.csv")):
        try:
            data = load_csv(str(csv_file))
            if data["entries"]:
                results.append(data)
        except Exception as e:
            import sys
            print(f"Warning: Failed to parse {csv_file.name}: {e}", file=sys.stderr)

    return results

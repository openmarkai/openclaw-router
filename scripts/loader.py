"""
Parses OpenMark AI CSV benchmark exports into structured routing entries.

Supports two CSV formats:
1. OpenClaw-format CSV: has # comment headers with task metadata
   (task_name, display_name, description) followed by standard CSV data.
2. Regular CSV: no comment headers. Category derived from filename.

Both formats share:
- Quoted headers with spaces and special chars
- Stability as ±float
- Export date in the last row
- Status field for filtering
"""

import csv
import io
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


def parse_comment_headers(filepath: str) -> dict:
    """
    Read # comment lines at the top of a CSV and parse as key: value metadata.
    Returns dict with keys like task_name, display_name, description.
    Stops at the first non-comment, non-empty line.
    """
    metadata = {}
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if stripped.startswith("#"):
                content = stripped.lstrip("#").strip()
                if ":" in content:
                    key, _, value = content.partition(":")
                    metadata[key.strip().lower()] = value.strip()
            elif stripped:
                break
    return metadata


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

    Supports OpenClaw-format CSV (with # comment headers for metadata)
    and regular CSV (category derived from filename).

    Returns:
        {
            "category": str,             # from task_name header or filename
            "display_name": str|None,    # from header or None
            "description": str|None,     # from header or None
            "export_date": str|None,     # ISO date
            "entries": [...]
        }
    """
    path = Path(filepath)
    filename_category = path.stem.lower().replace(" ", "_").replace("-", "_")

    metadata = parse_comment_headers(filepath)
    category = metadata.get("task_name", filename_category)
    display_name = metadata.get("display_name")
    description = metadata.get("description")

    export_date = parse_export_date(filepath)

    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        data_lines = [line for line in f if not line.strip().startswith("#")]

    reader = csv.DictReader(io.StringIO("".join(data_lines)))
    for row in reader:
        model = row.get("Model", "").strip()
        if not model or model.startswith("Exported from"):
            continue

        status = row.get("Status", "").strip().lower()
        if status != "completed":
            continue

        oc_key_raw = row.get("OC Key", "").strip()
        oc_or_key_raw = row.get("OC OR Key", "").strip()

        entries.append({
            "model": model,
            "provider": row.get("Provider", "").strip(),
            "oc_key": oc_key_raw if oc_key_raw else None,
            "oc_or_key": oc_or_key_raw if oc_or_key_raw else None,
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
        "display_name": display_name,
        "description": description,
        "export_date": export_date,
        "entries": entries,
    }


REQUIRED_COLUMNS = {"Model", "Provider", "Score (%)", "Cost ($)", "Time (s)", "Status"}

EXPECTED_COLUMNS = {
    "Model", "Provider", "Score (%)", "Score (Raw)", "Max Score",
    "Stability", "Rec. Temp", "Pricing Tier", "Cost ($)", "Time (s)",
    "Acc/$", "Acc/min", "Completion (%)", "Input Tokens (avg/run)",
    "Output Tokens (avg/run)", "Status",
}


def validate_csv(filepath: str) -> dict:
    """
    Validate an OpenMark CSV export for format correctness.

    Returns:
        {
            "valid": bool,
            "errors": [str],
            "warnings": [str],
            "summary": {
                "task_name": str|None,
                "display_name": str|None,
                "has_metadata_headers": bool,
                "total_rows": int,
                "completed_rows": int,
                "columns_found": [str],
                "columns_missing": [str],
            }
        }
    """
    errors = []
    warnings = []
    summary = {
        "task_name": None,
        "display_name": None,
        "has_metadata_headers": False,
        "total_rows": 0,
        "completed_rows": 0,
        "columns_found": [],
        "columns_missing": [],
    }

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        return {"valid": False, "errors": ["File not found"], "warnings": [], "summary": summary}
    except UnicodeDecodeError:
        return {"valid": False, "errors": ["File is not valid UTF-8 text"], "warnings": [], "summary": summary}

    if not content.strip():
        return {"valid": False, "errors": ["File is empty"], "warnings": [], "summary": summary}

    metadata = parse_comment_headers(filepath)
    if metadata:
        summary["has_metadata_headers"] = True
        summary["task_name"] = metadata.get("task_name")
        summary["display_name"] = metadata.get("display_name")

        if not metadata.get("task_name"):
            warnings.append("Metadata headers present but missing 'task_name'. Category will be derived from filename.")
        if not metadata.get("description"):
            warnings.append("No 'description' in metadata headers. Classification will work but without rich context.")

    lines = content.splitlines()
    data_lines = [line for line in lines if not line.strip().startswith("#")]

    if not data_lines or not any(line.strip() for line in data_lines):
        errors.append("No CSV data found (only comment headers or empty lines)")
        return {"valid": False, "errors": errors, "warnings": warnings, "summary": summary}

    reader = csv.DictReader(io.StringIO("\n".join(data_lines)))
    columns = set(reader.fieldnames or [])
    summary["columns_found"] = sorted(columns)

    missing_required = REQUIRED_COLUMNS - columns
    if missing_required:
        summary["columns_missing"] = sorted(missing_required)
        errors.append(f"Missing required columns: {', '.join(sorted(missing_required))}")

    missing_optional = EXPECTED_COLUMNS - REQUIRED_COLUMNS - columns
    if missing_optional:
        warnings.append(f"Missing optional columns (defaults will be used): {', '.join(sorted(missing_optional))}")

    total_rows = 0
    completed_rows = 0
    for row in reader:
        model = (row.get("Model") or "").strip()
        if not model or model.startswith("Exported from"):
            continue
        total_rows += 1
        status = (row.get("Status") or "").strip().lower()
        if status == "completed":
            completed_rows += 1

            score_str = (row.get("Score (%)") or "").strip()
            if score_str:
                try:
                    float(score_str)
                except ValueError:
                    errors.append(f"Non-numeric Score (%) value for model '{model}': '{score_str}'")

            cost_str = (row.get("Cost ($)") or "").strip()
            if cost_str:
                try:
                    float(cost_str)
                except ValueError:
                    errors.append(f"Non-numeric Cost ($) value for model '{model}': '{cost_str}'")

    summary["total_rows"] = total_rows
    summary["completed_rows"] = completed_rows

    if total_rows == 0:
        errors.append("No model data rows found in the CSV")
    elif completed_rows == 0:
        errors.append("No models with 'completed' status found. The router requires at least one completed model.")
    elif completed_rows < 2:
        warnings.append("Only 1 completed model found. Routing works best with multiple models to compare.")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "summary": summary,
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
            data["filename"] = csv_file.name
            if data["entries"]:
                results.append(data)
        except Exception as e:
            import sys
            print(f"Warning: Failed to parse {csv_file.name}: {e}", file=sys.stderr)

    return results


def detect_duplicates(benchmarks: list[dict]) -> list[dict]:
    """
    Detect duplicate task_name values across loaded benchmarks.
    Returns a list of duplicate groups with filenames and export dates.
    """
    from collections import defaultdict
    by_name = defaultdict(list)
    for b in benchmarks:
        by_name[b["category"]].append({
            "filename": b.get("filename", "unknown"),
            "export_date": b.get("export_date"),
            "models": len(b["entries"]),
        })

    duplicates = []
    for name, files in by_name.items():
        if len(files) > 1:
            duplicates.append({"task_name": name, "files": files})

    return duplicates

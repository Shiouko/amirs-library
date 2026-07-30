#!/usr/bin/env python3
"""
library_update.py — deterministic CLI to mutate data/library.json safely.

Used by the maintainer (Liora) to record Amir's progress without hand-editing
JSON. Stdlib only. All writes are atomic (temp file + os.replace). Output JSON
is pretty-printed: 2-space indent, ensure_ascii=False (keeps JP/KR titles intact).

Commands:
  progress --id <id> --value <int> [--note "text"]
      Set progressCurrent, append a history entry (date = today, +08:00),
      bump updatedAt and meta.lastUpdated.

  status --id <id> --status <reading|completed|plan|paused|dropped> [--score <n>]
      Set status. If completed, set completedAt = today. Optional score (1-10).

  add --json '<full entry JSON>'
      Validate required keys and append a new entry.

  list
      Print id / type / status / progress table.

Exit codes: 0 success, 1 user/usage error, 2 data/integrity error.
"""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone, timedelta

# --- Config -----------------------------------------------------------------

# Resolve repo root relative to this file so the script works from any CWD.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "data", "library.json"))

MYT = timezone(timedelta(hours=8))  # Malaysia Time (+08:00)

VALID_STATUSES = {"reading", "completed", "plan", "paused", "dropped"}
VALID_TYPES = {"anime", "manga", "manhwa", "manhua"}

REQUIRED_ENTRY_KEYS = [
    "id", "type", "title", "status", "progressCurrent", "progressLabel",
]


# --- Helpers ----------------------------------------------------------------

def today_myt() -> str:
    """Today's date in +08:00 as YYYY-MM-DD."""
    return datetime.now(MYT).strftime("%Y-%m-%d")


def now_iso_myt() -> str:
    """Current timestamp in +08:00 as ISO-8601 (seconds precision)."""
    return datetime.now(MYT).replace(microsecond=0).isoformat()


def fail(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def load_data() -> dict:
    if not os.path.exists(DATA_PATH):
        fail(f"data file not found: {DATA_PATH}", 2)
    try:
        with open(DATA_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as exc:
        fail(f"data file is not valid JSON: {exc}", 2)


def save_data(data: dict) -> None:
    """Atomic write: dump to a temp file in the same dir, then os.replace."""
    data["meta"]["lastUpdated"] = now_iso_myt()
    directory = os.path.dirname(DATA_PATH)
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".library_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp_path, DATA_PATH)
    except Exception:
        # Clean up the temp file on any failure; leave the original intact.
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def find_entry(data: dict, entry_id: str) -> dict:
    for entry in data.get("entries", []):
        if entry.get("id") == entry_id:
            return entry
    fail(f"no entry with id '{entry_id}'", 1)


def append_history(entry: dict, progress: int, note: str = "") -> None:
    entry.setdefault("history", []).append(
        {"date": today_myt(), "progress": progress, "note": note}
    )


# --- Commands ---------------------------------------------------------------

def cmd_progress(args) -> None:
    if args.value < 0:
        fail("--value must be >= 0")
    data = load_data()
    entry = find_entry(data, args.id)

    entry["progressCurrent"] = args.value
    # Cap to total when known (leave status untouched per plan).
    total = entry.get("progressTotal")
    if isinstance(total, int) and total and args.value > total:
        print(f"note: value {args.value} exceeds total {total}; capping.", file=sys.stderr)
        entry["progressCurrent"] = total
    append_history(entry, entry["progressCurrent"], args.note or "")
    entry["updatedAt"] = today_myt()

    save_data(data)
    label = entry.get("progressLabel", "Ch.")
    print(f"ok: {entry['id']} progress -> {label} {entry['progressCurrent']}")


def cmd_status(args) -> None:
    if args.status not in VALID_STATUSES:
        fail(f"--status must be one of: {', '.join(sorted(VALID_STATUSES))}")
    if args.score is not None and not (0 <= args.score <= 10):
        fail("--score must be between 0 and 10")

    data = load_data()
    entry = find_entry(data, args.id)

    entry["status"] = args.status
    if args.status == "completed":
        entry["completedAt"] = today_myt()
    if args.score is not None:
        entry["score"] = args.score
    entry["updatedAt"] = today_myt()

    save_data(data)
    extra = f", score {args.score}" if args.score is not None else ""
    print(f"ok: {entry['id']} status -> {args.status}{extra}")


def cmd_add(args) -> None:
    try:
        entry = json.loads(args.json)
    except json.JSONDecodeError as exc:
        fail(f"--json is not valid JSON: {exc}")
    if not isinstance(entry, dict):
        fail("--json must be a JSON object")

    missing = [k for k in REQUIRED_ENTRY_KEYS if k not in entry]
    if missing:
        fail(f"entry missing required keys: {', '.join(missing)}")
    if entry["type"] not in VALID_TYPES:
        fail(f"type must be one of: {', '.join(sorted(VALID_TYPES))}")
    if entry["status"] not in VALID_STATUSES:
        fail(f"status must be one of: {', '.join(sorted(VALID_STATUSES))}")

    data = load_data()
    ids = {e.get("id") for e in data.get("entries", [])}
    if entry["id"] in ids:
        fail(f"an entry with id '{entry['id']}' already exists")

    # Fill sensible defaults for optional fields.
    today = today_myt()
    entry.setdefault("altTitles", [])
    entry.setdefault("coverUrl", "")
    entry.setdefault("anilistId", None)
    entry.setdefault("malId", None)
    entry.setdefault("progressTotal", None)
    entry.setdefault("score", None)
    entry.setdefault("genres", [])
    entry.setdefault("synopsis", "")
    entry.setdefault("year", None)
    entry.setdefault("format", "")
    entry.setdefault("authors", [])
    entry.setdefault("startedAt", None)
    entry.setdefault("completedAt", None)
    entry.setdefault("notes", "")
    entry.setdefault("history", [])
    entry.setdefault("addedAt", today)
    entry["updatedAt"] = today

    data.setdefault("entries", []).append(entry)
    save_data(data)
    print(f"ok: added {entry['id']} ({entry['title']})")


def cmd_list(_args) -> None:
    data = load_data()
    entries = data.get("entries", [])
    if not entries:
        print("(shelf is empty)")
        return
    header = f"{'ID':<14} {'TYPE':<8} {'STATUS':<11} PROGRESS"
    print(header)
    print("-" * len(header))
    for e in entries:
        label = e.get("progressLabel", "Ch.")
        total = e.get("progressTotal")
        prog = f"{label} {e.get('progressCurrent', 0)}"
        prog += f" / {total}" if total else " · ongoing"
        print(f"{e.get('id','?'):<14} {e.get('type','?'):<8} {e.get('status','?'):<11} {prog}")
    print(f"\n{len(entries)} entr{'y' if len(entries) == 1 else 'ies'}")


# --- CLI --------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Update Amir's Library data file (data/library.json)."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_prog = sub.add_parser("progress", help="Update progress for an entry")
    p_prog.add_argument("--id", required=True, help="Entry id, e.g. al-2")
    p_prog.add_argument("--value", required=True, type=int, help="New progress value")
    p_prog.add_argument("--note", default="", help="Optional note for the history log")
    p_prog.set_defaults(func=cmd_progress)

    p_stat = sub.add_parser("status", help="Change status (and optional score)")
    p_stat.add_argument("--id", required=True)
    p_stat.add_argument("--status", required=True,
                        choices=sorted(VALID_STATUSES))
    p_stat.add_argument("--score", type=float, default=None, help="Score 0-10")
    p_stat.set_defaults(func=cmd_status)

    p_add = sub.add_parser("add", help="Add a full entry from JSON")
    p_add.add_argument("--json", required=True, help="Full entry as a JSON string")
    p_add.set_defaults(func=cmd_add)

    p_list = sub.add_parser("list", help="List all entries")
    p_list.set_defaults(func=cmd_list)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except Exception as exc:  # pragma: no cover - safety net
        fail(f"unexpected error: {exc}", 2)


if __name__ == "__main__":
    main()

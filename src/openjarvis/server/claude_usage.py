"""Local endpoint with Claude Code token use (5-hour and weekly windows).

Reads the session logs in ``~/.claude/projects`` and compares the totals with
limits calibrated from percentages the user types in.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

PROJECTS_DIR = Path.home() / ".claude" / "projects"
CALIBRATION_FILE = Path.home() / ".openjarvis" / "claude_usage.json"

FIVE_HOURS = timedelta(hours=5)
WEEK = timedelta(days=7)


class Calibration(BaseModel):
    five_hour_percent: float = Field(gt=0, le=100)
    weekly_percent: float = Field(gt=0, le=100)


def _parse_time(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _collect(now: datetime) -> dict[str, tuple[datetime, int]]:
    """Return ``{message id: (time, tokens)}`` for the last week.

    Streaming writes the same assistant message several times, so only the
    last entry per id counts. Cache reads are left out: they are cheap and
    would dwarf the real work.
    """
    found: dict[str, tuple[datetime, int]] = {}
    if not PROJECTS_DIR.is_dir():
        return found
    cutoff = now - WEEK
    cutoff_ts = cutoff.timestamp()
    for path in PROJECTS_DIR.rglob("*.jsonl"):
        try:
            if path.stat().st_mtime < cutoff_ts:
                continue
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for line in lines:
            if '"usage"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            message = entry.get("message")
            if not isinstance(message, dict):
                continue
            usage = message.get("usage")
            when = _parse_time(entry.get("timestamp"))
            if not isinstance(usage, dict) or when is None or when < cutoff:
                continue
            tokens = sum(
                int(usage.get(key) or 0)
                for key in (
                    "input_tokens",
                    "output_tokens",
                    "cache_creation_input_tokens",
                )
            )
            key = message.get("id") or entry.get("uuid") or f"{path.name}:{when}"
            found[key] = (when, tokens)
    return found


def _totals(now: datetime) -> dict[str, int]:
    five = week = 0
    for when, tokens in _collect(now).values():
        week += tokens
        if when >= now - FIVE_HOURS:
            five += tokens
    return {"five_hour": five, "weekly": week}


def _load_limits() -> dict[str, Optional[int]]:
    try:
        data = json.loads(CALIBRATION_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"five_hour": None, "weekly": None}
    return {
        "five_hour": data.get("five_hour_limit"),
        "weekly": data.get("weekly_limit"),
    }


def _report(totals: dict[str, int]) -> dict[str, Any]:
    limits = _load_limits()
    out: dict[str, Any] = {"calibrated": all(limits.values())}
    for name in ("five_hour", "weekly"):
        limit = limits[name]
        out[name] = {
            "tokens": totals[name],
            "limit": limit,
            "percent": round(min(totals[name] / limit * 100, 999), 1)
            if limit
            else None,
        }
    return out


@router.get("/v1/claude/usage")
async def claude_usage() -> dict[str, Any]:
    """Token totals for the last 5 hours and 7 days, plus % once calibrated."""
    return _report(_totals(datetime.now(timezone.utc)))


@router.post("/v1/claude/usage/calibrate")
async def calibrate(body: Calibration) -> dict[str, Any]:
    """Set the limits so current use equals the typed percentages."""
    totals = _totals(datetime.now(timezone.utc))
    if totals["five_hour"] <= 0 or totals["weekly"] <= 0:
        raise HTTPException(status_code=409, detail="Sem uso registrado para calibrar.")
    limits = {
        "five_hour_limit": round(totals["five_hour"] / (body.five_hour_percent / 100)),
        "weekly_limit": round(totals["weekly"] / (body.weekly_percent / 100)),
        "calibrated_at": time.time(),
    }
    CALIBRATION_FILE.parent.mkdir(parents=True, exist_ok=True)
    CALIBRATION_FILE.write_text(json.dumps(limits), encoding="utf-8")
    return _report(totals)

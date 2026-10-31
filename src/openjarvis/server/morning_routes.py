"""Local endpoints for the morning greeting: unread mail and the spoken recap."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from starlette.concurrency import run_in_threadpool

from openjarvis.core.paths import get_config_dir

router = APIRouter()

_RECAP_FILE = "morning_recap.md"
_RECAP_MAX_CHARS = 2000


def _recap_path() -> Path:
    return get_config_dir() / _RECAP_FILE


@router.get("/v1/mail/unread")
async def unread_mail(limit: int = Query(8, ge=1, le=25)) -> dict[str, Any]:
    """Unread count plus sender/subject/date of the newest messages."""
    from openjarvis.connectors.unread_mail import fetch_unread_cached

    return await run_in_threadpool(fetch_unread_cached, limit)


@router.get("/v1/news/headlines")
async def news_headlines(limit: int = Query(6, ge=1, le=20)) -> dict[str, Any]:
    """Newest headlines from the configured RSS feeds, one feed after another."""
    from openjarvis.connectors.headlines import fetch_headlines_cached

    return await run_in_threadpool(fetch_headlines_cached, limit)


@router.get("/v1/morning/recap")
async def morning_recap() -> dict[str, str]:
    """Text the assistant speaks while the morning digest is being prepared.

    It lives in ``~/.openjarvis/morning_recap.md`` so it can be edited freely.
    """
    path = _recap_path()
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    return {"text": text[:_RECAP_MAX_CHARS]}

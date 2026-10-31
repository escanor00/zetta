"""Recent headlines from the configured RSS feeds, for the HUD news panel."""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_LOOKBACK = timedelta(hours=48)
# Fetching every feed takes a few seconds, and headlines change slowly.
_CACHE_SECONDS = 300.0
_cache_lock = threading.Lock()
_cache: Optional[tuple[float, int, Dict[str, Any]]] = None


def _sort_key(moment: Optional[datetime]) -> datetime:
    """Comparable (naive UTC) moment; feeds mix aware and naive dates."""
    if moment is None:
        return datetime.min
    if moment.tzinfo is not None:
        return moment.astimezone(timezone.utc).replace(tzinfo=None)
    return moment


def _safe_link(url: Optional[str]) -> Optional[str]:
    """Only plain web links; a feed must not smuggle in javascript: or file:."""
    if not url:
        return None
    parsed = urlparse(url.strip())
    return url.strip() if parsed.scheme in {"http", "https"} and parsed.netloc else None


def _interleave(docs: List[Any], limit: int) -> List[Any]:
    """Newest first within each feed, then take turns between feeds."""
    by_feed: Dict[str, List[Any]] = {}
    for doc in sorted(docs, key=lambda d: _sort_key(d.timestamp), reverse=True):
        by_feed.setdefault(doc.metadata.get("feed_name", ""), []).append(doc)

    ordered: List[Any] = []
    while len(ordered) < limit and any(by_feed.values()):
        for feed in list(by_feed):
            if by_feed[feed] and len(ordered) < limit:
                ordered.append(by_feed[feed].pop(0))
    return ordered


def _describe(doc: Any) -> Dict[str, Any]:
    source = doc.metadata.get("feed_name", "") or "Notícias"
    return {
        "id": hashlib.sha1(f"{source}|{doc.title}".encode("utf-8")).hexdigest()[:16],
        "source": source,
        "title": " ".join((doc.title or "").split()),
        "link": _safe_link(doc.url),
        "published": doc.timestamp.isoformat() if doc.timestamp else None,
    }


def fetch_headlines(
    limit: int = 6, *, connector: Any = None, now: Optional[datetime] = None
) -> Dict[str, Any]:
    """Latest headlines across the configured feeds. Never raises."""
    limit = max(1, min(int(limit), 20))
    if connector is None:
        from openjarvis.connectors.news_rss import NewsRSSConnector

        connector = NewsRSSConnector()

    try:
        if not connector.is_connected():
            return {"connected": False, "items": []}
        since = (now or datetime.now()) - _LOOKBACK
        docs = list(connector.sync(since=since))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read headlines: %s", exc)
        return {
            "connected": True,
            "items": [],
            "error": "Não consegui buscar as notícias agora.",
        }

    return {
        "connected": True,
        "items": [_describe(d) for d in _interleave(docs, limit)],
    }


def fetch_headlines_cached(limit: int = 6) -> Dict[str, Any]:
    """``fetch_headlines`` with a short shared cache."""
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if (
            _cache is not None
            and _cache[1] == limit
            and now - _cache[0] < _CACHE_SECONDS
        ):
            return _cache[2]
    result = fetch_headlines(limit)
    if result["items"]:
        with _cache_lock:
            _cache = (now, limit, result)
    return result

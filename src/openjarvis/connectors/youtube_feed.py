"""Newest videos from a few YouTube channels, for the HUD YouTube panel.

Uses the public Atom feed every channel has, so it needs no account or key.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# (channel id, shown name): technology and the VR world.
CHANNELS: List[tuple[str, str]] = [
    ("UCCWx9yfQC4wMDuPmszpWa-A", "Lurucas VR"),
    ("UCw6VrE_qJqLfRH9fP5WOhGg", "VR Tutoriais Marco Pereira"),
    ("UCVttJS9LLVAN6cdApvXJnZQ", "AI ProgBr"),
    ("UCqDMvCa1tGak6AmijajiKOw", "UploadVR"),
    ("UCx78qBGQl-oCvGwX-MaVRgA", "Road to VR"),
    ("UCdmGjywrxeOPfC7vDllmSgQ", "TecMundo"),
    ("UC_bXJnsgwOqEPA_-6N6faKw", "Canaltech"),
    ("UCEf5U1dB5a2e2S-XUlnhxSA", "Diolinux"),
]

_FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
_NS = {
    "a": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
}
_PER_CHANNEL = 3
_CACHE_SECONDS = 600.0
_VIDEO_ID = re.compile(r"^[\w-]{6,20}$")
_cache_lock = threading.Lock()
_cache: Optional[tuple[float, int, Dict[str, Any]]] = None


def _read_channel(channel_id: str, name: str) -> List[Dict[str, Any]]:
    request = urllib.request.Request(
        _FEED_URL.format(channel_id), headers={"User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
        root = ET.fromstring(response.read())
    videos: List[Dict[str, Any]] = []
    for entry in root.findall("a:entry", _NS)[:_PER_CHANNEL]:
        video_id = (entry.findtext("yt:videoId", "", _NS) or "").strip()
        title = " ".join((entry.findtext("a:title", "", _NS) or "").split())
        if not _VIDEO_ID.match(video_id) or "#shorts" in title.lower():
            continue
        videos.append(
            {
                "id": video_id,
                "title": title,
                "channel": name,
                "published": entry.findtext("a:published", None, _NS),
                "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
            }
        )
    return videos


def _moment(video: Dict[str, Any]) -> datetime:
    try:
        return datetime.fromisoformat(video["published"])
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


def fetch_youtube_feed(limit: int = 8) -> Dict[str, Any]:
    """Newest videos across the channels, newest first. Never raises."""
    limit = max(1, min(int(limit), 24))

    def safe(channel: tuple[str, str]) -> List[Dict[str, Any]]:
        try:
            return _read_channel(*channel)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not read YouTube feed %s: %s", channel[1], exc)
            return []

    with ThreadPoolExecutor(max_workers=len(CHANNELS)) as pool:
        groups = list(pool.map(safe, CHANNELS))
    videos = sorted(
        (video for group in groups for video in group), key=_moment, reverse=True
    )
    result: Dict[str, Any] = {"items": videos[:limit]}
    if not videos:
        result["error"] = "Não consegui buscar os vídeos agora."
    return result


def fetch_youtube_feed_cached(limit: int = 8) -> Dict[str, Any]:
    """``fetch_youtube_feed`` with a short shared cache."""
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if _cache is not None and _cache[1] == limit and now - _cache[0] < _CACHE_SECONDS:
            return _cache[2]
    result = fetch_youtube_feed(limit)
    if result["items"]:
        with _cache_lock:
            _cache = (now, limit, result)
    return result

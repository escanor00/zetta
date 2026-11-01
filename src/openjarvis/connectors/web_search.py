"""Quick web search for the HUD search panel.

Reads the plain DuckDuckGo results page (no account or key). Google refuses
automated queries, so it is only offered as a link in the panel.
"""

from __future__ import annotations

import html
import logging
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_URL = "https://html.duckduckgo.com/html/?"
_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120 Safari/537.36"
)
_BLOCK = re.compile(r'<div class="result results_links.*?(?=<div class="result results_links|\Z)', re.S)
_TITLE = re.compile(r'class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_SNIPPET = re.compile(r'class="result__snippet"[^>]*>(.*?)</a>', re.S)
_TAGS = re.compile(r"<[^>]+>")


def _clean(fragment: str) -> str:
    return " ".join(html.unescape(_TAGS.sub("", fragment)).split())


def _target(href: str) -> Optional[str]:
    """The real address behind DuckDuckGo's redirect link; only web links."""
    href = html.unescape(href)
    if href.startswith("//"):
        href = "https:" + href
    parsed = urllib.parse.urlparse(href)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        href = urllib.parse.parse_qs(parsed.query).get("uddg", [""])[0]
        parsed = urllib.parse.urlparse(href)
    return href if parsed.scheme in {"http", "https"} and parsed.netloc else None


def parse_results(page: str, limit: int) -> List[Dict[str, str]]:
    results: List[Dict[str, str]] = []
    for block in _BLOCK.findall(page):
        if "result--ad" in block:
            continue
        title = _TITLE.search(block)
        link = _target(title.group(1)) if title else None
        if not title or not link:
            continue
        snippet = _SNIPPET.search(block)
        results.append(
            {
                "title": _clean(title.group(2)),
                "link": link,
                "host": urllib.parse.urlparse(link).netloc.removeprefix("www."),
                "snippet": _clean(snippet.group(1)) if snippet else "",
            }
        )
        if len(results) >= limit:
            break
    return results


def web_search(query: str, limit: int = 6) -> Dict[str, Any]:
    """Top results for ``query``. Never raises."""
    query = " ".join(query.split())[:200]
    if not query:
        return {"items": []}
    request = urllib.request.Request(
        _URL + urllib.parse.urlencode({"q": query, "kl": "br-pt"}),
        headers={"User-Agent": _AGENT, "Accept-Language": "pt-BR,pt;q=0.9"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310
            page = response.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Web search failed: %s", exc)
        return {"items": [], "error": "Não consegui pesquisar agora."}
    return {"items": parse_results(page, max(1, min(int(limit), 10)))}

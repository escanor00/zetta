"""Unread mail summary: sender, subject and date only, never message bodies.

The IMAP connectors open INBOX with ``readonly=True`` and this module fetches
headers with ``BODY.PEEK``, so looking at the list never marks anything as read.
"""

from __future__ import annotations

import email as email_lib
import logging
import threading
import time
from email.utils import parseaddr
from typing import Any, Dict, List, Optional

from openjarvis.connectors.gmail_imap import _decode_header, _parse_date

logger = logging.getLogger(__name__)

_HEADER_FIELDS = "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])"
# Polling clients (several tabs, every couple of minutes) should not each open
# their own IMAP session.
_CACHE_SECONDS = 30.0
_cache_lock = threading.Lock()
_cache: Optional[tuple[float, int, Dict[str, Any]]] = None


def _default_connector() -> Any:
    """First connected IMAP-based connector, or ``None``."""
    import openjarvis.connectors  # noqa: F401 — registers every connector
    from openjarvis.connectors.gmail_imap import GmailIMAPConnector
    from openjarvis.connectors.imap import IMAPConnector

    for connector_cls in (IMAPConnector, GmailIMAPConnector):
        try:
            connector = connector_cls()
            if connector.is_connected():
                return connector
        except Exception:  # noqa: BLE001 — a broken connector is just offline
            continue
    return None


def _parse_message(uid: int, raw_header: bytes) -> Dict[str, Any]:
    message = email_lib.message_from_bytes(raw_header)
    name, address = parseaddr(_decode_header(message.get("From", "")))
    subject = _decode_header(message.get("Subject", "")).strip()
    try:
        date = _parse_date(message).isoformat()
    except Exception:  # noqa: BLE001
        date = None
    return {
        "uid": uid,
        "from": (name or address or "Remetente desconhecido").strip(),
        "from_address": address,
        "subject": subject or "(sem assunto)",
        "date": date,
    }


def _header_bytes(fetch_data: List[Any]) -> bytes:
    """The header block out of an ``imaplib`` FETCH response."""
    for part in fetch_data:
        if isinstance(part, tuple) and len(part) >= 2 and isinstance(part[1], bytes):
            return part[1]
    return b""


def fetch_unread(limit: int = 10, *, connector: Any = None) -> Dict[str, Any]:
    """Count unread mail and describe the newest *limit* messages.

    Never raises: a missing account or a connection problem is reported in the
    result so a polling UI can degrade quietly.
    """
    limit = max(1, min(int(limit), 25))
    connector = connector if connector is not None else _default_connector()
    if connector is None:
        return {"connected": False, "count": 0, "messages": []}

    imap = None
    try:
        imap = connector._open_imap()
        status, data = imap.uid("SEARCH", None, "UNSEEN")
        if status != "OK":
            raise RuntimeError("IMAP search failed")
        uids = data[0].split() if data and data[0] else []

        messages: List[Dict[str, Any]] = []
        for raw_uid in reversed(uids[-limit:]):  # newest first
            status, fetched = imap.uid("FETCH", raw_uid, _HEADER_FIELDS)
            if status != "OK":
                continue
            header = _header_bytes(fetched)
            if header:
                messages.append(_parse_message(int(raw_uid), header))
        return {"connected": True, "count": len(uids), "messages": messages}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read unread mail: %s", exc)
        return {
            "connected": True,
            "count": 0,
            "messages": [],
            "error": "Não consegui consultar a caixa de entrada agora.",
        }
    finally:
        if imap is not None:
            try:
                connector._close_imap(imap)
            except Exception:  # noqa: BLE001
                pass


def fetch_unread_cached(limit: int = 10) -> Dict[str, Any]:
    """``fetch_unread`` with a short shared cache."""
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if (
            _cache is not None
            and _cache[1] == limit
            and now - _cache[0] < _CACHE_SECONDS
        ):
            return _cache[2]
    result = fetch_unread(limit)
    if "error" not in result:
        with _cache_lock:
            _cache = (now, limit, result)
    return result

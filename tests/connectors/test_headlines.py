from __future__ import annotations

from datetime import datetime, timedelta, timezone

from openjarvis.connectors._stubs import Document
from openjarvis.connectors.headlines import fetch_headlines

NOW = datetime(2026, 10, 31, 12, 0, 0)


def _doc(feed: str, title: str, age_hours: float, url: str | None = "https://x.com/a"):
    return Document(
        doc_id=f"{feed}-{title}",
        source="news_rss",
        doc_type="article",
        content="",
        title=title,
        timestamp=NOW - timedelta(hours=age_hours),
        url=url,
        metadata={"feed_name": feed},
    )


class _Connector:
    def __init__(self, docs=None, connected=True, error: Exception | None = None):
        self._docs = docs or []
        self._connected = connected
        self._error = error
        self.since = None

    def is_connected(self):
        return self._connected

    def sync(self, *, since=None, cursor=None):
        self.since = since
        if self._error:
            raise self._error
        yield from self._docs


def test_reports_not_connected_without_feeds():
    result = fetch_headlines(connector=_Connector(connected=False))

    assert result == {"connected": False, "items": []}


def test_takes_turns_between_feeds_instead_of_one_feed_filling_the_list():
    docs = [
        _doc("G1", "g1-a", 1),
        _doc("G1", "g1-b", 2),
        _doc("G1", "g1-c", 3),
        _doc("Folha", "folha-a", 4),
        _doc("Tecnoblog", "tec-a", 5),
    ]

    result = fetch_headlines(4, connector=_Connector(docs), now=NOW)

    assert [i["title"] for i in result["items"]] == ["g1-a", "folha-a", "tec-a", "g1-b"]


def test_newest_first_within_a_feed():
    docs = [_doc("G1", "velha", 30), _doc("G1", "nova", 1), _doc("G1", "media", 10)]

    result = fetch_headlines(3, connector=_Connector(docs), now=NOW)

    assert [i["title"] for i in result["items"]] == ["nova", "media", "velha"]


def test_mixed_aware_and_naive_dates_do_not_break_sorting():
    aware = _doc("Folha", "aware", 0)
    aware.timestamp = datetime(2026, 10, 31, 14, 0, tzinfo=timezone.utc)
    naive = _doc("Folha", "naive", 5)

    result = fetch_headlines(2, connector=_Connector([naive, aware]), now=NOW)

    assert [i["title"] for i in result["items"]] == ["aware", "naive"]


def test_only_plain_web_links_are_returned():
    docs = [
        _doc("A", "ok", 1, "https://g1.globo.com/noticia"),
        _doc("B", "js", 2, "javascript:alert(1)"),
        _doc("C", "file", 3, "file:///c:/windows/win.ini"),
        _doc("D", "none", 4, None),
    ]

    result = fetch_headlines(10, connector=_Connector(docs), now=NOW)
    links = {i["title"]: i["link"] for i in result["items"]}

    assert links == {
        "ok": "https://g1.globo.com/noticia",
        "js": None,
        "file": None,
        "none": None,
    }


def test_ids_are_stable_and_distinct():
    docs = [_doc("G1", "um", 1), _doc("G1", "dois", 2)]

    first = fetch_headlines(5, connector=_Connector(docs), now=NOW)
    second = fetch_headlines(5, connector=_Connector(docs), now=NOW)

    ids = [i["id"] for i in first["items"]]
    assert ids == [i["id"] for i in second["items"]]
    assert len(set(ids)) == 2


def test_only_asks_for_the_last_two_days():
    connector = _Connector([_doc("G1", "x", 1)])

    fetch_headlines(connector=connector, now=NOW)

    assert connector.since == NOW - timedelta(hours=48)


def test_failures_are_reported_not_raised():
    result = fetch_headlines(connector=_Connector(error=RuntimeError("feed caiu")))

    assert result["connected"] is True
    assert result["items"] == []
    assert "feed caiu" not in result["error"]


def test_titles_are_collapsed_to_one_line():
    result = fetch_headlines(
        connector=_Connector([_doc("G1", "linha\n  quebrada", 1)]), now=NOW
    )

    assert result["items"][0]["title"] == "linha quebrada"

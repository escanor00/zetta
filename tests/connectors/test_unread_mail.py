from __future__ import annotations

from openjarvis.connectors import unread_mail
from openjarvis.connectors.unread_mail import fetch_unread


def _raw(
    sender: str, subject: str, date: str = "Fri, 30 Oct 2026 10:00:00 -0300"
) -> bytes:
    return f"From: {sender}\r\nSubject: {subject}\r\nDate: {date}\r\n\r\n".encode(
        "utf-8"
    )


class _FakeImap:
    """Just enough of imaplib for ``fetch_unread``; records every command."""

    def __init__(self, unseen: list[int], headers: dict[int, bytes]):
        self._unseen = unseen
        self._headers = headers
        self.commands: list[tuple] = []

    def uid(self, command, *args):
        self.commands.append((command, *args))
        if command == "SEARCH":
            return "OK", [" ".join(str(u) for u in self._unseen).encode()]
        if command == "FETCH":
            uid = int(args[0])
            return "OK", [
                (b"%d (BODY[HEADER.FIELDS] {1}" % uid, self._headers[uid]),
                b")",
            ]
        raise AssertionError(f"unexpected IMAP command {command}")


class _FakeConnector:
    def __init__(self, imap=None, error: Exception | None = None):
        self._imap = imap
        self._error = error
        self.closed = False

    def _open_imap(self):
        if self._error:
            raise self._error
        return self._imap

    def _close_imap(self, imap):
        self.closed = True


def test_reports_not_connected_without_an_account(monkeypatch):
    monkeypatch.setattr(unread_mail, "_default_connector", lambda: None)

    assert fetch_unread() == {"connected": False, "count": 0, "messages": []}


def test_counts_all_unread_but_describes_only_the_newest():
    imap = _FakeImap(
        unseen=[3, 7, 9, 12],
        headers={
            7: _raw("Ana <ana@x.com>", "Sete"),
            9: _raw("Banco <b@x.com>", "Nove"),
            12: _raw("Carlos <c@x.com>", "Doze"),
        },
    )
    connector = _FakeConnector(imap)

    result = fetch_unread(3, connector=connector)

    assert result["connected"] is True
    assert result["count"] == 4
    assert [m["uid"] for m in result["messages"]] == [12, 9, 7]  # newest first
    assert result["messages"][0]["from"] == "Carlos"
    assert result["messages"][0]["from_address"] == "c@x.com"
    assert connector.closed is True


def test_decodes_encoded_headers_and_falls_back_for_blank_ones():
    imap = _FakeImap(
        unseen=[1, 2],
        headers={
            1: _raw("=?utf-8?q?Jo=C3=A3o?= <j@x.com>", "=?utf-8?q?A=C3=A7=C3=A3o?="),
            2: b"From: sem@nome.com\r\n\r\n",
        },
    )

    result = fetch_unread(5, connector=_FakeConnector(imap))
    by_uid = {m["uid"]: m for m in result["messages"]}

    assert by_uid[1]["from"] == "João"
    assert by_uid[1]["subject"] == "Ação"
    assert by_uid[2]["from"] == "sem@nome.com"
    assert by_uid[2]["subject"] == "(sem assunto)"


def test_only_reads_headers_without_marking_anything_as_read():
    imap = _FakeImap(unseen=[5], headers={5: _raw("Ana <a@x.com>", "Oi")})

    fetch_unread(5, connector=_FakeConnector(imap))

    fetches = [c for c in imap.commands if c[0] == "FETCH"]
    assert fetches and all("BODY.PEEK" in c[2] for c in fetches)
    assert all(c[0] in {"SEARCH", "FETCH"} for c in imap.commands)  # no STORE
    assert all("RFC822" not in str(c) and "BODY[]" not in str(c) for c in imap.commands)


def test_empty_inbox():
    result = fetch_unread(5, connector=_FakeConnector(_FakeImap([], {})))

    assert result == {"connected": True, "count": 0, "messages": []}


def test_connection_failure_is_reported_not_raised():
    connector = _FakeConnector(error=OSError("rede caiu"))

    result = fetch_unread(5, connector=connector)

    assert result["connected"] is True
    assert result["count"] == 0
    assert "error" in result
    assert "rede caiu" not in result["error"]  # no internals leaked to the UI


def test_limit_is_clamped():
    imap = _FakeImap(
        unseen=list(range(1, 40)),
        headers={u: _raw("A <a@x.com>", str(u)) for u in range(1, 40)},
    )

    result = fetch_unread(1000, connector=_FakeConnector(imap))

    assert result["count"] == 39
    assert len(result["messages"]) == 25

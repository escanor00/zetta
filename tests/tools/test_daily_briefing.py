from __future__ import annotations

from unittest.mock import patch

from openjarvis.core.types import ToolResult
from openjarvis.tools import daily_briefing
from openjarvis.tools.daily_briefing import DailyBriefingTool


def _collected(content: str) -> ToolResult:
    return ToolResult(tool_name="digest_collect", content=content, success=True)


def test_registered_and_describes_its_focus_values():
    spec = DailyBriefingTool().spec

    assert spec.name == "daily_briefing"
    assert spec.parameters["properties"]["focus"]["enum"] == ["all", "news", "email"]


def test_email_focus_without_account_says_so():
    with patch.object(daily_briefing, "_connected", return_value=[]):
        result = DailyBriefingTool().execute(focus="email")

    assert result.success is True
    assert "Nenhuma conta de e-mail" in result.content


def test_email_focus_lists_recent_mail_without_internal_ids():
    collected = _collected(
        "=== MESSAGES ===\n"
        '[gmail id=abc123] From: Ana — "Reunião amanhã" (2h ago)\n'
        '[gmail id=def456] From: Banco — "Fatura" (5h ago)\n'
    )
    with (
        patch.object(daily_briefing, "_connected", return_value=["gmail"]),
        patch.object(daily_briefing, "_collect", return_value=collected),
    ):
        result = DailyBriefingTool().execute(focus="email")

    assert "Os 2 e-mails mais recentes" in result.content
    assert "não diga que são" in result.content
    assert "Reunião amanhã" in result.content
    assert "abc123" not in result.content


def test_email_focus_with_empty_inbox():
    with (
        patch.object(daily_briefing, "_connected", return_value=["gmail"]),
        patch.object(daily_briefing, "_collect", return_value=_collected("")),
    ):
        result = DailyBriefingTool().execute(focus="email")

    assert "Nenhum e-mail novo" in result.content


def test_news_focus_returns_headlines_and_drops_error_lines():
    collected = _collected(
        "=== WORLD ===\n"
        "[G1] Chuva forte em BH — alagamentos\n"
        "[Folha] Corinthians vence\n"
        "=== ERRORS ===\n"
        "Connector 'weather' not connected (no credentials)\n"
    )
    with (
        patch.object(daily_briefing, "_connected", return_value=["news_rss"]),
        patch.object(daily_briefing, "_collect", return_value=collected),
    ):
        result = DailyBriefingTool().execute(focus="news")

    assert "Chuva forte em BH" in result.content
    assert "Corinthians vence" in result.content
    assert "weather" not in result.content


def test_news_focus_without_sources():
    with patch.object(daily_briefing, "_connected", return_value=[]):
        result = DailyBriefingTool().execute(focus="news")

    assert "Nenhuma fonte de notícias" in result.content


def test_full_briefing_appends_a_note_when_mail_is_not_connected():
    with (
        patch.object(
            daily_briefing,
            "_full_briefing",
            wraps=daily_briefing._full_briefing,
        ),
        patch.object(daily_briefing, "_connected", return_value=[]),
        patch("openjarvis.sdk.Jarvis") as jarvis_cls,
    ):
        jarvis_cls.return_value.__enter__.return_value.ask.return_value = (
            "Bom dia, Luiz. Notícias do dia."
        )
        result = DailyBriefingTool().execute()

    assert result.content.startswith("Bom dia, Luiz.")
    assert "Nenhuma conta de e-mail" in result.content


def test_invalid_focus_is_rejected():
    result = DailyBriefingTool().execute(focus="clima")

    assert result.success is False


def test_errors_are_reported_not_raised():
    with patch.object(daily_briefing, "_connected", side_effect=RuntimeError("falhou")):
        result = DailyBriefingTool().execute(focus="email")

    assert result.success is False
    assert "falhou" in result.content


def test_generic_imap_accounts_count_as_mail():
    assert "imap" in daily_briefing._MAIL_SOURCES


def test_digest_collect_formats_imap_mail_like_gmail_imap():
    from datetime import datetime

    from openjarvis.connectors._stubs import Document
    from openjarvis.tools.digest_collect import _format_doc

    doc = Document(
        doc_id="imap:1",
        source="imap",
        doc_type="email",
        content="corpo",
        title="Fatura",
        author="Banco",
        timestamp=datetime.now(),
    )

    line = _format_doc("imap", doc)

    assert "Banco" in line and "Fatura" in line

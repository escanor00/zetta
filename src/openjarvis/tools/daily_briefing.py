"""Daily briefing tool — spoken summary, headlines, or "do I have mail?"."""

from __future__ import annotations

import re
from typing import Any, List

from openjarvis.core.registry import ConnectorRegistry, ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_MAIL_SOURCES = ("gmail", "gmail_imap", "imap", "outlook")
_NEWS_SOURCES = ("news_rss",)
_MAX_HEADLINES = 8
_MAX_MAILS = 10

_NO_MAIL = (
    "Nenhuma conta de e-mail está conectada, então não consigo ver suas "
    "mensagens. Conecte o Gmail em Fontes de Dados."
)
_NO_NEWS = "Nenhuma fonte de notícias está configurada."


def _connected(source_ids: tuple[str, ...]) -> List[str]:
    """Connector ids among *source_ids* that are registered and connected."""
    import openjarvis.connectors  # noqa: F401 — registers every connector

    connected: List[str] = []
    for source in source_ids:
        if not ConnectorRegistry.contains(source):
            continue
        try:
            if ConnectorRegistry.get(source)().is_connected():
                connected.append(source)
        except Exception:  # noqa: BLE001 — a broken connector is just offline
            continue
    return connected


def _collect(sources: List[str], hours_back: float) -> ToolResult:
    from openjarvis.tools.digest_collect import DigestCollectTool

    return DigestCollectTool().execute(sources=sources, hours_back=hours_back)


def _content_lines(result: ToolResult) -> List[str]:
    """Item lines of a digest_collect result, without section/error headers."""
    lines: List[str] = []
    for line in result.content.splitlines():
        line = line.strip()
        if not line or line.startswith("==="):
            continue
        if line.startswith("Connector '") or line.startswith("Error fetching"):
            continue
        lines.append(re.sub(r"^\[(\w+) id=[^\]]*\]", r"[\1]", line))
    return lines


def _email_briefing() -> ToolResult:
    sources = _connected(_MAIL_SOURCES)
    if not sources:
        return ToolResult(tool_name="daily_briefing", content=_NO_MAIL, success=True)

    result = _collect(sources, hours_back=24)
    lines = _content_lines(result)[:_MAX_MAILS]
    if not lines:
        return ToolResult(
            tool_name="daily_briefing",
            content="Nenhum e-mail novo nas últimas 24 horas.",
            success=True,
        )
    body = "\n".join(lines)
    return ToolResult(
        tool_name="daily_briefing",
        content=(
            f"Os {len(lines)} e-mails mais recentes da caixa de entrada. Não "
            "consigo saber quais já foram lidos, nem quantos existem além "
            f"destes; não diga que são 'não lidos':\n{body}"
        ),
        success=True,
    )


def _news_briefing() -> ToolResult:
    sources = _connected(_NEWS_SOURCES)
    if not sources:
        return ToolResult(tool_name="daily_briefing", content=_NO_NEWS, success=True)

    result = _collect(sources, hours_back=48)
    lines = _content_lines(result)[:_MAX_HEADLINES]
    if not lines:
        return ToolResult(
            tool_name="daily_briefing",
            content="Não encontrei notícias recentes nas fontes configuradas.",
            success=True,
        )
    return ToolResult(
        tool_name="daily_briefing",
        content="Manchetes recentes:\n" + "\n".join(lines),
        success=True,
    )


def _full_briefing() -> ToolResult:
    from openjarvis.sdk import Jarvis

    with Jarvis() as jarvis:
        narrative = jarvis.ask("Generate my morning digest", agent="morning_digest")

    notes: List[str] = []
    if not _connected(_MAIL_SOURCES):
        notes.append(_NO_MAIL)
    text = narrative.strip() or "Não há nada novo para relatar agora."
    return ToolResult(
        tool_name="daily_briefing",
        content="\n\n".join([text, *notes]),
        success=True,
    )


@ToolRegistry.register("daily_briefing")
class DailyBriefingTool(BaseTool):
    """Spoken daily summary, news headlines, or recent e-mail."""

    tool_id = "daily_briefing"
    is_local = True

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="daily_briefing",
            description=(
                "Resumo do dia, notícias e e-mails do usuário. Use quando ele "
                "pedir o resumo do dia ou um bom-dia/briefing (focus='all'), as "
                "notícias ou manchetes (focus='news'), ou perguntar se tem "
                "e-mail ou mensagens para ler (focus='email'). Devolve texto "
                "pronto para ser falado; leia-o de forma natural e curta, sem "
                "inventar nada além do que a ferramenta retornou."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "focus": {
                        "type": "string",
                        "enum": ["all", "news", "email"],
                        "description": (
                            "'all' resumo completo, 'news' só notícias, "
                            "'email' só e-mails. Padrão: 'all'."
                        ),
                    },
                },
            },
            category="data",
            timeout_seconds=120.0,
        )

    def execute(self, **params: Any) -> ToolResult:
        focus = str(params.get("focus") or "all").strip().lower()
        handlers = {
            "email": _email_briefing,
            "news": _news_briefing,
            "all": _full_briefing,
        }
        handler = handlers.get(focus)
        if handler is None:
            return ToolResult(
                tool_name="daily_briefing",
                content=f"Foco inválido: {focus!r}. Use 'all', 'news' ou 'email'.",
                success=False,
            )
        try:
            return handler()
        except Exception as exc:  # noqa: BLE001
            return ToolResult(
                tool_name="daily_briefing",
                content=f"Não consegui preparar o resumo agora: {exc}",
                success=False,
            )


__all__ = ["DailyBriefingTool"]

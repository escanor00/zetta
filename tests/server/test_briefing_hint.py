from __future__ import annotations

from types import SimpleNamespace

import pytest

from openjarvis.server.routes import _inject_briefing_hint


def _app(enabled=("daily_briefing", "file_read")):
    config = SimpleNamespace(tools=SimpleNamespace(enabled=list(enabled)))
    return SimpleNamespace(state=SimpleNamespace(config=config))


def _request(text: str):
    message = SimpleNamespace(role="user", content=text)
    return SimpleNamespace(messages=[message]), message


@pytest.mark.parametrize(
    "spoken",
    [
        "Tenho algum e-mail para ler?",
        "tenho email novo",
        "Quais são as notícias de hoje?",
        "me fala as manchetes",
        "Faça o resumo do meu dia",
        "resuma o meu dia por favor",
        "me dá um briefing",
        "o que tem de novo?",
    ],
)
def test_hint_added_for_summary_news_and_email_requests(spoken):
    body, message = _request(spoken)

    _inject_briefing_hint(body, _app())

    assert message.content.startswith("[Contexto: para o resumo do dia")
    assert "daily_briefing" in message.content
    assert message.content.endswith(spoken)


@pytest.mark.parametrize(
    "spoken",
    [
        "Bom dia!",
        "Qual a capital da França?",
        "Crie uma nota chamada X",
        "resumo do texto",
    ],
)
def test_hint_not_added_for_unrelated_requests(spoken):
    body, message = _request(spoken)

    _inject_briefing_hint(body, _app())

    assert message.content == spoken


def test_hint_skipped_when_the_tool_is_not_enabled():
    body, message = _request("Tenho e-mail?")

    _inject_briefing_hint(body, _app(enabled=("file_read",)))

    assert message.content == "Tenho e-mail?"

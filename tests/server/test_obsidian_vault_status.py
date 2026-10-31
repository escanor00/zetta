from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server import connectors_router, obsidian_active_note
from openjarvis.server.obsidian_active_note import router
from openjarvis.server.routes import _inject_obsidian_vault


@pytest.fixture(autouse=True)
def _isolated_state():
    connectors_router._instances.pop("obsidian", None)
    obsidian_active_note._status_cache.clear()
    yield
    connectors_router._instances.pop("obsidian", None)
    obsidian_active_note._status_cache.clear()


def _app(vault_path: str) -> FastAPI:
    app = FastAPI()
    app.state.config = SimpleNamespace(
        obsidian=SimpleNamespace(vault_path=vault_path),
    )
    app.include_router(router)
    return app


def test_status_reports_connected_vault_and_note_count(tmp_path):
    vault = tmp_path / "Zetta"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / "a.md").write_text("a", encoding="utf-8")
    (vault / "pasta").mkdir()
    (vault / "pasta" / "b.md").write_text("b", encoding="utf-8")
    (vault / ".obsidian" / "ignored.md").write_text("x", encoding="utf-8")
    (vault / "image.png").write_bytes(b"\x89PNG")

    response = TestClient(_app(str(vault))).get("/v1/obsidian/status")

    assert response.json() == {
        "configured": True,
        "connected": True,
        "vault": "Zetta",
        "notes": 2,
    }


def test_status_without_configured_vault():
    response = TestClient(_app("")).get("/v1/obsidian/status")

    assert response.json() == {
        "configured": False,
        "connected": False,
        "vault": "",
        "notes": None,
    }


def test_status_with_missing_directory_is_not_connected(tmp_path):
    response = TestClient(_app(str(tmp_path / "gone"))).get("/v1/obsidian/status")

    assert response.json()["configured"] is True
    assert response.json()["connected"] is False
    assert response.json()["notes"] is None


def _request(text: str):
    message = SimpleNamespace(role="user", content=text)
    return SimpleNamespace(messages=[message]), message


def test_vault_hint_is_a_prefix_so_it_never_lands_in_note_content(tmp_path):
    body, message = _request("Crie uma nota X com o conteudo: # Titulo")

    _inject_obsidian_vault(body, _app(str(tmp_path)))

    assert message.content.startswith("[Contexto local do Obsidian")
    assert message.content.endswith("com o conteudo: # Titulo")
    assert str(tmp_path) in message.content


def test_vault_hint_skipped_for_unrelated_requests(tmp_path):
    body, message = _request("Qual a capital da França?")

    _inject_obsidian_vault(body, _app(str(tmp_path)))

    assert message.content == "Qual a capital da França?"


def test_vault_hint_skipped_when_no_vault_configured():
    body, message = _request("Crie uma nota X")

    _inject_obsidian_vault(body, _app(""))

    assert message.content == "Crie uma nota X"


def test_vault_hint_covers_follow_up_turns_without_note_keywords(tmp_path):
    first = SimpleNamespace(role="user", content="Salve uma nova nota chamada X")
    reply = SimpleNamespace(role="assistant", content="Qual o conteúdo?")
    follow_up = SimpleNamespace(role="user", content="Hoje eu comprei o Cloud Code.")
    body = SimpleNamespace(messages=[first, reply, follow_up])

    _inject_obsidian_vault(body, _app(str(tmp_path)))

    assert follow_up.content.startswith("[Contexto local do Obsidian")
    assert follow_up.content.endswith("Hoje eu comprei o Cloud Code.")
    assert first.content == "Salve uma nova nota chamada X"


@pytest.mark.parametrize("spoken", ["abra o obsídia", "abra o obsidia", "Obsidian"])
def test_vault_hint_tolerates_mangled_obsidian_spelling(tmp_path, spoken):
    body, message = _request(f"{spoken} e salve algo")

    _inject_obsidian_vault(body, _app(str(tmp_path)))

    assert message.content.startswith("[Contexto local do Obsidian")

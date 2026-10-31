from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server import morning_routes


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(morning_routes.router)
    return TestClient(app)


def test_recap_returns_the_file_text(tmp_path, monkeypatch):
    recap = tmp_path / "morning_recap.md"
    recap.write_text("  Bom dia! Hoje construímos muita coisa.  \n", encoding="utf-8")
    monkeypatch.setattr(morning_routes, "_recap_path", lambda: recap)

    response = _client().get("/v1/morning/recap")

    assert response.json() == {"text": "Bom dia! Hoje construímos muita coisa."}


def test_recap_is_empty_when_the_file_does_not_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(morning_routes, "_recap_path", lambda: tmp_path / "nada.md")

    assert _client().get("/v1/morning/recap").json() == {"text": ""}


def test_recap_is_capped(tmp_path, monkeypatch):
    recap = tmp_path / "morning_recap.md"
    recap.write_text("a" * 5000, encoding="utf-8")
    monkeypatch.setattr(morning_routes, "_recap_path", lambda: recap)

    assert len(_client().get("/v1/morning/recap").json()["text"]) == 2000


def test_unread_endpoint_passes_the_limit_through(monkeypatch):
    seen: list[int] = []

    def fake(limit: int):
        seen.append(limit)
        return {"connected": True, "count": 2, "messages": []}

    monkeypatch.setattr("openjarvis.connectors.unread_mail.fetch_unread_cached", fake)

    response = _client().get("/v1/mail/unread?limit=4")

    assert response.json() == {"connected": True, "count": 2, "messages": []}
    assert seen == [4]


def test_unread_endpoint_rejects_an_absurd_limit():
    assert _client().get("/v1/mail/unread?limit=500").status_code == 422


def test_headlines_endpoint_passes_the_limit_through(monkeypatch):
    seen: list[int] = []

    def fake(limit: int):
        seen.append(limit)
        return {"connected": True, "items": []}

    monkeypatch.setattr("openjarvis.connectors.headlines.fetch_headlines_cached", fake)

    response = _client().get("/v1/news/headlines?limit=3")

    assert response.json() == {"connected": True, "items": []}
    assert seen == [3]


def test_headlines_endpoint_rejects_an_absurd_limit():
    assert _client().get("/v1/news/headlines?limit=500").status_code == 422

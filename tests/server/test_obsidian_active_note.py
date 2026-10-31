from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server.obsidian_active_note import router


def test_active_canvas_path_is_accepted(tmp_path):
    vault = tmp_path / "Vault"
    (vault / ".obsidian").mkdir(parents=True)

    app = FastAPI()
    app.state.config = SimpleNamespace(
        security=SimpleNamespace(allowed_dirs=[str(vault)])
    )
    app.include_router(router)

    response = TestClient(app).post(
        "/v1/obsidian/active-note",
        json={"vault": "Vault", "path": "Boards/Ideas.canvas"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "active": True}
    assert app.state.obsidian_active_note["path"] == "Boards/Ideas.canvas"

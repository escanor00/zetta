"""Tests for the search_notes tool."""

from __future__ import annotations

from pathlib import Path

import pytest

from openjarvis.tools.search_notes import SearchNotesTool, _fold, _terms


@pytest.fixture
def vault(tmp_path: Path) -> Path:
    sub = tmp_path / "Conceito da zetta"
    sub.mkdir()
    (sub / "Visão geral.md").write_text(
        "# Visão geral\nA Zetta é uma assistente local com voz e memória.\n",
        encoding="utf-8",
    )
    (sub / "Voz.md").write_text(
        "Notas sobre a voz: o modelo fala com sotaque brasileiro.\n", encoding="utf-8"
    )
    (tmp_path / "Receitas.md").write_text(
        "Bolo de cenoura com cobertura de chocolate.\n", encoding="utf-8"
    )
    hidden = tmp_path / ".obsidian"
    hidden.mkdir()
    (hidden / "config.md").write_text("cenoura segredo interno", encoding="utf-8")
    return tmp_path


def search(vault: Path, query: str, **kw) -> str:
    out = SearchNotesTool(str(vault)).execute(query=query, **kw)
    assert out.success, out.content
    return out.content


def test_finds_notes_inside_subfolders_with_their_path(vault) -> None:
    text = search(vault, "O que eu tenho anotado sobre a voz?")
    assert f"Voz (arquivo: {vault.as_posix()}/Conceito da zetta/Voz.md)" in text
    assert "sotaque brasileiro" in text


def test_ignores_accents_case_and_plurals(vault) -> None:
    assert "Visão geral" in search(vault, "VISAO GERAL da zetta")
    assert "Receitas" in search(vault, "bolos de cenouras")


def test_title_match_outranks_body_match(vault) -> None:
    text = search(vault, "voz")
    assert text.index("/Voz.md") < text.index("/Visão geral.md")


def test_hidden_obsidian_folder_is_not_searched(vault) -> None:
    text = search(vault, "cenoura segredo")
    assert "config.md" not in text and ".obsidian" not in text
    assert "Receitas.md" in text


def test_no_match_is_a_normal_answer(vault) -> None:
    assert "Nenhuma nota encontrada" in search(vault, "astronomia quântica")
    assert "Nenhuma nota encontrada" in search(vault, "de a o")  # only stopwords


def test_limit_is_clamped(vault) -> None:
    text = search(vault, "zetta voz cenoura", limit=1)
    assert text.count("arquivo:") == 1
    assert search(vault, "zetta voz cenoura", limit=999).count("arquivo:") <= 3
    assert search(vault, "voz", limit="abc").count("arquivo:") >= 1


def test_errors_are_reported_not_raised(tmp_path: Path) -> None:
    assert not SearchNotesTool(str(tmp_path / "missing")).execute(query="x").success
    assert not SearchNotesTool(str(tmp_path)).execute(query="  ").success


def test_uses_configured_vault_when_none_given(vault, monkeypatch) -> None:
    import openjarvis.tools.search_notes as mod

    monkeypatch.setattr(mod, "_vault_path", lambda: str(vault))
    out = SearchNotesTool().execute(query="cenoura")
    assert out.success and "Receitas" in out.content


def test_helpers() -> None:
    assert _fold("Ação ÇÃO") == "acao cao"
    assert len(_fold("Ação")) == len("Ação")  # length preserved for excerpts
    assert _terms("Os conceitos da Zetta") == _terms("conceito zetta")


def test_spec_is_read_only_and_requires_query() -> None:
    spec = SearchNotesTool().spec
    assert spec.name == "search_notes"
    assert spec.parameters["required"] == ["query"]
    assert spec.required_capabilities == []

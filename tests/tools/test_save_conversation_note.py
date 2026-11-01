"""Tests for the save_conversation_note tool."""

from __future__ import annotations

from pathlib import Path

from openjarvis.tools.save_conversation_note import SaveConversationNoteTool


def test_saves_note_with_links(tmp_path: Path) -> None:
    (tmp_path / "Voz.md").write_text(
        "Notas sobre a voz brasileira da Zetta.\n", encoding="utf-8"
    )
    tool = SaveConversationNoteTool(str(tmp_path))
    result = tool.execute(title="Ajuste da voz", summary="Falamos da voz da Zetta.")
    assert result.success
    notes = list((tmp_path / "Conversas").glob("*.md"))
    assert len(notes) == 1
    text = notes[0].read_text(encoding="utf-8")
    assert "# Ajuste da voz" in text
    assert "[[Voz]]" in text


def test_never_overwrites(tmp_path: Path) -> None:
    tool = SaveConversationNoteTool(str(tmp_path))
    tool.execute(title="Mesmo", summary="um")
    tool.execute(title="Mesmo", summary="dois")
    assert len(list((tmp_path / "Conversas").glob("*.md"))) == 2


def test_requires_vault(tmp_path: Path) -> None:
    tool = SaveConversationNoteTool(str(tmp_path / "nao-existe"))
    assert not tool.execute(title="a", summary="b").success

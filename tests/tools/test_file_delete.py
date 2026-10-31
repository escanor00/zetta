"""Tests for voice-confirmed file deletion."""

from __future__ import annotations

import json
import uuid
from typing import Optional

from openjarvis.core.types import ToolCall
from openjarvis.tools._request_context import (
    ToolRequestContext,
    reset_tool_request_context,
    set_tool_request_context,
)
from openjarvis.tools._stubs import ToolExecutor
from openjarvis.tools.file_delete import (
    FileDeleteTool,
    prepare_voice_delete_confirmation,
)


def _call(path: str) -> ToolCall:
    return ToolCall(
        id="delete-call",
        name="file_delete",
        arguments=json.dumps({"path": path}),
    )


def _execute(
    tool: FileDeleteTool,
    path: str,
    *,
    source: str,
    text: str,
    conversation: str,
    request_id: Optional[str] = None,
):
    token = set_tool_request_context(
        ToolRequestContext(
            conversation_id=conversation,
            input_source=source,
            user_text=text,
            request_id=request_id or uuid.uuid4().hex,
        )
    )
    try:
        return ToolExecutor([tool]).execute(_call(path))
    finally:
        reset_tool_request_context(token)


def test_stages_then_deletes_after_exact_voice_confirmation(tmp_path) -> None:
    note = tmp_path / "Minha nota.md"
    note.write_text("conteúdo", encoding="utf-8")
    tool = FileDeleteTool(allowed_dirs=[str(tmp_path)])

    staged = _execute(
        tool,
        str(note),
        source="voice",
        text="apague minha nota",
        conversation="voice-delete",
    )
    assert not staged.success
    assert "Confirmo excluir Minha nota" in staged.content
    assert note.exists()

    deleted = _execute(
        tool,
        str(note),
        source="voice",
        text="Confirmo excluir Minha nota",
        conversation="voice-delete",
    )
    assert deleted.success
    assert not note.exists()


def test_typed_confirmation_does_not_delete(tmp_path) -> None:
    note = tmp_path / "nota.md"
    note.write_text("conteúdo", encoding="utf-8")
    tool = FileDeleteTool(allowed_dirs=[str(tmp_path)])

    _execute(
        tool,
        str(note),
        source="voice",
        text="apague nota",
        conversation="typed-confirm",
    )
    result = _execute(
        tool,
        str(note),
        source="text",
        text="Confirmo excluir nota",
        conversation="typed-confirm",
    )

    assert not result.success
    assert note.exists()


def test_confirmation_must_be_a_later_chat_turn(tmp_path) -> None:
    note = tmp_path / "nota.md"
    note.write_text("conteúdo", encoding="utf-8")
    tool = FileDeleteTool(allowed_dirs=[str(tmp_path)])
    request_id = "same-request"

    staged = _execute(
        tool,
        str(note),
        source="voice",
        text="Confirmo excluir nota",
        conversation="same-turn",
        request_id=request_id,
    )
    repeated = _execute(
        tool,
        str(note),
        source="voice",
        text="Confirmo excluir nota",
        conversation="same-turn",
        request_id=request_id,
    )

    assert not staged.success
    assert not repeated.success
    assert note.exists()


def test_unrelated_voice_turn_cancels_pending_deletion(tmp_path) -> None:
    note = tmp_path / "nota.md"
    note.write_text("conteúdo", encoding="utf-8")
    tool = FileDeleteTool(allowed_dirs=[str(tmp_path)])

    _execute(
        tool,
        str(note),
        source="voice",
        text="apague nota",
        conversation="cancelled",
    )
    prepare_voice_delete_confirmation(
        ToolRequestContext(
            conversation_id="cancelled",
            input_source="voice",
            user_text="não, cancele",
            request_id="cancel-request",
        )
    )
    result = _execute(
        tool,
        str(note),
        source="voice",
        text="Confirmo excluir nota",
        conversation="cancelled",
    )

    assert not result.success
    assert note.exists()


def test_confirmation_is_bound_to_conversation_and_path(tmp_path) -> None:
    note = tmp_path / "nota.md"
    note.write_text("conteúdo", encoding="utf-8")
    other_note = tmp_path / "outra.md"
    other_note.write_text("conteúdo", encoding="utf-8")
    tool = FileDeleteTool(allowed_dirs=[str(tmp_path)])

    _execute(
        tool,
        str(note),
        source="voice",
        text="apague nota",
        conversation="pending-conversation",
    )
    other_conversation = _execute(
        tool,
        str(note),
        source="voice",
        text="Confirmo excluir nota",
        conversation="different-conversation",
    )
    different_path = _execute(
        tool,
        str(other_note),
        source="voice",
        text="Confirmo excluir nota",
        conversation="pending-conversation",
    )

    assert not other_conversation.success
    assert not different_path.success
    assert note.exists()
    assert other_note.exists()


def test_deletion_is_disabled_without_an_allowlist(tmp_path) -> None:
    note = tmp_path / "nota.md"
    note.write_text("conteúdo", encoding="utf-8")

    result = FileDeleteTool(allowed_dirs=[]).execute(
        path=str(note),
        _request_context=ToolRequestContext(
            conversation_id="disabled",
            input_source="voice",
            user_text="Confirmo excluir nota",
            request_id="disabled-request",
        ),
    )

    assert not result.success
    assert note.exists()


def test_delete_allowlist_is_separate_from_general_file_access(tmp_path) -> None:
    from openjarvis.core.config import JarvisConfig
    from openjarvis.tools._paths import file_tool_kwargs

    config = JarvisConfig()
    config.security.allowed_dirs = [str(tmp_path / "workspace")]
    config.security.delete_allowed_dirs = [str(tmp_path / "vault")]

    assert file_tool_kwargs("file_delete", config) == {
        "allowed_dirs": [str(tmp_path / "vault")]
    }


def test_sensitive_files_cannot_be_deleted(tmp_path) -> None:
    sensitive = tmp_path / "credentials.json"
    sensitive.write_text('{"token":"secret"}', encoding="utf-8")
    tool = FileDeleteTool(allowed_dirs=[str(tmp_path)])

    result = _execute(
        tool,
        str(sensitive),
        source="voice",
        text="exclua credentials",
        conversation="sensitive-file",
    )

    assert not result.success
    assert sensitive.exists()

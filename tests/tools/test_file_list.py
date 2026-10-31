"""Tests for the file_list tool."""

from __future__ import annotations

from openjarvis.tools.file_list import FileListTool


def test_spec() -> None:
    tool = FileListTool(allowed_dirs=[])
    assert tool.spec.name == "file_list"
    assert tool.spec.category == "filesystem"
    assert "file:read" in tool.spec.required_capabilities


def test_lists_entries_but_omits_sensitive_files(tmp_path) -> None:
    (tmp_path / "notes.txt").write_text("private contents")
    (tmp_path / "credentials.json").write_text('{"token": "secret"}')
    (tmp_path / "folder").mkdir()

    result = FileListTool(allowed_dirs=[]).execute(path=str(tmp_path))

    assert result.success
    assert "file: notes.txt" in result.content
    assert "directory: folder" in result.content
    assert "credentials.json" not in result.content
    assert "private contents" not in result.content


def test_restricts_directory_to_allowed_dirs(tmp_path) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    denied = tmp_path / "denied"
    denied.mkdir()

    result = FileListTool(allowed_dirs=[str(allowed)]).execute(path=str(denied))

    assert not result.success
    assert "Access denied" in result.content


def test_rejects_file_path(tmp_path) -> None:
    file_path = tmp_path / "note.txt"
    file_path.write_text("note")

    result = FileListTool(allowed_dirs=[]).execute(path=str(file_path))

    assert not result.success
    assert "Not a directory" in result.content


def test_limits_number_of_entries(tmp_path) -> None:
    for index in range(3):
        (tmp_path / f"{index}.txt").write_text("x")

    result = FileListTool(allowed_dirs=[]).execute(path=str(tmp_path), limit=1)

    assert result.success
    assert result.metadata["entry_count"] == 1
    assert result.metadata["truncated"]
    assert "more entries omitted" in result.content

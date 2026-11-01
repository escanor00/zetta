"""Reading may be allowed wider than writing via security.read_allowed_dirs."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from openjarvis.tools._paths import file_tool_kwargs


def cfg(allowed, read=None, delete=None):
    security = SimpleNamespace(allowed_dirs=allowed, delete_allowed_dirs=delete or [])
    if read is not None:
        security.read_allowed_dirs = read
    return SimpleNamespace(security=security)


@pytest.mark.parametrize("name", ["file_read", "file_list"])
def test_read_tools_use_the_wider_read_list(name) -> None:
    kwargs = file_tool_kwargs(name, cfg(["D:/w"], read=["C:/", "D:/"]))
    assert kwargs == {"allowed_dirs": ["C:/", "D:/"]}


def test_write_tool_keeps_the_narrow_list() -> None:
    kwargs = file_tool_kwargs("file_write", cfg(["D:/w"], read=["C:/", "D:/"]))
    assert kwargs == {"allowed_dirs": ["D:/w"]}


def test_delete_tool_is_unaffected() -> None:
    kwargs = file_tool_kwargs(
        "file_delete", cfg(["D:/w"], read=["C:/"], delete=["D:/w/x"])
    )
    assert kwargs == {"allowed_dirs": ["D:/w/x"]}


@pytest.mark.parametrize("read", [[], None])
def test_empty_or_missing_read_list_falls_back(read) -> None:
    for name in ("file_read", "file_list", "file_write"):
        assert file_tool_kwargs(name, cfg(["D:/w"], read=read)) == {
            "allowed_dirs": ["D:/w"]
        }


def test_config_field_defaults_to_empty() -> None:
    from openjarvis.core.config import SecurityConfig

    assert SecurityConfig().read_allowed_dirs == []

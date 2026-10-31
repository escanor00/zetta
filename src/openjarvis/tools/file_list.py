"""Directory listing tool with path and sensitive-file validation."""

from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._paths import resolve_allowed_dirs
from openjarvis.tools._stubs import BaseTool, ToolSpec

_MAX_ENTRIES = 200


@ToolRegistry.register("file_list")
class FileListTool(BaseTool):
    """List one directory without reading file contents."""

    tool_id = "file_list"

    def __init__(self, allowed_dirs: Optional[List[str]] = None) -> None:
        self._allowed_dirs = [
            Path(directory).expanduser().resolve()
            for directory in resolve_allowed_dirs(allowed_dirs)
        ]

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="file_list",
            description=(
                "List the immediate files and folders in a directory. "
                "Sensitive filenames are omitted; this does not read file contents."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path of the directory to list.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": (
                            "Maximum entries to return (default 100, max 200)."
                        ),
                    },
                },
                "required": ["path"],
            },
            category="filesystem",
            required_capabilities=["file:read"],
        )

    def _is_path_allowed(self, path: Path) -> bool:
        if not self._allowed_dirs:
            return True
        resolved = path.resolve()
        return any(
            resolved == directory or resolved.is_relative_to(directory)
            for directory in self._allowed_dirs
        )

    def execute(self, **params: Any) -> ToolResult:
        requested_path = params.get("path", "")
        if not requested_path:
            return ToolResult(
                tool_name="file_list",
                content="No path provided.",
                success=False,
            )

        path = Path(requested_path)
        if not path.is_absolute() and self._allowed_dirs:
            path = self._allowed_dirs[0] / path
        if not self._is_path_allowed(path):
            return ToolResult(
                tool_name="file_list",
                content=(
                    f"Access denied: {requested_path} is outside allowed directories."
                ),
                success=False,
            )
        if not path.exists():
            return ToolResult(
                tool_name="file_list",
                content=f"Directory not found: {requested_path}",
                success=False,
            )
        if not path.is_dir():
            return ToolResult(
                tool_name="file_list",
                content=f"Not a directory: {requested_path}",
                success=False,
            )

        from openjarvis.security.file_policy import is_sensitive_file

        try:
            entries = sorted(
                (
                    entry
                    for entry in path.iterdir()
                    if not is_sensitive_file(entry)
                ),
                key=lambda entry: entry.name.casefold(),
            )
        except OSError as exc:
            return ToolResult(
                tool_name="file_list",
                content=f"Cannot list directory: {exc}",
                success=False,
            )

        requested_limit = params.get("limit", 100)
        if not isinstance(requested_limit, int) or isinstance(requested_limit, bool):
            return ToolResult(
                tool_name="file_list",
                content="Invalid limit: provide an integer between 1 and 200.",
                success=False,
            )
        limit = min(max(requested_limit, 1), _MAX_ENTRIES)
        visible = entries[:limit]
        lines = [
            f"{'directory' if entry.is_dir() else 'file'}: {entry.name}"
            for entry in visible
        ]
        if len(entries) > limit:
            lines.append(f"... {len(entries) - limit} more entries omitted")
        return ToolResult(
            tool_name="file_list",
            content="\n".join(lines) if lines else "Directory is empty.",
            success=True,
            metadata={
                "path": str(path.resolve()),
                "entry_count": len(visible),
                "truncated": len(entries) > limit,
            },
        )


__all__ = ["FileListTool"]

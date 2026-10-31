"""Voice-confirmed file deletion restricted to explicitly configured directories."""

from __future__ import annotations

import re
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any, List, Optional

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._paths import resolve_delete_allowed_dirs
from openjarvis.tools._request_context import ToolRequestContext
from openjarvis.tools._stubs import BaseTool, ToolSpec

_PENDING_TTL_SECONDS = 300
_PENDING_DELETIONS: dict[str, tuple[Path, float, str]] = {}
_PENDING_LOCK = threading.Lock()


def _normalize_confirmation(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text.casefold())
    without_accents = "".join(
        char for char in normalized if not unicodedata.combining(char)
    )
    return re.sub(r"[^a-z0-9]+", " ", without_accents).strip()


def _is_voice_confirmation(context: ToolRequestContext, filename: str) -> bool:
    if context.input_source != "voice":
        return False
    spoken = _normalize_confirmation(context.user_text)
    filename_normalized = _normalize_confirmation(filename)
    return spoken in {
        f"confirmo excluir {filename_normalized}",
        f"confirmo a exclusao de {filename_normalized}",
    }


def prepare_voice_delete_confirmation(context: ToolRequestContext) -> None:
    """Cancel a staged deletion when the next user turn is not its confirmation."""
    with _PENDING_LOCK:
        pending = _PENDING_DELETIONS.get(context.conversation_id)
        if pending is None:
            return
        if pending[1] <= time.monotonic() or not _is_voice_confirmation(
            context,
            pending[0].stem,
        ):
            del _PENDING_DELETIONS[context.conversation_id]


@ToolRegistry.register("file_delete")
class FileDeleteTool(BaseTool):
    """Delete one file only after a separate, explicit voice confirmation."""

    tool_id = "file_delete"

    def __init__(self, allowed_dirs: Optional[List[str]] = None) -> None:
        self._allowed_dirs = [
            Path(directory).expanduser().resolve()
            for directory in resolve_delete_allowed_dirs(allowed_dirs)
        ]

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="file_delete",
            description=(
                "Exclui um único arquivo dentro das pastas autorizadas para "
                "exclusão. A primeira chamada apenas prepara o pedido. O usuário "
                "precisa dizer por voz a frase exata retornada pela ferramenta, "
                "em uma mensagem posterior; confirmação digitada não é aceita."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or vault-relative file path.",
                    },
                },
                "required": ["path"],
            },
            category="filesystem",
            required_capabilities=["file:write"],
        )

    def _is_path_allowed(self, path: Path) -> bool:
        if not self._allowed_dirs:
            return False
        resolved = path.resolve()
        return any(
            resolved == directory or resolved.is_relative_to(directory)
            for directory in self._allowed_dirs
        )

    def execute(self, **params: Any) -> ToolResult:
        requested_path = params.get("path", "")
        if not isinstance(requested_path, str) or not requested_path.strip():
            return self._failure("No path provided.")

        context = params.get("_request_context")
        if not isinstance(context, ToolRequestContext) or not context.conversation_id:
            return self._failure(
                "Deletion is unavailable without an active chat conversation."
            )

        path = Path(requested_path)
        if not path.is_absolute():
            if not self._allowed_dirs:
                return self._failure(
                    "Deletion is disabled: no deletion directory is authorized."
                )
            path = self._allowed_dirs[0] / path

        from openjarvis.security.file_policy import is_sensitive_file

        if is_sensitive_file(path):
            return self._failure(f"Access denied: {requested_path} is a sensitive file.")
        if not self._is_path_allowed(path):
            return self._failure(
                f"Access denied: {requested_path} is outside deletion directories."
            )
        if not path.exists():
            return self._failure(f"File not found: {requested_path}")
        if not path.is_file():
            return self._failure("Only individual files can be deleted.")

        resolved = path.resolve()
        now = time.monotonic()
        with _PENDING_LOCK:
            pending = _PENDING_DELETIONS.get(context.conversation_id)
            if pending is None or pending[1] <= now or pending[0] != resolved:
                _PENDING_DELETIONS[context.conversation_id] = (
                    resolved,
                    now + _PENDING_TTL_SECONDS,
                    context.request_id,
                )
                return self._confirmation_required(resolved)

            if pending[2] == context.request_id:
                return self._confirmation_required(resolved)

            if not _is_voice_confirmation(context, resolved.stem):
                return self._confirmation_required(resolved)

            del _PENDING_DELETIONS[context.conversation_id]

        try:
            path.unlink()
        except OSError as exc:
            return self._failure(f"Could not delete {requested_path}: {exc}")

        return ToolResult(
            tool_name=self.spec.name,
            content=f"Arquivo excluído: {resolved.name}",
            success=True,
            metadata={"path": str(resolved)},
        )

    def _confirmation_required(self, path: Path) -> ToolResult:
        phrase = f"Confirmo excluir {path.stem}"
        return ToolResult(
            tool_name=self.spec.name,
            content=(
                f"A exclusão NÃO foi executada. Peça ao usuário que diga "
                f"exatamente: “{phrase}”. Aguarde uma nova mensagem de voz, em "
                "uma conversa posterior, e então chame esta ferramenta novamente "
                "com o mesmo caminho. O pedido expira em cinco minutos."
            ),
            success=False,
            metadata={"pending_path": str(path)},
        )

    def _failure(self, message: str) -> ToolResult:
        return ToolResult(tool_name=self.spec.name, content=message, success=False)


__all__ = ["FileDeleteTool"]

"""Saves a conversation summary as a new Obsidian note linked to similar notes."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec
from openjarvis.tools.search_notes import SearchNotesTool, _terms, _vault_path

_FOLDER = "Conversas"
_MAX_LINKS = 5
_BAD_FILENAME = re.compile(r'[\\/:*?"<>|#\[\]^]')


@ToolRegistry.register("save_conversation_note")
class SaveConversationNoteTool(BaseTool):
    """Writes a summary of the current conversation into the vault."""

    tool_id = "save_conversation_note"

    def __init__(self, vault_path: Optional[str] = None) -> None:
        self._vault_path = vault_path

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="save_conversation_note",
            description=(
                "Saves a short summary of the current conversation as a NEW note in "
                "the user's Obsidian vault (folder 'Conversas'), automatically linked "
                "with [[links]] to similar notes. Call it once when the conversation "
                "ends (the user says goodbye/thanks) or when asked to remember it. "
                "Never overwrites existing notes."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short note title."},
                    "summary": {
                        "type": "string",
                        "description": "Summary: topics, decisions, facts learned.",
                    },
                },
                "required": ["title", "summary"],
            },
            category="memory",
            cost_estimate=0.0,
            latency_estimate=0.5,
        )

    @staticmethod
    def _related(vault: Path, text: str) -> List[str]:
        search = SearchNotesTool(str(vault))
        notes = search._load_notes(vault)
        terms = _terms(text)
        if not notes or not terms:
            return []
        scored = search._score(terms, notes)
        return [
            Path(notes[i][0]).with_suffix("").as_posix()
            for _, i in scored[:_MAX_LINKS]
        ]

    def execute(self, **params: Any) -> ToolResult:
        title = str(params.get("title") or "").strip()
        summary = str(params.get("summary") or "").strip()
        if not title or not summary:
            return ToolResult(
                tool_name="save_conversation_note",
                content="Preciso de um título e de um resumo.",
                success=False,
            )
        vault_str = self._vault_path if self._vault_path is not None else _vault_path()
        vault = Path(vault_str).expanduser() if vault_str else None
        if vault is None or not vault.is_dir():
            return ToolResult(
                tool_name="save_conversation_note",
                content="A pasta de notas do Obsidian não está configurada.",
                success=False,
            )
        try:
            links = self._related(vault, f"{title} {summary}")
            now = datetime.now()
            safe = _BAD_FILENAME.sub("", title).strip()[:80] or "Conversa"
            folder = vault / _FOLDER
            folder.mkdir(exist_ok=True)
            path = folder / f"{now:%Y-%m-%d} {safe}.md"
            n = 2
            while path.exists():
                path = folder / f"{now:%Y-%m-%d} {safe} ({n}).md"
                n += 1
            body = [
                "---",
                f"data: {now:%Y-%m-%d %H:%M}",
                "tags: [conversa, zetta]",
                "---",
                f"# {title}",
                "",
                summary,
            ]
            if links:
                body += ["", "## Notas relacionadas"] + [f"- [[{p}]]" for p in links]
            path.write_text("\n".join(body) + "\n", encoding="utf-8")
        except OSError as exc:
            return ToolResult(
                tool_name="save_conversation_note",
                content=f"Não consegui salvar a nota: {exc}",
                success=False,
            )
        return ToolResult(
            tool_name="save_conversation_note",
            content=f"Nota salva: {path.as_posix()} ({len(links)} link(s)).",
            success=True,
        )


__all__ = ["SaveConversationNoteTool"]

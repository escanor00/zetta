"""Search tool for the user's Obsidian notes (the assistant's long-term memory)."""

from __future__ import annotations

import math
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_WORD = re.compile(r"\w+", re.UNICODE)
_STOPWORDS = frozenset(
    "a o as os um uma uns umas de do da dos das em no na nos nas por para com sem "
    "e ou que se ao aos eu meu minha meus minhas qual quais como quando onde "
    "sobre tenho tem ter anotado anotada anotei sao ser foi".split()
)
_TITLE_BOOST = 3
_MAX_CHARS_PER_NOTE = 200_000
_SNIPPET_CHARS = 220


def _fold(text: str) -> str:
    """Lowercase and strip accents without changing the string's length."""
    return "".join(unicodedata.normalize("NFD", c)[0] for c in text).lower()


def _stem(word: str) -> str:
    """Crude Portuguese stem: the first six letters (conceito/conceitos match)."""
    return word[:6]


def _terms(text: str) -> List[str]:
    return [
        _stem(w)
        for w in _WORD.findall(_fold(text))
        if len(w) > 1 and w not in _STOPWORDS
    ]


def _vault_path() -> str:
    from openjarvis.core.config import load_config

    return str(getattr(load_config().obsidian, "vault_path", "") or "")


@ToolRegistry.register("search_notes")
class SearchNotesTool(BaseTool):
    """Finds the most relevant notes in the Obsidian vault for a question."""

    tool_id = "search_notes"

    def __init__(self, vault_path: Optional[str] = None) -> None:
        self._vault_path = vault_path

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="search_notes",
            description=(
                "Searches the user's personal Obsidian notes (the assistant's memory), "
                "including every subfolder, and returns the best matching notes with "
                "their path and an excerpt. Use it FIRST for any question about the "
                "user's life, projects, people, plans or anything they may have "
                "written down. Open a whole note afterwards with file_read."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Words describing what to look for.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "How many notes to return (1-10, default 5).",
                    },
                },
                "required": ["query"],
            },
            category="memory",
            cost_estimate=0.0,
            latency_estimate=0.2,
        )

    def _load_notes(self, vault: Path) -> List[Tuple[str, str, str]]:
        """Return ``(relative_path, title, text)`` for every note."""
        from openjarvis.connectors.obsidian import ObsidianConnector

        notes: List[Tuple[str, str, str]] = []
        for doc in ObsidianConnector(str(vault)).sync():
            rel = doc.doc_id.split(":", 1)[1] if ":" in doc.doc_id else doc.doc_id
            notes.append((rel, doc.title, doc.content[:_MAX_CHARS_PER_NOTE]))
        return notes

    @staticmethod
    def _score(
        query_terms: List[str], notes: List[Tuple[str, str, str]]
    ) -> List[Tuple[float, int]]:
        title_terms = [_terms(title or rel) for rel, title, _ in notes]
        body_terms = [_terms(text) for _, _, text in notes]
        unique = set(query_terms)
        df: Dict[str, int] = {
            t: sum(
                1
                for i in range(len(notes))
                if t in title_terms[i] or t in body_terms[i]
            )
            for t in unique
        }
        scored: List[Tuple[float, int]] = []
        for i in range(len(notes)):
            score = 0.0
            for t in unique:
                tf = body_terms[i].count(t) + _TITLE_BOOST * title_terms[i].count(t)
                if tf:
                    idf = math.log(1 + len(notes) / (1 + df[t]))
                    score += (1 + math.log(tf)) * idf
            if score > 0:
                scored.append((score, i))
        scored.sort(key=lambda s: (-s[0], notes[s[1]][0]))
        return scored

    @staticmethod
    def _excerpt(text: str, query_words: List[str]) -> str:
        folded = _fold(text)
        positions = [p for w in query_words if (p := folded.find(w)) >= 0]
        start = max(min(positions, default=0) - 60, 0)
        piece = text[start : start + _SNIPPET_CHARS]
        return ("..." if start else "") + " ".join(piece.split()) + "..."

    def execute(self, **params: Any) -> ToolResult:
        query = str(params.get("query") or "").strip()
        if not query:
            return ToolResult(
                tool_name="search_notes",
                content="Diga o que procurar nas notas.",
                success=False,
            )
        try:
            limit = min(max(int(params.get("limit") or 5), 1), 10)
        except (TypeError, ValueError):
            limit = 5
        vault_str = self._vault_path if self._vault_path is not None else _vault_path()
        vault = Path(vault_str).expanduser() if vault_str else None
        if vault is None or not vault.is_dir():
            return ToolResult(
                tool_name="search_notes",
                content=(
                    "A pasta de notas do Obsidian não está configurada ou não existe."
                ),
                success=False,
            )
        try:
            notes = self._load_notes(vault)
        except OSError as exc:
            return ToolResult(
                tool_name="search_notes",
                content=f"Não consegui ler as notas: {exc}",
                success=False,
            )
        query_terms = _terms(query)
        scored = self._score(query_terms, notes) if query_terms else []
        if not scored:
            return ToolResult(
                tool_name="search_notes",
                content=f"Nenhuma nota encontrada para: {query}.",
                success=True,
            )
        words = [w for w in _WORD.findall(_fold(query)) if w not in _STOPWORDS]
        lines = [f"Encontrei {min(len(scored), limit)} nota(s) para '{query}':"]
        for rank, (_, idx) in enumerate(scored[:limit], start=1):
            rel, title, text = notes[idx]
            # Full path: file_read does not accept vault-relative paths.
            path = (vault / rel).as_posix()
            lines.append(
                f"{rank}. {title or Path(rel).stem} (arquivo: {path}): "
                f"{self._excerpt(text, words)}"
            )
        return ToolResult(
            tool_name="search_notes", content="\n".join(lines), success=True
        )


__all__ = ["SearchNotesTool"]

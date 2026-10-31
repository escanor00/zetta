"""Request metadata for tools that need to validate user-originated actions."""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True, slots=True)
class ToolRequestContext:
    conversation_id: str
    input_source: str
    user_text: str
    request_id: str


_CURRENT_TOOL_REQUEST: ContextVar[Optional[ToolRequestContext]] = ContextVar(
    "openjarvis_tool_request_context",
    default=None,
)


def set_tool_request_context(context: ToolRequestContext) -> Token:
    return _CURRENT_TOOL_REQUEST.set(context)


def reset_tool_request_context(token: Token) -> None:
    _CURRENT_TOOL_REQUEST.reset(token)


def get_tool_request_context() -> Optional[ToolRequestContext]:
    return _CURRENT_TOOL_REQUEST.get()

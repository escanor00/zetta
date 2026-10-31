"""Local endpoint for the relative path of Obsidian's active file."""

from __future__ import annotations

import os
import time
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()


class ActiveNoteUpdate(BaseModel):
    """Minimal note or canvas context sent by the local Obsidian plugin."""

    vault: str = Field(default="", max_length=256)
    path: str | None = Field(default=None, max_length=2048)


@router.post("/v1/obsidian/active-note")
async def update_active_note(
    payload: ActiveNoteUpdate, request: Request
) -> dict[str, bool]:
    """Store only an allowed, vault-relative file path; never receive file text."""
    if not payload.path:
        request.app.state.obsidian_active_note = None
        return {"ok": True, "active": False}

    config = getattr(request.app.state, "config", None)
    allowed_dirs = getattr(getattr(config, "security", None), "allowed_dirs", None)
    if not allowed_dirs:
        request.app.state.obsidian_active_note = None
        raise HTTPException(
            status_code=403,
            detail="No allowed vault directory is configured.",
        )

    vault_name = payload.vault.strip()
    matching_roots: list[Path] = []
    for directory in allowed_dirs:
        try:
            root = Path(directory).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        if root.name.casefold() == vault_name.casefold():
            matching_roots.append(root)

    if len(matching_roots) != 1:
        request.app.state.obsidian_active_note = None
        raise HTTPException(
            status_code=403,
            detail="The active Obsidian vault does not uniquely match an allowed directory.",
        )

    relative_text = payload.path.replace("\\", "/")
    relative = PurePosixPath(relative_text)
    if (
        relative.is_absolute()
        or not relative.parts
        or any(part in {".", ".."} for part in relative.parts)
        or ":" in relative.parts[0]
        or "\x00" in relative_text
        or relative.suffix.casefold() not in {".md", ".markdown", ".txt", ".canvas"}
    ):
        request.app.state.obsidian_active_note = None
        raise HTTPException(status_code=400, detail="Invalid active note path.")

    root = matching_roots[0]
    vault_root = root
    if not (vault_root / ".obsidian").is_dir():
        nested_root = (root / vault_name).resolve()
        try:
            nested_root.relative_to(root)
        except ValueError:
            nested_root = root
        if (
            nested_root.name.casefold() == vault_name.casefold()
            and (nested_root / ".obsidian").is_dir()
        ):
            vault_root = nested_root

    candidate = vault_root.joinpath(*relative.parts).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        request.app.state.obsidian_active_note = None
        raise HTTPException(
            status_code=403,
            detail="The active note is outside the allowed vault.",
        ) from exc

    request.app.state.obsidian_active_note = {
        "vault": vault_name,
        "path": candidate.relative_to(root).as_posix(),
        "updated_at": time.monotonic(),
    }
    return {"ok": True, "active": True}


_STATUS_CACHE_TTL_SECONDS = 15.0
_status_cache: dict[str, tuple[float, int]] = {}


def _count_notes(vault: Path) -> int:
    """Count the files the Obsidian connector would ingest (cached briefly)."""
    from openjarvis.connectors.obsidian import _SKIP_DIRS, _TEXT_EXTENSIONS

    key = str(vault)
    cached = _status_cache.get(key)
    now = time.monotonic()
    if cached is not None and now - cached[0] < _STATUS_CACHE_TTL_SECONDS:
        return cached[1]

    total = 0
    for _root, dirs, files in os.walk(vault):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in _SKIP_DIRS]
        total += sum(
            1 for name in files if Path(name).suffix.lower() in _TEXT_EXTENSIONS
        )
    _status_cache[key] = (now, total)
    return total


def resolve_vault_path(app: object) -> str:
    """Return the configured vault path (connector instance first, then config)."""
    from openjarvis.server.connectors_router import _instances

    instance = _instances.get("obsidian")
    if instance is not None:
        return getattr(instance, "_vault_path", "") or ""
    config = getattr(getattr(app, "state", None), "config", None)
    return getattr(getattr(config, "obsidian", None), "vault_path", "") or ""


@router.get("/v1/obsidian/status")
async def obsidian_status(request: Request) -> dict[str, object]:
    """Report whether the Obsidian vault is connected and how many notes it has.

    The vault comes from the connector instance when one exists (so a runtime
    ``POST /v1/connectors/obsidian/connect`` is reflected), otherwise from the
    ``[obsidian] vault_path`` config. Only the vault *name* is returned.
    """
    vault_path = resolve_vault_path(request.app)

    if not vault_path:
        return {"configured": False, "connected": False, "vault": "", "notes": None}

    vault = Path(vault_path).expanduser()
    if not vault.is_dir():
        return {
            "configured": True,
            "connected": False,
            "vault": vault.name,
            "notes": None,
        }

    from starlette.concurrency import run_in_threadpool

    notes = await run_in_threadpool(_count_notes, vault)
    return {"configured": True, "connected": True, "vault": vault.name, "notes": notes}

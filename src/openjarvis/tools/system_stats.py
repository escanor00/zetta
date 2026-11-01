"""System stats tool — read-only disk, memory and CPU usage of this computer."""

from __future__ import annotations

from typing import Any, List

import psutil

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_SECTIONS = ("all", "disk", "memory", "cpu")
_GB = 1024**3
_TB = 1024**4


def _amount(num_bytes: int) -> str:
    """Rounded, spoken size: '810 gigas', '5,3 gigas' or '1,8 teras'."""
    if num_bytes >= _TB:
        return f"{num_bytes / _TB:.1f}".replace(".", ",") + " teras"
    gigas = num_bytes / _GB
    if gigas < 10:
        return f"{gigas:.1f}".replace(".", ",") + " gigas"
    return f"{round(gigas)} gigas"


def _percent(value: float) -> str:
    return f"{value:.0f} por cento"


def _fullness(percent: float) -> str:
    """How full a disk is, in plain words."""
    if percent >= 90:
        return "quase cheio"
    if percent >= 75:
        return "bem cheio"
    if percent >= 50:
        return "meio ocupado"
    return "com bastante espaço"


def _disk_lines() -> List[str]:
    lines: List[str] = []
    used_total = size_total = 0
    for part in psutil.disk_partitions(all=False):
        if "cdrom" in part.opts or not part.fstype:
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except OSError:
            continue  # unreadable or ejected drive
        # "C:\" -> "C", so the sentence reads "Disco C: ..." rather than "C::".
        name = part.mountpoint.rstrip(r"\/").rstrip(":") or part.mountpoint
        used_total += usage.used
        size_total += usage.total
        lines.append(
            f"Disco {name}: {_fullness(usage.percent)}, usa {_amount(usage.used)} "
            f"dos {_amount(usage.total)} ({_percent(usage.percent)}) e restam "
            f"{_amount(usage.free)}."
        )
    if not lines:
        return ["Não consegui ler nenhum disco."]
    if len(lines) > 1:
        lines.append(
            f"No total, os {len(lines)} discos usam {_amount(used_total)} "
            f"dos {_amount(size_total)}."
        )
    return lines


def _memory_line() -> str:
    mem = psutil.virtual_memory()
    return (
        f"Memória: usa {_amount(mem.used)} dos {_amount(mem.total)} "
        f"({_percent(mem.percent)})."
    )


def _cpu_line() -> str:
    return f"Processador: {_percent(psutil.cpu_percent(interval=0.3))} em uso."


@ToolRegistry.register("system_stats")
class SystemStatsTool(BaseTool):
    """Reports how much disk, memory and CPU this computer is using."""

    tool_id = "system_stats"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="system_stats",
            description=(
                "Reports this computer's current disk space (every drive), memory "
                "and CPU usage. Use it for questions such as how much disk, memory "
                "or processor is being used. Read-only."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "section": {
                        "type": "string",
                        "enum": list(_SECTIONS),
                        "description": "What to report (default: all).",
                    },
                },
            },
            category="system",
            cost_estimate=0.0,
            latency_estimate=0.5,
        )

    def execute(self, **params: Any) -> ToolResult:
        section = str(params.get("section") or "all").lower()
        if section not in _SECTIONS:
            return ToolResult(
                tool_name="system_stats",
                content=(
                    f"Seção inválida: {section!r}. Use uma de {', '.join(_SECTIONS)}."
                ),
                success=False,
            )
        lines: List[str] = []
        try:
            if section in ("all", "disk"):
                lines.extend(_disk_lines())
            if section in ("all", "memory"):
                lines.append(_memory_line())
            if section in ("all", "cpu"):
                lines.append(_cpu_line())
        except Exception as exc:  # noqa: BLE001 - psutil can fail on odd hosts
            return ToolResult(
                tool_name="system_stats",
                content=f"Não consegui ler as estatísticas do sistema: {exc}",
                success=False,
            )
        return ToolResult(
            tool_name="system_stats", content="\n".join(lines), success=True
        )


__all__ = ["SystemStatsTool"]

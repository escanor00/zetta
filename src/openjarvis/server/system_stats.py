"""Local endpoint with live host metrics (CPU, memory, disk, network)."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Optional

import psutil
from fastapi import APIRouter

router = APIRouter()

# Samples closer together than this reuse the previous rates, so several
# clients polling at once do not shrink the measurement window to noise.
_MIN_SAMPLE_SECONDS = 0.5

_lock = threading.Lock()
_last_net: Optional[tuple[float, int, int]] = None
_last_rates: dict[str, Optional[float]] = {"down": None, "up": None}

# ``cpu_percent(None)`` reports usage since the previous call, so prime it.
psutil.cpu_percent(None)


def _network_rates() -> dict[str, Optional[float]]:
    """Return bytes/second received and sent since the previous sample."""
    global _last_net, _last_rates
    counters = psutil.net_io_counters()
    now = time.monotonic()
    with _lock:
        if _last_net is not None:
            elapsed = now - _last_net[0]
            if elapsed < _MIN_SAMPLE_SECONDS:
                return dict(_last_rates)
            _last_rates = {
                "down": max(0.0, (counters.bytes_recv - _last_net[1]) / elapsed),
                "up": max(0.0, (counters.bytes_sent - _last_net[2]) / elapsed),
            }
        _last_net = (now, counters.bytes_recv, counters.bytes_sent)
        return dict(_last_rates)


def _disk_usage() -> Optional[dict[str, Any]]:
    try:
        usage = psutil.disk_usage(Path.home().anchor or "/")
    except OSError:
        return None
    return {
        "percent": usage.percent,
        "used_bytes": usage.used,
        "total_bytes": usage.total,
    }


@router.get("/v1/system/stats")
async def system_stats() -> dict[str, Any]:
    """Report host CPU, memory, disk and network throughput.

    Network rates are ``None`` on the first call (no previous sample to diff).
    """
    memory = psutil.virtual_memory()
    return {
        "cpu": {"percent": psutil.cpu_percent(None)},
        "memory": {
            "percent": memory.percent,
            "used_bytes": memory.used,
            "total_bytes": memory.total,
        },
        "disk": _disk_usage(),
        "network": _network_rates(),
    }

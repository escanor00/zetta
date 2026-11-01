"""Tests for the system_stats tool."""

from __future__ import annotations

from collections import namedtuple

import pytest

from openjarvis.tools import system_stats as mod
from openjarvis.tools.system_stats import SystemStatsTool

Part = namedtuple("Part", "mountpoint fstype opts")
Usage = namedtuple("Usage", "total used free percent")
Mem = namedtuple("Mem", "total used percent")

GB = 1024**3


@pytest.fixture
def fake_host(monkeypatch):
    usage = {
        "C:\\": Usage(931 * GB, 465 * GB, 466 * GB, 50.0),
        "D:\\": Usage(2 * 1024 * GB, 1024 * GB, 1024 * GB, 50.0),
    }
    parts = [
        Part("C:\\", "NTFS", "rw,fixed"),
        Part("D:\\", "NTFS", "rw,fixed"),
        Part("E:\\", "", "cdrom"),  # optical drive, must be skipped
    ]
    monkeypatch.setattr(mod.psutil, "disk_partitions", lambda all=False: parts)
    monkeypatch.setattr(mod.psutil, "disk_usage", lambda mp: usage[mp])
    monkeypatch.setattr(
        mod.psutil, "virtual_memory", lambda: Mem(16 * GB, 8 * GB, 50.0)
    )
    monkeypatch.setattr(mod.psutil, "cpu_percent", lambda interval=None: 12.4)


def test_spec_is_read_only_and_named() -> None:
    spec = SystemStatsTool().spec
    assert spec.name == "system_stats"
    assert spec.parameters["properties"]["section"]["enum"] == [
        "all",
        "disk",
        "memory",
        "cpu",
    ]
    assert spec.required_capabilities == []


def test_reports_every_fixed_drive_in_spoken_form(fake_host) -> None:
    out = SystemStatsTool().execute(section="disk")
    assert out.success
    assert (
        "Disco C: meio ocupado, usa 465 gigas dos 931 gigas (50 por cento) "
        "e restam 466 gigas."
        in out.content
    )
    assert "2,0 teras" in out.content and "Disco D:" in out.content
    assert "E:" not in out.content
    assert "%" not in out.content  # spoken aloud, so no symbols


def test_all_includes_memory_and_cpu(fake_host) -> None:
    out = SystemStatsTool().execute()
    assert "Memória: usa 8,0 gigas dos 16 gigas (50 por cento)." in out.content
    assert "Processador: 12 por cento em uso." in out.content


def test_single_sections(fake_host) -> None:
    assert "Disco" not in SystemStatsTool().execute(section="memory").content
    assert SystemStatsTool().execute(section="cpu").content.startswith("Processador")


def test_invalid_section_is_an_error(fake_host) -> None:
    out = SystemStatsTool().execute(section="gpu")
    assert not out.success and "inválida" in out.content


def test_unreadable_drive_is_skipped(monkeypatch, fake_host) -> None:
    def usage(mp):
        if mp == "D:\\":
            raise OSError("not ready")
        return Usage(100 * GB, 10 * GB, 90 * GB, 10.0)

    monkeypatch.setattr(mod.psutil, "disk_usage", usage)
    out = SystemStatsTool().execute(section="disk")
    assert "Disco C:" in out.content and "Disco D:" not in out.content


def test_no_readable_disk_is_reported(monkeypatch) -> None:
    monkeypatch.setattr(mod.psutil, "disk_partitions", lambda all=False: [])
    assert (
        "Não consegui ler nenhum disco"
        in SystemStatsTool().execute(section="disk").content
    )


def test_psutil_failure_becomes_tool_error(monkeypatch) -> None:
    def boom(*a, **k):
        raise RuntimeError("psutil broke")

    monkeypatch.setattr(mod.psutil, "virtual_memory", boom)
    out = SystemStatsTool().execute(section="memory")
    assert not out.success and "psutil broke" in out.content


@pytest.mark.parametrize(
    "percent, words",
    [
        (10, "com bastante espaço"),
        (49.9, "com bastante espaço"),
        (50, "meio ocupado"),
        (74.9, "meio ocupado"),
        (75, "bem cheio"),
        (89.9, "bem cheio"),
        (90, "quase cheio"),
        (100, "quase cheio"),
    ],
)
def test_fullness_words(percent, words) -> None:
    assert mod._fullness(percent) == words


@pytest.mark.parametrize(
    "num_bytes, spoken",
    [
        (5 * GB + GB // 3, "5,3 gigas"),
        (809 * GB + GB // 5, "809 gigas"),
        (1024 * GB * 3 // 2, "1,5 teras"),
        (0, "0,0 gigas"),
    ],
)
def test_amounts_are_rounded(num_bytes, spoken) -> None:
    assert mod._amount(num_bytes) == spoken


def test_total_line_only_with_several_drives(fake_host, monkeypatch) -> None:
    out = SystemStatsTool().execute(section="disk").content
    assert "No total, os 2 discos usam 1,5 teras dos 2,9 teras." in out
    monkeypatch.setattr(
        mod.psutil, "disk_partitions", lambda all=False: [Part("C:\\", "NTFS", "rw")]
    )
    assert "No total" not in SystemStatsTool().execute(section="disk").content

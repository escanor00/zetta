"""Qwen3-TTS (0.6B) backend — local, runs as a small worker in its own venv.

The model's libraries clash with Zetta's, so it lives in ``OPENJARVIS_QWEN3_HOME``
(default ``D:\zetta-qwen-tts``) and this backend talks to it over localhost,
starting it on first use. ``voice_id`` is one of the model's built-in speakers
(e.g. ``"Serena"``). Audio is generated sentence by sentence.
"""

from __future__ import annotations

import io
import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, List

import httpx

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult

logger = logging.getLogger(__name__)

_DEFAULT_VOICE_ID = "Serena"
_SAMPLE_RATE = 24000
_URL = "http://127.0.0.1:8765"
_LANGUAGES = {"pt": "Portuguese", "en": "English", "es": "Spanish", "fr": "French"}


def _home() -> Path:
    return Path(os.environ.get("OPENJARVIS_QWEN3_HOME", r"D:\zetta-qwen-tts"))


@TTSRegistry.register("qwen3tts")
class Qwen3TTSBackend(TTSBackend):
    """Qwen3-TTS-12Hz-0.6B-CustomVoice via a local worker process."""

    backend_id = "qwen3tts"

    def __init__(self, *, language: str = "pt", **_: Any) -> None:
        self._language = _LANGUAGES.get(language, "Portuguese")
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None

    def _up(self) -> bool:
        try:
            return httpx.get(f"{_URL}/health", timeout=1).status_code == 200
        except httpx.HTTPError:
            return False

    def _ensure_worker(self) -> None:
        with self._lock:
            if self._up():
                return
            home = _home()
            self._proc = subprocess.Popen(
                [str(home / "venv" / "Scripts" / "python.exe"), str(home / "server.py")],
                cwd=home,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            for _ in range(180):  # model load can take a minute on first start
                if self._up():
                    return
                time.sleep(1)
            raise RuntimeError("Qwen3-TTS worker did not start")

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = _DEFAULT_VOICE_ID,
        speed: float = 1.0,
        output_format: str = "wav",
    ) -> TTSResult:
        import numpy as np
        import soundfile as sf

        voice_id = voice_id or _DEFAULT_VOICE_ID
        self._ensure_worker()
        body = {"text": text, "speaker": voice_id, "language": self._language}
        pcm = bytearray()
        with httpx.stream("POST", f"{_URL}/tts/stream", json=body, timeout=120) as r:
            r.raise_for_status()
            for chunk in r.iter_bytes():
                pcm += chunk
        audio = np.frombuffer(bytes(pcm), dtype="<i2").astype("float32") / 32767
        if speed and abs(speed - 1.0) > 0.01:
            idx = np.arange(0, len(audio), speed)
            audio = np.interp(idx, np.arange(len(audio)), audio).astype("float32")
        buf = io.BytesIO()
        sf.write(buf, audio, _SAMPLE_RATE, format=output_format.upper())
        return TTSResult(
            audio=buf.getvalue(),
            format=output_format,
            voice_id=voice_id,
            sample_rate=_SAMPLE_RATE,
            duration_seconds=len(audio) / _SAMPLE_RATE,
            metadata={"backend": "qwen3tts", "language": self._language},
        )

    def available_voices(self) -> List[str]:
        return ["Serena", "Vivian", "Ono_Anna", "Sohee"]

    def health(self) -> bool:
        return (_home() / "server.py").is_file() and (
            _home() / "venv" / "Scripts" / "python.exe"
        ).is_file()

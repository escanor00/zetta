"""XTTS-v2 TTS backend — local, natural-sounding, multilingual.

Requires: pip install "coqui-tts[codec]" (and a CUDA build of torch for speed).

``voice_id`` is either the name of one of XTTS's built-in speakers
(e.g. ``"Ana Florence"``) or the path to a short, clean ``.wav`` of the voice
to clone. Model files live in ``OPENJARVIS_XTTS_HOME`` (default ``D:\\zetta-voz``).
"""

from __future__ import annotations

import io
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, List

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult

logger = logging.getLogger(__name__)

_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
_DEFAULT_VOICE_ID = "Ana Florence"
_SAMPLE_RATE = 24000


def _home() -> Path:
    return Path(os.environ.get("OPENJARVIS_XTTS_HOME", r"D:\zetta-voz"))


def clean_for_speech(text: str) -> str:
    """Strip what XTTS would read aloud literally ("ponto", "asterisco"...)."""
    text = re.sub(r"https?://\S+|www\.\S+", "", text)
    text = re.sub(r"(\w[\w.+-]*)@[\w.-]+\.\w+", r"\1", text)  # e-mail -> name only
    text = re.sub(r"[*_#`>|~]+", "", text)  # markdown
    text = re.sub(r"^\s*(?:\d+[.)]|[-•])\s+", "", text, flags=re.M)  # list markers
    text = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", text)  # 1.200 -> 1200
    text = re.sub(r"(?<=\d)\.(?=\d)", ",", text)  # 3.5 -> 3,5
    text = re.sub(r"\s*\n+\s*", ". ", text)  # paragraph breaks -> pause
    text = re.sub(r"([.!?])(\s*\.)+", r"\1", text)  # no doubled dots
    text = re.sub(r"\.{2,}", ".", text)
    for written, said in _PRONUNCIATION.items():
        text = re.sub(rf"{written}", said, text)
    return re.sub(r"\s{2,}", " ", text).strip()


_PRONUNCIATION = {"API": "A P I", "Anthropic": "Antrópic", "Claude": "Clôd"}


def split_sentences(text: str) -> list[str]:
    """One piece per sentence, without the final dot XTTS tends to read aloud."""
    parts = re.split(r"(?<=[.!?])\s+", clean_for_speech(text))
    return [p.rstrip(".").strip() for p in parts if p.strip(" .")]


@TTSRegistry.register("xtts")
class XTTSBackend(TTSBackend):
    """Coqui XTTS-v2 — expressive local voice synthesis."""

    backend_id = "xtts"

    def __init__(self, *, device: str = "auto", language: str = "pt", **_: Any) -> None:
        self._device = device
        self._language = language
        self._tts: Any | None = None
        self._lock = threading.RLock()

    def _ensure_model(self) -> Any:
        with self._lock:
            if self._tts is not None:
                return self._tts
            # Keep the ~2 GB of weights off the C: drive.
            os.environ.setdefault("HF_HOME", str(_home() / "hf"))
            os.environ.setdefault("COQUI_TOS_AGREED", "1")
            try:
                from TTS.api import TTS
            except ImportError as exc:
                raise RuntimeError(
                    'coqui-tts not installed. Install with: pip install "coqui-tts[codec]"'
                ) from exc
            device = self._device
            if device == "auto":
                import torch

                device = "cuda" if torch.cuda.is_available() else "cpu"
            self._tts = TTS(_MODEL_NAME).to(device)
            return self._tts

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
        kwargs: dict[str, Any] = {
            "language": self._language,
            "speed": speed,
            "split_sentences": False,
        }
        if voice_id.lower().endswith(".wav") and Path(voice_id).is_file():
            kwargs["speaker_wav"] = voice_id
        else:
            kwargs["speaker"] = voice_id

        pause = np.zeros(int(_SAMPLE_RATE * 0.25), dtype="float32")
        pieces: list[Any] = []
        with self._lock:
            tts = self._ensure_model()
            for sentence in split_sentences(text) or [text]:
                wav = tts.tts(text=sentence, **kwargs)
                pieces += [np.asarray(wav, dtype="float32"), pause]
        audio = np.concatenate(pieces)
        buf = io.BytesIO()
        sf.write(buf, audio, _SAMPLE_RATE, format=output_format.upper())
        return TTSResult(
            audio=buf.getvalue(),
            format=output_format,
            voice_id=voice_id,
            sample_rate=_SAMPLE_RATE,
            duration_seconds=len(audio) / _SAMPLE_RATE,
            metadata={"backend": "xtts", "language": self._language},
        )

    def available_voices(self) -> List[str]:
        return [
            "Ana Florence",
            "Brenda Stern",
            "Claribel Dervla",
            "Daisy Studious",
            "Gracie Wise",
            "Tammie Ema",
            "Alison Dietlinde",
            "Sofia Hellen",
            "Alma María",
            "Camilla Holmström",
        ]

    def health(self) -> bool:
        try:
            import TTS  # noqa: F401
        except ImportError:
            return False
        return (_home() / "hf").exists()

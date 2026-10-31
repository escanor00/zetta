"""Microphone recording with silence detection and audio playback helpers."""

from __future__ import annotations

import io
import wave

_SAMPLE_RATE = 16000
_CHANNELS = 1
_CHUNK = 1024
_SILENCE_THRESHOLD = 500  # RMS below this → silence
_SILENCE_SECONDS = 1.0  # seconds of silence before auto-stop
_STARTUP_SILENCE_SECONDS = 5.0  # give up early if speech never begins
_MAX_RECORD_SECONDS = 30  # safety ceiling

# --- Interrupção da fala do assistente --------------------------------------
# Apertar qualquer tecla sempre interrompe a fala (Windows).
# Para também interromper falando por cima, troque para True, mas SÓ use com
# fones de ouvido: com caixas de som o microfone ouve a voz do assistente e
# ele cortaria a si mesmo.
_INTERRUPT_BY_VOICE = True
_VOICE_INTERRUPT_THRESHOLD = 600  # volume mínimo da sua voz para cortar
_VOICE_INTERRUPT_CHUNKS = 3  # quantos pedaços "com voz" são necessários...
_VOICE_INTERRUPT_WINDOW = 6  # ...entre os últimos pedaços (cada um dura 32 ms)
_INTERRUPT_CHUNK = 512  # pedaços menores = reação mais rápida

# Áudio captado enquanto você interrompia. A gravação seguinte começa com ele,
# para não perder as primeiras palavras da sua frase.
_carryover: list[bytes] = []

# Indica se a última fala tocada foi cortada por você (tecla ou voz).
_interrupted = False


def was_interrupted() -> bool:
    """True se a última fala tocada foi interrompida pelo usuário."""
    return _interrupted


def _rms(data: bytes) -> float:
    """Compute RMS amplitude of 16-bit PCM bytes."""
    import struct

    n = len(data) // 2
    if n == 0:
        return 0.0
    shorts = struct.unpack(f"{n}h", data[: n * 2])
    return (sum(s * s for s in shorts) / n) ** 0.5


def record_until_silence(
    *,
    sample_rate: int = _SAMPLE_RATE,
    silence_threshold: int = _SILENCE_THRESHOLD,
    silence_seconds: float = _SILENCE_SECONDS,
    startup_silence_seconds: float = _STARTUP_SILENCE_SECONDS,
    max_seconds: float = _MAX_RECORD_SECONDS,
) -> bytes:
    """Record from the default microphone until silence is detected.

    Returns raw WAV bytes (16-bit mono).
    Raises RuntimeError if sounddevice is not installed.
    """
    try:
        import sounddevice as sd
    except ImportError:
        raise RuntimeError(
            "sounddevice is required for voice input. "
            "Install with: pip install sounddevice"
        )

    chunks_per_second = sample_rate / _CHUNK
    silence_chunks = int(silence_seconds * chunks_per_second)
    startup_silence_chunks = max(1, int(startup_silence_seconds * chunks_per_second))
    max_chunks = int(max_seconds * chunks_per_second)

    # Se a fala do assistente foi cortada pela sua voz, aproveita o que você
    # já disse em vez de pedir para repetir.
    frames: list[bytes] = list(_carryover)
    _carryover.clear()
    silence_count = 0
    has_speech = bool(frames)

    with sd.RawInputStream(
        samplerate=sample_rate,
        channels=_CHANNELS,
        dtype="int16",
        blocksize=_CHUNK,
    ) as stream:
        for _ in range(max_chunks):
            raw, _ = stream.read(_CHUNK)
            data = bytes(raw)
            frames.append(data)

            amplitude = _rms(data)
            if amplitude > silence_threshold:
                has_speech = True
                silence_count = 0
            elif not has_speech and len(frames) >= startup_silence_chunks:
                break
            elif has_speech:
                silence_count += 1
                if silence_count >= silence_chunks:
                    break

    return _frames_to_wav(frames, sample_rate)


def _frames_to_wav(frames: list[bytes], sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(_CHANNELS)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(b"".join(frames))
    return buf.getvalue()


def _play_interruptible(sd, data, sr, echo_pause: bool = True) -> None:
    """Toca o áudio e para se o usuário apertar uma tecla (ou falar, com fones)."""
    import time

    global _interrupted
    _interrupted = False

    try:
        import msvcrt  # só existe no Windows
    except ImportError:
        msvcrt = None

    # Descarta teclas antigas que ficaram no buffer, para não cortar a fala
    # logo no começo por engano.
    if msvcrt is not None:
        while msvcrt.kbhit():
            msvcrt.getwch()

    mic = None
    if _INTERRUPT_BY_VOICE:
        try:
            mic = sd.RawInputStream(
                samplerate=_SAMPLE_RATE,
                channels=_CHANNELS,
                dtype="int16",
                blocksize=_INTERRUPT_CHUNK,
            )
            mic.start()
        except Exception:
            mic = None

    sd.play(data, sr)
    flags: list[bool] = []  # últimos pedaços: tinha voz?
    recent: list[bytes] = []  # ~0,5 s mais recentes do microfone
    interrupted = False
    try:
        while sd.get_stream().active:
            if msvcrt is not None and msvcrt.kbhit():
                msvcrt.getwch()  # consome a tecla apertada
                sd.stop()
                interrupted = True
                break
            if mic is not None:
                raw, _ = mic.read(_INTERRUPT_CHUNK)
                chunk = bytes(raw)
                recent.append(chunk)
                del recent[:-16]
                flags.append(_rms(chunk) > _VOICE_INTERRUPT_THRESHOLD)
                del flags[:-_VOICE_INTERRUPT_WINDOW]
                if sum(flags) >= _VOICE_INTERRUPT_CHUNKS:
                    _carryover[:] = recent  # guarda o que você já falou
                    sd.stop()
                    interrupted = True
                    break
            else:
                time.sleep(0.05)
    finally:
        if mic is not None:
            mic.stop()
            mic.close()

    _interrupted = interrupted
    if not interrupted and echo_pause:
        # Fala terminou sozinha: espera o eco da sala acabar antes de ouvir.
        time.sleep(0.5)


def play_wav(
    audio: bytes, sample_rate: int = 24000, echo_pause: bool = True
) -> None:
    """Play raw WAV bytes through the default output device.

    If the bytes are a valid WAV file, sample rate is read from the header;
    otherwise ``sample_rate`` is used as a fallback.
    """
    try:
        import numpy as np
        import sounddevice as sd
        import soundfile as sf
    except ImportError:
        raise RuntimeError(
            "sounddevice, numpy, and soundfile are required for voice output. "
            "Install with: pip install sounddevice numpy soundfile"
        )

    buf = io.BytesIO(audio)
    try:
        data, sr = sf.read(buf, dtype="float32")
    except Exception:
        # Fall back: treat as raw PCM
        import struct

        n = len(audio) // 2
        data = (
            np.array(struct.unpack(f"{n}h", audio[: n * 2]), dtype="float32") / 32768.0
        )
        sr = sample_rate

    _play_interruptible(sd, data, sr, echo_pause)


__all__ = ["play_wav", "record_until_silence", "was_interrupted"]

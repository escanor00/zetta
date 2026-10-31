"""Voice input/output helpers for the interactive chat session."""

from __future__ import annotations

from typing import Any, Optional

from rich.markup import escape

VOICE_EXIT = object()

# Backend selection is shared with the API server and lives in
# openjarvis.speech._tts_discovery. Importing that at module level would pull
# the whole speech stack -- numpy included -- into every `jarvis` invocation,
# which tests/cli/test_cli.py guards against, so these aliases resolve lazily.
_LAZY_TTS_NAMES = {
    "_TTS_BACKEND_ORDER": "TTS_BACKEND_ORDER",
    "_BACKEND_DEFAULT_VOICE": "BACKEND_DEFAULT_VOICE",
}


def __getattr__(name: str) -> Any:
    target = _LAZY_TTS_NAMES.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from openjarvis.speech import _tts_discovery

    return getattr(_tts_discovery, target)


def _terminal_safe_text(value: object) -> str:
    """Remove terminal controls and escape Rich markup from dynamic text."""
    printable = "".join(
        char for char in str(value) if char in ("\n", "\t") or char.isprintable()
    )
    return escape(printable)


class VoiceSession:
    """Cache healthy speech backends for one interactive chat session."""

    def __init__(self, config: object | None = None) -> None:
        self._config = config
        self._stt_resolved = False
        self._stt_backend: Any = None
        self._tts_backend: Any = None
        self._tts_attempted: set[str] = set()
        self._voice_prefs: tuple[str, str, float] | None = None
        self._voice_warned: set[str] = set()

    def get_stt_backend(self) -> Any:
        """Resolve and health-check STT once, then reuse the loaded backend."""
        if not self._stt_resolved:
            from openjarvis.core.config import load_config
            from openjarvis.speech._discovery import get_speech_backend

            config = self._config if self._config is not None else load_config()
            self._stt_backend = get_speech_backend(config)
            self._stt_resolved = True
        return self._stt_backend

    def get_stt_language(self) -> Optional[str]:
        """Return the configured ``speech.language``, or None to auto-detect."""
        from openjarvis.core.config import load_config

        config = self._config if self._config is not None else load_config()
        return (getattr(config.speech, "language", "") or "").strip() or None

    def get_tts_backend(self) -> Any:
        """Return a cached healthy TTS backend, falling through once per key."""
        if self._tts_backend is not None:
            return self._tts_backend

        from openjarvis.speech._tts_discovery import get_tts_backend

        preferred, _, _ = self.get_voice_preferences()
        self._tts_backend = get_tts_backend(preferred, attempted=self._tts_attempted)
        return self._tts_backend

    def get_voice_preferences(self) -> tuple[str, str, float]:
        """Resolve configured (tts_backend, voice_id, speed), cached per session."""
        if self._voice_prefs is None:
            from openjarvis.core.config import load_config
            from openjarvis.speech._tts_discovery import voice_preferences

            config = self._config if self._config is not None else load_config()
            self._voice_prefs = voice_preferences(config)
        return self._voice_prefs

    def voice_for_backend(self, backend: Any, console: Any = None) -> tuple[str, float]:
        """Return the voice ID valid for ``backend``, plus the configured speed.

        Voice IDs are not portable across backends, so the configured
        ``speech.voice_id`` is honored only when ``backend`` is the configured
        ``speech.tts_backend``. Otherwise the fallback backend's own default is
        used and the substitution is reported once per session.
        """
        want_backend, voice_id, speed = self.get_voice_preferences()
        active = getattr(backend, "backend_id", "") or ""
        if active == want_backend:
            return voice_id, speed

        from openjarvis.speech._tts_discovery import default_voice_for

        substitute = default_voice_for(active)
        if console is not None and active not in self._voice_warned:
            self._voice_warned.add(active)
            console.print(
                f"[dim yellow]Voice: {want_backend!r} unavailable — using "
                f"{active!r} with its default voice "
                f"({substitute or 'backend default'}).[/dim yellow]"
            )
        return substitute, speed

    def discard_tts_backend(self) -> None:
        """Forget a backend that failed synthesis and allow the next fallback."""
        self._tts_backend = None


_HANDS_FREE = False  # True = continua ouvindo sem pedir Enter


def read_voice_input(console: Any, session: VoiceSession) -> Optional[str] | object:
    """Accept a typed message, or record after an empty submission.

    Depois da primeira fala bem-sucedida, continua ouvindo sozinho até haver
    silêncio; aí volta a pedir Enter.
    """
    global _HANDS_FREE

    if _HANDS_FREE:
        result = record_voice(console, session)
        if not isinstance(result, str):
            # silêncio (None) ou saída (VOICE_EXIT): volta ao modo normal
            _HANDS_FREE = False
            if result is None:
                console.print(
                    "[dim]Silêncio — voltando ao modo normal (Enter para falar).[/dim]"
                )
        return result

    try:
        typed = input("You> [type, or press Enter to speak] ")
    except (EOFError, KeyboardInterrupt):
        return VOICE_EXIT
    typed = typed.strip()
    if typed:
        return typed
    result = record_voice(console, session)
    if isinstance(result, str):
        _HANDS_FREE = True
    return result


def record_voice(
    console: Any,
    session: VoiceSession | None = None,
) -> Optional[str] | object:
    """Record from mic, transcribe, and return text or a loop sentinel."""
    from openjarvis.speech.voice_io import record_until_silence

    active_session = session or VoiceSession()
    backend = active_session.get_stt_backend()
    if backend is None:
        console.print(
            "[red]No speech-to-text backend available. "
            "Install the voice dependencies with: "
            "pip install 'OpenJarvis[speech]', or configure a healthy "
            "OpenAI/Deepgram backend.[/red]"
        )
        return VOICE_EXIT

    console.print("[dim cyan]Listening… (speak now, stops on silence)[/dim cyan]")
    try:
        audio_bytes = record_until_silence()
    except KeyboardInterrupt:
        return VOICE_EXIT
    except Exception as exc:
        # PortAudio failures are regular Exceptions (and can surface as
        # OSError), so report them without letting terminal control sequences
        # through. SystemExit deliberately continues to propagate, while
        # Ctrl-C maps to the chat loop's graceful-exit sentinel above.
        console.print(f"[red]Mic error: {_terminal_safe_text(exc)}[/red]")
        return VOICE_EXIT

    console.print("[dim]Transcribing…[/dim]")
    try:
        result = backend.transcribe(
            audio_bytes, format="wav", language=active_session.get_stt_language()
        )
        text = result.text.strip()
        if text:
            console.print(f"[bold]You (voice):[/bold] {_terminal_safe_text(text)}")
            return text
        console.print("[dim]Nothing heard — try again.[/dim]")
        return None
    except Exception as exc:
        console.print(f"[red]Transcription error: {_terminal_safe_text(exc)}[/red]")
        return None


def _limpar_para_fala(text: str) -> str:
    """Remove formatação Markdown para a voz não ler símbolos."""
    import re

    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)  # blocos de código
    text = re.sub(r"`([^`]*)`", r"\1", text)  # `código`
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)  # imagens
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # [texto](link)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)  # títulos
    text = re.sub(r"^\s*[-*•]\s+", "", text, flags=re.MULTILINE)  # marcadores
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)  # negrito
    text = text.replace("*", "").replace("#", "")  # sobras
    text = re.sub(
        "[\U0001F000-\U0001FAFF"  # emojis e pictogramas
        "\U00002600-\U000027BF"  # símbolos diversos (✅ ❤ ✨ ⚠ ...)
        "\U00002300-\U000023FF"  # técnicos (⌚ ⏰ ...)
        "\U00002B00-\U00002BFF"  # estrelas e setas (⭐ ...)
        "\U0000FE00-\U0000FE0F"  # seletores de variação
        "\U0000200D\U000020E3]+",  # junção de emojis e "keycap"
        "",
        text,
    )  # emojis
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _dividir_em_frases(text: str, minimo: int = 40) -> list[str]:
    """Divide o texto em frases; junta as muito curtas para a voz não picotar."""
    import re

    partes = re.split(r"(?<=[.!?…])\s+|\n+", text)
    frases: list[str] = []
    atual = ""
    for parte in partes:
        parte = parte.strip()
        if not parte:
            continue
        atual = f"{atual} {parte}".strip()
        if len(atual) >= minimo:
            frases.append(atual)
            atual = ""
    if atual:
        if frases:
            frases[-1] += " " + atual
        else:
            frases.append(atual)
    return frases


def _falar_em_frases(
    backend: Any,
    frases: list[str],
    synth_kwargs: dict[str, Any],
    play_wav: Any,
    foi_interrompido: Any,
) -> None:
    """Fala frase por frase: enquanto uma toca, a próxima já está sendo gerada.

    A primeira frase começa a tocar muito antes de o texto inteiro ser gerado.
    """
    import queue
    import threading

    fila: queue.Queue = queue.Queue(maxsize=2)
    parar = threading.Event()

    def colocar(item: Any) -> None:
        while not parar.is_set():
            try:
                fila.put(item, timeout=0.2)
                return
            except queue.Full:
                continue

    def produzir() -> None:
        try:
            for i, frase in enumerate(frases):
                if parar.is_set():
                    break
                colocar((i, backend.synthesize(frase, **synth_kwargs)))
        except Exception as exc:  # repassa o erro para a thread principal
            colocar(exc)
        finally:
            colocar(None)

    threading.Thread(target=produzir, daemon=True).start()
    try:
        while True:
            item = fila.get()
            if item is None:
                break
            if isinstance(item, Exception):
                raise item
            i, resultado = item
            if resultado.audio:
                # A pausa contra eco só vale depois da última frase.
                play_wav(
                    resultado.audio,
                    sample_rate=resultado.sample_rate,
                    echo_pause=(i == len(frases) - 1),
                )
                if foi_interrompido():
                    break
    finally:
        parar.set()


def speak(text: str, console: Any, session: VoiceSession | None = None) -> None:
    """Synthesize and play text, reusing a healthy backend for the session."""
    text = _limpar_para_fala(text)
    if not text:  # nada para falar (ex.: a resposta era só um bloco de código)
        return
    from openjarvis.cli.voice_io import play_wav, was_interrupted

    frases = _dividir_em_frases(text) or [text]

    active_session = session or VoiceSession()

    # Resolved before the loop: a bad config value must surface as a config
    # error, not be swallowed by the per-backend fallback handler below.
    try:
        active_session.get_voice_preferences()
    except Exception as exc:
        console.print(f"[red]Invalid speech config: {_terminal_safe_text(exc)}[/red]")
        return

    while (backend := active_session.get_tts_backend()) is not None:
        try:
            voice_id, speed = active_session.voice_for_backend(backend, console)
            synth_kwargs: dict[str, Any] = {"output_format": "wav", "speed": speed}
            if voice_id:
                synth_kwargs["voice_id"] = voice_id
            _falar_em_frases(backend, frases, synth_kwargs, play_wav, was_interrupted)
            return
        except Exception as exc:
            console.print(
                f"[dim yellow]Voice backend "
                f"{getattr(backend, 'backend_id', '?')!r} failed: "
                f"{_terminal_safe_text(exc)}[/dim yellow]"
            )
            active_session.discard_tts_backend()

    console.print(
        "[dim yellow]No TTS backend available — install kokoro: "
        "pip install kokoro[/dim yellow]"
    )


__all__ = ["VOICE_EXIT", "VoiceSession", "read_voice_input", "record_voice", "speak"]

import { useEffect, useRef } from 'react';
import { useAppStore } from '../lib/store';
import { prefetchFillers, useTtsStore } from '../lib/tts';
import {
  FILLER_DELAY_MS,
  FILLER_ID_PREFIX,
  FILLER_MAX_PER_REPLY,
  FILLER_MIN_GAP_MS,
  pickFillerPhrase,
} from '../lib/filler-speech';

/**
 * Speaks a short phrase while the assistant is still working, so a slow reply
 * (model latency, web search, file tools) is not met with silence.
 *
 * It goes through the shared TTS store, so the microphone stays paused exactly
 * as it does for a normal reply, and the real reply replaces it as soon as it
 * is ready.
 */
export function useFillerSpeech(): void {
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const voiceAutoplay = useAppStore((s) => s.settings.voiceAutoplay);
  const ttsAvailable = useTtsStore((s) => s.available);
  const isStreaming = useAppStore(
    (s) => s.streamState.isStreaming && s.streamState.conversationId === s.activeId,
  );
  const runningTool = useAppStore((s) => {
    const running = [...s.streamState.activeToolCalls]
      .reverse()
      .find((toolCall) => toolCall.status === 'running');
    return running ? `${running.id}|${running.tool}` : null;
  });

  const enabled = voiceOutputEnabled && voiceAutoplay && ttsAvailable === true;
  const spoken = useRef({ count: 0, lastAt: 0, lastPhrase: '' });

  const say = (tool?: string | null) => {
    const tts = useTtsStore.getState();
    const memory = spoken.current;
    const now = Date.now();
    if (tts.available !== true || tts.state !== 'idle') return;
    if (memory.count >= FILLER_MAX_PER_REPLY) return;
    if (memory.count > 0 && now - memory.lastAt < FILLER_MIN_GAP_MS) return;

    const phrase = pickFillerPhrase(tool, memory.lastPhrase);
    if (phrase === null) return;

    memory.count += 1;
    memory.lastAt = now;
    memory.lastPhrase = phrase;
    void tts.speak(`${FILLER_ID_PREFIX}${now}`, phrase);
  };

  // Warm the phrase cache so the first filler plays without a synthesis delay.
  useEffect(() => {
    if (enabled) prefetchFillers();
  }, [enabled]);

  // A new reply starts: reset the budget and arm the "still silent" timer.
  useEffect(() => {
    if (!isStreaming) return;
    spoken.current = { count: 0, lastAt: 0, lastPhrase: '' };
    if (!enabled) return;

    const timer = window.setTimeout(() => {
      const stream = useAppStore.getState().streamState;
      if (stream.isStreaming && !stream.content) say();
    }, FILLER_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `say` only reads refs and stores, so it is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, enabled]);

  // A tool just started: say what is happening.
  useEffect(() => {
    if (!enabled || !isStreaming || runningTool === null) return;
    say(runningTool.split('|')[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTool]);
}

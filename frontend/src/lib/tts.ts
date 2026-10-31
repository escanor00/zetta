import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { toSpeakableText } from './message-text';
import { GENERIC_FILLERS, isFillerId } from './filler-speech';
import { splitIntoSpeechChunks } from './speech-chunks';

export type TtsState = 'idle' | 'loading' | 'speaking';

/**
 * Voice output is a single shared resource: one utterance at a time, for the
 * whole app. The state lives in one store rather than per component, because a
 * per-component hook would give every message its own audio element -- two
 * replies would then talk over each other, and autoplay would make that the
 * normal case rather than the exception.
 */
interface TtsStore {
  state: TtsState;
  /** id of the message currently loading or speaking, if any. */
  speakingId: string | null;
  error: string | null;
  /** Message whose read-aloud attempt failed, if any. */
  errorId: string | null;
  /** null until the health probe has answered. */
  available: boolean | null;
  /** Last message spoken by autoplay, so a re-render never repeats it. */
  autoSpokenId: string | null;
  speak: (id: string, text: string) => Promise<void>;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

// Playback handles are not render state -- keeping them out of the store avoids
// re-rendering every subscriber when an audio element is swapped.
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;
/** Synthesized filler phrases, so a filler starts without a synthesis delay. */
const fillerCache = new Map<string, Blob>();
let fillersPrefetched = false;

/** Let the page's own first utterance (e.g. the morning recap) go first. */
const PREFETCH_DELAY_MS = 8000;

/** Synthesize the generic filler phrases once, in the background. */
export function prefetchFillers(): void {
  if (fillersPrefetched) return;
  fillersPrefetched = true;
  setTimeout(() => void warmFillerCache(), PREFETCH_DELAY_MS);
}

async function warmFillerCache(): Promise<void> {
  for (const phrase of GENERIC_FILLERS) {
    const text = toSpeakableText(phrase);
    if (!text || fillerCache.has(text)) continue;
    try {
      fillerCache.set(text, await synthesizeSpeech(text));
    } catch {
      // Fillers are optional: fall back to on-demand synthesis.
      fillersPrefetched = false;
      return;
    }
  }
}

/** Settles when the filler that is currently playing has finished. */
let fillerEnded: Promise<void> | null = null;
let resolveFillerEnded: (() => void) | null = null;

function beginFillerPlayback(): void {
  fillerEnded = new Promise<void>((resolve) => {
    resolveFillerEnded = () => {
      resolveFillerEnded = null;
      fillerEnded = null;
      resolve();
    };
  });
}

function endFillerPlayback(): void {
  resolveFillerEnded?.();
}

/** Resolves when nothing is loading or speaking (or after `timeoutMs`). */
export function waitForTtsIdle(timeoutMs = 60_000): Promise<void> {
  if (useTtsStore.getState().state === 'idle') return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = useTtsStore.subscribe((current) => {
      if (current.state === 'idle') finish();
    });
  });
}

/**
 * Resolves once a filler that is being *spoken* has finished (or after
 * `timeoutMs`), so the real reply does not cut it off mid-word. A filler that
 * is still loading is not worth waiting for: speak() simply replaces it.
 */
export function waitForFillerEnd(timeoutMs = 4000): Promise<void> {
  const playing = fillerEnded;
  if (!playing) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void playing.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Only a stream ending in the active conversation may trigger autoplay. */
export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

/** Stop and release the current audio element, keeping any synthesis alive. */
function releasePlayback(): void {
  endFillerPlayback();
  if (audio) {
    // Detach first: clearing src re-runs the media load algorithm, which fails
    // on an empty source and dispatches an `error` event. With the handler
    // still attached that surfaces as a bogus "Playback failed" after every
    // successful utterance.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function teardown(): void {
  releasePlayback();
  if (controller) {
    controller.abort();
    controller = null;
  }
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  state: 'idle',
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        set({ available: health.available });
        if (!health.available) healthProbe = null;
      })
      .catch(() => {
        set({ available: false });
        healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  speak: (id: string, text: string) => {
    const trimmed = toSpeakableText(text);
    if (!trimmed) return Promise.resolve();

    const filler = isFillerId(id);
    // A reply must not cut a filler off mid-word: let it keep playing while the
    // reply is synthesized, and swap once the first audio is ready.
    const overFiller = !filler && fillerEnded !== null;

    // Bump before teardown so a synthesis still in flight is both aborted and
    // fenced off by the token, even if the abort loses the race.
    token += 1;
    const mine = token;
    if (overFiller) {
      controller?.abort();
      controller = null;
    } else {
      teardown();
    }
    set({ state: 'loading', speakingId: id, error: null, errorId: null });

    const ac = new AbortController();
    controller = ac;

    const chunks = filler ? [trimmed] : splitIntoSpeechChunks(trimmed);
    const cachedFiller = filler ? fillerCache.get(trimmed) : undefined;
    const fetchChunk = (index: number): Promise<Blob> =>
      index === 0 && cachedFiller
        ? Promise.resolve(cachedFiller)
        : synthesizeSpeech(chunks[index], { signal: ac.signal });

    // Plays one chunk; `onStarted` fires once audio is actually playing. The
    // end of the last chunk resets the store synchronously, like a single clip.
    const playBlob = (blob: Blob, isLast: boolean, onStarted: () => void): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        releasePlayback();
        const url = URL.createObjectURL(blob);
        objectUrl = url;
        const el = new Audio(url);
        audio = el;

        el.onended = () => {
          if (filler) endFillerPlayback();
          if (isLast && mine === token) {
            teardown();
            set({ state: 'idle', speakingId: null });
          }
          resolve();
        };
        el.onerror = () => {
          if (filler) endFillerPlayback();
          if (mine !== token) resolve();
          else reject(new Error('Playback failed'));
        };

        el.play().then(() => {
          if (mine !== token) return;
          set({ state: 'speaking', speakingId: id });
          if (filler) beginFillerPlayback();
          onStarted();
        }, reject);
      });

    // `speak` settles when playback has started (or failed); the remaining
    // chunks keep going in the background.
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    void (async () => {
      try {
        let upcoming = fetchChunk(0);
        for (let index = 0; index < chunks.length; index += 1) {
          const blob = await upcoming;
          if (filler && !cachedFiller) fillerCache.set(trimmed, blob);
          if (mine !== token) return;

          if (index + 1 < chunks.length) {
            // Synthesize the next chunk while this one plays. Errors surface
            // when it is awaited; this only avoids an unhandled rejection if
            // playback is stopped first.
            upcoming = fetchChunk(index + 1);
            upcoming.catch(() => undefined);
          }
          if (index === 0 && overFiller) {
            await waitForFillerEnd();
            if (mine !== token) return;
          }

          await playBlob(blob, index === chunks.length - 1, markStarted);
          if (mine !== token) return;
        }
      } catch (err) {
        if (mine !== token) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        teardown();
        set({
          state: 'idle',
          speakingId: null,
          error: err instanceof Error ? err.message : 'Speech synthesis failed',
          errorId: id,
        });
      } finally {
        markStarted();
      }
    })();

    return started;
  },

  stop: () => {
    token += 1;
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

/** Test seam: reset module-level playback handles between cases. */
export function __resetTtsForTests(): void {
  teardown();
  token = 0;
  healthProbe = null;
  fillerCache.clear();
  fillersPrefetched = false;
  useTtsStore.setState({
    state: 'idle',
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../lib/store';
import { fetchMorningRecap, fetchTodayDigest, generateDigest } from '../lib/api';
import {
  MORNING_DIGEST_ID,
  MORNING_KEY,
  MORNING_RECAP_ID,
  isMorningForced,
  localDateKey,
  shouldRunMorningBriefing,
} from '../lib/morning';
import { useTtsStore, waitForTtsIdle } from '../lib/tts';

/** Give the page a moment to settle before talking. */
const START_DELAY_MS = 1500;

const userHasInteracted = () => navigator.userActivation?.hasBeenActive ?? false;

/**
 * Once per day, on the first open: speaks a short recap while today's digest is
 * prepared in the background, then speaks the digest itself.
 *
 * Browsers refuse audio before the first click or key press, so when playback
 * is blocked this reports `needsGesture` and starts on the next interaction.
 */
export function useMorningBriefing(): { needsGesture: boolean; start: () => void } {
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const ttsAvailable = useTtsStore((s) => s.available);
  const [needsGesture, setNeedsGesture] = useState(false);
  const running = useRef(false);
  const finished = useRef(false);
  const gestureTried = useRef(false);

  const run = useCallback(async () => {
    if (running.current || finished.current) return;
    running.current = true;

    const recap = await fetchMorningRecap();

    if (recap) {
      await useTtsStore.getState().speak(MORNING_RECAP_ID, recap);
      const { error } = useTtsStore.getState();
      if (error) {
        // Autoplay was refused. Wait for a click or key press once, then retry.
        running.current = false;
        if (!gestureTried.current && !userHasInteracted()) setNeedsGesture(true);
        return;
      }
    }

    finished.current = true;
    try {
      localStorage.setItem(MORNING_KEY, localDateKey());
    } catch {
      // Without storage the briefing may repeat after a reload; that is harmless.
    }

    // The digest takes several seconds to generate. Starting it only once the
    // recap is playing keeps it from slowing the recap's first words, and it is
    // ready well before the recap ends.
    const digest = (await fetchTodayDigest()) ?? (await generateDigest());
    if (!digest) return;
    await waitForTtsIdle(120_000);
    await useTtsStore.getState().speak(MORNING_DIGEST_ID, digest);
  }, []);

  const start = useCallback(() => {
    gestureTried.current = true;
    setNeedsGesture(false);
    void run();
  }, [run]);

  // First open of the day: start once voice output is known to work.
  useEffect(() => {
    if (!voiceOutputEnabled || ttsAvailable !== true) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(MORNING_KEY);
    } catch {
      last = null;
    }
    if (!shouldRunMorningBriefing(last, new Date(), isMorningForced(window.location.search))) {
      return;
    }

    let timer: number | undefined;
    const begin = () => {
      timer = window.setTimeout(() => void run(), START_DELAY_MS);
    };
    if (document.visibilityState === 'visible') {
      begin();
    } else {
      document.addEventListener('visibilitychange', begin, { once: true });
    }
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', begin);
    };
  }, [voiceOutputEnabled, ttsAvailable, run]);

  // Blocked autoplay: the next click or key press is the permission to talk.
  useEffect(() => {
    if (!needsGesture) return;
    const onGesture = () => start();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [needsGesture, start]);

  return { needsGesture, start };
}

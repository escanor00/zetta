import { useEffect, useState } from 'react';

/** Matches the exit animation in index.css; reduced motion skips the wait. */
const LEAVE_MS = 240;

/**
 * Shared behavior of the HUD's self-opening panels (unread mail, headlines).
 *
 * Returns whether the panel should still be rendered: it stays mounted for the
 * exit animation after `open` turns false. Escape calls `onClose` while open.
 */
export function usePopupPanel(open: boolean, onClose: () => void): boolean {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setMounted(false), reduced ? 0 : LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  return mounted;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUnreadMail, type UnreadMail } from '../lib/api';
import { hasUndismissed, loadDismissed, saveDismissed, withDismissed } from '../lib/unread-mail';

/**
 * Polls the unread-mail summary and opens the panel on its own whenever there
 * is mail the user has not dismissed yet. Closing remembers what was showing,
 * so only genuinely new mail reopens it.
 */
export function useUnreadMail(intervalMs = 120_000) {
  const [mail, setMail] = useState<UnreadMail | null>(null);
  const [open, setOpen] = useState(false);
  /** True once the first poll has answered, whether or not it found mail. */
  const [loaded, setLoaded] = useState(false);
  const dismissed = useRef<Set<number>>(loadDismissed());

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void fetchUnreadMail().then((summary) => {
        if (cancelled) return;
        setMail(summary);
        setLoaded(true);
        if (summary && summary.count > 0 && hasUndismissed(summary.messages, dismissed.current)) {
          setOpen(true);
        }
      });
    };
    poll();
    const timer = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  const close = useCallback(() => {
    setOpen(false);
    if (mail) {
      dismissed.current = withDismissed(mail.messages, dismissed.current);
      saveDismissed(dismissed.current);
    }
  }, [mail]);

  const reopen = useCallback(() => setOpen(true), []);

  const hasNew = mail !== null && hasUndismissed(mail.messages, dismissed.current);

  return { mail, open, close, reopen, hasNew, loaded };
}

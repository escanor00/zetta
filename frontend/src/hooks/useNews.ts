import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHeadlines, type Headlines } from '../lib/api';
import { hasUnseenNews, loadSeenNews, markNewsSeen, saveSeenNews, type SeenNews } from '../lib/news';

/**
 * Polls the headlines and opens the panel on its own when there are ones the
 * user has not dismissed. It opens alongside the unread-mail panel, not after
 * it. `close` dismisses what was showing.
 */
export function useNews(intervalMs = 600_000) {
  const [news, setNews] = useState<Headlines | null>(null);
  const [open, setOpen] = useState(false);
  const seen = useRef<SeenNews>(loadSeenNews());

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void fetchHeadlines().then((headlines) => {
        if (!cancelled) setNews(headlines);
      });
    };
    poll();
    const timer = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  const pending =
    news !== null &&
    news.items.length > 0 &&
    hasUnseenNews(news.items, seen.current);

  useEffect(() => {
    if (pending) setOpen(true);
  }, [pending]);

  const close = useCallback(() => {
    setOpen(false);
    if (news) {
      seen.current = markNewsSeen(news.items, seen.current);
      saveSeenNews(seen.current);
    }
  }, [news]);

  const reopen = useCallback(() => setOpen(true), []);

  return { news, open, close, reopen, hasNew: pending };
}

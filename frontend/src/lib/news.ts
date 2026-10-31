import type { Headline } from './api';

export const NEWS_DISMISSED_KEY = 'openjarvis-news-dismissed';
const MAX_REMEMBERED = 300;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * What the user has already seen: the headline ids and the publication time of
 * the newest one. An older headline that merely slides into the visible list
 * (because newer ones expired) must not count as news, so "new" means both
 * unseen *and* published after `newest`.
 */
export interface SeenNews {
  ids: Set<string>;
  /** Epoch ms of the newest dismissed headline; 0 when unknown. */
  newest: number;
}

export function emptySeenNews(): SeenNews {
  return { ids: new Set(), newest: 0 };
}

function publishedAt(item: Headline): number {
  const time = item.published ? Date.parse(item.published) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function loadSeenNews(storage: StorageLike = localStorage): SeenNews {
  try {
    const parsed = JSON.parse(storage.getItem(NEWS_DISMISSED_KEY) ?? 'null');
    // Older versions stored just the array of ids.
    const rawIds: unknown = Array.isArray(parsed) ? parsed : parsed?.ids;
    const ids = Array.isArray(rawIds)
      ? rawIds.filter((id): id is string => typeof id === 'string')
      : [];
    const newest =
      !Array.isArray(parsed) && typeof parsed?.newest === 'number' && Number.isFinite(parsed.newest)
        ? parsed.newest
        : 0;
    return { ids: new Set(ids), newest };
  } catch {
    return emptySeenNews();
  }
}

export function saveSeenNews(seen: SeenNews, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(
      NEWS_DISMISSED_KEY,
      JSON.stringify({ ids: [...seen.ids].slice(-MAX_REMEMBERED), newest: seen.newest }),
    );
  } catch {
    // Not persisting only means the panel may reopen after a reload.
  }
}

/** True when a headline is both unseen and newer than everything dismissed. */
export function hasUnseenNews(items: Headline[], seen: SeenNews): boolean {
  return items.some(
    (item) => !seen.ids.has(item.id) && (seen.newest === 0 || publishedAt(item) > seen.newest),
  );
}

/** A new record that also remembers every headline currently listed. */
export function markNewsSeen(items: Headline[], seen: SeenNews): SeenNews {
  const ids = new Set(seen.ids);
  let newest = seen.newest;
  for (const item of items) {
    ids.add(item.id);
    newest = Math.max(newest, publishedAt(item));
  }
  return { ids, newest };
}

/** The link only when it is a plain web address (never javascript:, file:, ...). */
export function safeWebLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

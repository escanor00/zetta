import { describe, expect, it } from 'vitest';
import type { Headline } from './api';
import {
  NEWS_DISMISSED_KEY,
  emptySeenNews,
  hasUnseenNews,
  loadSeenNews,
  markNewsSeen,
  safeWebLink,
  saveSeenNews,
} from './news';

const headline = (id: string, published: string | null = null): Headline => ({
  id,
  source: 'G1',
  title: `Manchete ${id}`,
  link: null,
  published,
});

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

describe('seen headlines', () => {
  it('everything is new the first time', () => {
    expect(hasUnseenNews([headline('a'), headline('b')], emptySeenNews())).toBe(true);
  });

  it('stays closed when every headline was already seen', () => {
    const seen = markNewsSeen([headline('a', '2026-10-31T10:00:00Z')], emptySeenNews());

    expect(hasUnseenNews([headline('a', '2026-10-31T10:00:00Z')], seen)).toBe(false);
  });

  it('reopens for a headline published after the ones already seen', () => {
    const seen = markNewsSeen([headline('a', '2026-10-31T10:00:00Z')], emptySeenNews());

    expect(
      hasUnseenNews([headline('c', '2026-10-31T11:00:00Z'), headline('a', '2026-10-31T10:00:00Z')], seen),
    ).toBe(true);
  });

  it('does not reopen when an older headline merely slides into the list', () => {
    const seen = markNewsSeen(
      [headline('a', '2026-10-31T12:00:00Z'), headline('b', '2026-10-31T11:00:00Z')],
      emptySeenNews(),
    );

    // "z" was always there, just below the visible window.
    expect(hasUnseenNews([headline('a', '2026-10-31T12:00:00Z'), headline('z', '2026-10-30T08:00:00Z')], seen)).toBe(
      false,
    );
  });

  it('falls back to ids when no publication time is known', () => {
    const seen = markNewsSeen([headline('a')], emptySeenNews());

    expect(hasUnseenNews([headline('a')], seen)).toBe(false);
    expect(hasUnseenNews([headline('b')], seen)).toBe(true);
  });

  it('does not mutate the previous record', () => {
    const before = emptySeenNews();

    markNewsSeen([headline('a', '2026-10-31T10:00:00Z')], before);

    expect(before.ids.size).toBe(0);
    expect(before.newest).toBe(0);
  });

  it('persists and restores both the ids and the newest time', () => {
    const storage = memoryStorage();
    const seen = markNewsSeen([headline('x', '2026-10-31T10:00:00Z')], emptySeenNews());

    saveSeenNews(seen, storage);

    expect(loadSeenNews(storage)).toEqual(seen);
  });

  it('reads the older array-only format and ignores corrupt storage', () => {
    expect(loadSeenNews(memoryStorage('["a","b"]'))).toEqual({ ids: new Set(['a', 'b']), newest: 0 });
    expect(loadSeenNews(memoryStorage('não é json'))).toEqual(emptySeenNews());
    expect(loadSeenNews(memoryStorage('{"ids":["a",1],"newest":"x"}'))).toEqual({
      ids: new Set(['a']),
      newest: 0,
    });
  });

  it('keeps only the most recent ids', () => {
    const storage = memoryStorage();
    const ids = new Set(Array.from({ length: 500 }, (_, index) => `id${index}`));

    saveSeenNews({ ids, newest: 5 }, storage);

    const stored = JSON.parse(storage.read() ?? '{}') as { ids: string[]; newest: number };
    expect(stored.ids).toHaveLength(300);
    expect(stored.ids[stored.ids.length - 1]).toBe('id499');
    expect(stored.newest).toBe(5);
    expect(NEWS_DISMISSED_KEY).toBe('openjarvis-news-dismissed');
  });
});

describe('safeWebLink', () => {
  it.each([
    ['https://g1.globo.com/noticia', 'https://g1.globo.com/noticia'],
    ['http://exemplo.com/a?b=1', 'http://exemplo.com/a?b=1'],
  ])('keeps %s', (link, expected) => {
    expect(safeWebLink(link)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'file:///c:/windows/win.ini',
    'isso não é link',
    '',
    null,
    undefined,
  ])('rejects %s', (link) => {
    expect(safeWebLink(link)).toBeNull();
  });
});

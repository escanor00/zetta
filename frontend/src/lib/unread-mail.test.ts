import { describe, expect, it } from 'vitest';
import type { UnreadMessage } from './api';
import {
  MAIL_DISMISSED_KEY,
  formatMailAge,
  hasUndismissed,
  loadDismissed,
  saveDismissed,
  withDismissed,
} from './unread-mail';

const message = (uid: number): UnreadMessage => ({
  uid,
  from: 'Ana',
  from_address: 'ana@x.com',
  subject: `Assunto ${uid}`,
  date: null,
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

describe('dismissed unread mail', () => {
  it('opens for messages that were never dismissed', () => {
    expect(hasUndismissed([message(1), message(2)], new Set([1]))).toBe(true);
  });

  it('stays closed when every listed message was dismissed', () => {
    expect(hasUndismissed([message(1), message(2)], new Set([1, 2]))).toBe(false);
  });

  it('reopens when a new message arrives after dismissing', () => {
    const dismissed = withDismissed([message(1), message(2)], new Set());

    expect(hasUndismissed([message(3), message(2), message(1)], dismissed)).toBe(true);
  });

  it('does not reopen when an older message slides into the list', () => {
    // 12 and 11 were dismissed; 9 is just an older unread one that moved up
    // because 10 was read in the meantime.
    const dismissed = new Set([12, 11, 10, 8]);

    expect(hasUndismissed([message(12), message(11), message(9)], dismissed)).toBe(false);
  });

  it('does not mutate the previous set', () => {
    const before = new Set([1]);

    withDismissed([message(2)], before);

    expect([...before]).toEqual([1]);
  });

  it('persists and restores the dismissed uids', () => {
    const storage = memoryStorage();

    saveDismissed(new Set([4, 9]), storage);

    expect(loadDismissed(storage)).toEqual(new Set([4, 9]));
  });

  it('ignores corrupt storage', () => {
    expect(loadDismissed(memoryStorage('{não é json'))).toEqual(new Set());
    expect(loadDismissed(memoryStorage('{"a":1}'))).toEqual(new Set());
    expect(loadDismissed(memoryStorage('[1,"x",2.5,3]'))).toEqual(new Set([1, 3]));
  });

  it('keeps only the most recent uids', () => {
    const storage = memoryStorage();

    saveDismissed(new Set(Array.from({ length: 500 }, (_, index) => index)), storage);

    const stored = JSON.parse(storage.read() ?? '[]') as number[];
    expect(stored).toHaveLength(300);
    expect(stored[stored.length - 1]).toBe(499);
    expect(MAIL_DISMISSED_KEY).toBe('openjarvis-mail-dismissed');
  });
});

describe('formatMailAge', () => {
  const now = new Date('2026-10-31T12:00:00Z');

  it.each([
    ['2026-10-31T11:59:40Z', 'agora'],
    ['2026-10-31T11:55:00Z', 'há 5 min'],
    ['2026-10-31T09:00:00Z', 'há 3 h'],
    ['2026-10-30T10:00:00Z', 'ontem'],
  ])('describes %s as %s', (iso, expected) => {
    expect(formatMailAge(iso, now)).toBe(expected);
  });

  it('is empty for a missing or invalid date', () => {
    expect(formatMailAge(null, now)).toBe('');
    expect(formatMailAge('isso não é data', now)).toBe('');
  });
});

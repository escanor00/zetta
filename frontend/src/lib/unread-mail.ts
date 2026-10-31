import type { UnreadMessage } from './api';

export const MAIL_DISMISSED_KEY = 'openjarvis-mail-dismissed';
/** Enough history that old UIDs stop mattering without growing forever. */
const MAX_REMEMBERED = 300;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadDismissed(storage: StorageLike = localStorage): Set<number> {
  try {
    const parsed = JSON.parse(storage.getItem(MAIL_DISMISSED_KEY) ?? '[]');
    return new Set(
      Array.isArray(parsed) ? parsed.filter((uid): uid is number => Number.isInteger(uid)) : [],
    );
  } catch {
    return new Set();
  }
}

export function saveDismissed(dismissed: Set<number>, storage: StorageLike = localStorage): void {
  try {
    storage.setItem(MAIL_DISMISSED_KEY, JSON.stringify([...dismissed].slice(-MAX_REMEMBERED)));
  } catch {
    // Not persisting only means the panel may reopen after a reload.
  }
}

/**
 * True when a listed message arrived after everything dismissed so far.
 *
 * IMAP UIDs only grow, so "new" means a higher UID. Comparing against the exact
 * dismissed set would count an older message as new whenever a newer one is
 * read and the older one slides into the list of the latest messages.
 */
export function hasUndismissed(messages: UnreadMessage[], dismissed: Set<number>): boolean {
  let newest = 0;
  for (const uid of dismissed) if (uid > newest) newest = uid;
  return messages.some((message) => message.uid > newest);
}

/** A new set that also remembers every message currently listed. */
export function withDismissed(messages: UnreadMessage[], dismissed: Set<number>): Set<number> {
  const next = new Set(dismissed);
  for (const message of messages) next.add(message.uid);
  return next;
}

/** "agora", "há 5 min", "há 3 h", "ontem" or a short date. */
export function formatMailAge(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  return then.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export const MORNING_KEY = 'openjarvis-morning-briefing';
export const MORNING_RECAP_ID = 'morning:recap';
export const MORNING_DIGEST_ID = 'morning:digest';

/** Local calendar day as YYYY-MM-DD (not UTC, so it flips at the user's midnight). */
export function localDateKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The briefing plays once per local day, or whenever it is forced. */
export function shouldRunMorningBriefing(
  lastKey: string | null,
  now: Date = new Date(),
  forced = false,
): boolean {
  return forced || lastKey !== localDateKey(now);
}

export function isMorningForced(search: string): boolean {
  return new URLSearchParams(search).get('morning') === '1';
}

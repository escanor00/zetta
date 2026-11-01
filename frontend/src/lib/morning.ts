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

/** Greeting for the user's local clock: 5-11 morning, 12-17 afternoon, else night. */
export function timeGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Replaces every `{saudacao}` in a recap with the greeting for `date`. */
export function fillGreeting(text: string, date: Date = new Date()): string {
  return text.split('{saudacao}').join(timeGreeting(date));
}

const LEADING_GREETING =
  /^\s*(?:bom dia|boa tarde|boa noite)\b(?:,\s*\p{Lu}\p{L}*)?[\s,.!:;-]*/iu;

/** Drops a greeting ("Bom dia, Luiz.") from the start of a text, if there is one. */
export function stripLeadingGreeting(text: string): string {
  return text.replace(LEADING_GREETING, '');
}

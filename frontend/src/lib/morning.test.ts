import { describe, expect, it } from 'vitest';
import { isMorningForced, localDateKey, shouldRunMorningBriefing } from './morning';

describe('morning briefing schedule', () => {
  it('uses the local calendar day, zero padded', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 10, 30, 0, 1))).toBe('2026-11-30');
  });

  it('runs on the first open of a day', () => {
    expect(shouldRunMorningBriefing(null, new Date(2026, 9, 31, 7, 0))).toBe(true);
    expect(shouldRunMorningBriefing('2026-10-30', new Date(2026, 9, 31, 7, 0))).toBe(true);
  });

  it('does not run again on the same day', () => {
    expect(shouldRunMorningBriefing('2026-10-31', new Date(2026, 9, 31, 18, 0))).toBe(false);
  });

  it('can be forced', () => {
    expect(shouldRunMorningBriefing('2026-10-31', new Date(2026, 9, 31, 18, 0), true)).toBe(true);
  });

  it('is forced only by ?morning=1', () => {
    expect(isMorningForced('?morning=1')).toBe(true);
    expect(isMorningForced('?a=b&morning=1')).toBe(true);
    expect(isMorningForced('?morning=0')).toBe(false);
    expect(isMorningForced('')).toBe(false);
  });
});

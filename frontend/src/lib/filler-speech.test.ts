import { describe, expect, it } from 'vitest';
import {
  FILLER_ID_PREFIX,
  GENERIC_FILLERS,
  isFillerId,
  pickFillerPhrase,
} from './filler-speech';

describe('pickFillerPhrase', () => {
  it('uses a tool-specific phrase when a known tool starts', () => {
    expect(pickFillerPhrase('web_search')).toContain('pesquisar');
    expect(pickFillerPhrase('file_write')).toContain('Salvando');
    expect(pickFillerPhrase('daily_briefing')).toContain('buscar');
  });

  it('falls back to a generic phrase for unknown tools and no tool', () => {
    expect(GENERIC_FILLERS).toContain(pickFillerPhrase('ferramenta_nova'));
    expect(GENERIC_FILLERS).toContain(pickFillerPhrase());
  });

  it('never repeats the previous phrase', () => {
    for (const previous of GENERIC_FILLERS) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        expect(pickFillerPhrase(undefined, previous)).not.toBe(previous);
      }
    }
  });

  it('stays silent for tools that ask the user for confirmation', () => {
    expect(pickFillerPhrase('file_delete')).toBeNull();
  });
});

describe('isFillerId', () => {
  it('recognizes only filler ids', () => {
    expect(isFillerId(`${FILLER_ID_PREFIX}123`)).toBe(true);
    expect(isFillerId('message-1')).toBe(false);
    expect(isFillerId(null)).toBe(false);
  });
});

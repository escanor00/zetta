import { describe, expect, it } from 'vitest';
import {
  fillGreeting,
  isMorningForced,
  localDateKey,
  shouldRunMorningBriefing,
  stripLeadingGreeting,
  timeGreeting,
} from './morning';

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

describe('time-of-day greeting', () => {
  it('follows the local hour', () => {
    const at = (h: number, m = 0) => timeGreeting(new Date(2026, 5, 1, h, m));
    expect(at(0)).toBe('Boa noite');
    expect(at(4, 59)).toBe('Boa noite');
    expect(at(5)).toBe('Bom dia');
    expect(at(11, 59)).toBe('Bom dia');
    expect(at(12)).toBe('Boa tarde');
    expect(at(17, 59)).toBe('Boa tarde');
    expect(at(18)).toBe('Boa noite');
    expect(at(23, 59)).toBe('Boa noite');
  });

  it('fills every placeholder and leaves other text alone', () => {
    const afternoon = new Date(2026, 5, 1, 15, 0);
    expect(fillGreeting('{saudacao}, Luiz. Veja: {saudacao}!', afternoon)).toBe(
      'Boa tarde, Luiz. Veja: Boa tarde!',
    );
    expect(fillGreeting('Olá, Luiz.', afternoon)).toBe('Olá, Luiz.');
  });
});

describe('stripLeadingGreeting', () => {
  it('removes a greeting with or without the name', () => {
    expect(stripLeadingGreeting('Bom dia, Luiz. Você tem 3 e-mails.')).toBe('Você tem 3 e-mails.');
    expect(stripLeadingGreeting('Boa tarde! Hoje chegaram notícias.')).toBe('Hoje chegaram notícias.');
    expect(stripLeadingGreeting('  BOA NOITE, Luiz, veja os e-mails')).toBe('veja os e-mails');
  });

  it('keeps texts that do not start with a greeting', () => {
    expect(stripLeadingGreeting('Você tem 3 e-mails. Bom dia a todos.')).toBe(
      'Você tem 3 e-mails. Bom dia a todos.',
    );
    expect(stripLeadingGreeting('Bom diagnóstico, Luiz.')).toBe('Bom diagnóstico, Luiz.');
    expect(stripLeadingGreeting('')).toBe('');
  });
});

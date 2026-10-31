import { describe, expect, it } from 'vitest';
import {
  extractWakeWordCommand,
  getWakeWordMessage,
  startsWithWakeGreeting,
} from './wake-word';

describe('extractWakeWordCommand', () => {
  it('recognizes the Portuguese wake phrase with punctuation and accents', () => {
    expect(extractWakeWordCommand('Olá, Zetta!')).toBe('');
  });

  it('returns words spoken after the wake phrase', () => {
    expect(extractWakeWordCommand('Olá, Zetta, crie uma nova nota')).toBe(
      'crie uma nova nota',
    );
  });

  it('recognizes case-insensitive wake phrases without accents', () => {
    expect(extractWakeWordCommand('OLA ZETTA abra o chat')).toBe('abra o chat');
  });

  it('recognizes the common single-t transcription of Zetta', () => {
    expect(getWakeWordMessage('Olá, Zeta')).toBe('Olá, Zetta');
    expect(getWakeWordMessage('Olá, Zeta, abra o chat')).toBe('abra o chat');
  });

  it('recognizes common speech-to-text variants of the wake phrase', () => {
    expect(getWakeWordMessage('Olha, Zetta')).toBe('Olá, Zetta');
    expect(getWakeWordMessage('Olá, Seta')).toBe('Olá, Zetta');
    expect(getWakeWordMessage('Olá, Zet')).toBe('Olá, Zetta');
  });

  it('identifies an unrecognized transcript that starts like a wake greeting', () => {
    expect(startsWithWakeGreeting('Olá, como vai?')).toBe(true);
    expect(startsWithWakeGreeting('Zetta, olá')).toBe(false);
  });

  it('does not activate when the wake phrase is absent', () => {
    expect(extractWakeWordCommand('Olá, como você está?')).toBeNull();
    expect(extractWakeWordCommand('Zetta, olá')).toBeNull();
  });

  it('sends a greeting when only the wake phrase is spoken', () => {
    expect(getWakeWordMessage('Olá, Zetta!')).toBe('Olá, Zetta');
  });

  it('preserves a command after the wake phrase', () => {
    expect(getWakeWordMessage('Olá, Zetta, crie uma nova nota')).toBe(
      'crie uma nova nota',
    );
  });

  it('does not create a message when the wake phrase is absent', () => {
    expect(getWakeWordMessage('Olá, como você está?')).toBeNull();
  });
});

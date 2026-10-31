import { describe, expect, it } from 'vitest';
import {
  FIRST_CHUNK_MAX,
  REST_CHUNK_MAX,
  SINGLE_CHUNK_MAX,
  splitIntoSpeechChunks,
} from './speech-chunks';

const SENTENCE = 'Esta é uma frase de exemplo que ocupa algum espaço no texto falado.';

describe('splitIntoSpeechChunks', () => {
  it('keeps short text in a single chunk', () => {
    expect(splitIntoSpeechChunks('Olá, tudo bem?')).toEqual(['Olá, tudo bem?']);
    const nearLimit = 'a'.repeat(SINGLE_CHUNK_MAX);
    expect(splitIntoSpeechChunks(nearLimit)).toEqual([nearLimit]);
  });

  it('splits long text on sentence boundaries without losing words', () => {
    const text = Array.from({ length: 12 }, () => SENTENCE).join(' ');
    const chunks = splitIntoSpeechChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.endsWith('.')).toBe(true);
    }
  });

  it('keeps the first chunk small so audio starts quickly', () => {
    const text = Array.from({ length: 12 }, () => SENTENCE).join(' ');
    const [first, ...rest] = splitIntoSpeechChunks(text);

    expect(first.length).toBeLessThanOrEqual(FIRST_CHUNK_MAX * 1.15);
    for (const chunk of rest) {
      expect(chunk.length).toBeLessThanOrEqual(REST_CHUNK_MAX);
    }
  });

  it('grows chunks gradually so the next one is ready before the previous ends', () => {
    const text = `Curta. ${'palavra '.repeat(120)}fim.`;
    const chunks = splitIntoSpeechChunks(text);

    for (let index = 1; index < chunks.length; index += 1) {
      const allowed = Math.max(FIRST_CHUNK_MAX, chunks[index - 1].length * 2.5);
      // Pieces are cut at word boundaries, so allow a little slack.
      expect(chunks[index].length).toBeLessThanOrEqual(allowed * 1.15);
    }
    expect(chunks[1].length).toBeLessThan(REST_CHUNK_MAX);
  });

  it('breaks a very long sentence instead of making one huge chunk', () => {
    const text = `${'palavra '.repeat(80)}fim.`;
    const chunks = splitIntoSpeechChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.trim());
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(REST_CHUNK_MAX * 1.15);
  });

  it('handles text without sentence punctuation', () => {
    const text = 'sem pontuacao '.repeat(40).trim();
    const chunks = splitIntoSpeechChunks(text);

    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });
});

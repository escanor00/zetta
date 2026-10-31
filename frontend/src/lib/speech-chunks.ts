/**
 * Long replies take a long time to synthesize as one block (about 30 s for a
 * paragraph). Splitting them into sentence-sized chunks lets playback start
 * after the first one while the rest is synthesized in the background.
 */

/** Text up to this length is synthesized in one piece. */
export const SINGLE_CHUNK_MAX = 130;
/** The first chunk is kept small so audio starts quickly. */
export const FIRST_CHUNK_MAX = 110;
export const REST_CHUNK_MAX = 400;
/**
 * Speech is synthesized about 2.5x faster than it plays, so a chunk may be up
 * to this many times longer than the one before it and still be ready when the
 * previous one ends. Larger jumps leave an audible gap.
 */
const GROWTH_FACTOR = 2.5;
/** A sentence may overshoot its chunk limit by this much before being cut. */
const SLACK = 1.15;

function nextLimit(previousLength: number): number {
  return Math.min(REST_CHUNK_MAX, Math.max(FIRST_CHUNK_MAX, Math.round(previousLength * GROWTH_FACTOR)));
}

/** Cut a sentence that is too long at the last comma or space before `max`. */
function breakLongSentence(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max * SLACK) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' '));
    const at = cut > max * 0.4 ? cut + 1 : max;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  pieces.push(rest);
  return pieces;
}

export function splitIntoSpeechChunks(text: string): string[] {
  const clean = text.trim();
  if (clean.length <= SINGLE_CHUNK_MAX) return [clean];

  const sentences = clean.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';
  let limit = FIRST_CHUNK_MAX;

  for (const sentence of sentences) {
    for (const piece of breakLongSentence(sentence, limit)) {
      if (current && (current + piece).length > limit) {
        chunks.push(current.trim());
        limit = nextLimit(current.trim().length);
        current = piece;
      } else {
        current += piece;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

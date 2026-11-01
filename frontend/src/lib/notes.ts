export interface NoteHit {
  title: string;
  path: string;
  excerpt: string;
}

/** Reads the text the `search_notes` tool returns ("1. Title (arquivo: path): excerpt") into cards. */
export function parseNoteHits(result: string | undefined): NoteHit[] {
  if (!result) return [];
  const hits: NoteHit[] = [];
  for (const line of result.split('\n')) {
    const match = line.match(/^\d+\.\s+(.+?)\s+\(arquivo:\s+(.+?)\):\s*(.*)$/);
    if (match) hits.push({ title: match[1], path: match[2], excerpt: match[3] });
  }
  return hits;
}

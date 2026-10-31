function normalizeToken(token: string): string {
  return token
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function extractWakeWordCommand(transcript: string): string | null {
  const tokens = [...transcript.matchAll(/\S+/gu)];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const wakeName = normalizeToken(tokens[index + 1][0]);
    if (
      !['ola', 'olha'].includes(normalizeToken(tokens[index][0])) ||
      !(
        ['zeta', 'zetta', 'seta'].includes(wakeName) ||
        (wakeName.startsWith('zet') && wakeName.length <= 6)
      )
    ) {
      continue;
    }

    const commandStart = (tokens[index + 1].index ?? 0) + tokens[index + 1][0].length;
    return transcript.slice(commandStart).replace(/^[\s,.:;!?—-]+/u, '').trim();
  }

  return null;
}

export function startsWithWakeGreeting(transcript: string): boolean {
  const firstToken = transcript.match(/\S+/u)?.[0];
  return firstToken !== undefined &&
    ['ola', 'olha'].includes(normalizeToken(firstToken));
}

export function getWakeWordMessage(transcript: string): string | null {
  const command = extractWakeWordCommand(transcript);
  if (command === null) return null;
  return command || 'Olá, Zetta';
}

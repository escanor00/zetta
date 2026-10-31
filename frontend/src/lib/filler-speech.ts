/**
 * Short spoken "I'm working on it" phrases, played while a reply is still being
 * produced so the assistant does not stay silent for several seconds.
 */

export const FILLER_ID_PREFIX = 'filler:';

/** Wait this long without any streamed text before the first generic filler. */
export const FILLER_DELAY_MS = 2000;
/** Never speak fillers closer together than this. */
export const FILLER_MIN_GAP_MS = 6000;
/** Upper bound per reply, so a long task does not turn into chatter. */
export const FILLER_MAX_PER_REPLY = 3;

export const GENERIC_FILLERS = [
  'Um momento, estou verificando.',
  'Deixa eu ver isso para você.',
  'Só um instante, já te respondo.',
  'Estou trabalhando nisso, um instante.',
] as const;

const TOOL_FILLERS: Record<string, string> = {
  web_search: 'Vou pesquisar isso na web, só um instante.',
  file_read: 'Deixa eu ler esse arquivo.',
  file_list: 'Vou olhar o que tem nessa pasta.',
  file_write: 'Salvando isso agora.',
  obsidian_search_notes: 'Procurando nas suas notas.',
  calculator: 'Deixa eu fazer essa conta.',
  code_interpreter: 'Executando o código, um instante.',
  shell_exec: 'Rodando o comando, um instante.',
  daily_briefing: 'Vou buscar isso para você, um instante.',
};

/** Tools whose flow asks the user for something: never talk over them. */
const SILENT_TOOLS = new Set(['file_delete']);

export function isFillerId(id: string | null): boolean {
  return id !== null && id.startsWith(FILLER_ID_PREFIX);
}

/**
 * Pick a phrase for the moment: a tool-specific one when a tool just started,
 * otherwise a generic one. Never repeats `previous`. Returns null when the tool
 * must stay silent.
 */
export function pickFillerPhrase(tool?: string | null, previous = ''): string | null {
  if (tool && SILENT_TOOLS.has(tool)) return null;

  const specific = tool ? TOOL_FILLERS[tool] : undefined;
  if (specific && specific !== previous) return specific;

  const options = GENERIC_FILLERS.filter((phrase) => phrase !== previous);
  return options[Math.floor(Math.random() * options.length)] ?? GENERIC_FILLERS[0];
}

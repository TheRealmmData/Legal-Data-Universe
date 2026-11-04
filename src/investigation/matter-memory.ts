/**
 * Matter-scoped contextual memory (owner-directed, 2026-10-31).
 * Two tiers, never conflated:
 * - session: in-memory only, dies with the page (objectives,
 *   recent searches).
 * - durable: localStorage, ONLY entries the user explicitly
 *   approved via "remember: ..." — reviewable and resettable,
 *   never alters evidence, never leaves the device, never used
 *   for external training.
 */
export interface MatterMemory {
  durableNotes: string[];
  sessionObjectives: string[];
  sessionSearches: string[];
}
const KEY = 'ldu-matter-memory-v1';
export function emptyMemory(): MatterMemory {
  return { durableNotes: [], sessionObjectives: [], sessionSearches: [] };
}
export function loadDurable(storage: Pick<Storage, 'getItem'> | undefined): string[] {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
export function saveDurable(storage: Pick<Storage, 'setItem'> | undefined, notes: string[]): void {
  try { storage?.setItem(KEY, JSON.stringify(notes.slice(0, 50))); } catch { /* private mode */ }
}
export function rememberNote(m: MatterMemory, note: string): MatterMemory {
  const clean = note.trim().slice(0, 300);
  return clean ? { ...m, durableNotes: [...m.durableNotes, clean].slice(-50) } : m;
}
export function resetDurable(m: MatterMemory): MatterMemory {
  return { ...m, durableNotes: [] };
}
export function noteSearch(m: MatterMemory, term: string): MatterMemory {
  return { ...m, sessionSearches: [...m.sessionSearches, term].slice(-20) };
}
export function noteObjective(m: MatterMemory, objective: string): MatterMemory {
  return { ...m, sessionObjectives: [...m.sessionObjectives, objective].slice(-10) };
}
export function memoryLines(m: MatterMemory): string[] {
  return [
    `Durable (you approved): ${m.durableNotes.length ? m.durableNotes.join(' | ') : '(none)'}`,
    `Session objectives: ${m.sessionObjectives.length ? m.sessionObjectives.join(' | ') : '(none)'}`,
    `Session searches: ${m.sessionSearches.length ? m.sessionSearches.join(' | ') : '(none)'}`,
  ];
}

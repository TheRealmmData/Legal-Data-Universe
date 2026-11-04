/**
 * Spatial interaction as a prompting language — typed contract
 * (Vision Addendum §3A, 2026-10-28). When an investigator points,
 * grabs, circles, or time-windows evidence and then asks a question,
 * the SELECTION ITSELF is structured input — object IDs, never a
 * model's guess at what a gesture meant. Foundation only: the
 * current UI supplies selectedRecordId + active hits today; lens and
 * multi-select fields activate as lenses land. IDs are validated
 * against the evidence store before any model sees them.
 */
import type { EvidenceStore } from '../evidence/store.ts';

export type ActiveLens = 'evidence' | 'network' | 'concept' | 'chronology';

export interface SpatialSelectionContext {
  selectedEntityIds: string[]; // people / organizations
  selectedRelationshipIds: string[]; // e.g. "edge:p-alex--p-blair", "reply:fx-002->fx-001"
  selectedSourceIds: string[]; // record IDs
  activeLens: ActiveLens;
  timeRange?: { from?: string; to?: string };
  filters: Record<string, string>;
  investigatorQuestion: string;
  investigationId: string;
  hypothesisId?: string;
  priorFindingIds: string[];
}

export function emptySelection(
  investigationId: string,
  investigatorQuestion: string,
): SpatialSelectionContext {
  return {
    selectedEntityIds: [],
    selectedRelationshipIds: [],
    selectedSourceIds: [],
    activeLens: 'evidence',
    filters: {},
    investigatorQuestion,
    investigationId,
    priorFindingIds: [],
  };
}

/**
 * Reject any selection that references records the store cannot
 * resolve — a spatial gesture must never smuggle an invented
 * source ID into a model request.
 */
export function validateSelectionContext(
  selection: SpatialSelectionContext,
  store: EvidenceStore,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const id of selection.selectedSourceIds) {
    if (!store.has(id)) problems.push(`selected source not in evidence store: ${id}`);
  }
  if (!selection.investigatorQuestion.trim()) {
    problems.push('investigator question is empty');
  }
  if (!selection.investigationId.trim()) problems.push('investigationId is required');
  return { ok: problems.length === 0, problems };
}

/** Human-readable, model-bound rendering of the selection (auditable). */
export function describeSelection(selection: SpatialSelectionContext): string {
  const bits: string[] = [`lens=${selection.activeLens}`];
  if (selection.selectedSourceIds.length) bits.push(`sources=[${selection.selectedSourceIds.join(', ')}]`);
  if (selection.selectedEntityIds.length) bits.push(`entities=[${selection.selectedEntityIds.join(', ')}]`);
  if (selection.selectedRelationshipIds.length) {
    bits.push(`relationships=[${selection.selectedRelationshipIds.join(', ')}]`);
  }
  if (selection.timeRange?.from || selection.timeRange?.to) {
    bits.push(`time=${selection.timeRange.from ?? '...'}..${selection.timeRange.to ?? '...'}`);
  }
  if (selection.hypothesisId) bits.push(`hypothesis=${selection.hypothesisId}`);
  return bits.join(' ');
}

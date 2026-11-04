/**
 * Agentic Legal Assistant — shared specialist contracts.
 * Architecture (knowledge/ms 4 proposed architecture.png):
 * Assistant -> Intelligent Orchestrator -> 4 specialists ->
 * Evidence & Quality Control -> attorney (Human Approval).
 * Every specialist run carries provenance; nothing reaches the
 * attorney without passing QC. Specialists are functional
 * components with explicit I/O — not prompt personas.
 * Model routing (actual): all four specialists are
 * deterministic in v1; the Baseten model path (ai/runner.ts)
 * serves open questions the orchestrator does not claim.
 * Benchmark before ever splitting specialists across models.
 */
export type SpecialistName = 'retrieval' | 'relationship' | 'reasoning' | 'work-product' | 'quality-control';

export interface Provenance {
  method: string;
  recordIds: string[];
  scope: string;
}

export interface SpecialistRun<T> {
  specialist: SpecialistName;
  inputSummary: string;
  output: T;
  provenance: Provenance;
}

export interface QuoteCitation {
  recordId: string;
  quote: string;
}

export interface AuditEntry {
  step: number;
  actor: SpecialistName | 'orchestrator';
  action: string;
  detail: string;
}

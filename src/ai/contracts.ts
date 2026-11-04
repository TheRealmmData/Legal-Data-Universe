/**
 * Bounded agentic investigation — interface contracts (design D15/D16).
 * NOT wired into the runtime scene yet. No API keys, no network calls.
 * Deterministic tools return record IDs and counts only; the Meta model
 * plans and synthesises, and every synthesized claim must cite IDs that
 * validateCitations() can resolve against the evidence store.
 */

export interface EvidenceRecord {
  id: string;
  kind: 'email' | 'document' | 'note' | 'other';
  title: string;
  body: string;
  /** ISO date string as stored; may be unreliable — see dateConfidence. */
  date: string;
  dateConfidence: 'verified' | 'derived' | 'suspect';
  participants: string[];
  familyId?: string;
}

export type ToolName =
  | 'search_records'
  | 'get_record'
  | 'compare_timeline'
  | 'trace_relationships'
  | 'collection_analytics';

export interface ToolCall {
  tool: ToolName;
  /** Tool-specific, JSON-serializable arguments (allow-listed server-side). */
  args: Record<string, string | string[] | number>;
  reason: string;
}

export interface ToolResult {
  tool: ToolName;
  recordIds: string[];
  /** Deterministic summary (counts, orderings) — never model prose. */
  facts: string[];
}

export interface InvestigationPlan {
  objective: string;
  /** Hard bound: 3–5 steps, enforced by the executor, not the model. */
  steps: ToolCall[];
}

export interface Citation {
  recordId: string;
  /** Verbatim excerpt from that record's title/body — machine-checked. */
  quote: string;
}

export interface FindingDraft {
  claim: string;
  citationIds: string[];
  citations: Citation[];
  status: 'draft' | 'approved' | 'rejected';
  /** Structured work-product detail retained for the findings
   * memo. Model drafts may omit these; specialist drafts supply
   * them from their hypothesis evaluation. */
  title?: string;
  counterCitations?: Citation[];
  gaps?: string[];
  verdict?: string;
  leadId?: string;
  demoStep?: number;
  sourceLabel?: string;
  /**
   * Grounding class (M4, 2026-10-31): 'quote' findings rest on
   * verbatim document quotations; 'metadata' findings rest on
   * deterministic collection analytics (exact counts/rankings).
   * Metadata findings are validated against tool facts, not
   * quotes — collection-level answers must not fail for lack
   * of a quotable sentence.
   */
  groundedBy?: 'quote' | 'metadata';
}

export type AuditEvent =
  | { type: 'plan_created'; at: string; plan: InvestigationPlan }
  | { type: 'tool_executed'; at: string; call: ToolCall; result: ToolResult }
  | { type: 'run_interrupted'; at: string; afterStep: number }
  | { type: 'finding_decided'; at: string; claim: string; decision: string };

/** Reject any synthesized claim whose citations do not all resolve. */
export function validateCitations(
  finding: FindingDraft,
  knownIds: ReadonlySet<string>,
): { ok: boolean; missing: string[] } {
  const missing = finding.citationIds.filter((id) => !knownIds.has(id));
  return { ok: finding.citationIds.length > 0 && missing.length === 0, missing };
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Quote-exact verification (workshop pattern, adopted M4): every cited
 * quote must appear verbatim — whitespace-normalized — in the cited
 * record's title or body, the quote's record must be among the
 * finding's citation IDs, and there must be at least one quote.
 * Paraphrase dressed as quotation fails here, outside the model.
 */
export function validateQuotes(
  finding: FindingDraft,
  textOf: (recordId: string) => string | undefined,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!finding.citations || finding.citations.length === 0) {
    failures.push('no verbatim quotations supplied');
    return { ok: false, failures };
  }
  for (const citation of finding.citations) {
    if (!finding.citationIds.includes(citation.recordId)) {
      failures.push(`quote cites ${citation.recordId} which is not in citationIds`);
      continue;
    }
    const source = textOf(citation.recordId);
    if (source == null) {
      failures.push(`no source text for ${citation.recordId}`);
      continue;
    }
    if (!normalize(source).includes(normalize(citation.quote))) {
      failures.push(`quote not verbatim in ${citation.recordId}: "${citation.quote.slice(0, 60)}"`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Executor stopping rules (enforced outside the model). */
export const RUN_LIMITS = {
  maxSteps: 5,
  maxRecordsPerStep: 25,
  stopWhenNoNewRecords: true,
} as const;

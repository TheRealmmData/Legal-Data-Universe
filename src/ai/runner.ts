/**
 * Bounded investigation runner (M3 preparation, D15/D16).
 * The planner and synthesizer are INJECTED interfaces — in production
 * they will call a Meta model through our server proxy; in tests they
 * are explicit test doubles. Nothing here calls a model, and no fake
 * agent execution is presented as real: audit events label every
 * actor as 'model-planning' | 'tool-execution' | 'model-synthesis'
 * | 'human', and the injected implementations are named in the log.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import { collectionProfile, personCounterparties } from '../evidence/analysis.ts';
import {
  RUN_LIMITS,
  validateCitations,
  validateQuotes,
  type FindingDraft,
  type InvestigationPlan,
  type ToolCall,
  type ToolResult,
} from './contracts.ts';

export interface Planner {
  readonly name: string;
  plan(objective: string): Promise<InvestigationPlan>;
}

/** Source text handed to the synthesizer so quotations can be verbatim. */
export interface SynthesisRecord {
  id: string;
  title: string;
  body: string;
  date: string;
  dateConfidence: string;
}

export interface Synthesizer {
  readonly name: string;
  synthesize(input: {
    objective: string;
    results: ToolResult[];
    records: SynthesisRecord[];
  }): Promise<FindingDraft[]>;
}

/** Optional live-progress hooks (spatial UI); awaited, never required. */
export interface RunHooks {
  onPlan?(plan: InvestigationPlan): Promise<void> | void;
  onStep?(index: number, call: ToolCall, result: ToolResult): Promise<void> | void;
}

export type AuditKind =
  | 'model-planning'
  | 'tool-execution'
  | 'model-synthesis'
  | 'human';

export interface RunnerAuditEvent {
  kind: AuditKind;
  actor: string;
  detail: string;
  atStep?: number;
}

export interface RunOutcome {
  status: 'completed' | 'interrupted' | 'gap-no-evidence' | 'gap-invalid-citations';
  plan: InvestigationPlan;
  results: ToolResult[];
  findings: FindingDraft[];
  audit: RunnerAuditEvent[];
}

export interface InterruptSignal {
  interrupted: boolean;
}

export function executeTool(store: EvidenceStore, call: ToolCall): ToolResult {
  switch (call.tool) {
    case 'search_records': {
      const term = String(call.args.term ?? '');
      const { hits, totalMatches, truncated } = store.searchWithCount(
        term,
        RUN_LIMITS.maxRecordsPerStep,
      );
      return {
        tool: call.tool,
        recordIds: hits.map((h) => h.recordId),
        facts: [
          `search "${term}" matched ${totalMatches} record(s) in the corpus` +
            (truncated ? `; returning the top ${hits.length} (step cap) — total is the defensible count` : ''),
          ...(totalMatches === 0 && term.trim().includes(' ')
            ? ['note: this engine matches literal substrings; a multi-word phrase that appears nowhere verbatim matches nothing — retry with one distinctive word']
            : []),
          ...hits.map((h) => `${h.recordId}: ${h.excerpt}`),
        ],
      };
    }
    case 'get_record': {
      const id = String(call.args.recordId ?? '');
      const record = store.getRecord(id);
      return {
        tool: call.tool,
        recordIds: record ? [record.id] : [],
        facts: record
          ? [
              `retrieved ${record.id} dated ${record.date} (${record.dateConfidence})`,
              `${record.id} title: ${record.title}`,
              `${record.id} body: ${record.body}`,
            ]
          : [`record ${id || '(missing id)'} not found`],
      };
    }
    case 'compare_timeline': {
      const ids = Array.isArray(call.args.recordIds)
        ? call.args.recordIds.map(String)
        : [];
      const entries = store.timeline(ids);
      const facts = entries.map(
        (e) =>
          `${e.recordId} ${e.date} [${e.dateConfidence}]${e.repliesBeforeOriginal ? ' REPLIES-BEFORE-ORIGINAL' : ''}`,
      );
      return { tool: call.tool, recordIds: entries.map((e) => e.recordId), facts };
    }
    case 'collection_analytics': {
      // Deterministic eDiscovery profile: exact counts/rankings
      // the model cannot derive from keyword excerpts. Numbers
      // in facts are exhaustive; synth must copy them exactly.
      const all = store.allIds()
        .map((id) => store.getRecord(id))
        .filter((r) => r != null);
      const p = collectionProfile(all);
      const personId = String(call.args.personId ?? '');
      const facts = [
        `collection total: ${p.total} record(s), ${p.peopleCount} people, dates ${p.dateRange.earliest}..${p.dateRange.latest}`,
        `by kind: ${p.byKind.map((k) => `${k.kind}=${k.count}`).join(', ')}`,
        `by custodian: ${p.byCustodian.map((c) => `${c.custodianId}=${c.count}`).join(', ')}`,
        `by organization: ${p.byOrganization.map((o) => `${o.organizationId}=${o.count}`).join(', ')}`,
        ...(p.byExtension
          ? [`by file extension (load-file): ${p.byExtension.map((e) => `${e.extension}=${e.count}`).join(', ')}`]
          : []),
        p.fileTypeNote,
      ];
      let exampleIds: string[] = [];
      if (personId) {
        const cps = personCounterparties(all, personId);
        facts.push(
          cps.length
            ? `counterparties of ${store.personName(personId)} (${personId}): ${cps.map((c) => `${store.personName(c.personId)} (${c.personId}) sent-to-${c.sent}/received-from-${c.received} (examples ${c.exampleRecordIds.join(',')})`).join('; ')}`
            : `no explicit-role communications found for ${personId}`,
        );
        exampleIds = cps.flatMap((c) => c.exampleRecordIds).slice(0, 8);
      } else {
        exampleIds = all.slice(0, 3).map((r) => r.id);
      }
      return { tool: call.tool, recordIds: exampleIds, facts };
    }
    case 'trace_relationships': {
      const id = String(call.args.recordId ?? '');
      const related = store.related(id);
      return {
        tool: call.tool,
        recordIds: related,
        facts: [`${related.length} record(s) related to ${id || '(missing id)'}`],
      };
    }
    default:
      throw new Error(`tool not allow-listed: ${String(call.tool)}`);
  }
}

export async function runInvestigation(
  store: EvidenceStore,
  planner: Planner,
  synthesizer: Synthesizer,
  objective: string,
  signal: InterruptSignal = { interrupted: false },
  hooks: RunHooks = {},
): Promise<RunOutcome> {
  const audit: RunnerAuditEvent[] = [];
  const plan = await planner.plan(objective);
  await hooks.onPlan?.(plan);
  audit.push({
    kind: 'model-planning',
    actor: planner.name,
    detail: `plan with ${plan.steps.length} step(s) for objective`,
  });
  if (plan.steps.length > RUN_LIMITS.maxSteps) {
    throw new Error(
      `plan exceeds bound: ${plan.steps.length} steps > ${RUN_LIMITS.maxSteps}`,
    );
  }

  const results: ToolResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < plan.steps.length; i += 1) {
    if (signal.interrupted) {
      audit.push({ kind: 'human', actor: 'investigator', detail: 'run interrupted', atStep: i });
      return { status: 'interrupted', plan, results, findings: [], audit };
    }
    const result = executeTool(store, plan.steps[i]);
    results.push(result);
    await hooks.onStep?.(i, plan.steps[i], result);
    audit.push({
      kind: 'tool-execution',
      actor: 'deterministic-tools',
      detail: `${result.tool}: ${result.facts.join('; ')}`,
      atStep: i,
    });
    const fresh = result.recordIds.filter((id) => !seen.has(id));
    result.recordIds.forEach((id) => seen.add(id));
    if (RUN_LIMITS.stopWhenNoNewRecords && fresh.length === 0 && seen.size > 0) {
      audit.push({
        kind: 'tool-execution',
        actor: 'deterministic-tools',
        detail: 'stopping: step produced no new records',
        atStep: i,
      });
      break;
    }
  }

  if (seen.size === 0) {
    audit.push({
      kind: 'model-synthesis',
      actor: synthesizer.name,
      detail: 'skipped: labelled gap, no evidence retrieved',
    });
    return { status: 'gap-no-evidence', plan, results, findings: [], audit };
  }

  const records: SynthesisRecord[] = [...seen]
    .map((id) => store.getRecord(id))
    .filter((r) => r != null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      date: r.date,
      dateConfidence: r.dateConfidence,
    }));
  const drafts = await synthesizer.synthesize({ objective, results, records });
  audit.push({
    kind: 'model-synthesis',
    actor: synthesizer.name,
    detail: `produced ${drafts.length} draft finding(s)`,
  });
  const known = new Set(store.allIds());
  const textOf = (id: string) => {
    const record = store.getRecord(id);
    return record ? `${record.title} ${record.body}` : undefined;
  };
  const factsText = results.flatMap((r) => r.facts).join('\n');
  const numbersIn = (s: string) => new Set((s.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, '')));
  const factNumbers = numbersIn(factsText);
  const valid = drafts.filter((d) => {
    const ids = validateCitations(d, known);
    if (!ids.ok) {
      audit.push({
        kind: 'tool-execution',
        actor: 'citation-verification',
        detail: `rejected draft "${d.claim.slice(0, 60)}": unresolved citation IDs [${ids.missing.join(', ') || 'none supplied'}]`,
      });
      return false;
    }
    if (d.groundedBy === 'metadata') {
      // Metadata grounding: every number in the claim must be a
      // computed tool fact. Citations point at example records;
      // any supplied quotes must still verify verbatim.
      const invented = [...numbersIn(d.claim)].filter((n) => !factNumbers.has(n));
      if (invented.length > 0) {
        audit.push({
          kind: 'tool-execution',
          actor: 'metadata-verification',
          detail: `rejected metadata draft "${d.claim.slice(0, 60)}": numbers not in computed facts [${invented.join(', ')}]`,
        });
        return false;
      }
      if (d.citations.length > 0 && !validateQuotes(d, textOf).ok) {
        audit.push({
          kind: 'tool-execution',
          actor: 'quote-verification',
          detail: `rejected metadata draft "${d.claim.slice(0, 60)}": supplied quote not verbatim`,
        });
        return false;
      }
      return true;
    }
    const quotes = validateQuotes(d, textOf);
    if (!quotes.ok) {
      audit.push({
        kind: 'tool-execution',
        actor: 'quote-verification',
        detail: `rejected draft "${d.claim.slice(0, 60)}": ${quotes.failures.join('; ')}`,
      });
      return false;
    }
    return true;
  });
  if (valid.length === 0) {
    // Deterministic analytics answer: when the model produced no
    // survivable finding but collection_analytics computed exact
    // facts, the run still answers — from computed provenance,
    // labelled as such, never dressed as a model finding.
    const analytics = results.find((r) => r.tool === 'collection_analytics');
    // Gate: only for questions that actually ask for counts,
    // rankings, counterparties, or file-type composition. An
    // unanswerable substantive question must stay a labelled
    // gap — collection facts are not an answer to it.
    const isAnalyticsQuestion =
      /how many|how much|count|total|number of|biggest|largest|most|rank|who (?:was|did|has|is)|communicat|counterpart|custodian|file type|word document|emails?\b|breakdown|composition/i
        .test(objective);
    if (analytics && analytics.recordIds.length > 0 && isAnalyticsQuestion) {
      const finding: FindingDraft = {
        claim: `Collection analytics (computed, exhaustive): ${analytics.facts.slice(0, 4).join(' | ')}`,
        citationIds: analytics.recordIds.slice(0, 3),
        citations: [],
        status: 'draft',
        groundedBy: 'metadata',
      };
      audit.push({
        kind: 'tool-execution',
        actor: 'deterministic-analytics',
        detail: 'model drafts did not survive validation; answering from computed collection facts',
      });
      return { status: 'completed', plan, results, findings: [finding], audit };
    }
    return { status: 'gap-invalid-citations', plan, results, findings: [], audit };
  }
  return {
    status: 'completed',
    plan,
    results,
    findings: valid.map((d) => ({ ...d, status: 'draft' as const })),
    audit,
  };
}

/** Human gate: export exists only for explicitly approved findings. */
export function buildExport(findings: FindingDraft[], audit: RunnerAuditEvent[]) {
  const approved = findings.filter((f) => f.status === 'approved');
  if (approved.length === 0) {
    throw new Error('export refused: no finding has explicit human approval');
  }
  return { exportedFindings: approved, auditTrail: audit };
}

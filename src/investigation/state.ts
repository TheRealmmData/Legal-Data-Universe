/**
 * Shared investigation state (D2 infrastructure, 2026-10-27).
 * One state object is shared by the agent (B), the investigator's own
 * exploration (A), and collaborative follow-up (C) — the same leads,
 * findings, annotations, and audit trail in VR, MR, and desktop.
 * Serializable so a session switch never loses the investigation.
 */

export type LeadStatus = 'new' | 'exploring' | 'validated' | 'rejected';
export type LeadSource = 'agent' | 'investigator';

export interface Lead {
  id: string;
  title: string;
  source: LeadSource;
  status: LeadStatus;
  recordIds: string[];
  rationale: string;
}

export interface FindingCitation {
  recordId: string;
  quote: string;
}

export interface Finding {
  id: string;
  claim: string;
  citationIds: string[];
  status: 'draft' | 'approved' | 'rejected';
  title?: string;
  citations?: FindingCitation[];
  counterCitations?: FindingCitation[];
  gaps?: string[];
  verdict?: string;
  leadId?: string;
  demoStep?: number;
  sourceLabel?: string;
  decidedAt?: string;
  /** Run association (M4 traceability): which run/question
   * produced this draft. Optional for pre-runId snapshots. */
  runId?: number;
  question?: string;
  groundedBy?: 'quote' | 'metadata';
}

export interface Annotation {
  at: string;
  author: 'investigator' | 'agent';
  text: string;
  recordId?: string;
  leadId?: string;
}

export interface InvestigationAuditEvent {
  at: string;
  actor: 'agent' | 'investigator' | 'system';
  action: string;
  detail: string;
}

/**
 * Defensible record of one executed search. `originalQuery` is exactly
 * what the investigator (or agent) asked for; `operation` states how it
 * was actually executed, so a future natural-language front end can
 * record its translation honestly instead of implying the raw question
 * was run verbatim against the corpus.
 */
export interface SearchExecution {
  id: string;
  at: string;
  actor: 'investigator' | 'agent';
  originalQuery: string;
  /** e.g. 'keyword-substring' today; 'boolean' / 'natural-language->keyword' later. */
  operation: string;
  executedQuery: string;
  corpusId: string;
  corpusVersion: string;
  corpusSize: number;
  hitCount: number;
  matchedRecordIds: string[];
  /** Records actually returned to the caller, if fewer than hitCount. */
  returnedCount?: number;
  truncated?: boolean;
}

export type InvestigationMode = 'explore' | 'investigate';

export interface InvestigationSnapshot {
  objective: string;
  mode: InvestigationMode;
  leads: Lead[];
  findings: Finding[];
  annotations: Annotation[];
  visitedRecordIds: string[];
  audit: InvestigationAuditEvent[];
  queryHistory: string[];
  searchExecutions: SearchExecution[];
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;
const now = () => new Date().toISOString();

export class InvestigationState {
  objective = '';
  /**
   * Explore and Investigate are bidirectional modes over ONE state
   * (owner direction 2026-10-28): switching mode changes nothing but
   * this label + an audit entry. Selections, leads, findings,
   * decisions, executions, and visited records all persist.
   */
  mode: InvestigationMode = 'explore';
  private leads = new Map<string, Lead>();
  private findings = new Map<string, Finding>();
  private annotations: Annotation[] = [];
  private visited = new Set<string>();
  private audit: InvestigationAuditEvent[] = [];
  private queries: string[] = [];
  private searchExecutions: SearchExecution[] = [];

  setMode(mode: InvestigationMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.log('investigator', 'mode-switch', `-> ${mode} (context preserved)`);
  }

  setObjective(objective: string, actor: 'agent' | 'investigator'): void {
    this.objective = objective;
    this.log(actor, 'objective-set', objective);
  }

  addLead(input: Omit<Lead, 'id' | 'status'> & { status?: LeadStatus }): Lead {
    const lead: Lead = { ...input, id: nextId('lead'), status: input.status ?? 'new' };
    this.leads.set(lead.id, lead);
    this.log(
      lead.source === 'agent' ? 'agent' : 'investigator',
      'lead-added',
      `${lead.id}: ${lead.title} (${lead.recordIds.length} record(s))`,
    );
    return lead;
  }

  setLeadStatus(leadId: string, status: LeadStatus): Lead {
    const lead = this.mustLead(leadId);
    lead.status = status;
    this.log('investigator', 'lead-status', `${leadId} -> ${status}`);
    return lead;
  }

  getLead(leadId: string): Lead | undefined {
    return this.leads.get(leadId);
  }

  listLeads(status?: LeadStatus): Lead[] {
    const all = [...this.leads.values()];
    return status ? all.filter((l) => l.status === status) : all;
  }

  recordQuery(term: string): void {
    this.queries.push(term);
    this.log('investigator', 'search', `"${term}"`);
  }

  queryHistory(): readonly string[] {
    return this.queries;
  }

  recordSearchExecution(
    input: Omit<SearchExecution, 'id' | 'at'>,
  ): SearchExecution {
    const execution: SearchExecution = {
      ...input,
      matchedRecordIds: [...input.matchedRecordIds],
      id: nextId('search'),
      at: now(),
    };
    this.searchExecutions.push(execution);
    this.log(
      execution.actor,
      'search-executed',
      `${execution.id} [${execution.operation}] "${execution.executedQuery}" -> ${execution.hitCount}/${execution.corpusSize} (${execution.corpusId}@${execution.corpusVersion})`,
    );
    return execution;
  }

  listSearchExecutions(): readonly SearchExecution[] {
    return this.searchExecutions;
  }

  markVisited(recordId: string): void {
    this.visited.add(recordId);
  }

  annotate(input: Omit<Annotation, 'at'>): Annotation {
    const annotation = { ...input, at: now() };
    this.annotations.push(annotation);
    this.log(input.author, 'annotation', input.text.slice(0, 120));
    return annotation;
  }

  addFinding(input: Omit<Finding, 'id' | 'status'>): Finding {
    const finding: Finding = { ...input, id: nextId('finding'), status: 'draft' };
    this.findings.set(finding.id, finding);
    this.log('agent', 'finding-drafted', `${finding.id}: ${finding.claim.slice(0, 120)}`);
    return finding;
  }

  decideFinding(findingId: string, decision: 'approved' | 'rejected'): Finding {
    const finding = this.findings.get(findingId);
    if (!finding) throw new Error(`unknown finding: ${findingId}`);
    finding.status = decision;
    finding.decidedAt = now();
    this.log('investigator', `finding-${decision}`, findingId);
    return finding;
  }

  approvedFindings(): Finding[] {
    return [...this.findings.values()].filter((f) => f.status === 'approved');
  }

  /** Review register: every finding ever drafted, in order. */
  listFindings(): Finding[] {
    return [...this.findings.values()];
  }

  /** Export exists only for explicitly approved findings, with provenance. */
  buildExport(findingIds?: readonly string[]): { objective: string; findings: Finding[]; annotations: Annotation[]; audit: InvestigationAuditEvent[] } {
    const approved = findingIds?.length
      ? findingIds.map((id) => {
          const finding = this.findings.get(id);
          if (!finding) throw new Error(`export refused: unknown finding ${id}`);
          if (finding.status !== 'approved') throw new Error(`export refused: finding ${id} is not approved`);
          return finding;
        })
      : this.approvedFindings();
    if (approved.length === 0) {
      throw new Error('export refused: no finding has explicit investigator approval');
    }
    return {
      objective: this.objective,
      findings: approved,
      annotations: [...this.annotations],
      audit: [...this.audit],
    };
  }

  auditTrail(): readonly InvestigationAuditEvent[] {
    return this.audit;
  }

  toJSON(): InvestigationSnapshot {
    return {
      objective: this.objective,
      mode: this.mode,
      leads: [...this.leads.values()],
      findings: [...this.findings.values()],
      annotations: [...this.annotations],
      visitedRecordIds: [...this.visited],
      audit: [...this.audit],
      queryHistory: [...this.queries],
      searchExecutions: [...this.searchExecutions],
    };
  }

  static fromJSON(snapshot: InvestigationSnapshot): InvestigationState {
    const state = new InvestigationState();
    state.objective = snapshot.objective;
    state.mode = snapshot.mode ?? 'explore';
    snapshot.leads.forEach((l) => state.leads.set(l.id, l));
    snapshot.findings.forEach((f) => state.findings.set(f.id, f));
    state.annotations = [...snapshot.annotations];
    state.visited = new Set(snapshot.visitedRecordIds);
    state.audit = [...snapshot.audit];
    state.queries = [...snapshot.queryHistory];
    state.searchExecutions = [...(snapshot.searchExecutions ?? [])];
    return state;
  }

  private mustLead(leadId: string): Lead {
    const lead = this.leads.get(leadId);
    if (!lead) throw new Error(`unknown lead: ${leadId}`);
    return lead;
  }

  private log(actor: InvestigationAuditEvent['actor'], action: string, detail: string): void {
    this.audit.push({ at: now(), actor, action, detail });
  }
}

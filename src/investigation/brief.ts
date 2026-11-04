/**
 * Investigation brief + plan-proposal contracts (Spatial Intelligence
 * pivot, owner direction 2026-10-27: DEFINE -> PLAN -> DISCOVER ->
 * EXPLORE -> VERIFY -> DECIDE/EXPORT).
 *
 * Foundation only: types + validation. Nothing here is wired into
 * the investigator-facing workflow yet (that change waits for owner
 * Quest retest + approval). The contract enforces the pivot's core
 * discipline in data: the investigator's briefing exists BEFORE any
 * AI plan, the plan is a proposal the investigator approves/edits
 * (never auto-executed on arrival), and every hypothesis separates
 * supporting from contradictory evidence explicitly.
 */

export interface InvestigationBrief {
  id: string;
  /** The allegation/claim under investigation, investigator-authored. */
  allegation: string;
  /** Facts the investigator already believes established, with sources if any. */
  knownFacts: string[];
  /** What this investigation must decide or produce. */
  objectives: string[];
  /** Open uncertainties the investigator wants resolved or bounded. */
  uncertainties: string[];
  /** People/custodians of interest, if known (IDs where available). */
  peopleOfInterest: string[];
  /** ISO date bounds of interest, optional. */
  dateRange?: { from?: string; to?: string };
  authoredBy: 'investigator';
  authoredAt: string;
}

export type PlanStepKind =
  | 'search_records'
  | 'get_record'
  | 'compare_timeline'
  | 'trace_relationships'
  | 'communication_network'
  | 'concept_cluster'
  | 'chronology_review';

export interface PlanProposalStep {
  kind: PlanStepKind;
  /** Which investigative lens this step opens, for spatial binding. */
  lens: 'network' | 'concept' | 'chronology' | 'evidence';
  args: Record<string, string | string[] | number>;
  /** Why this step serves the brief (model-stated, investigator-editable). */
  rationale: string;
  /** True when the step's purpose is to seek disconfirming evidence. */
  seeksCounterevidence: boolean;
}

export interface PlanProposal {
  id: string;
  briefId: string;
  steps: PlanProposalStep[];
  /** Proposals are inert until the investigator approves (possibly edited). */
  status: 'proposed' | 'approved' | 'edited-approved' | 'rejected';
  proposedBy: string; // e.g. "model-planner [baseten:...]" — provenance, not authority
  createdAt: string;
}

export interface Hypothesis {
  id: string;
  statement: string;
  /** Observed support: record IDs whose source text was verified. */
  supportingRecordIds: string[];
  /** Observed contradiction: never merged into support or hidden. */
  contradictoryRecordIds: string[];
  /** Anything model-inferred beyond the records, labelled as such. */
  inferences: string[];
  status: 'open' | 'supported' | 'weakened' | 'refuted' | 'unresolved';
}

export function validateBrief(brief: InvestigationBrief): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!brief.allegation.trim()) problems.push('allegation is empty');
  if (brief.objectives.length === 0) problems.push('at least one objective is required');
  if (brief.uncertainties.length === 0) {
    problems.push('at least one uncertainty is required (an investigation with none is a conclusion, not a brief)');
  }
  return { ok: problems.length === 0, problems };
}

export function validatePlanProposal(
  plan: PlanProposal,
  maxSteps = 7,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (plan.steps.length === 0) problems.push('plan has no steps');
  if (plan.steps.length > maxSteps) problems.push(`plan exceeds ${maxSteps} steps`);
  if (!plan.steps.some((s) => s.seeksCounterevidence)) {
    problems.push('plan must include at least one counterevidence-seeking step');
  }
  if (plan.status !== 'proposed') problems.push('new proposals must start as proposed, never pre-approved');
  return { ok: problems.length === 0, problems };
}

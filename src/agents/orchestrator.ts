/**
 * Intelligent Orchestrator: chooses tools/specialists and
 * sequences them with a full audit trail. v1 implements one
 * reliable end-to-end investigation (Reyes/Falcon external
 * transfer); the contract generalizes by plan, not by persona.
 * QC is a hard gate: on QC failure, draft findings are WITHHELD
 * (status 'qc-failed') and only the failure report surfaces.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import { retrieveEvidence, type RetrievalOutput } from './retrieval.ts';
import { analyzeRelationships, type RelationshipOutput } from './relationship.ts';
import { evaluateReyesTransfer, type ReasoningOutput } from './reasoning.ts';
import { verifyAssessment, type QcOutput } from './quality-control.ts';
import { prepareWorkProduct, type WorkProductOutput } from './work-product.ts';
import type { AuditEntry } from './types.ts';

export interface OrchestratedInvestigation {
  question: string;
  status: 'complete' | 'qc-failed';
  audit: AuditEntry[];
  retrieval: RetrievalOutput;
  relationships: RelationshipOutput;
  reasoning: ReasoningOutput;
  qc: QcOutput;
  workProduct: WorkProductOutput | null;
  modelRouting: string;
}

export const REYES_QUESTION = 'Assess whether Elena Reyes transferred Falcon source code externally';

export function runReyesInvestigation(store: EvidenceStore): OrchestratedInvestigation {
  const audit: AuditEntry[] = [];
  const log = (actor: AuditEntry['actor'], action: string, detail: string) =>
    audit.push({ step: audit.length + 1, actor, action, detail });

  log('orchestrator', 'plan', `Question claimed by orchestrator (deterministic specialists; model not required). Corpus ${store.size} records.`);
  const retrievalRun = retrieveEvidence(store, [
    { theme: 'source-code', term: 'source code', why: 'collection-wide source-code footprint' },
    { theme: 'external-source-code', term: 'scheduler_core', why: 'any record referencing the actual source file' },
    { theme: 'acquisition', term: 'cloned', why: 'repository acquisition events' },
    { theme: 'usb', term: 'USB', why: 'removable-media events' },
    { theme: 'personal-forward', term: 'personal mailbox', why: 'external self-forwarding' },
    { theme: 'counter-approvals', term: 'Approved', why: 'authorized-transfer counterevidence' },
    { theme: 'clean-room', term: 'clean-room', why: 'receiving-side controls' },
    { theme: 'chat-nightjar', term: 'Nightjar', why: 'workplace-chat motive/context lead; gossip is not proof' },
    { theme: 'chat-do-not-email', term: 'do not put this in email', why: 'chat evidence bearing on the USB explanation' },
    { theme: 'escrow-red-herring', term: 'escrow', why: 'authorized source-code handling that must be distinguished from transfer' },
    { theme: 'air-gapped-receipt', term: 'air-gapped', why: 'recipient receipt/use boundary' },
  ]);
  log('retrieval', 'search', retrievalRun.inputSummary + ` → ${retrievalRun.output.bundles.map((b) => `${b.theme}:${b.totalMatches}`).join(' ')}`);

  // Focus set = authored core + Reyes-involved records.
  const focus = retrievalRun.output.authoredIds;
  const relRun = analyzeRelationships(store, 'p-elena', focus);
  log('relationship', 'analyze', `${relRun.output.counterparties.length} counterparties, ${relRun.output.crossOrgCounterparties.length} cross-org, timeline ${relRun.output.timeline.length} events`);

  const reasonRun = evaluateReyesTransfer(store, retrievalRun.output, relRun.output);
  log('reasoning', 'evaluate', reasonRun.output.hypotheses.map((h) => `${h.id}=${h.verdict}`).join(' '));

  const qcRun = verifyAssessment(store, retrievalRun.output, reasonRun.output);
  log('quality-control', 'verify', qcRun.output.ok ? `PASS (${qcRun.output.checkedQuotes} quotes verbatim, ${qcRun.output.checkedCounts} counts recomputed)` : `FAIL: ${qcRun.output.failures.join('; ')}`);

  let workProduct: WorkProductOutput | null = null;
  if (qcRun.output.ok) {
    const wpRun = prepareWorkProduct(reasonRun.output, retrievalRun.output);
    workProduct = wpRun.output;
    log('work-product', 'prepare', `${wpRun.output.draftFindings.length} draft finding(s) for Human Approval; search report ${wpRun.output.searchReport.bundles.length} bundles; ID list ${wpRun.output.documentIdList.count}`);
  } else {
    log('orchestrator', 'withhold', 'QC failed — draft findings withheld from attorney queue');
  }
  log('orchestrator', 'complete', 'Attorney approval remains required for every draft; nothing exported automatically.');

  return {
    question: REYES_QUESTION,
    status: qcRun.output.ok ? 'complete' : 'qc-failed',
    audit,
    retrieval: retrievalRun.output,
    relationships: relRun.output,
    reasoning: reasonRun.output,
    qc: qcRun.output,
    workProduct,
    modelRouting:
      'Deterministic specialists (retrieval/relationship/reasoning/QC/work-product); zero model calls in this pipeline. Baseten muse-spark-open-1026 remains the open-question path in ai/runner.ts. Four-model split NOT adopted: no benchmark shows benefit over gated determinism for these tasks.',
  };
}

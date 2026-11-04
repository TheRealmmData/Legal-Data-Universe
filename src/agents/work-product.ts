/**
 * Legal Work-Product Assistant: prepares findings and reports
 * from a QC-passed assessment. Outputs are DATA (drafts,
 * report payloads, ID lists) — downloading/approval stays in
 * the existing Human Approval + export workflows.
 */
import type { FindingDraft } from '../ai/contracts.ts';
import type { RetrievalOutput } from './retrieval.ts';
import type { ReasoningOutput } from './reasoning.ts';
import type { SpecialistRun } from './types.ts';

export interface WorkProductOutput {
  draftFindings: FindingDraft[];
  searchReport: {
    type: 'search-term-hit-report';
    bundles: { theme: string; query: string; count: number; documentIds: string[] }[];
    note: string;
  };
  documentIdList: { type: 'document-id-list'; count: number; documentIds: string[] };
}

export function prepareWorkProduct(
  reasoning: ReasoningOutput,
  retrieval: RetrievalOutput,
): SpecialistRun<WorkProductOutput> {
  const demoTitle = (id: string) => id.startsWith('H1')
    ? 'Lead 1 — The midnight acquisition'
    : id.startsWith('H2')
      ? 'Lead 2 — Secrets leave through a personal mailbox'
      : 'Lead 3 — The smoking gun reaches HelixWorks';
  const demoStep = (id: string) => id.startsWith('H1') ? 1 : id.startsWith('H2') ? 2 : 3;
  const draftFindings: FindingDraft[] = reasoning.hypotheses
    .filter((h) => h.verdict === 'supported' || h.verdict === 'partly-supported')
    .map((h) => ({
      title: demoTitle(h.id),
      claim: `[${h.verdict.toUpperCase()}] ${h.statement} Counterevidence considered: ${h.counter.map((c) => c.recordId).join(', ') || 'none cited'}. Gaps: ${h.gaps.join(' ')}`,
      citationIds: [...new Set([...h.support, ...h.counter].map((c) => c.recordId))],
      citations: h.support.map((c) => ({ recordId: c.recordId, quote: c.quote })),
      counterCitations: h.counter.map((c) => ({ recordId: c.recordId, quote: c.quote })),
      gaps: [...h.gaps],
      verdict: h.verdict,
      leadId: h.id,
      demoStep: demoStep(h.id),
      sourceLabel: 'Multi-specialist deterministic assessment (QC-checked)',
      status: 'draft' as const,
      groundedBy: 'quote' as const,
    }));
  // The not-established hypothesis is work product too, as an
  // explicitly-labelled negative — attorneys need the absence
  // documented, never silently dropped.
  for (const h of reasoning.hypotheses.filter((x) => x.verdict === 'not-established')) {
    draftFindings.push({
      title: demoTitle(h.id),
      claim: `[NOT ESTABLISHED] ${h.statement} Basis for non-conclusion: ${h.gaps.join(' ')}`,
      citationIds: [...new Set([...h.support, ...h.counter].map((c) => c.recordId))],
      citations: h.counter.map((c) => ({ recordId: c.recordId, quote: c.quote })),
      counterCitations: h.support.map((c) => ({ recordId: c.recordId, quote: c.quote })),
      gaps: [...h.gaps],
      verdict: h.verdict,
      leadId: h.id,
      demoStep: demoStep(h.id),
      sourceLabel: 'Multi-specialist deterministic assessment (QC-checked)',
      status: 'draft' as const,
      groundedBy: 'metadata' as const,
    });
  }
  const allIds = [...new Set(retrieval.bundles.flatMap((b) => b.recordIds))].sort();
  return {
    specialist: 'work-product',
    inputSummary: `${reasoning.hypotheses.length} hypotheses, ${retrieval.bundles.length} search bundles`,
    output: {
      draftFindings,
      searchReport: {
        type: 'search-term-hit-report',
        bundles: retrieval.bundles.map((b) => ({
          theme: b.theme, query: b.term, count: b.totalMatches, documentIds: b.recordIds,
        })),
        note: 'Search reports document scope and counts. They are not findings.',
      },
      documentIdList: { type: 'document-id-list', count: allIds.length, documentIds: allIds },
    },
    provenance: {
      method: 'drafts only from QC-passed hypotheses; reports from retrieval bundles verbatim',
      recordIds: allIds,
      scope: 'assessment-scoped',
    },
  };
}

/**
 * Evidence & Quality Control (independent layer): provenance,
 * verbatim-quote verification, count recomputation,
 * contradiction surfacing. Findings that fail QC are WITHHELD
 * from the attorney queue — approval remains the attorney's.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import type { RetrievalOutput } from './retrieval.ts';
import type { ReasoningOutput } from './reasoning.ts';
import type { SpecialistRun } from './types.ts';

export interface QcOutput {
  ok: boolean;
  failures: string[];
  checkedQuotes: number;
  checkedCounts: number;
}

export function verifyAssessment(
  store: EvidenceStore,
  retrieval: RetrievalOutput,
  reasoning: ReasoningOutput,
): SpecialistRun<QcOutput> {
  const failures: string[] = [];
  let checkedQuotes = 0;
  for (const h of reasoning.hypotheses) {
    for (const c of [...h.support, ...h.counter]) {
      checkedQuotes += 1;
      const r = store.getRecord(c.recordId);
      if (!r) failures.push(`${h.id}: citation ${c.recordId} does not exist`);
      else if (!r.body.includes(c.quote)) failures.push(`${h.id}: quote for ${c.recordId} is NOT verbatim`);
    }
    if (h.verdict === 'supported' && h.support.length === 0) {
      failures.push(`${h.id}: verdict "supported" with zero citations`);
    }
  }
  let checkedCounts = 0;
  for (const b of retrieval.bundles) {
    checkedCounts += 1;
    const again = store.searchWithCount(b.term, 100000);
    if (again.totalMatches !== b.totalMatches) {
      failures.push(`bundle ${b.theme}: count ${b.totalMatches} ≠ recomputed ${again.totalMatches}`);
    }
  }
  // Contradiction surface: a hypothesis may not cite the same
  // record as both support and counter without it being visible.
  for (const h of reasoning.hypotheses) {
    const sup = new Set(h.support.map((c) => c.recordId));
    for (const c of h.counter) {
      if (sup.has(c.recordId)) failures.push(`${h.id}: ${c.recordId} cited as both support and counter`);
    }
  }
  return {
    specialist: 'quality-control',
    inputSummary: `${checkedQuotes} quotes, ${checkedCounts} counts, contradiction scan`,
    output: { ok: failures.length === 0, failures, checkedQuotes, checkedCounts },
    provenance: {
      method: 'verbatim substring check vs stored bodies; independent count recomputation',
      recordIds: [],
      scope: 'every citation and bundle in the assessment',
    },
  };
}

/**
 * Retrieval Specialist: finds relevant text, concepts, and
 * metadata. Input: themed query plan. Output: exhaustive
 * bundles with counts (never sampled silently). Deterministic.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import type { SpecialistRun } from './types.ts';

export interface RetrievalQuery {
  theme: string;
  term: string;
  why: string;
}
export interface RetrievalBundle {
  theme: string;
  term: string;
  why: string;
  totalMatches: number;
  recordIds: string[];
}
export interface RetrievalOutput {
  bundles: RetrievalBundle[];
  authoredIds: string[];
}

export function retrieveEvidence(
  store: EvidenceStore,
  queries: RetrievalQuery[],
): SpecialistRun<RetrievalOutput> {
  const bundles = queries.map((q) => {
    const res = store.searchWithCount(q.term, 100000);
    return {
      theme: q.theme, term: q.term, why: q.why,
      totalMatches: res.totalMatches,
      recordIds: res.hits.map((h) => h.recordId),
    };
  });
  const authoredIds = store.allIds().filter((id) => id.startsWith('ts-'));
  return {
    specialist: 'retrieval',
    inputSummary: `${queries.length} themed queries over ${store.size} records`,
    output: { bundles, authoredIds },
    provenance: {
      method: 'exhaustive substring search (documented rule), full counts',
      recordIds: [...new Set(bundles.flatMap((b) => b.recordIds))],
      scope: `all ${store.size} records`,
    },
  };
}

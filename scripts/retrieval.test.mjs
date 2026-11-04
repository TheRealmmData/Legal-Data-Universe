/**
 * Retrieval defensibility harness (M3 headset report, 2026-10-28).
 * Proves, against labeled ground truth on the expanded corpus:
 *  - every record is retrievable (coverage),
 *  - investigator search is exhaustive with honest totals (no
 *    silent top-k), while the AI tool reports total vs returned,
 *  - precision/recall of the declared keyword-substring operation
 *    on labeled relevance judgments (a model score is never used).
 * Run: node scripts/retrieval.test.mjs
 */
import { loadExpandedCorpus } from '../src/evidence/corpus/index.ts';
import { executeTool } from '../src/ai/runner.ts';

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

const { store, adapter, corpus } = loadExpandedCorpus();
const GT = corpus.groundTruth;

// Coverage: all 112 records retrievable by ID (metadata criterion)
const missing = corpus.records.filter(
  (r) => !store.search(r.id, 1000).some((h) => h.recordId === r.id),
);
check(`coverage: all ${corpus.records.length} records retrievable`, missing.length === 0);

// Exhaustiveness + honest totals
const march = store.searchWithCount('March', 1000);
const marchCapped = store.searchWithCount('March', 3);
check('exhaustive search returns complete set with matching total',
  march.hits.length === march.totalMatches && !march.truncated && march.totalMatches === 11);
check('capped search declares truncation instead of posing as complete',
  marchCapped.truncated && marchCapped.hits.length === 3 && marchCapped.totalMatches === 11);
check('exact-title smoke test: "March date confirmed" -> cx-006 only',
  JSON.stringify(store.search('March date confirmed', 1000).map((h) => h.recordId)) === '["cx-006"]');

// AI tool and direct search share one data source (same store instance)
const toolMarch = executeTool(store, { tool: 'search_records', args: { term: 'March' }, reason: 'harness' });
check('AI tool reports corpus total (11), not just its returned page',
  toolMarch.facts[0].includes('matched 11 record(s)'));
check('planner-style invented phrase honestly matches zero (literal engine)',
  executeTool(store, { tool: 'search_records', args: { term: 'Atlas revised March' }, reason: 'harness' }).recordIds.length === 0);

// Precision / recall on labeled judgments (keyword operation, exhaustive)
function score(query, relevantIds) {
  const retrieved = new Set(store.search(query, 1000).map((h) => h.recordId));
  const relevant = new Set(relevantIds);
  const tp = [...retrieved].filter((id) => relevant.has(id));
  const fp = [...retrieved].filter((id) => !relevant.has(id));
  const fn = [...relevant].filter((id) => !retrieved.has(id));
  return {
    precision: tp.length / Math.max(1, tp.length + fp.length),
    recall: tp.length / Math.max(1, tp.length + fn.length),
    tp: tp.length, fp, fn,
  };
}
const atlasScore = score('Atlas', GT.relevantRecordIds);
console.log(`  [metrics] "Atlas" vs relevant set: P=${atlasScore.precision.toFixed(2)} R=${atlasScore.recall.toFixed(2)} TP=${atlasScore.tp} FP=[${atlasScore.fp}] FN=[${atlasScore.fn}]`);
check('keyword "Atlas" has known false positive (archived terms cx-003)',
  atlasScore.fp.includes('cx-003') && atlasScore.precision < 1);
check('keyword "Atlas" misses relevant records without the literal term (recall < 1, measured)',
  atlasScore.recall < 1 && atlasScore.fn.length > 0);
const priyaScore = score('Priya', ['cx-001', 'cx-004', 'cx-005', 'cx-006', 'cx-009', 'cx-010', 'cx-013', 'cx-018']);
console.log(`  [metrics] "Priya" vs authored set: P=${priyaScore.precision.toFixed(2)} R=${priyaScore.recall.toFixed(2)} TP=${priyaScore.tp} FP=[${priyaScore.fp}] FN=[${priyaScore.fn}]`);
check('person-name search surfaces background mentions as measured FP (not hidden)',
  priyaScore.fp.some((id) => id.startsWith('bg-')));

console.log(failures === 0 ? '\nAll retrieval tests passed.' : `\n${failures} retrieval test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

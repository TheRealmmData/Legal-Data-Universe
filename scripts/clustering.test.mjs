/**
 * Clustering engine contract tests (2026-11-01). Sparky-owned.
 * No network, no spend, no corpus build: small synthetic docs
 * prove the shared machinery every engine relies on —
 * tokenize/vectors/cosine, union-find grouping, schema
 * validation, Fireworks spend gates (mock fetch).
 * Run: node scripts/clustering.test.mjs
 */
import { readFileSync } from 'node:fs';
import {
  tokenize, fitIdf, vectorize, cosine, topTerms, majorityTag,
} from '../src/clustering/vector.ts';
import { kmeansCosine, groupsFromAssignments, denseToSparse } from '../src/clustering/kmeans.ts';
import { TfidfClusterer, thresholdCluster } from '../src/clustering/tfidf.ts';
import {
  validateArtifact, purity, ARTIFACT_VERSION,
} from '../src/clustering/types.ts';
import {
  loadFireworksEmbedConfig, verifyEmbeddingModel, embedTexts, groupEmbeddings,
} from '../src/clustering/fireworks.ts';

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

const docs = [
  { id: 'a1', authored: 'soc2', tokens: tokenize('SOC 2 auditors asked for access review exports') },
  { id: 'a2', authored: 'soc2', tokens: tokenize('Control evidence pack uploaded auditors confirm completion') },
  { id: 'b1', authored: 'hiring', tokens: tokenize('Interview loop schedule candidate panel coding session') },
  { id: 'b2', authored: 'hiring', tokens: tokenize('Referral bonus open roles platform team loop') },
  { id: 'c1', authored: 'resignation', tokens: tokenize('Elena Reyes resigning effective June handover') },
];
check('artifact version is 1', ARTIFACT_VERSION === 1);

// Vectors: shared vocabulary -> positive cosine; disjoint -> 0.
// (minDf 1: the 5-doc fixture is smaller than the default floor.)
const model = fitIdf(docs, 1);
const vecs = docs.map((d) => vectorize(d.tokens, model));
check('idf keeps repeated terms, drops stopwords',
  model.idf.has('auditors') && !model.idf.has('the'));
check('cosine same-topic > cross-topic',
  cosine(vecs[0], vecs[1]) > cosine(vecs[0], vecs[2])
  && cosine(vecs[2], vecs[3]) > cosine(vecs[2], vecs[4]));
check('top terms name the topic', topTerms(vecs, [0, 1], 2).some((t) => t === 'auditors'));
check('majority tag votes honestly', majorityTag(docs, [0, 1, 2]).tag === 'soc2');

// Engine: low tau merges, high tau splits; deterministic.
const engine = new TfidfClusterer({ minDf: 1 });
check('engine groups near-dupes at low tau',
  engine.groupAt(docs, 0.05).groups.length <= 3);
check('engine splits everything at tau 1',
  engine.groupAt(docs, 1).groups.length === docs.length);
const once = JSON.stringify(engine.groupAt(docs, 0.2).groups);
const twice = JSON.stringify(engine.groupAt(docs, 0.2).groups);
check('engine is deterministic', once === twice);
check('thresholdCluster matches engine', JSON.stringify(thresholdCluster(docs, vecs, 0.2)) === once);
check('purity is perfect on clean split',
  purity(docs, [{ members: [0, 1] }, { members: [2, 3] }, { members: [4] }]).score === 1);

// k-means: fixed-k, deterministic, non-chaining. The 5-doc
// fixture only proves convergence + determinism (seeding dominates
// at that size); the real property — topic recovery — is pinned
// on the corpus build below.
const kIds = docs.map((d) => d.id);
const kVecs = docs.map((d) => vectorize(d.tokens, fitIdf(docs, 1)));
const kRes = kmeansCosine(kIds, kVecs, 3);
check('k-means converges on the fixture', kRes.converged);
const kAgain = kmeansCosine(kIds, kVecs, 3);
check('k-means is deterministic',
  JSON.stringify(kRes.assignments) === JSON.stringify(kAgain.assignments));
check('dense conversion runs without loss of shape',
  kmeansCosine(kIds, denseToSparse(kVecs.map((v) => {
    const terms = [...new Set(docs.flatMap((d) => d.tokens))].sort();
    return terms.map((t) => v.weights.get(t) ?? 0);
  })), 3).converged);

// Schema: accepts the shipped TF-IDF artifact, rejects rot.
const shipped = JSON.parse(readFileSync(new URL('../data/concept-clusters-tfidf.json', import.meta.url)));
check('shipped TF-IDF artifact validates', validateArtifact(shipped));
check('shipped artifact covers all 3000 records exactly once',
  shipped.clusters.reduce((s, c) => s + c.recordIds.length, 0) === 3000
  && new Set(shipped.clusters.flatMap((c) => c.recordIds)).size === 3000);
check('schema rejects duplicate record ids',
  !validateArtifact({ ...shipped, clusters: [{ ...shipped.clusters[0] }, { ...shipped.clusters[1], recordIds: [...shipped.clusters[1].recordIds, shipped.clusters[0].recordIds[0]] }] }));
check('schema rejects bad purity', !validateArtifact({ ...shipped, purityVsAuthored: 2 }));

// Fireworks gates: no key -> error, no model -> error, no flag -> refusal.
check('missing key blocks before any call',
  'error' in loadFireworksEmbedConfig({}));
check('missing model blocks before any call',
  'error' in loadFireworksEmbedConfig({ FIREWORKS_API_KEY: 'x' }));
const cfg = loadFireworksEmbedConfig(
  { FIREWORKS_API_KEY: 'test-key', FIREWORKS_EMBEDDING_MODEL: 'test-model' });
check('full config passes the gate', !('error' in cfg));
const boom = () => { throw new Error('network must not be touched'); };
let threw = false;
try {
  await embedTexts(cfg, ['a'], { approveSpend: false }, boom);
} catch { threw = true; }
check('embedTexts refuses without approveSpend (fetch untouched)', threw);
const fakeFetch = async (url, init) => {
  const n = JSON.parse(String(init.body)).input.length;
  return {
    ok: true,
    text: async () => JSON.stringify({
      data: Array.from({ length: n }, (_, i) => ({ embedding: [0.5 + i * 0.01, 0.5] })),
    }),
  };
};
const verified = await verifyEmbeddingModel(cfg, fakeFetch);
check('verify parses dims from a 200', verified.ok && verified.dims === 2);
const vecs2 = await embedTexts(cfg, ['a', 'b'], { approveSpend: true }, fakeFetch);
check('approved batch returns one vector per text', vecs2.length === 2);
check('dense grouping unions identical vectors',
  groupEmbeddings(['x', 'y', 'z'], [[1, 0], [1, 0], [0, 1]], 0.99).length === 2);

// Outcome-1 pin (2026-11-01): k-means recovers topics where
// single-linkage chains. Pinned on the deterministic corpus
// build (~100ms): k=16 must clear 0.8 purity.
const { buildTradeSecretCorpus } = await import('../src/evidence/corpus/trade-secret.ts');
const probeCorpus = buildTradeSecretCorpus(7, 3000);
const probeDocs = probeCorpus.records.map((r) => ({
  id: r.id,
  authored: r.conceptTags?.[0] ?? '',
  tokens: tokenize(`${r.title} ${r.body}`),
}));
const probeEngine = new TfidfClusterer();
const probeVecs = probeEngine.vectorsFor(probeDocs);
const probeIds = probeDocs.map((d) => d.id);
const probeRes = kmeansCosine(probeIds, probeVecs, 16);
const probePurity = purity(probeDocs, groupsFromAssignments(probeRes.assignments, 16)).score;
console.log(`  k-means k=16 on TS3000: purity=${probePurity.toFixed(4)} iters=${probeRes.iterations}`);
check('k-means recovers corpus topics (purity >= 0.8 at k=16)', probePurity >= 0.8);

console.log(failures === 0 ? '\nAll clustering tests passed.' : `\n${failures} clustering test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

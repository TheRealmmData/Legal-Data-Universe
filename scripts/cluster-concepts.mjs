/**
 * Computed concept clusters runner, option C (2026-11-01). Thin
 * orchestration over src/clustering/* — the engine (tfidf.ts),
 * vectors (vector.ts), and schema (types.ts) are shared with the
 * eval harness and the future embedding engine. Re-running must
 * reproduce data/concept-clusters-tfidf.json byte-identically.
 *
 * Deterministic TF-IDF + cosine single-linkage over the Trade
 * Secret 3000 extracted-text bodies. No model, no credit, no
 * network. Honest scope: purity is measured against the
 * corpus's own authored tags (template-assigned on background
 * records), so a high score partly reflects template structure.
 *
 * Run: node scripts/cluster-concepts.mjs
 */
import { writeFileSync } from 'node:fs';
import { buildTradeSecretCorpus } from '../src/evidence/corpus/trade-secret.ts';
import { tokenize, topTerms } from '../src/clustering/vector.ts';
import { TfidfClusterer, TFIDF_SWEEP } from '../src/clustering/tfidf.ts';
import { purity, validateArtifact } from '../src/clustering/types.ts';

const corpus = buildTradeSecretCorpus(7, 3000);
const docs = corpus.records.map((r) => ({
  id: r.id,
  authored: r.conceptTags?.[0] ?? '',
  tokens: tokenize(`${r.title} ${r.body}`),
}));

const engine = new TfidfClusterer();
const sweep = [];
for (const tau of TFIDF_SWEEP) {
  const { groups, vectors } = engine.groupAt(docs, tau);
  const p = purity(docs, groups);
  sweep.push({ tau, groups, vectors, purity: p });
  console.log(`tau=${tau} clusters=${groups.length} purity=${p.score.toFixed(4)}`);
}
// Band-preferring selection: readable counts 8-20 win; among
// them, highest purity; ties -> fewer clusters.
let best = sweep[0];
for (const s of sweep) {
  const inBand = s.groups.length >= 8 && s.groups.length <= 20;
  const bestInBand = best.groups.length >= 8 && best.groups.length <= 20;
  if ((inBand && !bestInBand)
    || (inBand === bestInBand && (s.purity.score > best.purity.score
      || (s.purity.score === best.purity.score && s.groups.length < best.groups.length)))) {
    best = s;
  }
}
const ordered = best.groups
  .map((g) => ({ g, terms: topTerms(best.vectors, g.members) }))
  .sort((a, b) => b.g.members.length - a.g.members.length
    || (a.terms[0] < b.terms[0] ? -1 : 1));
const tauUsed = TFIDF_SWEEP[sweep.indexOf(best)];
console.log(`\nchosen tau=${tauUsed} clusters=${best.groups.length} purity=${best.purity.score.toFixed(4)} (${docs.length} records)`);
const out = {
  method: engine.describe().method,
  params: { minDf: 3, maxDf: 0.5, tf: '1+log', norm: 'l2', tau: tauUsed, seed: 7, target: 3000 },
  corpus: 'novachip-trade-secret-3000',
  purityVsAuthored: Number(best.purity.score.toFixed(4)),
  purityNote: 'Measured against the corpus authored tags (template-assigned on background records), so the score partly reflects template structure.',
  clusters: ordered.map(({ g, terms }, idx) => {
    const ids = g.members.map((i) => docs[i].id).sort();
    const detail = best.purity.detail[best.groups.indexOf(g)];
    return {
      id: `tfidf-${String(idx + 1).padStart(2, '0')}`,
      label: terms.join(' / '),
      size: ids.length,
      majorityAuthored: detail.majority,
      majorityShare: Number((detail.majorityCount / ids.length).toFixed(3)),
      thin: ids.length < 5,
      recordIds: ids,
    };
  }),
};
for (const cl of out.clusters) {
  console.log(`${cl.id} n=${cl.size} [${cl.label}] majority=${cl.majorityAuthored} ${cl.majorityShare}${cl.thin ? ' THIN' : ''}`);
}
if (!validateArtifact(out)) {
  console.log('artifact FAILED schema validation — not written.');
  process.exit(1);
}
const target = new URL('../data/concept-clusters-tfidf.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log('\nwrote app/data/concept-clusters-tfidf.json');

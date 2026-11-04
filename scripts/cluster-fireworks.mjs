/**
 * Fireworks embedding cluster runner, option A staging (2026-11-01).
 * Spend-gated: WITHOUT --approve-spend this script performs exactly
 * ONE tiny verification call (proving the hackathon credit covers
 * the configured embedding model) and stops. WITH --approve-spend
 * it embeds the corpus, groups by cosine, and writes
 * data/concept-clusters-fireworks.json through the shared schema.
 *
 * Required env (server/.env, gitignored — never printed):
 *   FIREWORKS_API_KEY, FIREWORKS_EMBEDDING_MODEL (exact dashboard
 *   id, e.g. an accounts/fireworks/models/... embedding model).
 *
 * Run:
 *   node scripts/cluster-fireworks.mjs [--model <id>]            # verify only
 *   node scripts/cluster-fireworks.mjs --approve-spend [--model <id>]  # full run
 */
import { writeFileSync } from 'node:fs';
import { loadEnvFile } from '../server/inference.mjs';
import { buildTradeSecretCorpus } from '../src/evidence/corpus/trade-secret.ts';
import { tokenize } from '../src/clustering/vector.ts';
import {
  loadFireworksEmbedConfig, verifyEmbeddingModel, embedTexts, groupEmbeddings,
} from '../src/clustering/fireworks.ts';
import { purity, validateArtifact } from '../src/clustering/types.ts';

const args = process.argv.slice(2);
const approveSpend = args.includes('--approve-spend');
const modelFlag = args.indexOf('--model');
const modelOverride = modelFlag >= 0 ? args[modelFlag + 1] : undefined;

const envPath = new URL('../server/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const env = { ...loadEnvFile(envPath), ...process.env };
const config = loadFireworksEmbedConfig(env, modelOverride);
if ('error' in config) {
  console.log(`cluster-fireworks: ${config.error}`);
  process.exit(1);
}
console.log(`cluster-fireworks: model=${config.model} approveSpend=${approveSpend}`);

try {
  const verified = await verifyEmbeddingModel(config);
  console.log(`verify: ok dims=${verified.dims} ms=${verified.ms}`);
} catch (e) {
  console.log(`verify FAILED (no spend incurred): ${String(e?.message ?? e).slice(0, 300)}`);
  console.log('If the model id is a chat/reranker model rather than an embeddings model, /v1/embeddings will 4xx — paste an Embeddings-type model id from the dashboard.');
  process.exit(1);
}

if (!approveSpend) {
  console.log('dry-run complete: credit covers this model. Re-run with --approve-spend for the full corpus.');
  process.exit(0);
}

const corpus = buildTradeSecretCorpus(7, 3000);
const texts = corpus.records.map((r) => `${r.title}\n${r.body}`);
const docs = corpus.records.map((r) => ({
  id: r.id,
  authored: r.conceptTags?.[0] ?? '',
  tokens: tokenize(`${r.title} ${r.body}`),
}));
console.log(`embedding ${texts.length} records…`);
const vectors = await embedTexts(config, texts, {
  approveSpend: true,
  onProgress: (done, total) => console.log(`  ${done}/${total}`),
});
const sweep = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85];
let best = null;
for (const tau of sweep) {
  const groups = groupEmbeddings(docs.map((d) => d.id), vectors, tau);
  const p = purity(docs, groups);
  console.log(`tau=${tau} clusters=${groups.length} purity=${p.score.toFixed(4)}`);
  const inBand = groups.length >= 8 && groups.length <= 24;
  const bestInBand = best !== null && best.groups.length >= 8 && best.groups.length <= 24;
  if (!best || (inBand && !bestInBand)
    || (inBand === bestInBand && (p.score > best.purity.score
      || (p.score === best.purity.score && groups.length < best.groups.length)))) {
    best = { tau, groups, purity: p };
  }
}
// Labels reuse shared-vocabulary top terms (lexical basis stays
// inspectable even when grouping is neural).
const { topTerms } = await import('../src/clustering/vector.ts');
const { TfidfClusterer } = await import('../src/clustering/tfidf.ts');
const lex = new TfidfClusterer().vectorsFor(docs);
const ordered = best.groups
  .map((g) => ({ g, terms: topTerms(lex, g.members) }))
  .sort((a, b) => b.g.members.length - a.g.members.length
    || (a.terms[0] < b.terms[0] ? -1 : 1));
const out = {
  method: `fireworks-embeddings+cosine (${config.model})`,
  params: { tau: best.tau, seed: 7, target: 3000, spendApproved: true },
  corpus: 'novachip-trade-secret-3000',
  purityVsAuthored: Number(best.purity.score.toFixed(4)),
  purityNote: 'Measured against the corpus authored tags (template-assigned on background records), so the score partly reflects template structure. Grouping is neural; labels are lexical top terms.',
  clusters: ordered.map(({ g, terms }, idx) => {
    const ids = g.members.map((i) => docs[i].id).sort();
    const detail = best.purity.detail[best.groups.indexOf(g)];
    return {
      id: `fw-${String(idx + 1).padStart(2, '0')}`,
      label: terms.join(' / '),
      size: ids.length,
      majorityAuthored: detail.majority,
      majorityShare: Number((detail.majorityCount / ids.length).toFixed(3)),
      thin: ids.length < 5,
      recordIds: ids,
    };
  }),
};
if (!validateArtifact(out)) {
  console.log('artifact FAILED schema validation — not written.');
  process.exit(1);
}
writeFileSync(new URL('../data/concept-clusters-fireworks.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log('\nwrote app/data/concept-clusters-fireworks.json');

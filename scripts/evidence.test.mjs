/**
 * Durable tests for the generic evidence store (M3 prep, WS-A).
 * Run: node scripts/evidence.test.mjs
 */
import { readFileSync } from 'node:fs';
import { EvidenceStore } from '../src/evidence/store.ts';
import {
  FIXTURE_CUSTODIANS,
  FIXTURE_PEOPLE,
  FIXTURE_RECORDS,
} from '../src/evidence/fixtures.ts';

const truth = JSON.parse(
  readFileSync(new URL('../tests/ground-truth-fixture.json', import.meta.url), 'utf8'),
).plantedDefects;

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};
const throws = (fn) => {
  try { fn(); return false; } catch { return true; }
};

const store = new EvidenceStore(FIXTURE_PEOPLE, FIXTURE_CUSTODIANS, FIXTURE_RECORDS);

// Identity & integrity
check('store holds all fixture records', store.size === 8);
check('duplicate record id rejected', throws(() =>
  new EvidenceStore(FIXTURE_PEOPLE, FIXTURE_CUSTODIANS, [...FIXTURE_RECORDS, FIXTURE_RECORDS[0]])));
check('unknown custodian rejected', throws(() =>
  new EvidenceStore(FIXTURE_PEOPLE, FIXTURE_CUSTODIANS, [{ ...FIXTURE_RECORDS[0], id: 'fx-x', custodianId: 'nope' }])));
check('unknown person rejected', throws(() =>
  new EvidenceStore(FIXTURE_PEOPLE, FIXTURE_CUSTODIANS, [{ ...FIXTURE_RECORDS[0], id: 'fx-y', personIds: ['ghost'] }])));

// Retrieval & provenance
const hits = store.search('Atlas');
check('search returns planted Atlas set', JSON.stringify(hits.map((h) => h.recordId).sort()) === JSON.stringify([...truth.atlasRecordIds].sort()));
check('search excludes decoys', !hits.some((h) => truth.decoyRecordIds.includes(h.recordId)));
check('search excerpt contains match context', hits.every((h) => /atlas|Atlas/.test(h.excerpt + store.getRecord(h.recordId).title)));
check('empty search term returns nothing', store.search('  ').length === 0);
check('missing record returns undefined (not a throw)', store.getRecord('fx-999') === undefined);
check('provenance is inspectable', store.provenanceOf('fx-001')?.contentHash === 'fixture-hash-001');

// Determinism: identical call, identical ordered result
check('search is deterministic', JSON.stringify(store.search('Atlas')) === JSON.stringify(hits));

// Exact hit counts + identities (M3 search-correctness regression,
// owner Quest findings 2026-10-27: nonsense queries showed all 8)
const ids = (term) => store.search(term).map((h) => h.recordId).sort();
const sameIds = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());
check('preset March = exactly 5 known records', sameIds(ids('March'), ['fx-001', 'fx-002', 'fx-004', 'fx-006', 'fx-007']));
check('preset Invoice = exactly fx-004', sameIds(ids('Invoice'), ['fx-004']));
check('free-text catering = exactly fx-005', sameIds(ids('catering'), ['fx-005']));
check('free-text rota = exactly fx-008', sameIds(ids('rota'), ['fx-008']));
check('free-text schedule = exactly fx-007', sameIds(ids('schedule'), ['fx-007']));
check('nonsense query zzzzz = zero hits (never all records)', store.search('zzzzz').length === 0);
check('empty string = zero hits (Show All is not a search)', store.search('').length === 0);
check('case-insensitive: ATLAS = Atlas set', sameIds(ids('ATLAS'), truth.atlasRecordIds));
check('metadata person search: Casey = 4 known records',
  sameIds(ids('Casey'), ['fx-003', 'fx-004', 'fx-006', 'fx-008'])
  && store.search('Casey').every((h) => h.matchedIn.includes('metadata')));
check('metadata record-id search: fx-004 = itself only', sameIds(ids('fx-004'), ['fx-004']));
check('repeated March query is identical', JSON.stringify(store.search('March')) === JSON.stringify(store.search('March')));
check('corpus total stays 8 regardless of hits', store.size === 8 && ids('March').length === 5);

// Timeline & planted defects (ground truth lives only in tests/)
const timeline = store.timeline(truth.atlasRecordIds);
check('sentinel-dated record sorts first and is suspect',
  timeline[0].recordId === truth.sentinelDateRecordId && timeline[0].dateConfidence === 'suspect');
check('reply-before-original is flagged',
  timeline.find((e) => e.recordId === truth.replyBeforeOriginalRecordId)?.repliesBeforeOriginal === true);
check('missing ids are skipped by timeline', store.timeline(['fx-001', 'fx-999']).length === 1);

// Relationships
const related = store.related('fx-001');
check('relationships include reply and shared-person records', related.includes('fx-002') && related.includes('fx-004'));
check('relationships exclude the source record itself', !related.includes('fx-001'));
check('related() on missing record returns empty', store.related('fx-999').length === 0);
check('custodian filter works', store.recordsByCustodian('cust-a').length === 4);

// Spatial-intelligence analysis foundations (2026-10-27): identity and
// provenance must hold across every investigative view of the same records
const { communicationEdges, lexicalSimilarities, chronologyAnomalies, bridgeCandidates } = await import('../src/evidence/analysis.ts');
const edges = communicationEdges(FIXTURE_RECORDS);
check('communication network derives only observed co-occurrence edges',
  edges.length === 3 && edges.every((e) => e.basis === 'observed')
  && edges.find((e) => e.personA === 'p-alex' && e.personB === 'p-blair')?.weight === 2);
check('every edge record resolves in the store with provenance',
  edges.every((e) => e.recordIds.every((id) => store.has(id) && !!store.provenanceOf(id)?.contentHash)));
const sims = lexicalSimilarities(FIXTURE_RECORDS);
const topPair = sims[0];
check('lexical similarity ranks the planted thread highest, labelled derived',
  topPair.basis === 'derived'
  && [topPair.recordA, topPair.recordB].sort().join() === 'fx-001,fx-002'
  && topPair.sharedTerms.includes('atlas'));
const anomalies = chronologyAnomalies(store);
check('chronology anomalies surface planted defects (reply-first, sentinel)',
  anomalies.some((a) => a.recordId === 'fx-002' && a.kind === 'reply-before-original')
  && anomalies.some((a) => a.recordId === 'fx-003' && a.kind === 'sentinel-date'));
const bridges = bridgeCandidates(FIXTURE_RECORDS);
check('bridge candidates are derived-labelled, explained, and resolvable',
  bridges.every((b) => b.basis === 'derived' && b.explanation.includes(b.recordId)
    && store.has(b.recordId) && b.connects.every((id) => store.has(id))));
check('bridge detection is deterministic',
  JSON.stringify(bridgeCandidates(FIXTURE_RECORDS)) === JSON.stringify(bridges));
check('same record identity across search/timeline/edges views',
  store.search('Atlas').every((h) => store.getRecord(h.recordId)?.id === h.recordId)
  && store.timeline(['fx-001'])[0].recordId === 'fx-001');

// Expanded corpus (M3 reopened): deterministic, directed, bridged
const { buildCorpus } = await import('../src/evidence/corpus/generator.ts');
const { directedCommunicationEdges, personBridges } = await import('../src/evidence/analysis.ts');
const corpus = buildCorpus();
check('corpus generation is deterministic (same seed, byte-identical)',
  JSON.stringify(buildCorpus()) === JSON.stringify(corpus));
const bigStore = new EvidenceStore(corpus.people, corpus.custodians, corpus.records);
check('expanded corpus loads into the same store (112 records)', bigStore.size === 112);
const directed = directedCommunicationEdges(corpus.records);
check('directed edges come only from explicit roles (vic -> mara exists)',
  directed.some((e) => e.fromPersonId === 'p-vic' && e.toPersonId === 'p-mara')
  && directedCommunicationEdges(FIXTURE_RECORDS).length === 0);
const pBridges = personBridges(corpus.records);
const FIN = new Set(corpus.groundTruth.communities.finance);
const VEN = new Set(corpus.groundTruth.communities.vendor);
const touchesBoth = (b) => b.connectsPeople.some((p) => FIN.has(p)) && b.connectsPeople.some((p) => VEN.has(p));
check('planted bridge is exactly Priya (sole finance<->vendor connector)',
  pBridges.filter(touchesBoth).length === 1
  && pBridges.find(touchesBoth)?.personId === corpus.groundTruth.bridgePersonId);
const bigAnomalies = chronologyAnomalies(bigStore);
check('expanded corpus preserves planted chronology defects',
  bigAnomalies.some((a) => a.recordId === 'cx-002' && a.kind === 'reply-before-original')
  && bigAnomalies.some((a) => a.recordId === 'cx-003' && a.kind === 'sentinel-date'));
check('decoys stay out of Atlas search at corpus scale',
  !bigStore.search('Atlas').some((h) => corpus.groundTruth.decoyRecordIds.includes(h.recordId)));

// Corpus integration architecture: same adapter boundary, data swap only
const { loadExpandedCorpus } = await import('../src/evidence/corpus/index.ts');
const loaded = loadExpandedCorpus();
check('expanded corpus serves through the standard EvidenceAdapter',
  (await loaded.adapter.corpusSize()) === 112
  && (await loaded.adapter.search('reconciled chronology')).length >= 1
  && (await loaded.adapter.provenanceOf('cx-001'))?.collectionId === 'atlas-expanded-001');

console.log(failures === 0 ? '\nAll evidence tests passed.' : `\n${failures} evidence test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

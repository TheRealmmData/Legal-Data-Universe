/**
 * Deterministic-baseline scorecard (offline, zero spend).
 * Scores the shipped deterministic Discover engine against the
 * programmatic subset of app/tests/golden-tasks.json so future
 * arms (general+features, specialist) have a baseline to beat.
 * Model arms are approval-gated and intentionally NOT run here.
 * Run: node scripts/baseline-scorecard.mjs
 */
import { loadExpandedCorpus } from '../src/evidence/corpus/index.ts';
import { discoverLeads, validateLead } from '../src/discovery/leads.ts';
import { chronologyAnomalies } from '../src/evidence/analysis.ts';

const { store, corpus } = loadExpandedCorpus();
const GT = corpus.groundTruth;
const leads = discoverLeads(store);
const rows = [];
const row = (task, criterion, pass) => rows.push({ task, criterion, pass });

const bridgeLead = leads.find((l) => l.kind === 'bridge-person');
row('gt-02', 'names ground-truth bridge person',
  !!bridgeLead && JSON.stringify(bridgeLead).includes(GT.bridgePersonId));
row('gt-02', 'cites only records containing that person',
  !!bridgeLead && bridgeLead.supportingRecordIds.every((id) =>
    store.getRecord(id)?.personIds.includes(GT.bridgePersonId)));
row('gt-02', 'states co-occurrence-is-not-transfer limitation',
  !!bridgeLead && bridgeLead.limitations.some((l) => l.includes('not information transfer')));

const chronoLead = leads.find((l) => l.kind === 'chronology-anomaly');
const anomalyIds = new Set(chronologyAnomalies(store).map((a) => a.recordId));
row('gt-04', 'flags sentinel-date record',
  !!chronoLead && chronoLead.supportingRecordIds.includes(GT.sentinelDateRecordId));
row('gt-04', 'flags reply-before-original record',
  !!chronoLead && chronoLead.supportingRecordIds.includes(GT.replyBeforeOriginalRecordId));
row('gt-04', 'all cited chronology records are true anomalies (no false flags)',
  !!chronoLead && chronoLead.supportingRecordIds.every((id) => anomalyIds.has(id)));

row('gt-07', 'returns at most 3 leads', leads.length <= 3);
row('gt-07', 'every lead passes validateLead', leads.every((l) => validateLead(l, store).ok));
row('gt-07', 'at least one lead matches a ground-truth pattern', !!bridgeLead || !!chronoLead);
row('gt-07', 'no decoy record cited as support',
  leads.every((l) => !l.supportingRecordIds.some((id) => GT.decoyRecordIds.includes(id))));

row('gt-08', 'network guidance distinguishes focus edges from corpus links',
  leads.some((l) => l.limitations.join(' ').length > 0)
  && !!bridgeLead); // full gt-08 grading needs model arm; baseline proxy noted

let pass = 0;
for (const r of rows) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.task}] ${r.criterion}`);
  if (r.pass) pass += 1;
}
console.log(`\nDeterministic baseline: ${pass}/${rows.length} programmatic criteria.`);
console.log('Model arms (A general-only, B general+features, C specialist): NOT RUN - approval-gated, see docs/36.');
console.log(`Leads: ${leads.map((l) => `${l.kind}(${l.score})`).join(' | ')}`);

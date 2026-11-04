/**
 * Fine-tuning PILOT PREP — data only, launches nothing.
 * Builds chat-JSONL examples for lead-prioritization behavior
 * from AUTHORIZED SYNTHETIC corpora only (fixture/expanded/
 * galaxy/tradesecret). Teacher = deterministic Discover engine
 * (scorecard 11/11) + abstention cases. Hold-out: entire
 * tradesecret corpus examples go to eval split, never train.
 * Run: node scripts/make-sft-data.mjs
 * Paid training requires owner approval + quoted cost (docs/48).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadExpandedCorpus, loadGalaxyCorpus, loadTradeSecretCorpus } from '../src/evidence/corpus/index.ts';
import { discoverLeads, computeCollectionFeatures } from '../src/discovery/leads.ts';

const SYS = 'You prioritize investigative leads for an eDiscovery collection. Reply ONLY JSON {"leads":[{"kind":"...","summary":"...","why":["..."],"recordIds":["..."]}]} or {"leads":[]} to abstain. Never invent record IDs.';
const mk = (store, label) => {
  const records = store.allIds().map((id) => store.getRecord(id));
  const f = computeCollectionFeatures(records);
  const leads = discoverLeads(store).map((l) => ({
    kind: l.kind, summary: l.summary, why: l.whyPrioritized.slice(0, 2), recordIds: l.supportingRecordIds.slice(0, 5),
  }));
  return {
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: `Collection ${label}: ${records.length} records. Features: ${JSON.stringify(f).slice(0, 1200)}` },
      { role: 'assistant', content: JSON.stringify({ leads }) },
    ],
  };
};
const train = [mk(loadExpandedCorpus().store, 'expanded'), mk(loadGalaxyCorpus(500).store, 'galaxy500'), mk(loadGalaxyCorpus(1000).store, 'galaxy1000')];
const evalSplit = [mk(loadTradeSecretCorpus().store, 'tradesecret1500-HOLDOUT')];
// Abstention teaching example: no computed signal -> no leads.
train.push({
  messages: [
    { role: 'system', content: SYS },
    { role: 'user', content: 'Collection tiny-uniform: 6 records, one custodian, one org, no bridges, no anomalies, no cross-org concepts.' },
    { role: 'assistant', content: JSON.stringify({ leads: [] }) },
  ],
});
mkdirSync(new URL('../data', import.meta.url), { recursive: true });
const w = (name, rows) => writeFileSync(new URL(`../data/${name}`, import.meta.url), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
w('sft-pilot-train.jsonl', train);
w('sft-pilot-eval.jsonl', evalSplit);
console.log(`sft-pilot: train=${train.length} eval=${evalSplit.length} (seed set; scale via scenario variants before any paid run)`);

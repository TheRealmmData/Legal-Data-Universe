/**
 * Galaxy stability stress (desktop proxy evidence — NOT Quest proof).
 * Simulates the owner's crash sequence at 1,000 records:
 * search -> step hits -> inspect -> clear, repeated, measuring the
 * synchronous CPU work each cycle performs (layout recompute,
 * exhaustive search, discovery, chronology). GPU/Quest stability
 * can only be owner-verified on-device.
 * Run: node scripts/stress-galaxy.mjs
 */
import { loadGalaxyCorpus } from '../src/evidence/corpus/index.ts';
import { galaxyPositions } from '../src/galaxy/layout.ts';
import { discoverLeads, personOrganizations } from '../src/discovery/leads.ts';
import { chronologyAnomalies } from '../src/evidence/analysis.ts';
import { SearchSession } from '../src/investigation/search-session.ts';
import { InvestigationState } from '../src/investigation/state.ts';

const { store, adapter } = loadGalaxyCorpus(1000);
const state = new InvestigationState();
const session = new SearchSession(adapter, state);
const records = store.allIds().map((id) => store.getRecord(id));
const personOrgs = personOrganizations(records);
const inputs = records.map((r) => ({
  id: r.id, date: r.date, org: r.organizationIds?.[0] ?? r.custodianId,
  concept: r.conceptTags?.[0] ?? '', custodian: r.custodianId, kind: r.kind,
  participantOrgs: [...new Set(r.personIds.flatMap((p) => [...(personOrgs.get(p) ?? [])]))],
}));

const CYCLES = 25;
let worst = 0;
const t0 = Date.now();
for (let cycle = 0; cycle < CYCLES; cycle += 1) {
  const start = performance.now();
  const hits = await session.query(cycle % 2 ? 'Atlas' : 'Priya');
  for (let step = 0; step < 5; step += 1) session.nextHit();
  if (hits[0]) await session.open(hits[0].recordId);
  galaxyPositions(inputs, 'evidence');
  galaxyPositions(inputs, 'chronology');
  chronologyAnomalies(store);
  session.clearSearch();
  galaxyPositions(inputs, 'evidence');
  worst = Math.max(worst, performance.now() - start);
}
const total = Date.now() - t0;
const leadsStart = performance.now();
discoverLeads(store);
console.log(`cycles=${CYCLES} totalMs=${total} avgCycleMs=${(total / CYCLES).toFixed(1)} worstCycleMs=${worst.toFixed(1)} discoverMs=${(performance.now() - leadsStart).toFixed(1)}`);
console.log('PASS  stress cycles completed without error (desktop CPU proxy only)');

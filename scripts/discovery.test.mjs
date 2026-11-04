/**
 * Discover lead engine tests (M4 direction scaffolding, 2026-10-28).
 * The deterministic prioritizer must: surface the planted bridge as
 * a lead on the expanded corpus, ground every lead in real records,
 * abstain on signal-free data, and reject fabricated model leads
 * through the same contract gate any future model route must pass.
 * Run: node scripts/discovery.test.mjs
 */
import {
  loadExpandedCorpus, loadGalaxyCorpus, loadTradeSecretCorpus,
} from '../src/evidence/corpus/index.ts';
import { galaxyPositions, orgAnchors, conceptAnchors, custodianAnchors, fileTypeAnchors } from '../src/galaxy/layout.ts';
import { personOrganizations } from '../src/discovery/leads.ts';
import {
  collectionProfile, directedCommunicationEdges, personCounterparties, personHubSummaries, replyLinks,
} from '../src/evidence/analysis.ts';
import { pickDetailedSlot, pickNearest } from '../src/galaxy/picking.ts';
import { EvidenceStore } from '../src/evidence/store.ts';
import {
  FIXTURE_CUSTODIANS, FIXTURE_PEOPLE, FIXTURE_RECORDS,
} from '../src/evidence/fixtures.ts';
import {
  discoverLeads, validateLead, computeCollectionFeatures, expandFocusForLead,
} from '../src/discovery/leads.ts';
import { secMissingFields } from '../src/evidence/sec-fields.ts';
import { recordDomainCheck } from '../src/evidence/corpus/index.ts';
import { routeQuestion } from '../src/ai/query-router.ts';
import { emptyMemory, rememberNote, resetDurable, noteSearch } from '../src/investigation/matter-memory.ts';
import { runReyesInvestigation } from '../src/agents/orchestrator.ts';
import { verifyAssessment } from '../src/agents/quality-control.ts';
import { investigateQuestion } from '../src/agents/investigate-leads.ts';
import { makeZip } from '../src/agents/zip.ts';

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

const { store, corpus } = loadExpandedCorpus();
const GT = corpus.groundTruth;
const leads = discoverLeads(store);
console.log(`  [leads] ${leads.map((l) => `${l.kind}(${l.score})`).join(' | ')}`);

check('expanded corpus yields 1-3 leads (never manufactures more)',
  leads.length >= 1 && leads.length <= 3);
check('every emitted lead passes the contract gate against its own store',
  leads.every((l) => validateLead(l, store).ok));
check('a bridge-person lead names the planted ground-truth bridge',
  leads.some((l) => l.kind === 'bridge-person'
    && JSON.stringify(l).includes(GT.bridgePersonId)));
check('a chronology lead covers the planted date defects',
  leads.some((l) => l.kind === 'chronology-anomaly'
    && (l.supportingRecordIds.includes(GT.sentinelDateRecordId)
      || l.supportingRecordIds.includes(GT.replyBeforeOriginalRecordId))));
check('all supporting record IDs resolve in the store',
  leads.every((l) => l.supportingRecordIds.every((id) => store.has(id))));
check('leads carry limitations and a runnable suggested action',
  leads.every((l) => l.limitations.length > 0 && l.suggestedAction.question.length > 0
    && l.suggestedAction.focusRecordIds.length > 0));
check('discovery is deterministic (identical leads on repeat)',
  JSON.stringify(discoverLeads(store)) === JSON.stringify(leads));
check('scores are ranked descending and priorities derive from score',
  leads.every((l, i) => i === 0 || leads[i - 1].score >= l.score));

const fixtureStore = new EvidenceStore(FIXTURE_PEOPLE, FIXTURE_CUSTODIANS, FIXTURE_RECORDS);
const fixtureLeads = discoverLeads(fixtureStore);
check('fixture corpus leads (if any) are all valid',
  fixtureLeads.every((l) => validateLead(l, fixtureStore).ok));

// Abstention: unrelated records with no shared people/tags/structure.
const quiet = new EvidenceStore(
  [{ id: 'p1', displayName: 'P1' }, { id: 'p2', displayName: 'P2' }, { id: 'p3', displayName: 'P3' }],
  [{ id: 'c1', displayName: 'C1' }],
  ['a', 'b', 'c', 'd'].map((id, i) => ({
    id, kind: 'note', title: `Note ${id}`, body: `Routine item ${id}`,
    date: `2026-0${i + 1}-15`, dateConfidence: 'verified', custodianId: 'c1',
    personIds: [`p${(i % 3) + 1}`],
    provenance: { sourceSystem: 'test', collectionId: 'quiet', contentHash: `h-${id}`, ingestedAt: '2026-01-01T00:00:00Z' },
  })),
);
check('signal-free corpus yields zero leads (abstention, not filler)',
  discoverLeads(quiet).length === 0);

// Contract gate rejects fabricated model output.
const fabricated = {
  ...leads[0],
  supportingRecordIds: ['cx-999-invented'],
};
check('validator rejects a lead citing a nonexistent record',
  !validateLead(fabricated, store).ok);
check('validator rejects a lead without limitations',
  !validateLead({ ...leads[0], limitations: [] }, store).ok);

// Lead selection reorganizes space around the evidence neighborhood.
const chronoLead = leads.find((l) => l.kind === 'chronology-anomaly');
const chronoFocus = chronoLead ? expandFocusForLead(store, chronoLead) : [];
check('explored chronology lead expands beyond its cited records (sequence context)',
  chronoFocus.length > chronoLead.supportingRecordIds.length
  && chronoLead.supportingRecordIds.every((id) => chronoFocus.includes(id))
  && chronoFocus.length <= 8);
const bridgeLead = leads.find((l) => l.kind === 'bridge-person');
const bridgeFocus = bridgeLead ? expandFocusForLead(store, bridgeLead) : [];
const bridgeOrgs = new Set(bridgeFocus.map((id) => {
  const r = store.getRecord(id);
  return r?.organizationIds?.[0] ?? r?.custodianId;
}));
check('explored bridge lead focus spans multiple organizations with cited records first',
  bridgeOrgs.size >= 2 && bridgeFocus[0] === bridgeLead.suggestedAction.focusRecordIds[0]);

const features = computeCollectionFeatures(
  store.allIds().map((id) => store.getRecord(id)),
);
check('collection features cover all 112 records with role metadata',
  features.recordCount === 112 && features.recordsWithRoles > 0 && features.suspectDateCount >= 1);

// Galaxy layouts + 500-record corpus scaling (M3, 2026-10-29).
const galaxy = loadGalaxyCorpus(500);
check('galaxy corpus parameter yields exactly 500 records', galaxy.store.size === 500);
const gRecords = galaxy.store.allIds().map((id) => galaxy.store.getRecord(id));
const gPersonOrgs = personOrganizations(gRecords);
const gInputs = gRecords.map((r) => ({
  id: r.id, date: r.date,
  org: r.organizationIds?.[0] ?? r.custodianId,
  concept: r.conceptTags?.[0] ?? '', custodian: r.custodianId, kind: r.kind,
  participantOrgs: [...new Set(r.personIds.flatMap((p) => [...(gPersonOrgs.get(p) ?? [])]))],
}));
const t0 = Date.now();
const evPos = galaxyPositions(gInputs, 'evidence');
const chPos = galaxyPositions(gInputs, 'chronology');
const nwPos = galaxyPositions(gInputs, 'network');
const layoutMs = Date.now() - t0;
check('all 500 records positioned in every lens, within radius bounds',
  [evPos, chPos, nwPos].every((m) => m.size === 500
    && [...m.values()].every((p) => p.radius > 2.6 && p.radius < 11.1)));
check('all nodes inside the waist-to-head comfort band (no below-platform nodes)',
  [evPos, chPos, nwPos].every((m) => [...m.values()].every((p) => Math.abs(p.position[1]) <= 0.75)));
check('galaxy layouts are deterministic',
  JSON.stringify([...galaxyPositions(gInputs, 'evidence').entries()])
    === JSON.stringify([...evPos.entries()]));
const orgMeanAz = [...new Set(gInputs.map((r) => r.org))].map((org) => {
  const azs = gInputs.filter((r) => r.org === org).map((r) => evPos.get(r.id).azimuth);
  return Math.atan2(
    azs.reduce((s, a) => s + Math.sin(a), 0), azs.reduce((s, a) => s + Math.cos(a), 0));
});
check('organization territories are azimuthally separated',
  orgMeanAz.every((a, i) => orgMeanAz.every((b, j) => i === j
    || Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 0.5)));
const byDate = [...gInputs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
check('chronology radius grows monotonically with stored date',
  byDate.every((r, i) => i === 0
    || chPos.get(r.id).radius >= chPos.get(byDate[i - 1].id).radius - 0.45));
check('evidence layout uses real vertical dimension (elevation spread > 1 rad)',
  (() => {
    const els = [...evPos.values()].map((p) => p.elevation);
    return Math.max(...els) - Math.min(...els) > 1.0;
  })());
check('org anchors exist for every organization with counts',
  orgAnchors(gInputs).every((a) => a.count > 0)
  && orgAnchors(gInputs).reduce((s, a) => s + a.count, 0) === 500);
console.log(`  [perf] 3 layouts x 500 records in ${layoutMs}ms`);

// Network relationship audit (M3 forensic, 2026-10-29): pin the
// genuine relationship inventory so the Network lens can never
// silently lose (or invent) connections. Counts measured by
// scripts/network-audit.mjs on Galaxy 1000.
const g1000 = loadGalaxyCorpus(1000);
const r1000 = g1000.store.allIds().map((id) => g1000.store.getRecord(id));
const channels = directedCommunicationEdges(r1000);
const hubs = personHubSummaries(r1000);
const replies = replyLinks(r1000);
check('network audit: 29 genuine directed channels among 11 people at 1000',
  channels.length === 29 && hubs.length === 11);
check('network audit: channel weights cover every sender-recipient record',
  channels.reduce((s, e) => s + e.weight, 0) >= 995);
check('network audit: reply links resolve to inspectable records only',
  replies.length === 4 && replies.every((l) => g1000.store.getRecord(l.toRecordId)));
check('network audit: hub sent/received counts are role-grounded',
  hubs.every((h) => h.sent + h.received > 0)
  && hubs.reduce((s, h) => s + h.sent, 0) >= 995
  && hubs.reduce((s, h) => s + h.received, 0) === channels.reduce((s, e) => s + e.weight, 0));
const nwInputs = r1000.map((r) => ({
  id: r.id, date: r.date,
  org: r.organizationIds?.[0] ?? r.custodianId,
  concept: r.conceptTags?.[0] ?? '', custodian: r.custodianId, kind: r.kind,
  participantOrgs: [...new Set(r.personIds.flatMap((p) => [...(personOrganizations(r1000).get(p) ?? [])]))],
  sender: r.participants?.find((p) => p.role === 'sender' || p.role === 'author')?.personId,
}));
const nw1000 = galaxyPositions(nwInputs, 'network');
check('network layout has volumetric depth (world height + radius spread)',
  (() => {
    const ys = [...nw1000.values()].map((p) => p.position[1]);
    const rs = [...nw1000.values()].map((p) => p.radius);
    return Math.max(...ys) - Math.min(...ys) > 0.85
      && Math.max(...rs) - Math.min(...rs) > 7;
  })());
check('network depth stays inside the comfort band at 1000',
  [...nw1000.values()].every((p) => Math.abs(p.position[1]) <= 0.75));

// Collection analytics regressions (the four owner questions,
// 2026-10-30): exact numbers from stored metadata, honest gaps.
{
  const profile = collectionProfile(r1000);
  check('analytics: exact email count from kind metadata',
    profile.total === 1000 && profile.byKind.find((k) => k.kind === 'email')?.count === 687);
  check('analytics: biggest custodian is cust-ops at 375',
    profile.byCustodian[0].custodianId === 'cust-ops' && profile.byCustodian[0].count === 375);
  check('analytics: Word count honestly not determinable (no MIME fields)',
    profile.fileTypeNote.includes('NOT determinable')
    && profile.byKind.find((k) => k.kind === 'document')?.count === 3);
  const priya = personCounterparties(r1000, 'p-priya');
  check('analytics: Priya top counterparty is p-tom with 37 exchanges + examples',
    priya[0].personId === 'p-tom' && priya[0].total === 37 && priya[0].exampleRecordIds.length > 0);
}

// Trade-secret demo universe (M4 final): 3000 records, SEC
// metadata, authored story + counterevidence resolvable.
{
  const ts = loadTradeSecretCorpus();
  const recs = ts.store.allIds().map((id) => ts.store.getRecord(id));
  const profile = collectionProfile(recs);
  check('trade-secret corpus: 3000 records, every record load-file complete',
    recs.length === 3000 && recs.every((r) => r.loadFile?.bates && r.loadFile?.md5 && r.loadFile?.mimeType));
  check('trade-secret corpus: Word (docx) count is computable and > 0',
    (profile.byExtension?.find((e) => e.extension === 'docx')?.count ?? 0) > 0);
  check('trade-secret corpus: story + counterevidence all resolve',
    [...ts.corpus.groundTruth.relevantRecordIds, ...ts.corpus.groundTruth.counterevidenceRecordIds]
      .every((id) => ts.store.getRecord(id)));
  check('trade-secret corpus: bodies are substantially unique (not 24 templates)',
    new Set(recs.map((r) => r.body)).size > 1000);
  // Corpus integrity (Round 2): 1500 RECORDS are unique by ID;
  // unique-BODY count is lower by design (near-duplicate bodies
  // with distinct metadata mirror real collections: forwards,
  // recurring reports). IDs/Bates never repeat.
  check('trade-secret corpus: 3000 unique record IDs and internal numbers',
    new Set(recs.map((r) => r.id)).size === 3000
    && new Set(recs.map((r) => r.loadFile.bates)).size === 3000);
  // Phrase search (Round 2 #4): exact phrase, quotes optional,
  // hyphen/space equivalent.
  const phrase = ts.store.searchWithCount('source code', 5000);
  const quoted = ts.store.searchWithCount('"source code"', 5000);
  const hyphen = ts.store.searchWithCount('source-code', 5000);
  check('phrase search: "source code" returns verified hits (>50) on TS corpus',
    phrase.totalMatches > 50 && quoted.totalMatches === phrase.totalMatches
    && hyphen.totalMatches === phrase.totalMatches);
  // Individual custodians (Round 3): SEC custodians are people.
  const custNames = new Set(recs.map((r) => r.loadFile.sec.custodian));
  console.log(`  TS3000 individual custodians: ${[...custNames].slice(0, 4).join('; ')} … (${custNames.size})`);
  check('custodians are individuals (12 people), never departments',
    custNames.size === 12 && ![...custNames].some((n) => /Engineering|Legal matter|productions|shared/.test(n)));
  check('custodian profile tallies equal direct record counts',
    profile.byCustodian.every((c) => c.count === recs.filter((r) => r.custodianId === c.custodianId).length));
  // Leads are collection-specific (Round 2 #1): leads computed
  // on the TS store reference TS people/records only.
  const tsLeads = discoverLeads(ts.store);
  check('TS leads: generated from active TS collection (no fixture refs)',
    tsLeads.length > 0
    && tsLeads.every((l) => l.supportingRecordIds.every((id) => ts.store.getRecord(id)))
    && !tsLeads.some((l) => /Priya|Atlas/i.test(l.summary)));
  // Custodians lens (Round 2 #6): positions compute for all.
  const tsPersonOrgs = personOrganizations(recs);
  const custInputs = recs.map((r) => ({
    id: r.id, date: r.date,
    org: r.organizationIds?.[0] ?? r.custodianId,
    concept: r.conceptTags?.[0] ?? '', custodian: r.custodianId, kind: r.kind,
    participantOrgs: [...new Set(r.personIds.flatMap((p) => [...(tsPersonOrgs.get(p) ?? [])]))],
  }));
  check('custodians lens: layout covers every TS record',
    galaxyPositions(custInputs, 'custodians').size === 3000);
  // Owner session 2026-11-01: time flows OUTWARD in every lens
  // (earliest nearest the platform, latest farthest); concept
  // clusters separate vertically by concept; per-group anchors
  // cover custodians + file types, not just orgs/concepts.
  const evTs = galaxyPositions(custInputs, 'evidence');
  const byDateTs = [...custInputs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  check('radial date intuition: earliest nearer than latest (evidence lens)',
    (evTs.get(byDateTs[0].id)?.radius ?? 99) < (evTs.get(byDateTs[byDateTs.length - 1].id)?.radius ?? -1));
  const coTs = galaxyPositions(custInputs, 'concepts');
  const coElev = new Map();
  for (const i of custInputs) {
    const e = coTs.get(i.id)?.position?.[1] ?? 0;
    if (!coElev.has(i.concept)) coElev.set(i.concept, []);
    coElev.get(i.concept).push(e);
  }
  // Owner superseded the height staircase (2026-11-01): each
  // cluster must FILL the head-to-waist band instead. Assert
  // within-cluster WORLD-height spread for most concepts.
  const coSpans = [...coElev.values()]
    .filter((es) => es.length >= 20)
    .map((es) => Math.max(...es) - Math.min(...es));
  const wideClusters = coSpans.filter((span) => span > 0.5).length;
  check('concepts lens: clusters fill the head-to-waist band (within-cluster span)',
    coSpans.length > 0 && wideClusters === coSpans.length);
  check('custodian + file-type anchors cover every group with counts',
    custodianAnchors(custInputs).reduce((s, a) => s + a.count, 0) === 3000
    && fileTypeAnchors(custInputs.map((i) => ({ ...i, fileType: 'MSG' }))).every((a) => a.count > 0));
  // SEC validation: every applicable field populated, Bates blank.
  const secBad = recs.filter((r) => secMissingFields(r).length > 0);
  if (secBad.length) console.log('  SEC sample failures:', secMissingFields(secBad[0]));
  check('SEC metadata: applicable fields populated on all 3000, Bates blank',
    secBad.length === 0 && recs.every((r) => r.loadFile.sec.firstBates === '' && r.loadFile.sec.extractedText === r.body));
  // Domain-verified coloring (owner session 2026-11-01):
  // sender mailbox domain vs record org domain. NovaChip
  // sub-orgs share novachip.com by design, so company-level
  // verification passes corpus-wide; sender home-org vs record
  // org mismatches are the explained cross-functional set
  // (ts-014: HR-authored record in the Legal matter).
  const domainBad = recs.map((r) => ({ r, check: recordDomainCheck(r) }))
    .filter(({ check }) => !check.domainOk);
  const crossFunc = recs.filter((r) => {
    const c = recordDomainCheck(r);
    return c.domainOk && !c.homeOrgOk;
  });
  check('domain verification: sender domains resolve on all 3000',
    recs.every((r) => recordDomainCheck(r).senderDomain.includes('@')));
  check('domain verification: company-level match on all 3000',
    domainBad.length === 0);
  check('domain verification: cross-functional set is tiny and explained (ts-014)',
    crossFunc.length >= 1 && crossFunc.length < 30
    && crossFunc.some((r) => r.id === 'ts-014'));
  console.log(`  domain: ${recs.length - domainBad.length}/${recs.length} company-verified; cross-functional: ${crossFunc.map((r) => r.id).slice(0, 5).join(', ')}`);
  // Deterministic query router (final run examples).
  const rText = routeQuestion(ts.store, 'Find documents containing source code');
  const rSender = routeQuestion(ts.store, 'List documents where Reyes is the sender');
  const rTop = routeQuestion(ts.store, 'Who are the top three people Reyes emailed?');
  const rJune = routeQuestion(ts.store, 'Show documents created in June');
  const rCust = routeQuestion(ts.store, 'Which custodians have Falcon documents?');
  const rNav = routeQuestion(ts.store, 'Go to the chronology lens');
  const rMem = routeQuestion(ts.store, 'remember: focus on June exfiltration window');
  console.log(`  router: text=${rText?.recordIds.length} sender=${rSender?.recordIds.length} june=${rJune?.recordIds.length}`);
  console.log(`  router top: ${rTop?.lines.slice(1, 3).join(' | ')}`);
  check('router: text/metadata/aggregation/date/hybrid/navigate/memory routes',
    rText?.route === 'text' && rText.recordIds.length > 50
    && rSender?.route === 'metadata' && rSender.recordIds.length > 0
    && rTop?.route === 'aggregation' && /sent \d+/.test(rTop.lines.join(' '))
    && rJune?.route === 'metadata' && rJune.recordIds.length > 0
    && rCust?.route === 'hybrid'
    && rNav?.lens === 'chronology'
    && rMem?.memoryAction === 'remember');
  // Matter memory: durable only by explicit remember; resettable.
  let mem = rememberNote(emptyMemory(), 'objective: Reyes June window');
  mem = noteSearch(mem, 'source code');
  check('matter memory: remember + session tiers + reset',
    mem.durableNotes.length === 1 && mem.sessionSearches.length === 1
    && resetDurable(mem).durableNotes.length === 0);
  // Multi-specialist orchestrated investigation (M4 target):
  // one reliable E2E — Reyes external-transfer assessment.
  const inv = runReyesInvestigation(ts.store);
  const verdicts = Object.fromEntries(inv.reasoning.hypotheses.map((h) => [h.id, h.verdict]));
  console.log(`  orchestrator: status=${inv.status} verdicts=${JSON.stringify(verdicts)} drafts=${inv.workProduct?.draftFindings.length}`);
  console.log(`  orchestrator audit: ${inv.audit.map((a) => a.actor).join(' -> ')}`);
  check('orchestrator: H1+H2+H3 supported (direct send + fingerprint + receipt), QC pass',
    inv.status === 'complete' && inv.qc.ok
    && verdicts['H1-acquisition'] === 'supported'
    && verdicts['H2-external-transfer-tuning'] === 'supported'
    && verdicts['H3-source-code-exfiltration'] === 'supported');
  check('orchestrator: work product = 3 supported drafts, expanded search report, ID list',
    inv.workProduct?.draftFindings.length === 3
    && inv.workProduct.draftFindings.every((d) => d.verdict === 'supported' && d.demoStep >= 1 && d.demoStep <= 3)
    && inv.workProduct.searchReport.bundles.length === 11
    && inv.workProduct.documentIdList.count > 100);
  check('orchestrator: every citation quote is verbatim in its record',
    inv.workProduct.draftFindings.every((d) => d.citations.every((c) => ts.store.getRecord(c.recordId)?.body.includes(c.quote))));
  // QC independence: a fabricated quote must fail the gate.
  const tampered = structuredClone(inv.reasoning);
  tampered.hypotheses[0].support[0].quote = 'Reyes definitely sent scheduler_core.ts to HelixWorks on June 20.';
  check('QC: fabricated quote is rejected',
    verifyAssessment(ts.store, inv.retrieval, tampered).output.ok === false);
  // Router claims the investigation question for the orchestrator.
  check('router: Reyes assessment claimed as investigation route',
    routeQuestion(ts.store, 'Assess whether Elena Reyes transferred Falcon source code externally')?.route === 'investigation');
  // Question-driven leads (owner vision): different questions
  // must produce meaningfully different investigations.
  const q1 = investigateQuestion(ts.store, 'Was Reyes emailing people about Falcon?');
  const q2 = investigateQuestion(ts.store, 'Are there any late night emails?');
  const q3 = investigateQuestion(ts.store, 'Who knew about the resignation and when did they know it?');
  console.log(`  leads q1: ${q1.leads.map((l) => l.title.slice(0, 40)).join(' | ')}`);
  console.log(`  leads q2: ${q2.leads.map((l) => l.title.slice(0, 40)).join(' | ')}`);
  console.log(`  leads q3: ${q3.leads.map((l) => l.title.slice(0, 40)).join(' | ')}`);
  check('investigate: different questions -> different lead titles and evidence',
    q1.leads.length >= 2 && q2.leads.length >= 2 && q3.leads.length >= 2
    && q1.leads[0].title !== q2.leads[0].title
    && q2.parsed.intents.includes('late-night')
    && q3.parsed.intents.includes('who-knew-when')
    && q1.leads.every((l) => l.benignAlternative.length > 0 && l.limitations.length > 0)
    && q1.leads[0].citations.every((c) => ts.store.getRecord(c.recordId)?.body.includes(c.quote)));
  // ZIP export: valid local-header magic + central directory.
  const zip = makeZip([{ name: 'a.csv', text: 'DocID\nts-001\n' }, { name: 'b.json', text: '{}' }]);
  const zipBytes = new Uint8Array(await zip.arrayBuffer());
  check('zip: PK headers present',
    zipBytes[0] === 0x50 && zipBytes[1] === 0x4b && zipBytes.length > 100);
  // File-types lens covers all records incl. unknown grouping.
  check('filetypes lens: layout covers every TS record',
    galaxyPositions(custInputs.map((i) => ({ ...i, fileType: 'MSG' })), 'filetypes').size === 3000);
}

// Picking (P0.2 headset defect): near MR nodes must be selectable,
// far nodes keep working, and during search the aimed HIT wins
// over a nearer non-hit in front of it.
{
  const ids = ['near-nonhit', 'far-hit', 'side-node'];
  const positions = new Float32Array([
    0, 0, -0.5, // near, dead ahead (local; MR scale 0.38 -> 0.19m)
    0.07, 0, -3, // far hit, slightly more off-axis than near node below
    1.5, 0, -3, // off to the side
  ]);
  const base = {
    positions, ids, meshPosition: [0, 1.35, 0], meshScale: 0.38,
    origin: [0, 1.35, 0], dir: [0, 0, -1],
  };
  check('picking: near MR node is selectable (no fixed 0.25m exclusion)',
    pickNearest(base)?.id === 'near-nonhit');
  // Off-axis near non-hit (score ~0.49) vs far hit (~0.58 raw):
  // only the search-hit preference makes the hit win.
  const aimed = new Float32Array([0.058, 0, -0.5, 0.07, 0, -3, 1.5, 0, -3]);
  check('picking: without search, nearer node wins',
    pickNearest({ ...base, positions: aimed })?.id === 'near-nonhit');
  check('picking: aimed search HIT wins over nearer non-hit',
    pickNearest({ ...base, positions: aimed, hitIds: new Set(['far-hit']) })?.id === 'far-hit');
  check('picking: empty ray picks nothing',
    pickNearest({ ...base, dir: [0, 1, 0] }) === undefined);
  check('picking: VR scale far node still selectable',
    pickNearest({ ...base, meshScale: 1, dir: [0.02, 0, -1] })?.id != null);
  check('picking: hovered node keeps the pick under jitter (preferredId)',
    pickNearest({ ...base, positions: aimed, preferredId: 'far-hit' })?.id === 'far-hit');
}

// Detailed slot orbs use the same controller/gaze candidate rays,
// so handheld examination is point-and-trigger rather than a
// separate squeeze-only path.
{
  const slots = [
    { recordId: 'slot-hidden', position: [0, 1.4, -1], radius: 0.09, visible: false },
    { recordId: 'slot-center', position: [0.03, 1.4, -1.2], radius: 0.09, visible: true },
    { recordId: 'slot-side', position: [0.5, 1.4, -1.2], radius: 0.09, visible: true },
    { recordId: undefined, position: [0, 1.4, -0.8], radius: 0.09, visible: true },
  ];
  check('slot picking: pointed visible orb wins over nearer unbound/hidden slots',
    pickDetailedSlot({ slots, origin: [0, 1.4, 0], dir: [0, 0, -1] })?.recordId === 'slot-center');
  check('slot picking: ray away from every orb picks nothing',
    pickDetailedSlot({ slots, origin: [0, 1.4, 0], dir: [0, 1, 0] }) === undefined);
}

console.log(failures === 0 ? '\nAll discovery tests passed.' : `\n${failures} discovery test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

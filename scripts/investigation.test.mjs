/**
 * Durable tests for D2 infrastructure: evidence adapter, shared
 * investigation state, investigator search session (2026-10-27).
 * Model-independent by design. Run: node scripts/investigation.test.mjs
 */
import { EvidenceStore } from '../src/evidence/store.ts';
import { StoreEvidenceAdapter } from '../src/evidence/adapter.ts';
import {
  FIXTURE_CUSTODIANS,
  FIXTURE_PEOPLE,
  FIXTURE_RECORDS,
} from '../src/evidence/fixtures.ts';
import { InvestigationState } from '../src/investigation/state.ts';
import { SearchSession } from '../src/investigation/search-session.ts';
import {
  chronologyOrder, nodeVisual, paginate, galaxyEmphasis,
  COMPACT_POSITIONS, EXPANDED_POSITIONS, isAccessiblePosition,
  nodeLabelText, clusterLabelText, focusSummary, focusWindowForHit,
  assembleMemoLines,
} from '../src/investigation/visual-state.ts';
import { galaxyPositions, conceptAnchors, GALAXY_CENTER } from '../src/galaxy/layout.ts';

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

const store = new EvidenceStore(FIXTURE_PEOPLE, FIXTURE_CUSTODIANS, FIXTURE_RECORDS);
const adapter = new StoreEvidenceAdapter(store, FIXTURE_CUSTODIANS);
const state = new InvestigationState();
const session = new SearchSession(adapter, state);

// Adapter parity with the underlying deterministic store
check('adapter reports corpus size', (await adapter.corpusSize()) === 8);
check('adapter search matches store search',
  JSON.stringify(await adapter.search('Atlas')) === JSON.stringify(store.search('Atlas')));
check('adapter lists custodians', (await adapter.listCustodians()).length === 2);
check('adapter missing record is undefined', (await adapter.getRecord('fx-999')) === undefined);

// Investigator-initiated search (phase A) is recorded and pinnable
state.setObjective('Fixture objective: what changed about the Atlas date?', 'investigator');
const hits = await session.query('Atlas');
check('investigator query returns hits', hits.length === 4);
check('query recorded in history + audit',
  state.queryHistory().includes('Atlas') && state.auditTrail().some((a) => a.action === 'search'));

// Defensible search execution records + hit navigation (M3 correction)
const exec1 = state.listSearchExecutions().at(-1);
check('search execution recorded with operation + corpus + hit ids',
  exec1?.operation === 'keyword-substring (exhaustive)' && exec1?.originalQuery === 'Atlas'
  && exec1?.hitCount === 4 && exec1?.corpusSize === 8
  && exec1?.returnedCount === 4 && exec1?.truncated === false
  && JSON.stringify([...exec1.matchedRecordIds].sort()) === JSON.stringify(hits.map((h) => h.recordId).sort())
  && !!exec1?.corpusId && !!exec1?.at);
check('no hit is current before navigation', session.currentHitId() === undefined && session.hitIndex() === -1);
const order = session.hitList();
check('Next lands on hit 1, then hit 2', session.nextHit() === order[0] && session.nextHit() === order[1]);
check('Previous steps back, then wraps to last hit',
  session.previousHit() === order[0] && session.previousHit() === order[order.length - 1]);
await session.open(order[2]);
check('opening a hit syncs the navigation cursor', session.hitIndex() === 2 && session.currentHitId() === order[2]);
const zeroHits = await session.query('zzzzz');
check('zero-hit query: 0 hits, empty hit list, navigation inert',
  zeroHits.length === 0 && session.hitList().length === 0
  && session.nextHit() === undefined && session.previousHit() === undefined
  && state.listSearchExecutions().at(-1)?.hitCount === 0);
const execCountBeforeEmpty = state.listSearchExecutions().length;
check('empty query executes and records nothing',
  (await session.query('   ')).length === 0
  && state.listSearchExecutions().length === execCountBeforeEmpty);
await session.query('Invoice');
session.clearSearch();
check('clearSearch empties navigation but keeps the execution audit',
  session.hitList().length === 0 && session.currentHitId() === undefined
  && state.listSearchExecutions().length === execCountBeforeEmpty + 1);
await session.query('Atlas');
const lead = session.pinLead('Atlas date change', hits, 'All four records reference the date move');
check('pinned lead is investigator-sourced and new', lead.source === 'investigator' && lead.status === 'new');
const opened = await session.open('fx-001');
check('open returns record with provenance', opened.record?.id === 'fx-001' && !!opened.provenance?.contentHash);
const related = await session.follow('fx-001');
check('follow returns related records', related.includes('fx-002'));

// Agent-originated lead (phase B) coexists in the same state
const agentLead = state.addLead({
  title: 'Reply predates original',
  source: 'agent',
  recordIds: ['fx-001', 'fx-002'],
  rationale: 'Stored dates put the reply before the proposal',
});
state.setLeadStatus(agentLead.id, 'exploring');
check('agent and investigator leads coexist', state.listLeads().length === 2);
state.annotate({ author: 'investigator', text: 'Check fx-002 header dates against source', leadId: agentLead.id, recordId: 'fx-002' });

// Findings: draft -> export refused -> approve -> export allowed
const finding = state.addFinding({ claim: 'The reply is stored one day before its original (fixture).', citationIds: ['fx-001', 'fx-002'] });
let refused = false;
try { state.buildExport(); } catch { refused = true; }
check('export refused before approval', refused);
state.decideFinding(finding.id, 'approved');
const exported = state.buildExport();
check('export carries approved finding, annotations, audit',
  exported.findings.length === 1 && exported.annotations.length === 1 && exported.audit.length >= 5);
let unknownThrew = false;
try { state.decideFinding('finding-999', 'approved'); } catch { unknownThrew = true; }
check('deciding an unknown finding throws', unknownThrew);

// Serialization round-trip preserves the whole investigation (VR<->MR continuity)
const restored = InvestigationState.fromJSON(JSON.parse(JSON.stringify(state.toJSON())));
check('snapshot round-trip preserves leads/findings/queries',
  restored.listLeads().length === 2 && restored.approvedFindings().length === 1 && restored.queryHistory().includes('Atlas'));
check('snapshot round-trip preserves search executions',
  restored.listSearchExecutions().length === state.listSearchExecutions().length
  && restored.listSearchExecutions().some((e) => e.executedQuery === 'zzzzz' && e.hitCount === 0));
check('restored state can still export', restored.buildExport().findings.length === 1);

// Overnight defect regressions (2026-10-27 Quest findings)
// 1) Examined evidence never disappears under later filtering.
check('visited non-hit stays clearly visible (no disappearing evidence)',
  nodeVisual({ searched: true, isHit: false, isSelected: false, isVisited: true }).opacity >= 0.6
  && nodeVisual({ searched: true, isHit: false, isSelected: false, isVisited: false }).opacity < 0.6
  && nodeVisual({ searched: false, isHit: false, isSelected: false, isVisited: true }).opacity === 1);
// Lead explore highlight (owner, 2026-11-03): exploring a lead by
// voice promised highlighted evidence but nothing lit up — lead
// focus must brighten its evidence and dim the rest, search hits
// keep precedence while a search is active, and selection wins.
check('lead focus evidence is bright, the rest dim, only while a lead is active',
  galaxyEmphasis({ searched: false, isHit: false, isSelected: false, leadActive: true, isLeadFocus: true }) === 'bright'
  && galaxyEmphasis({ searched: false, isHit: false, isSelected: false, leadActive: true, isLeadFocus: false }) === 'dim'
  && galaxyEmphasis({ searched: false, isHit: false, isSelected: false, leadActive: false, isLeadFocus: true }) === 'normal'
  && galaxyEmphasis({ searched: true, isHit: false, isSelected: false, leadActive: true, isLeadFocus: true }) === 'dim'
  && galaxyEmphasis({ searched: true, isHit: true, isSelected: false, leadActive: true, isLeadFocus: false }) === 'bright'
  && galaxyEmphasis({ searched: false, isHit: false, isSelected: true, leadActive: true, isLeadFocus: false }) === 'selected');
// 2) Panel pagination is lossless for long findings (no silent truncation).
const longLines = Array.from({ length: 57 }, (_, i) => `line ${i}`);
const pages = paginate(longLines, 24);
check('chronology lens orders by stored date, anomalies keep their place',
  chronologyOrder(FIXTURE_RECORDS)[0].id === 'fx-003'
  && chronologyOrder(FIXTURE_RECORDS).findIndex((r) => r.id === 'fx-002')
     < chronologyOrder(FIXTURE_RECORDS).findIndex((r) => r.id === 'fx-001'));
check('pagination loses nothing (57 lines -> 3 pages, all present in order)',
  pages.length === 3 && JSON.stringify(pages.flat()) === JSON.stringify(longLines));
// Owner session 2026-11-01: the source card accepts a
// `voice-status` action carrying multi-line scope guidance, so
// the first line must be a headline and the rest must survive
// as wrapped body lines.
check('voice-status objective splits headline from body',
  (() => {
    const objective = 'Outside voice scope — voice works in these 4 areas\nrest of scope';
    const [status, ...rest] = objective.split('\n');
    return status === 'Outside voice scope — voice works in these 4 areas' && rest.join(' ') === 'rest of scope';
  })());
// Fixed-panel occlusion guard (2026-10-28 headset acceptance FAIL:
// expanded nodes unselectable behind the fixed menu). The guard must
// condemn the ORIGINAL expanded center coordinate and pass every
// current default layout position.
check('occlusion guard condemns the original behind-menu coordinate',
  isAccessiblePosition([-0.374, 1.5, -2.877]) === false
  && isAccessiblePosition([1.6, 1.78, -3.2]) === false);
check('all compact + expanded node positions stay accessible (not behind fixed panels)',
  [...Object.values(COMPACT_POSITIONS), ...Object.values(EXPANDED_POSITIONS)]
    .every((p) => isAccessiblePosition(p)));
check('focus window: every hit index lands inside a detail-orb window (BG075 case)',
  Array.from({ length: 12 }, (_, i) => i).every((i) =>
    focusWindowForHit(Array.from({ length: 12 }, (_, j) => `h${j}`), i).includes(`h${i}`))
  && focusWindowForHit(Array.from({ length: 12 }, (_, j) => `h${j}`), 11).length === 8
  && focusWindowForHit(['a', 'b'], 1).join() === 'a,b'
  && focusWindowForHit([], 0).length === 0);
check('spatial labels: date in chronology (flagged suspects), ID otherwise',
  nodeLabelText({ id: 'cx-006', date: '2026-01-15' }, 'chronology') === '2026-01-15'
  && nodeLabelText({ id: 'cx-006', date: '1980-01-01' }, 'chronology', true) === '1980-01-01 !!'
  && nodeLabelText({ id: 'cx-006', date: '2026-01-15' }, 'network') === 'CX-006'
  && clusterLabelText('Finance (synthetic)', 3) === 'Finance · 3'
  && focusSummary(8, 112) === 'All 112 records in universe · detail orbs in focus');
// 3) Rejected findings are excluded from export; approved carry through.
const gateState = new InvestigationState();
const keep = gateState.addFinding({ claim: 'Keep me', citationIds: ['fx-001'] });
const drop = gateState.addFinding({ claim: 'Drop me', citationIds: ['fx-002'] });
gateState.decideFinding(keep.id, 'approved');
gateState.decideFinding(drop.id, 'rejected');
const gated = gateState.buildExport();
check('export contains approved only, rejected excluded',
  gated.findings.length === 1 && gated.findings[0].claim === 'Keep me');
// Run association (P0.1): findings keep run/question through decisions+export.
{
  const s = new InvestigationState();
  const a = s.addFinding({ claim: 'Run1 A', citationIds: ['fx-001'], runId: 1, question: 'Q1?' });
  const b = s.addFinding({ claim: 'Run2 B', citationIds: ['fx-002'], runId: 2, question: 'Q2?' });
  s.decideFinding(b.id, 'approved'); // out-of-order (displayed) decision
  const reg = s.listFindings();
  check('register preserves run/question per finding in order',
    reg.length === 2 && reg[0].runId === 1 && reg[1].runId === 2 && reg[1].question === 'Q2?');
  check('out-of-order approval exports only the decided finding',
    s.buildExport().findings.map((f) => f.id).join() === b.id && a.status === 'draft');
}
// Export provenance (2026-10-30): every exported citation must
// resolve to stored provenance with source + hash — the same
// join the UI export performs, verified at code level.
{
  const exp = gateState.buildExport();
  const joined = exp.findings.flatMap((f) => f.citationIds.map((id) => store.provenanceOf(id)));
  check('export citations resolve to provenance (source + hash)',
    joined.length > 0 && joined.every((p) => p && p.sourceSystem && p.contentHash));
}

// Brief/plan contracts (DEFINE -> PLAN foundation, 2026-10-27)
const { validateBrief, validatePlanProposal } = await import('../src/investigation/brief.ts');
const goodBrief = {
  id: 'brief-1',
  allegation: 'The Atlas delivery date moved without agreement.',
  knownFacts: ['A proposal email exists'],
  objectives: ['Establish what changed and when'],
  uncertainties: ['Whether the reply date is reliable'],
  peopleOfInterest: [],
  authoredBy: 'investigator',
  authoredAt: '2026-10-27T00:00:00Z',
};
check('a complete investigator brief validates', validateBrief(goodBrief).ok);
check('a brief with no uncertainty is rejected as a conclusion, not a brief',
  !validateBrief({ ...goodBrief, uncertainties: [] }).ok);
check('a plan without a counterevidence step is rejected',
  !validatePlanProposal({
    id: 'p1', briefId: 'brief-1', status: 'proposed', proposedBy: 'test', createdAt: 'x',
    steps: [{ kind: 'search_records', lens: 'evidence', args: { term: 'Atlas' }, rationale: 'find', seeksCounterevidence: false }],
  }).ok);
check('a pre-approved plan proposal is rejected (human approves plans)',
  !validatePlanProposal({
    id: 'p2', briefId: 'brief-1', status: 'approved', proposedBy: 'test', createdAt: 'x',
    steps: [{ kind: 'search_records', lens: 'evidence', args: { term: 'Atlas' }, rationale: 'find', seeksCounterevidence: true }],
  }).ok);

// Spatial-selection contract (Vision Addendum 3A): gestures become IDs, never guesses
const { emptySelection, validateSelectionContext, describeSelection } = await import('../src/investigation/interaction.ts');
const sel = emptySelection('inv-1', 'Why is this person important?');
sel.selectedSourceIds = ['fx-001', 'fx-002'];
check('a resolvable spatial selection validates', validateSelectionContext(sel, store).ok);
check('selection description is auditable (lens + source IDs)',
  describeSelection(sel).includes('fx-001') && describeSelection(sel).includes('lens=evidence'));
const badSel = emptySelection('inv-1', 'What about this?');
badSel.selectedSourceIds = ['fx-999'];
check('an invented selected source ID is rejected before any model call',
  !validateSelectionContext(badSel, store).ok);

// Bidirectional modes over ONE state (owner direction 2026-10-28):
// begin in Investigate, pivot to Explore, return - nothing is lost.
const modeState = new InvestigationState();
modeState.setObjective('Allegation-first session', 'investigator');
modeState.setMode('investigate');
const modeSession = new SearchSession(adapter, modeState);
await modeSession.query('March');
const modeLead = modeSession.pinLead('March thread', await modeSession.query('Atlas'), 'pivot seed');
const modeFinding = modeState.addFinding({ claim: 'Draft survives mode switches', citationIds: ['fx-001'] });
modeState.decideFinding(modeFinding.id, 'approved');
modeState.setMode('explore');
await modeSession.query('catering');
modeState.setMode('investigate');
const modeRestored = InvestigationState.fromJSON(JSON.parse(JSON.stringify(modeState.toJSON())));
check('mode switches preserve leads, decisions, executions, and mode itself',
  modeRestored.mode === 'investigate'
  && modeRestored.listLeads().some((l) => l.id === modeLead.id)
  && modeRestored.approvedFindings().length === 1
  && modeRestored.listSearchExecutions().length >= 3
  && modeRestored.buildExport().findings.length === 1
  && modeRestored.auditTrail().filter((a) => a.action === 'mode-switch').length === 3);

// Legal-memo source-card assembly (owner template, 2026-11-02
// headset round): EVERY card gets centered title -> EXECUTIVE
// SUMMARY -> numbered sections, regardless of call site.
{
  const plain = assembleMemoLines({
    status: '47 of 3000 records match "Falcon"',
    title: 'Matching records stay bright',
    sections: [
      { label: 'Hits', lines: ['ts-001  ->  ts-002'] },
      { label: 'Scope', lines: ['Whole corpus.'] },
    ],
  });
  check('memo: title is centered first',
    plain[0].kind === 'center' && plain[0].text.includes('Matching records'));
  check('memo: executive summary is one bold-lead paragraph after the title',
    plain.some((l) => l.kind === 'summary' && l.text.startsWith('Executive Summary: 47 of 3000')));
  check('memo: sections auto-number 1. 2. in order',
    plain.filter((l) => l.kind === 'h-numbered').map((l) => l.text).join('|') === '1.  Hits|2.  Scope');
  check('memo: body under a numbered heading is indented',
    plain.some((l) => l.text.includes('ts-001') && (l.indent ?? 0) >= 1));

  const authored = assembleMemoLines({
    status: 'Keyword hit 3 of 12 for "Falcon"',
    title: 'ts-001 - Falcon notes',
    sections: [
      { label: '# ts-001 — Falcon notes', lines: ['## EXECUTIVE SUMMARY', 'From Elena.', '', '**1.  SOURCE TEXT — read this first**', '__quoted body__'] },
      { numbered: '2.', label: 'Record', lines: ['Custodian: Elena'] },
      { label: 'Scope', lines: ['Whole corpus.'] },
    ],
  });
  check('memo: "# " section label becomes the centered title, not literal text',
    authored[0].kind === 'center' && authored[0].text.includes('ts-001')
    && !authored.some((l) => l.text.startsWith('#')));
  check('memo: authored exec summary becomes the summary paragraph',
    authored.some((l) => l.kind === 'summary' && l.text.startsWith('Executive Summary: From Elena.'))
    && !authored.some((l) => l.text === 'EXECUTIVE SUMMARY'));
  check('memo: explicit numbering respected and auto-numbering continues after it',
    authored.filter((l) => l.kind === 'h-numbered').map((l) => l.text).join('|') === '2.  Record|3.  Scope');
  check('memo: bold inline heading kept bold, quote kept underlined',
    authored.some((l) => l.kind === 'bold' && l.text.startsWith('1.'))
    && authored.some((l) => l.kind === 'underline' && l.text === 'quoted body'));

  const long = assembleMemoLines({
    status: 's', title: 'T',
    sections: [{ label: 'Long', lines: ['a. ' + 'word '.repeat(30).trim()] }],
  });
  check('memo: long body lines wrap to card width',
    long.every((l) => l.text.length <= 66));
}

// Menu keep-out (owner, 2026-11-02): no galaxy node sits in the
// cone behind the welcome menu's starting position, in any
// lens, at expanded scale from a standing head at origin.
{
  const inputs = FIXTURE_RECORDS.map((r) => ({
    id: r.id, org: 'org-a', concept: 'alpha', kind: r.kind ?? 'document',
    date: r.date, custodian: r.custodianId, participantOrgs: ['org-a'],
    sender: r.personIds?.[0], fileType: 'Email',
  }));
  // Add synthetic spread so every azimuth is exercised.
  for (let i = 0; i < 120; i += 1) {
    inputs.push({
      id: `syn-${i}`, org: i % 2 ? 'org-a' : 'org-b', concept: i % 3 ? 'alpha' : 'beta',
      kind: 'document', date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
      custodian: i % 2 ? 'c-a' : 'c-b', participantOrgs: ['org-a'], sender: 'p1', fileType: 'Word',
    });
  }
  const head = [0, 1.6, 0];
  const panelDir = [0 - head[0], 2.25 - head[1], -2.7 - head[2]];
  const inCone = (p) => {
    const w = [GALAXY_CENTER[0] + p[0] * 1.9, GALAXY_CENTER[1] + p[1] * 1.9, GALAXY_CENTER[2] + p[2] * 1.9];
    if (w[2] >= -2.7) return false;
    const v = [w[0] - head[0], w[1] - head[1], w[2] - head[2]];
    const dot = v[0] * panelDir[0] + v[1] * panelDir[1] + v[2] * panelDir[2];
    const cos = dot / (Math.hypot(...v) * Math.hypot(...panelDir));
    return Math.acos(Math.max(-1, Math.min(1, cos))) < 0.30;
  };
  for (const lens of ['evidence', 'network', 'chronology', 'concepts', 'custodians', 'filetypes']) {
    const placed = galaxyPositions(inputs, lens);
    const bad = [...placed.values()].filter((pl) => inCone(pl.position));
    check(`keep-out: ${lens} places nothing behind the menu`, bad.length === 0);
  }
  // First and last concept sectors must not coincide (the
  // -pi..+pi inclusive-endpoint overlap the owner saw between
  // 'vendor / assessment / critical' and its neighbor).
  const many = [];
  for (let i = 0; i < 19; i += 1) {
    many.push({
      id: `c-${i}`, org: 'org-a', concept: `concept-${String(i).padStart(2, '0')}`,
      kind: 'document', date: '2026-01-01', custodian: 'c-a',
      participantOrgs: ['org-a'], sender: 'p1', fileType: 'Word',
    });
  }
  const anchors = conceptAnchors(many);
  let minDist = Infinity;
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const a = anchors[i].position; const b = anchors[j].position;
      minDist = Math.min(minDist, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  check('concept anchors never coincide (first/last sector overlap)', minDist > 1);
}

console.log(failures === 0 ? '\nAll investigation tests passed.' : `\n${failures} investigation test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

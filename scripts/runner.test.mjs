/**
 * Durable tests for the bounded investigation runner (M3 prep, WS-B).
 * Planner/synthesizer here are EXPLICIT TEST DOUBLES — they prove the
 * executor's bounds, audit separation, refusal, interruption, and the
 * human-approval export gate. They are not model integration and must
 * never be described as such.
 * Run: node scripts/runner.test.mjs
 */
import { EvidenceStore } from '../src/evidence/store.ts';
import {
  FIXTURE_CUSTODIANS,
  FIXTURE_PEOPLE,
  FIXTURE_RECORDS,
} from '../src/evidence/fixtures.ts';
import { buildExport, executeTool, runInvestigation } from '../src/ai/runner.ts';

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};
const store = new EvidenceStore(FIXTURE_PEOPLE, FIXTURE_CUSTODIANS, FIXTURE_RECORDS);

const testPlanner = {
  name: 'test-double-planner',
  async plan(objective) {
    return {
      objective,
      steps: [
        { tool: 'search_records', args: { term: 'Atlas' }, reason: 'find the thread' },
        { tool: 'compare_timeline', args: { recordIds: ['fx-001', 'fx-002', 'fx-003'] }, reason: 'check chronology' },
        { tool: 'trace_relationships', args: { recordId: 'fx-001' }, reason: 'widen context' },
      ],
    };
  },
};
const citingSynthesizer = {
  name: 'test-double-synthesizer',
  async synthesize() {
    return [{
      claim: 'A reply predates its original (fixture observation).',
      citationIds: ['fx-001', 'fx-002'],
      citations: [
        { recordId: 'fx-001', quote: 'Vendor Atlas proposes moving the delivery date to March.' },
        { recordId: 'fx-002', quote: 'Agreed to the March date in your proposal.' },
      ],
      status: 'draft',
    }];
  },
};

// Happy path: bounded run completes, audit separates actors
const outcome = await runInvestigation(store, testPlanner, citingSynthesizer, 'fixture objective');
check('run completes within bounds', outcome.status === 'completed');
check('findings start as drafts', outcome.findings.every((f) => f.status === 'draft'));
check('audit separates planning, tools, synthesis',
  ['model-planning', 'tool-execution', 'model-synthesis'].every((k) => outcome.audit.some((a) => a.kind === k)));
check('timeline tool flags reply-before-original',
  outcome.results.some((r) => r.facts.some((f) => f.includes('REPLIES-BEFORE-ORIGINAL'))));

// Export gate: refused before approval, allowed after
let refused = false;
try { buildExport(outcome.findings, outcome.audit); } catch { refused = true; }
check('export refused without human approval', refused);
outcome.findings[0].status = 'approved';
check('export succeeds after approval and carries audit trail',
  buildExport(outcome.findings, outcome.audit).auditTrail.length > 0);

// Refusal / labelled gap when nothing is found
const emptyPlanner = {
  name: 'test-double-planner',
  async plan(objective) {
    return { objective, steps: [{ tool: 'search_records', args: { term: 'nonexistent-term' }, reason: 'probe' }] };
  },
};
const gap = await runInvestigation(store, emptyPlanner, citingSynthesizer, 'nothing here');
check('no-evidence run is a labelled gap, not a finding', gap.status === 'gap-no-evidence' && gap.findings.length === 0);

// Invalid citations never surface as findings
const hallucinatingSynthesizer = {
  name: 'test-double-synthesizer',
  async synthesize() {
    return [{ claim: 'Invented.', citationIds: ['fx-999'], citations: [{ recordId: 'fx-999', quote: 'ghost' }], status: 'draft' }];
  },
};
const bad = await runInvestigation(store, testPlanner, hallucinatingSynthesizer, 'fixture objective');
check('invented citations yield gap-invalid-citations', bad.status === 'gap-invalid-citations' && bad.findings.length === 0);
check('invented citation IDs are audited, not silently dropped',
  bad.audit.some((a) => a.actor === 'citation-verification' && a.detail.includes('fx-999')));

// Paraphrase dressed as quotation is refused by the quote-exact gate (M4)
const paraphrasingSynthesizer = {
  name: 'test-double-synthesizer',
  async synthesize() {
    return [{
      claim: 'Atlas suggested shifting delivery into March.',
      citationIds: ['fx-001'],
      citations: [{ recordId: 'fx-001', quote: 'Atlas suggested shifting delivery into March' }],
      status: 'draft',
    }];
  },
};
const paraphrased = await runInvestigation(store, testPlanner, paraphrasingSynthesizer, 'fixture objective');
check('non-verbatim quote is rejected and audited',
  paraphrased.status === 'gap-invalid-citations'
  && paraphrased.audit.some((a) => a.actor === 'quote-verification'));

// Metadata-grounded answers (M4): counts validated against computed
// facts, invented numbers rejected, deterministic fallback answers.
const analyticsPlanner = {
  name: 'test-double-planner',
  async plan(objective) {
    return { objective, steps: [{ tool: 'collection_analytics', args: {}, reason: 'count question' }] };
  },
};
const analyticsFacts = executeTool(store, { tool: 'collection_analytics', args: {}, reason: 'x' });
const totalFact = analyticsFacts.facts.find((f) => f.startsWith('collection total:'));
const total = Number(/total: (\d+)/.exec(totalFact ?? '')?.[1]);
const metadataSynth = {
  name: 'test-double-synthesizer',
  async synthesize() {
    return [{
      claim: `The collection contains ${total} record(s) in total.`,
      citationIds: ['fx-001'],
      citations: [{ recordId: 'fx-001', quote: 'Vendor Atlas proposes moving the delivery date to March.' }],
      status: 'draft',
      groundedBy: 'metadata',
    }];
  },
};
const metaRun = await runInvestigation(store, analyticsPlanner, metadataSynth, 'How many records total?');
check('metadata finding with computed number survives without quote-grounding',
  metaRun.status === 'completed' && metaRun.findings[0]?.groundedBy === 'metadata');
const exaggeratingSynth = {
  name: 'test-double-synthesizer',
  async synthesize() {
    return [{
      claim: 'The collection contains 999999 record(s).',
      citationIds: ['fx-001'],
      citations: [],
      status: 'draft',
      groundedBy: 'metadata',
    }];
  },
};
const badMeta = await runInvestigation(store, analyticsPlanner, exaggeratingSynth, 'How many records total?');
check('invented metadata number rejected; deterministic analytics answer instead',
  badMeta.status === 'completed'
  && badMeta.findings.length === 1
  && badMeta.findings[0].claim.includes('Collection analytics (computed')
  && badMeta.audit.some((a) => a.actor === 'metadata-verification'));
const gapMeta = await runInvestigation(store, analyticsPlanner, exaggeratingSynth, 'What did Atlas deliver in 2019?');
check('unanswerable substantive question stays a gap (no analytics fallback)',
  gapMeta.status === 'gap-invalid-citations' && gapMeta.findings.length === 0);

// Interruption between steps
const signal = { interrupted: false };
const interruptingPlanner = {
  name: 'test-double-planner',
  async plan(objective) {
    const inner = await testPlanner.plan(objective);
    queueMicrotask(() => { signal.interrupted = true; });
    return inner;
  },
};
const stopped = await runInvestigation(store, interruptingPlanner, citingSynthesizer, 'stop early', signal);
check('interruption halts before synthesis', stopped.status === 'interrupted' && stopped.findings.length === 0);

// Bounds and allow-list are executor-enforced
let overBoundThrew = false;
try {
  await runInvestigation(store, {
    name: 'test-double-planner',
    async plan(objective) {
      return { objective, steps: Array.from({ length: 6 }, () => ({ tool: 'search_records', args: { term: 'Atlas' }, reason: 'x' })) };
    },
  }, citingSynthesizer, 'too many steps');
} catch { overBoundThrew = true; }
check('plans over the 5-step bound are rejected', overBoundThrew);
let badToolThrew = false;
try { executeTool(store, { tool: 'delete_everything', args: {}, reason: 'x' }); } catch { badToolThrew = true; }
check('non-allow-listed tool is rejected', badToolThrew);
check('missing record tool result is honest',
  executeTool(store, { tool: 'get_record', args: { recordId: 'fx-999' }, reason: 'x' }).facts[0].includes('not found'));

// Sequential investigations: Stop, then a fresh question succeeds
// (owner defect 2026-10-27: a second Ask AI could not be initiated)
const rerun = await runInvestigation(store, testPlanner, citingSynthesizer, 'second question after interruption');
check('a new investigation runs cleanly after an interrupted one',
  rerun.status === 'completed' && rerun.findings.length === 1);
const rerunAgain = await runInvestigation(store, testPlanner, citingSynthesizer, 'third question in sequence');
check('repeated sequential investigations keep working',
  rerunAgain.status === 'completed');

console.log(failures === 0 ? '\nAll runner tests passed.' : `\n${failures} runner test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

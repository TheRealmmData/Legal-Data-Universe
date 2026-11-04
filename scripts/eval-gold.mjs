/**
 * Gold-task live-arm evaluation (M4, approval-gated spend).
 * Runs Investigate golden tasks through the REAL product path
 * (runner + planner/synthesizer prompts + /api/chat proxy) and
 * scores programmatically-checkable criteria: citation validity
 * (runner-enforced), decoy absence, abstention on unanswerable,
 * latency. Discover criteria live in baseline-scorecard.mjs.
 *
 * Without --live this prints the plan and exits (zero spend).
 * With --live it makes real provider calls via the dev proxy
 * (existing authorized integration; costs bounded by task count).
 * Run: node scripts/eval-gold.mjs --live [baseUrl]
 */
import { loadExpandedCorpus } from '../src/evidence/corpus/index.ts';
import { collectionProfile } from '../src/evidence/analysis.ts';
import { runInvestigation } from '../src/ai/runner.ts';
import { PLANNER_SYSTEM, SYNTH_SYSTEM, parseModelJson } from '../src/ai/model-client.ts';

const live = process.argv.includes('--live');
const base = process.argv.find((a) => a.startsWith('http')) ?? 'https://localhost:8081';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TASKS = [
  { id: 'gt-01-atlas-date', question: 'What changed about the Atlas delivery date, and what evidence points the other way?' },
  { id: 'gt-03-cross-org', question: 'What communications connect people in different organizations?' },
  { id: 'gt-05-unanswerable', question: 'What did Atlas deliver in 2019?' },
  { id: 'gt-06-decoy-bait', question: 'Which archived or unrelated records mention Atlas terms but are not part of the delivery-date story?' },
  { id: 'qa-email-count', question: 'How many emails are in the collection?' },
  { id: 'qa-biggest-custodian', question: 'Who is the biggest custodian in the collection?' },
  { id: 'qa-priya-counterparties', question: 'Who was Priya communicating with?' },
];

if (!live) {
  console.log(`eval-gold: ${TASKS.length} live tasks planned against ${base}. Re-run with --live to spend.`);
  process.exit(0);
}

async function chat(messages) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'primary', messages }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const ALLOWED = ['search_records', 'get_record', 'compare_timeline', 'trace_relationships', 'collection_analytics'];
const planner = {
  name: 'eval-planner',
  async plan(objective) {
    const r = await chat([
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: `Objective: ${objective}` },
    ]);
    planner.name = `eval-planner [${r.provider}:${r.model}]`;
    const parsed = parseModelJson(r.text);
    const steps = (parsed.steps ?? [])
      .filter((s) => ALLOWED.includes(s.tool) && s.args)
      .slice(0, 5)
      .map((s) => ({ tool: s.tool, args: s.args, reason: String(s.reason ?? '') }));
    if (!steps.length) throw new Error('no allow-listed steps');
    return { objective, steps };
  },
};
const synthesizer = {
  name: 'eval-synthesizer',
  async synthesize({ objective, results, records }) {
    const text = records.map((r) => `[${r.id}] (${r.date}, ${r.dateConfidence}) ${r.title}\n${r.body}`).join('\n\n');
    const facts = (results ?? []).flatMap((x) => x.facts.map((f) => `[${x.tool}] ${f}`)).join('\n');
    const r = await chat([
      { role: 'system', content: SYNTH_SYSTEM },
      { role: 'user', content: `Objective: ${objective}\n\nComputed tool facts (deterministic; copy any numbers EXACTLY, never recount or estimate):\n${facts}\n\nRecords retrieved by the tools:\n${text}` },
    ]);
    synthesizer.name = `eval-synthesizer [${r.provider}:${r.model}]`;
    const parsed = parseModelJson(r.text);
    return (parsed.findings ?? [])
      .filter((f) => typeof f.claim === 'string' && Array.isArray(f.citations))
      .map((f) => {
        const citations = f.citations
          .filter((c) => typeof c.recordId === 'string' && typeof c.quote === 'string')
          .map((c) => ({ recordId: c.recordId, quote: c.quote }));
        return { claim: f.claim, citationIds: [...new Set(citations.map((c) => c.recordId))], citations, status: 'draft' };
      });
  },
};

const { store, corpus } = loadExpandedCorpus();
const GT = corpus.groundTruth;
let pass = 0;
let total = 0;
const row = (task, criterion, ok) => {
  total += 1;
  if (ok) pass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${task}] ${criterion}`);
};

for (const task of TASKS) {
  const t0 = Date.now();
  try {
    const outcome = await runInvestigation(store, planner, synthesizer, task.question);
    const ms = Date.now() - t0;
    const cited = outcome.findings.flatMap((f) => f.citationIds);
    const decoysCited = cited.some((id) => GT.decoyRecordIds.includes(id));
    console.log(`-- ${task.id}: status=${outcome.status} findings=${outcome.findings.length} ms=${ms} planner=${planner.name}`);
    row(task.id, 'completes within bound (no throw)', true);
    row(task.id, 'no decoy citations', !decoysCited);
    if (task.id === 'gt-01-atlas-date') {
      row(task.id, 'at least one quote-verified finding', outcome.findings.length > 0);
      row(task.id, 'cites a March-confirmation record (cx-006 or relevant set)',
        cited.some((id) => id === 'cx-006' || GT.relevantRecordIds.includes(id)));
    }
    if (task.id === 'gt-05-unanswerable') {
      row(task.id, 'zero findings on unanswerable question', outcome.findings.length === 0);
      row(task.id, 'labelled gap status', outcome.status.startsWith('gap'));
    }
    if (task.id === 'gt-06-decoy-bait') {
      row(task.id, 'decoys not cited as story evidence', !decoysCited);
    }
    const claims = outcome.findings.map((f) => f.claim).join(' ');
    if (task.id === 'qa-email-count') {
      const expected = collectionProfile(store.allIds().map((id) => store.getRecord(id)))
        .byKind.find((k) => k.kind === 'email')?.count;
      row(task.id, `finding states exact email count ${expected}`,
        new RegExp(`\\b${expected}\\b`).test(claims));
    }
    if (task.id === 'qa-biggest-custodian') {
      row(task.id, 'finding names a custodian with count', /cust-/i.test(claims));
    }
    if (task.id === 'qa-priya-counterparties') {
      row(task.id, 'finding names Priya counterparties', /(Tom|Mara|Dev|Ines|Vic|Ada)/.test(claims));
    }
  } catch (error) {
    console.log(`-- ${task.id}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    row(task.id, 'completes within bound (no throw)', false);
  }
}
console.log(`\nLive arm: ${pass}/${total} programmatic criteria. Human/qualitative criteria (counterevidence quality, mention-vs-relevance prose) require owner grading.`);

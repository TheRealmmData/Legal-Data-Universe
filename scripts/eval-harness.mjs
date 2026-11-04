/**
 * Offline evaluation harness prototype for the bounded-investigation
 * contract (docs D15/D16). Generic synthetic fixtures only — this is
 * NOT the Milestone 3 dataset (D3 undecided) and makes NO API calls.
 * Run: node scripts/eval-harness.mjs   (exit 1 on any failed check)
 */
const records = [
  { id: 'F-001', title: 'Kickoff note', body: 'Vendor Atlas proposed a revised delivery date.', date: '2026-01-05', dateConfidence: 'verified', participants: ['a@example.com', 'b@example.com'] },
  { id: 'F-002', title: 'Reply before original', body: 'Agreed to the Atlas date in your message yesterday.', date: '2026-01-04', dateConfidence: 'suspect', participants: ['b@example.com', 'a@example.com'] },
  { id: 'F-003', title: 'Sentinel date memo', body: 'Atlas contract terms archived.', date: '1980-01-01', dateConfidence: 'suspect', participants: ['c@example.com'] },
  { id: 'F-004', title: 'Invoice query', body: 'Invoice 441 references the Atlas agreement.', date: '2026-02-01', dateConfidence: 'verified', participants: ['a@example.com', 'c@example.com'] },
];
const byId = new Map(records.map((r) => [r.id, r]));

const search = (term) => records.filter((r) => `${r.title} ${r.body}`.toLowerCase().includes(term.toLowerCase())).map((r) => r.id);
const timeline = (ids) => [...ids].map((id) => byId.get(id)).sort((a, b) => a.date.localeCompare(b.date));
const relationships = (id) => {
  const src = byId.get(id);
  return records.filter((r) => r.id !== id && r.participants.some((p) => src.participants.includes(p))).map((r) => r.id);
};
const validateCitations = (ids) => ids.length > 0 && ids.every((id) => byId.has(id));

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

const hits = search('Atlas');
check('search finds all Atlas records', hits.length === 4);
const ordered = timeline(hits);
check('timeline surfaces suspect sentinel date first', ordered[0].id === 'F-003' && ordered[0].dateConfidence === 'suspect');
check('reply-before-original pair is detectable', byId.get('F-002').date < byId.get('F-001').date);
check('relationships trace shared participants', relationships('F-001').includes('F-004'));
check('valid citations accepted', validateCitations(['F-001', 'F-002']));
check('invented citation rejected', !validateCitations(['F-999']));
check('empty citation list rejected', !validateCitations([]));

console.log(failures === 0 ? '\nAll harness checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

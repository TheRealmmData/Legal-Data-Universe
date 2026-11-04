/**
 * Durable tests for the guided NovaChip demo leads and attorney
 * findings-memo export. Offline/deterministic: live model quality
 * is exercised separately by scripts/eval-gold.mjs --live.
 */
import { readFileSync } from 'node:fs';
import { loadTradeSecretCorpus } from '../src/evidence/corpus/index.ts';
import { buildDemoLeads } from '../src/discovery/demo-leads.ts';
import { validateLead } from '../src/discovery/leads.ts';
import { runReyesInvestigation } from '../src/agents/orchestrator.ts';
import { InvestigationState } from '../src/investigation/state.ts';
import { buildFindingsJsonPayload, buildFindingsMemo, headlineClaim } from '../src/export/findings-memo.ts';
import { makePdfBytes } from '../src/export/pdf.ts';
import { makeZip } from '../src/agents/zip.ts';
import {
  clampOrbit, isTapGesture, orbitCameraPosition, orbitForward, pointerToNdc,
} from '../src/browser-controls-math.ts';

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

const loaded = loadTradeSecretCorpus();
const { store } = loaded;
const leads = buildDemoLeads(store);
check('sequenced investigation computes exactly three leads', leads.length === 3);
check('leads use three different perspectives in order',
  leads.map((l) => l.suggestedAction.lens).join(',') === 'chronology,network,filetypes');
check('every sequenced lead passes the generic lead contract',
  leads.every((lead) => validateLead(lead, store).ok));
check('every sequenced lead has a defined finding, follow-ups, and searches',
  leads.every((lead) => lead.definedFinding
    && (lead.followUpQuestions?.length ?? 0) >= 3
    && (lead.searchSuggestions?.length ?? 0) >= 3));
check('Lead 3 is the smoking gun (direct send + receipt language)',
  /smoking gun/i.test(leads[2]?.summary ?? '')
  && leads[2].supportingRecordIds.includes('ts-022')
  && leads[2].supportingRecordIds.includes('ts-023')
  && leads[2].supportingRecordIds.includes('ts-024'));

const snapshotHash = store.getRecord('ts-013')?.loadFile?.md5;
check('smoking attachment fingerprint matches internal snapshot',
  snapshotHash && store.getRecord('ts-023')?.loadFile?.md5 === snapshotHash);
check('same-name public extract has a different fingerprint',
  store.getRecord('ts-026')?.loadFile?.md5 !== snapshotHash);

const hitIds = (term) => store.searchWithCount(term, 100000).hits.map((h) => h.recordId);
check('chat/search rabbit holes resolve to authored records',
  hitIds('Nightjar').includes('ts-017')
  && hitIds('do not put this in email').includes('ts-020')
  && hitIds('air-gapped').includes('ts-024')
  && hitIds('air-gapped').includes('ts-025')
  && hitIds('escrow').includes('ts-019'));
check('Teams chat drops red herrings into the evidence, \
not the conclusion', leads[0].supportingRecordIds.includes('ts-018')
&& leads[2].supportingRecordIds.includes('ts-026')
&& leads[2].supportingRecordIds.includes('ts-019'));

const inv = runReyesInvestigation(store);
check('specialists produce three supported, structured drafts',
  inv.status === 'complete'
  && inv.workProduct?.draftFindings.length === 3
  && inv.workProduct.draftFindings.every((d) => d.verdict === 'supported'
    && d.title && d.demoStep && d.citations.length > 0));
check('specialist draft quotes are verbatim',
  inv.workProduct.draftFindings.every((d) => d.citations.every((c) => {
    const r = store.getRecord(c.recordId);
    return r && `${r.title} ${r.body}`.includes(c.quote);
  })));

// Single-lead session: draft and approve ONLY Lead 3.
const state = new InvestigationState();
state.setObjective('Did Reyes deliver Falcon source code to HelixWorks?', 'investigator');
state.recordSearchExecution({
  actor: 'agent',
  originalQuery: 'Lead 3 defined finding',
  operation: 'keyword-substring (agent tool)',
  executedQuery: 'scheduler_core',
  corpusId: loaded.corpusId,
  corpusVersion: loaded.corpusVersion,
  corpusSize: store.size,
  hitCount: hitIds('scheduler_core').length,
  matchedRecordIds: hitIds('scheduler_core'),
});
const lead3Draft = inv.workProduct.draftFindings.find((d) => d.demoStep === 3);
const finding = state.addFinding({
  claim: lead3Draft.claim,
  citationIds: lead3Draft.citationIds,
  question: leads[2].suggestedAction.question,
  groundedBy: lead3Draft.groundedBy,
  title: lead3Draft.title,
  citations: lead3Draft.citations,
  counterCitations: lead3Draft.counterCitations,
  gaps: lead3Draft.gaps,
  verdict: lead3Draft.verdict,
  leadId: lead3Draft.leadId,
  demoStep: 3,
  sourceLabel: lead3Draft.sourceLabel,
});
let refusedBeforeApproval = false;
try { state.buildExport([finding.id]); } catch { refusedBeforeApproval = true; }
check('single-finding export is refused before approval', refusedBeforeApproval);
state.decideFinding(finding.id, 'approved');
const exported = state.buildExport([finding.id]);
check('single-finding export carries claim + verbatim citations + gaps',
  exported.findings.length === 1
  && exported.findings[0].claim === lead3Draft.claim
  && exported.findings[0].citations?.length === lead3Draft.citations.length
  && (exported.findings[0].gaps?.length ?? 0) > 0);

const memoInput = {
  corpusLabel: `ACTIVE CORPUS: NovaChip Trade Secret ${store.size}`,
  exportedAt: '2026-11-02T12:00:00.000Z',
  findings: exported.findings,
  audit: state.auditTrail(),
  searchExecutions: state.listSearchExecutions(),
  store,
  selectionLabel: `Single approved finding ${finding.id}`,
};
const memo = buildFindingsMemo(memoInput);
const text = memo.lines.map((l) => l.text).join('\n');
check('single-lead memo names Lead 3 and leads with the finding',
  memo.filename === 'legal-data-universe-lead-3-findings-memo.pdf'
  && text.includes('Lead 3')
  && text.includes(headlineClaim(lead3Draft.claim).slice(0, 60)));
check('memo conclusion precedes provenance appendix (do not bury the lead)',
  text.indexOf('Executive Summary') >= 0
  && text.indexOf('Executive Summary') < text.indexOf('Appendix A - Source Records and Provenance')
  && text.indexOf('Appendix A - Source Records and Provenance') < text.indexOf('Appendix B - Search Executions'));
check('memo includes counterevidence, scope, and audit appendices',
  text.includes('Counterevidence and limitations')
  && text.includes('Investigation Scope and Method')
  && text.includes('Appendix C - Approval and Audit Trail'));

const pdf = makePdfBytes(memo.lines);
const pdfText = new TextDecoder().decode(pdf);
check('PDF is a real multi-page PDF with selectable finding text',
  pdfText.startsWith('%PDF-1.4')
  && pdfText.includes('/Type /Pages')
  && pdfText.includes('Findings Memorandum')
  && pdfText.includes('scheduler_core')
  && (pdfText.match(/\/Type \/Page\b/g) ?? []).length >= 2);

const json = buildFindingsJsonPayload({
  ...memoInput,
  objective: state.objective,
  annotations: exported.annotations,
});
check('JSON companion retains finding, quotes, and provenance',
  json.findings.length === 1
  && json.findings[0].claim === lead3Draft.claim
  && json.findings[0].headline === headlineClaim(lead3Draft.claim)
  && json.findings[0].citations.every((c) => c.provenance?.contentHash && c.record?.id === c.recordId));

const ndc = pointerToNdc(75, 25, { left: 0, top: 0, width: 100, height: 100 });
const orbitPos = orbitCameraPosition({ target: { x: 0, y: 1, z: -2 }, azimuth: 0, polar: 1.5, distance: 3 });
const clamped = clampOrbit({ target: { x: 99, y: 99, z: 99 }, azimuth: 0, polar: 99, distance: 99 });
check('browser controls: pointer NDC, tap threshold, and orbit math',
  ndc.x === 0.5 && ndc.y === 0.5
  && isTapGesture(3, 4, 100) && !isTapGesture(20, 0, 100)
  && Math.abs(orbitPos.x) < 1e-9 && Math.abs(orbitPos.y - (1 + 3 * Math.cos(1.5))) < 1e-9 && Math.abs(orbitPos.z - (-2 + 3 * Math.sin(1.5))) < 1e-9
  && orbitForward(0).z === -1
  && clamped.distance === 18 && clamped.polar === 1.52 && clamped.target.y === 5);

// Quest approval regression (owner, 2026-11-03): live runs make
// TWO drafts, so Approve must decide the DISPLAYED draft even when
// the queue holds more than one. The old >1 branch redrew a list
// forever and no approval could ever occur.
const evidenceUi = readFileSync(new URL('../src/evidence-ui.ts', import.meta.url), 'utf8');
const approveBlock = evidenceUi.slice(
  evidenceUi.indexOf('private approveRejectDisplayed'),
  evidenceUi.indexOf('private decideFinding'),
);
check('Approve decides the displayed draft with multiple drafts pending (no select-forever deadlock)',
  approveBlock.length > 0
  && !/pendingFindings\.length > 1/.test(approveBlock)
  && approveBlock.includes('this.decideFinding(decision)')
  && approveBlock.includes("diag('finding-approve-tap'"));

// Approve All (owner final QoL, 2026-11-04): one tap approves
// every waiting draft through the SAME state transition, with
// per-item failure isolation (a stale id is dropped + counted,
// never thrown, never silently approved), then re-arms export
// exactly like a single decision.
const approveAllBlock = evidenceUi.slice(
  evidenceUi.indexOf('private approveAllPending'),
  evidenceUi.indexOf('private decideFinding'),
);
check('Approve All decides each pending draft via state.decideFinding inside try/catch',
  approveAllBlock.length > 0
  && approveAllBlock.includes("this.state.decideFinding(entry.findingId, 'approved')")
  && approveAllBlock.includes('try {')
  && approveAllBlock.includes("diag('finding-decide-failed'"));
check('Approve All drains the processed queue and re-arms export',
  approveAllBlock.includes('this.pendingFindings = this.pendingFindings.filter')
  && approveAllBlock.includes('this.exportArmed = false'));
const panelSrc2 = readFileSync(new URL('../src/panel.ts', import.meta.url), 'utf8');
const uikitml2 = readFileSync(new URL('../public/ui/welcome.uikitml', import.meta.url), 'utf8');
check('Approve All button sits in the LEFT export column and is wired',
  uikitml2.indexOf('id="ai-approve-all"') > uikitml2.indexOf('id="ai-reject"')
  && uikitml2.indexOf('id="ai-approve-all"') < uikitml2.indexOf('id="exp-findings"')
  && panelSrc2.includes("wireAction('ai-approve-all', dispatchAgent('approve-all'))")
  && evidenceUi.includes("if (action === 'approve-all') return this.approveAllPending();"));

// Quest export regression (owner, 2026-11-03): Export All as ZIP
// silently did nothing on device although approved findings
// existed. The builders are fine; the delivery was the defect:
// downloadBlob used a detached anchor and revoked the blob URL
// synchronously, which cancels the download on Quest Chromium,
// and exportAllZip had no try/catch or diag. Cover the generic
// (non-demo) finding shape the owner approved that night too.
const generic = state.addFinding({
  claim: 'Reyes moved Falcon files before departure. [ts-020]',
  citationIds: ['ts-020'],
  question: 'What did Reyes move?',
  groundedBy: 'metadata',
});
state.decideFinding(generic.id, 'approved');
const allMemo = buildFindingsMemo({
  ...memoInput,
  findings: state.approvedFindings(),
  selectionLabel: 'All approved findings',
});
const allPdf = makePdfBytes(allMemo.lines);
const zip = makeZip([
  { name: allMemo.filename, data: allPdf },
  { name: 'approved-findings.json', text: JSON.stringify(json, null, 2) },
]);
const zipBytes = new Uint8Array(await zip.arrayBuffer());
check('all-approved memo + ZIP build for demo and generic findings alike',
  allPdf.length > pdf.length
  && zipBytes[0] === 0x50 && zipBytes[1] === 0x4b
  && new TextDecoder().decode(zipBytes).includes(allMemo.filename));
const downloadBlock = evidenceUi.slice(
  evidenceUi.indexOf('function downloadBlob'),
  evidenceUi.indexOf('function wrap'),
);
check('blob downloads attach the anchor and delay URL revoke (Quest-safe)',
  downloadBlock.length > 0
  && downloadBlock.includes('document.body.appendChild(anchor)')
  && /setTimeout\([\s\S]*?revokeObjectURL/.test(downloadBlock));
const zipBlock = evidenceUi.slice(
  evidenceUi.indexOf('private exportAllZip'),
  evidenceUi.indexOf('private exportApproved'),
);
check('ZIP export reports failures instead of failing silently',
  zipBlock.length > 0
  && zipBlock.includes('try {')
  && zipBlock.includes("diag('export-zip-failed'"));
// 2D voice transport (owner, 2026-11-03): keyboard X must
// toggle voice in the browser (panel copy promised "Press X"),
// and a system-muted mic must be reported, not timed out silent.
const panelTs = readFileSync(new URL('../src/panel.ts', import.meta.url), 'utf8');
const browserControlsTs = readFileSync(new URL('../src/browser-controls.ts', import.meta.url), 'utf8');
check('keyboard X toggles voice in 2D and a muted mic is reported by name',
  browserControlsTs.includes("key === 'x'")
  && browserControlsTs.includes('voiceToggleRequest.nonce += 1')
  && panelTs.includes('voiceToggleRequest.nonce !== this.lastVoiceToggleNonce')
  && panelTs.includes("diag('voice-mic-track'")
  && panelTs.includes('Microphone is MUTED by Windows')
  && panelTs.includes("downloadBlob('voice-diagnostic.wav'")
  && panelTs.includes('webkitSpeechRecognition')
  && panelTs.includes("diag('voice-webspeech-start'")
  && panelTs.includes('preferWitStt'));
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
check('tap mode is silent and exports also land via the dev server',
  panelTs.includes('endVoiceTurn();')
  && evidenceUi.includes('export function endVoiceTurn')
  && evidenceUi.includes("fetch('/api/export-save'")
  && evidenceUi.includes('canShare')
  && viteConfig.includes("'/api/export-save'"));
const uikitml = readFileSync(new URL('../public/ui/welcome.uikitml', import.meta.url), 'utf8');
check('decision buttons say Approve/Reject Draft Finding',
  uikitml.includes('>Approve Draft Finding<')
  && uikitml.includes('>Reject Draft Finding<')
  && !uikitml.includes('>Approve Finding<')
  && !uikitml.includes('>Reject Finding<'));

console.log(failures === 0 ? '\nAll demo/export tests passed.' : `\n${failures} demo/export test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

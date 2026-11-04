/**
 * Attorney-facing findings memorandum model.
 *
 * Order is a product requirement: conclusions first, detailed
 * evidence next, and only then scope/provenance/search/audit
 * appendices. JSON remains the machine-readable appendix in the
 * ZIP; the PDF built from these lines is the primary artifact.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import type { Finding, InvestigationAuditEvent, SearchExecution } from '../investigation/state.ts';
import type { PdfLine } from './pdf.ts';

export interface FindingsMemoInput {
  corpusLabel: string;
  exportedAt: string;
  findings: Finding[];
  audit: readonly InvestigationAuditEvent[];
  searchExecutions: readonly SearchExecution[];
  store: EvidenceStore;
  selectionLabel: string;
}

const GOLD: [number, number, number] = [0.55, 0.42, 0.12];
const MUTED: [number, number, number] = [0.35, 0.35, 0.35];

export function headlineClaim(claim: string): string {
  let text = claim.replace(/^\[[^\]]+\]\s*/i, '').trim();
  for (const marker of [' Counterevidence considered:', ' Basis for non-conclusion:', ' Gaps:']) {
    const at = text.indexOf(marker);
    if (at > 0) text = text.slice(0, at).trim();
  }
  return text;
}

function whyItMatters(finding: Finding): string {
  switch (finding.demoStep) {
    case 1: return 'This establishes the acquisition timeline and the channels available to Reyes after resignation. It does not, by itself, establish the contents of the USB device.';
    case 2: return 'This establishes that confidential Falcon tuning parameters left NovaChip and tests the authorization explanation against the approval\'s express scope limit.';
    case 3: return 'This is the direct source-code delivery evidence: sender, recipient, attached file identity, and receipt align. Downstream use at HelixWorks remains a separate question.';
    default: return 'This approved finding answers the investigator\'s stated question on the cited evidence and should be read with its counterevidence and gaps.';
  }
}

function recommendedNextStep(finding: Finding): string {
  switch (finding.demoStep) {
    case 1: return 'Forensically scope the June 13-15 clone/USB window and reconcile device serials against the May approval.';
    case 2: return 'Preserve and review the personal-mailbox attachment family and determine whether it was forwarded or retained after departure.';
    case 3: return 'Preserve the recipient laptop and deleted ZIP, audit clean-room and repository logs, and scope downstream use before alleging product contamination.';
    default: return 'Decide whether the remaining gaps require custodian follow-up, forensic collection, or third-party discovery.';
  }
}

export function buildFindingsMemo(input: FindingsMemoInput): { lines: PdfLine[]; filename: string } {
  const { findings, store } = input;
  const single = findings.length === 1;
  const step = single ? findings[0]?.demoStep : undefined;
  const filename = single && step
    ? `legal-data-universe-lead-${step}-findings-memo.pdf`
    : 'legal-data-universe-findings-memo.pdf';
  const lines: PdfLine[] = [];
  const add = (line: PdfLine) => lines.push(line);
  const body = (text: string, extra: Partial<PdfLine> = {}) => add({ text, size: 10, ...extra });
  const small = (text: string, extra: Partial<PdfLine> = {}) => add({ text, size: 8.5, color: MUTED, ...extra });
  const h1 = (text: string) => add({ text, size: 15, bold: true, gapBefore: 16, color: [0.05, 0.05, 0.05] });
  const h2 = (text: string) => add({ text, size: 12, bold: true, gapBefore: 12 });
  const h3 = (text: string) => add({ text, size: 10.5, bold: true, gapBefore: 8 });
  const bullet = (text: string) => body(`- ${text}`, { indent: 14 });

  add({ text: 'ATTORNEY WORK PRODUCT - DRAFT FINDINGS MEMORANDUM', size: 8.5, bold: true, align: 'center', color: GOLD });
  add({ text: 'Legal Data Universe', size: 22, bold: true, align: 'center', gapBefore: 8 });
  add({ text: single && step ? `Lead ${step} Findings Memorandum` : 'Findings Memorandum', size: 15, align: 'center', gapBefore: 2 });
  add({ text: '', rule: true, gapBefore: 8 });
  body(`Matter: NovaChip / Reyes Falcon source-code investigation (fictional synthetic matter)`, { gapBefore: 8 });
  body(`Selection: ${input.selectionLabel}`);
  body(`Date exported: ${input.exportedAt}`);
  body(`Corpus: ${input.corpusLabel}`);
  small('Synthetic demonstration data only - not client evidence, not connected to Relativity or any live matter.');

  h1('Executive Summary');
  body(`${findings.length} investigator-approved finding(s) are included. Rejected and undecided drafts are excluded.`);
  findings.forEach((finding, i) => {
    body(`${i + 1}. ${finding.title ?? `Finding ${finding.id}`}${finding.verdict ? ` [${finding.verdict.toUpperCase()}]` : ''}`, { bold: true, gapBefore: 6 });
    body(headlineClaim(finding.claim), { indent: 14 });
  });
  if (findings.some((f) => f.demoStep === 3)) {
    body('Bottom line: the evidence establishes acquisition, an external tuning-parameter transfer, and direct delivery of scheduler_core.ts to a HelixWorks engineer. It does not establish upload to or use inside HelixWorks systems.', { bold: true, gapBefore: 8 });
  }

  h1('Approved Findings');
  findings.forEach((finding, index) => {
    h2(`${index + 1}. ${finding.title ?? `Finding ${finding.id}`}`);
    small([
      `Finding ID: ${finding.id}`,
      finding.verdict ? `Verdict: ${finding.verdict}` : undefined,
      finding.sourceLabel ? `Source: ${finding.sourceLabel}` : undefined,
      finding.decidedAt ? `Approved: ${finding.decidedAt}` : 'Approved by investigator',
    ].filter(Boolean).join(' | '));
    body(headlineClaim(finding.claim), { bold: true, gapBefore: 4 });
    if (finding.question) {
      h3('Question asked');
      body(finding.question);
    }
    h3('Why it matters');
    body(whyItMatters(finding));
    h3('Evidence supporting the finding');
    if (finding.citations?.length) {
      for (const c of finding.citations) {
        const r = store.getRecord(c.recordId);
        bullet(`${c.recordId}${r ? ` - ${r.title} (${r.date.slice(0, 10)})` : ''}: "${c.quote}"`);
      }
    } else if (finding.citationIds.length) {
      bullet(`Cited records: ${finding.citationIds.join(', ')} (metadata-grounded; no verbatim quotation is claimed).`);
    } else bullet('No citation was retained with this finding. Treat this as a defect requiring re-drafting before reliance.');

    h3('Counterevidence and limitations');
    if (finding.counterCitations?.length) {
      for (const c of finding.counterCitations) bullet(`${c.recordId}: "${c.quote}"`);
    }
    if (finding.gaps?.length) for (const gap of finding.gaps) bullet(gap);
    if (!finding.counterCitations?.length && !finding.gaps?.length) {
      bullet('No structured counterevidence/gap field was retained with this draft; the full claim and audit trail should be reviewed before reliance.');
    }
    h3('Recommended next step');
    body(recommendedNextStep(finding));
  });

  h1('Investigation Scope and Method');
  body(`The active corpus is ${input.corpusLabel}. It contains ${store.size} synthetic records. Only the ${findings.length} approved finding(s) named above are included in this memo.`);
  body('Deterministic tools performed retrieval, counting, relationship/family tracing, file-fingerprint comparison, and verbatim-quote verification. The AI planner/synthesizer was restricted to the evidence supplied by those tools. A human investigator approved or rejected every draft; no finding in this memo was auto-approved.');
  body('Planted or synthetic story evidence is not represented as real-world evidence. Identity, dates, organizations, and content are fictional demonstration data.');

  h1('Appendix A - Source Records and Provenance');
  const citedIds = [...new Set(findings.flatMap((f) => [
    ...(f.citations ?? []).map((c) => c.recordId),
    ...(f.counterCitations ?? []).map((c) => c.recordId),
    ...f.citationIds,
  ]))].sort();
  for (const id of citedIds) {
    const r = store.getRecord(id);
    if (!r) { body(`${id}: cited record not found in active store.`, { bold: true }); continue; }
    h3(`${id} - ${r.title}`);
    const lf = r.loadFile;
    const sec = lf?.sec;
    const people = r.personIds.map((p) => store.personName(p)).join(', ');
    small(`Date: ${r.date} (${r.dateConfidence}) | Kind: ${r.kind} | Custodian: ${sec?.custodian ?? r.custodianId} | People: ${people}`);
    if (lf) small(`File: ${lf.fileName} | MIME: ${lf.mimeType} | MD5: ${lf.md5}${lf.familyId ? ` | Family: ${lf.familyId}` : ''}${lf.parentId ? ` | Parent: ${lf.parentId}` : ''}${lf.sourcePath ? ` | Source path: ${lf.sourcePath}` : ''}`);
    small(`Provenance: ${r.provenance.sourceSystem} | Collection: ${r.provenance.collectionId} | Content hash: ${r.provenance.contentHash} | Ingested: ${r.provenance.ingestedAt}`);
  }

  h1('Appendix B - Search Executions');
  if (!input.searchExecutions.length) body('No search executions were recorded in this session.');
  for (const e of input.searchExecutions) {
    bullet(`${e.id} (${e.at}) [${e.actor}] ${e.operation}: "${e.executedQuery}" - ${e.hitCount} of ${e.corpusSize} hit(s), returned ${e.returnedCount ?? e.hitCount}${e.truncated ? ', TRUNCATED' : ''}; corpus ${e.corpusId} v${e.corpusVersion}.`);
  }

  h1('Appendix C - Approval and Audit Trail');
  for (const finding of findings) {
    bullet(`${finding.id}: ${finding.status}${finding.decidedAt ? ` at ${finding.decidedAt}` : ''}${finding.runId != null ? `; run #${finding.runId}` : ''}${finding.sourceLabel ? `; ${finding.sourceLabel}` : ''}.`);
  }
  h2('Session audit events');
  if (!input.audit.length) body('No audit events were supplied.');
  for (const event of input.audit) bullet(`${event.at} [${event.actor}] ${event.action}: ${event.detail}`);

  h1('Appendix D - Machine-Readable Companion');
  body('The ZIP export includes approved-findings.json with the same approved claims, verbatim citations, counter-citations, gaps, provenance, search executions, annotations, and audit trail in structured form. The PDF is the attorney-facing presentation; JSON exists for reproducibility and downstream processing, not as the primary work product.');

  return { lines, filename };
}

export function buildFindingsJsonPayload(input: FindingsMemoInput & {
  objective: string;
  annotations: unknown[];
}): Record<string, unknown> {
  return {
    type: 'legal-data-universe-approved-findings',
    exportedAt: input.exportedAt,
    corpus: input.corpusLabel,
    selection: input.selectionLabel,
    objective: input.objective,
    findings: input.findings.map((finding) => ({
      ...finding,
      headline: headlineClaim(finding.claim),
      citations: (finding.citations ?? []).map((c) => ({
        ...c,
        record: input.store.getRecord(c.recordId) ?? null,
        provenance: input.store.provenanceOf(c.recordId) ?? null,
      })),
      counterCitations: (finding.counterCitations ?? []).map((c) => ({
        ...c,
        record: input.store.getRecord(c.recordId) ?? null,
        provenance: input.store.provenanceOf(c.recordId) ?? null,
      })),
    })),
    annotations: input.annotations,
    audit: input.audit,
    searchExecutions: input.searchExecutions,
    note: 'Synthetic demonstration records only - not case evidence. Quotes were machine-verified verbatim before drafting; approval is the investigator\'s.',
  };
}

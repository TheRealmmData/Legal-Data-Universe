/**
 * Synthetic trade-secret / source-code-theft demo universe (M4).
 * Deterministic (seeded), 1,500 records by default, with
 * Relativity-style load-file metadata on EVERY record (file name,
 * extension, MIME, Bates, family/thread, hash, size, author,
 * source path) so metadata Q&A has real fields to compute over.
 *
 * Story (fictional; discoverable, with competing explanations):
 * NovaChip senior engineer Elena Reyes resigns, joins competitor
 * HelixWorks. Signals: off-hours repo clones, a personal-email
 * forward, USB activity. Counter-signals: an approved open-source
 * contribution of the same module, a license memo, manager-approved
 * customer debug transfer. Ground truth below marks relevance —
 * it never states a legal conclusion.
 *
 * The accepted Atlas fixture/galaxy corpora are untouched; this
 * is an additional selectable demo universe.
 */
import type { EvidenceRecord } from '../types.ts';
import type { GeneratedCorpus } from './generator.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORGS = [
  { id: 'org-eng', name: 'NovaChip Engineering', domain: 'novachip.com' },
  { id: 'org-leg', name: 'NovaChip Legal', domain: 'novachip.com' },
  { id: 'org-sec', name: 'NovaChip Security & IT', domain: 'novachip.com' },
  { id: 'org-hlx', name: 'HelixWorks (competitor)', domain: 'helixworks.com' },
];
/** Deterministic corporate mailbox per person (domain-verified
 * coloring, owner 2026-11-01): NovaChip staff share the
 * novachip.com domain (sub-org stays authored territory);
 * HelixWorks staff carry helixworks.com. */
export function personEmail(name: string, orgId: string): string {
  const domain = ORGS.find((o) => o.id === orgId)?.domain ?? 'novachip.com';
  const [first, ...rest] = name.toLowerCase().split(' ');
  return `${first}.${rest.join('.')}@${domain}`;
}
export function orgDomain(orgId: string): string {
  return ORGS.find((o) => o.id === orgId)?.domain ?? 'novachip.com';
}

/**
 * Domain verification for one record (owner, 2026-11-01): the
 * sender/author's corporate mailbox domain vs the record
 * organization's domain, PLUS sender home-org vs record org.
 * NovaChip sub-orgs share novachip.com by design, so domainOk
 * verifies at company level while homeOrgOk carries the
 * sub-org cross-functional signal (e.g. HR writing to a Legal
 * matter). Records without any person resolve empty/false.
 */
export function recordDomainCheck(record: {
  personIds: string[];
  participants?: { personId: string; role: string }[];
  organizationIds?: string[];
}): { senderDomain: string; domainOk: boolean; senderHomeOrg: string; homeOrgOk: boolean } {
  const senderId = record.participants?.find(
    (p) => p.role === 'sender' || p.role === 'author',
  )?.personId ?? record.personIds[0] ?? '';
  const info = byId.get(senderId);
  if (!info) return { senderDomain: '', domainOk: false, senderHomeOrg: '', homeOrgOk: false };
  const senderDomain = personEmail(info.name, info.org);
  const recordOrg = record.organizationIds?.[0] ?? '';
  return {
    senderDomain,
    domainOk: orgDomain(info.org) === orgDomain(recordOrg),
    senderHomeOrg: info.org,
    homeOrgOk: info.org === recordOrg,
  };
}
const PEOPLE: [string, string, string, string][] = [
  // id, name, org, custodian — INDIVIDUAL custodians (SEC
  // CUSTODIAN is a person, never a department; Round 3 fail).
  ['p-elena', 'Elena Reyes', 'org-eng', 'cust-elena'],
  ['p-marcus', 'Marcus Webb', 'org-eng', 'cust-marcus'],
  ['p-sofia', 'Sofia Lindqvist', 'org-eng', 'cust-sofia'],
  ['p-raj', 'Raj Patel', 'org-eng', 'cust-raj'],
  ['p-karen', 'Karen Doyle', 'org-leg', 'cust-karen'],
  ['p-david', 'David Osei', 'org-leg', 'cust-david'],
  ['p-ivan', 'Ivan Petrov', 'org-sec', 'cust-ivan'],
  ['p-grace', 'Grace Liu', 'org-sec', 'cust-grace'],
  ['p-nina', 'Nina Brooks', 'org-hlx', 'cust-nina'],
  ['p-oleg', 'Oleg Sorin', 'org-hlx', 'cust-oleg'],
  ['p-hannah', 'Hannah Kim', 'org-eng', 'cust-hannah'],
  ['p-chris', 'Chris Nolan', 'org-sec', 'cust-chris'],
];
const CUSTODIANS: [string, string][] = PEOPLE.map(([, name, , cust]) => {
  const [first, ...rest] = name.split(' ');
  return [cust, `${rest.join(' ')}, ${first}`] as [string, string];
});
const byId = new Map(PEOPLE.map(([id, name, org, cust]) => [id, { name, org, cust }]));
const MIME: Record<string, string> = {
  msg: 'application/vnd.ms-outlook', eml: 'message/rfc822', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ts: 'text/typescript', py: 'text/x-python', zip: 'application/zip', txt: 'text/plain',
  md: 'text/markdown', log: 'text/plain', png: 'image/png',
};

let batesCounter = 0;
function loadFile(
  rnd: () => number, kind: string, title: string,
  opts: { ext?: string; familyId?: string; parentId?: string; threadId?: string; author?: string; md5?: string } = {},
): NonNullable<EvidenceRecord['loadFile']> {
  const ext = opts.ext ?? (kind === 'email'
    ? (rnd() < 0.7 ? 'msg' : 'eml')
    : kind === 'document'
      ? ['docx', 'pdf', 'xlsx', 'pptx', 'ts', 'py'][Math.floor(rnd() * 6)]
      : ['txt', 'md', 'log'][Math.floor(rnd() * 3)]);
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'record';
  batesCounter += 1;
  return {
    fileName: `${base}.${ext}`,
    extension: ext,
    mimeType: MIME[ext] ?? 'application/octet-stream',
    bates: `NC${String(batesCounter).padStart(7, '0')}`,
    ...(opts.familyId ? { familyId: opts.familyId } : {}),
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.threadId ? { threadId: opts.threadId } : {}),
    md5: opts.md5 ?? Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join(''),
    fileSizeKB: Math.max(1, Math.round(rnd() * (ext === 'zip' ? 48000 : 900))),
    ...(opts.author ? { author: opts.author } : {}),
    sourcePath: `/collections/novachip/${opts.author?.split(' ')[0]?.toLowerCase() ?? 'shared'}/${base}.${ext}`,
  };
}

const D = (d: string) => d;
export function buildTradeSecretCorpus(seed = 7, target = 3000): GeneratedCorpus {
  const rnd = mulberry32(seed);
  batesCounter = 0;
  const records: EvidenceRecord[] = [];
  const prov = {
    sourceSystem: 'synthetic-trade-secret-generator',
    collectionId: 'novachip-trade-secret',
    sourcePath: `trade-secret/${seed}`,
    contentHash: `seed-${seed}`,
    ingestedAt: '2026-10-31T00:00:00Z',
  };
  const add = (r: Omit<EvidenceRecord, 'provenance' | 'loadFile'> & {
    ext?: string; familyId?: string; parentId?: string; threadId?: string;
  }) => {
    const { ext, familyId, parentId, threadId, ...rec } = r;
    const lf = loadFile(rnd, rec.kind, rec.title, {
      ext, familyId, parentId, threadId,
      author: byId.get(rec.personIds[0])?.name,
    });
    // SEC metadata (sec-fields.ts inventory). Bates blank.
    const nameOf = (pid: string) => byId.get(pid)?.name ?? pid;
    const byRole = (role: string) => (rec.participants ?? [])
      .filter((p) => p.role === role).map((p) => nameOf(p.personId)).join('; ');
    const isEmail = rec.kind === 'email';
    // ~12% off-hours timestamps so late-night pattern analysis
    // has a real (labelled synthetic) signal to find.
    const hh = rnd() < 0.12 ? [22, 23, 0, 1, 2, 3][Math.floor(rnd() * 6)] : 7 + Math.floor(rnd() * 12);
    const time = `${String(hh > 12 ? hh - 12 : hh).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
    const [yy, mm, dd] = rec.date.slice(0, 10).split('-');
    const secDate = `${mm}/${dd}/${yy}`;
    const custName = CUSTODIANS.find(([id]) => id === rec.custodianId)?.[1]
      ?? nameOf(rec.personIds[0] ?? '');
    lf.sec = {
      firstBates: '', lastBates: '', attachRange: '', begAttach: '', endAttach: '',
      parentBates: '', childBates: '',
      custodian: custName,
      from: isEmail ? byRole('sender') : nameOf(rec.personIds[0] ?? ''),
      to: isEmail ? (byRole('recipient') || byRole('sender')) : '',
      cc: isEmail ? byRole('cc') : '', bcc: '',
      subject: rec.title,
      dateSent: isEmail ? secDate : '', timeSent: isEmail ? time : '',
      link: lf.sourcePath ?? '', mimeType: lf.mimeType,
      fileExtension: lf.extension.toUpperCase(),
      author: isEmail ? '' : nameOf(rec.personIds[0] ?? ''),
      dateCreated: isEmail ? '' : secDate, timeCreated: isEmail ? '' : time,
      dateModified: isEmail ? '' : secDate, timeModified: isEmail ? '' : time,
      dateAccessed: isEmail ? '' : secDate, timeAccessed: isEmail ? '' : time,
      printedDate: '',
      fileSizeKB: lf.fileSizeKB,
      pgCount: Math.max(1, Math.ceil(rec.body.length / 1800)),
      path: isEmail ? '' : (lf.sourcePath ?? ''),
      intFilePath: isEmail ? `Personal Folders\\Inbox\\${lf.fileName}` : '',
      intMsgId: isEmail ? `<${rec.id}@novachip.local>` : '',
      md5: lf.md5, extractedText: rec.body,
    };
    records.push({
      ...rec,
      provenance: prov,
      loadFile: lf,
      links: {
        ...(rec.links ?? {}),
        ...(familyId ? { familyId } : {}),
      },
    });
  };
  const P = (sender: string, ...recipients: string[]) => [
    { personId: sender, role: 'sender' as const },
    ...recipients.map((personId) => ({ personId, role: 'recipient' as const })),
  ];

  // ---- Authored core: the discoverable story (ids ts-0xx) ----
  add({ id: 'ts-001', kind: 'email', title: 'Resignation - Elena Reyes', date: D('2026-06-02'), dateConfidence: 'verified', custodianId: 'cust-elena', personIds: ['p-elena', 'p-marcus'], participants: P('p-elena', 'p-marcus'), organizationIds: ['org-eng'], conceptTags: ['resignation'], threadId: 'thr-resign', body: 'Marcus - I am resigning effective June 19 to pursue a new opportunity. I will complete the Falcon cache handover and document the remaining scheduler work before I leave.' });
  add({ id: 'ts-002', kind: 'email', title: 'Re: Resignation - Elena Reyes', date: D('2026-06-02'), dateConfidence: 'verified', custodianId: 'cust-elena', personIds: ['p-marcus', 'p-elena'], participants: P('p-marcus', 'p-elena'), organizationIds: ['org-eng'], conceptTags: ['resignation'], threadId: 'thr-resign', links: { inReplyToId: 'ts-001' }, body: 'Sorry to lose you. Please prioritise the Falcon handover notes and return all devices by June 19 per policy.' });
  add({ id: 'ts-003', kind: 'note', title: 'Git audit log extract - falcon-scheduler', date: D('2026-06-14'), dateConfidence: 'verified', custodianId: 'cust-ivan', personIds: ['p-ivan', 'p-elena'], participants: [{ personId: 'p-ivan', role: 'author' }], organizationIds: ['org-sec'], conceptTags: ['repo-access', 'exfiltration-signal'], ext: 'log', body: 'Audit extract: user ereyes cloned falcon-scheduler (full history) 2026-06-13 23:41 and again 2026-06-14 00:17 from a non-standard host. Two clones, 1.9 GB total. Normal pattern for this user is shallow CI fetches during work hours.' });
  add({ id: 'ts-004', kind: 'note', title: 'USB device event - workstation WS-4471', date: D('2026-06-15'), dateConfidence: 'verified', custodianId: 'cust-ivan', personIds: ['p-chris', 'p-elena'], participants: [{ personId: 'p-chris', role: 'author' }], organizationIds: ['org-sec'], conceptTags: ['exfiltration-signal'], ext: 'log', body: 'Endpoint log: unregistered USB mass-storage device mounted on WS-4471 (E. Reyes) 2026-06-15 18:03, write volume approx 640 MB over 22 minutes. Device serial not in approved inventory.' });
  add({ id: 'ts-005', kind: 'email', title: 'Falcon notes for myself', date: D('2026-06-16'), dateConfidence: 'verified', custodianId: 'cust-elena', personIds: ['p-elena'], participants: P('p-elena'), organizationIds: ['org-eng'], conceptTags: ['exfiltration-signal'], familyId: 'fam-falcon-notes', body: 'Forwarding my Falcon design notes and scheduler tuning parameters to my personal mailbox so I can finish the handover doc from home this weekend. Attachment: falcon-tuning-notes.docx' });
  add({ id: 'ts-006', kind: 'document', title: 'falcon-tuning-notes', date: D('2026-06-16'), dateConfidence: 'verified', custodianId: 'cust-elena', personIds: ['p-elena'], participants: [{ personId: 'p-elena', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['falcon-scheduler'], ext: 'docx', familyId: 'fam-falcon-notes', parentId: 'ts-005', body: 'Falcon scheduler tuning parameters: cache eviction thresholds, NUMA pinning matrix, and benchmark deltas vs the baseline scheduler. Compiled from internal performance runs March-May 2026.' });
  add({ id: 'ts-007', kind: 'document', title: 'Open-source contribution approval - falcon-cache-utils', date: D('2026-03-11'), dateConfidence: 'verified', custodianId: 'cust-karen', personIds: ['p-karen', 'p-elena'], participants: [{ personId: 'p-karen', role: 'author' }], organizationIds: ['org-leg'], conceptTags: ['licensing', 'exculpatory'], ext: 'pdf', body: 'Approved: E. Reyes may publish the falcon-cache-utils helper library (eviction statistics only, no scheduler core) under Apache-2.0. Approval does NOT cover scheduler tuning parameters or benchmark data.' });
  add({ id: 'ts-008', kind: 'email', title: 'Customer debug bundle approved', date: D('2026-05-28'), dateConfidence: 'verified', custodianId: 'cust-elena', personIds: ['p-marcus', 'p-elena'], participants: P('p-marcus', 'p-elena'), organizationIds: ['org-eng'], conceptTags: ['exculpatory'], threadId: 'thr-debug', body: 'Approved as requested: you may copy the Falcon debug bundle (logs + config, no source) to removable media for the customer onsite session on May 29. Log the device serial with IT when done.' });
  add({ id: 'ts-009', kind: 'email', title: 'Welcome to HelixWorks', date: D('2026-06-29'), dateConfidence: 'verified', custodianId: 'cust-nina', personIds: ['p-nina', 'p-elena'], participants: P('p-nina', 'p-elena'), organizationIds: ['org-hlx'], conceptTags: ['competitor'], body: 'Welcome aboard, Elena. Reminder of your obligations: do not bring or use any NovaChip confidential material here. Your first project is our clean-room scheduler evaluation; Legal has the protocol.' });
  add({ id: 'ts-010', kind: 'document', title: 'HelixWorks clean-room protocol', date: D('2026-06-30'), dateConfidence: 'verified', custodianId: 'cust-nina', personIds: ['p-nina'], participants: [{ personId: 'p-nina', role: 'author' }], organizationIds: ['org-hlx'], conceptTags: ['competitor', 'exculpatory'], ext: 'pdf', body: 'Clean-room protocol v3: engineers with competitor backgrounds work from public specifications only; all design inputs logged; no external code or documents may be introduced without Legal review.' });
  add({ id: 'ts-011', kind: 'email', title: 'Litigation hold - Reyes / Falcon', date: D('2026-07-08'), dateConfidence: 'verified', custodianId: 'cust-karen', personIds: ['p-karen', 'p-marcus', 'p-ivan', 'p-hannah'], participants: P('p-karen', 'p-marcus', 'p-ivan', 'p-hannah'), organizationIds: ['org-leg'], conceptTags: ['legal-hold'], body: 'Preserve all records relating to Elena Reyes, the Falcon scheduler, repository access June 2026, and endpoint/USB logs. Suspend auto-deletion for custodians Reyes, Webb, and the security log archive.' });
  add({ id: 'ts-012', kind: 'document', title: 'Falcon scheduler design (extract)', date: D('2026-04-19'), dateConfidence: 'verified', custodianId: 'cust-marcus', personIds: ['p-elena', 'p-sofia'], participants: [{ personId: 'p-elena', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['falcon-scheduler', 'source-code'], ext: 'docx', body: 'Design extract: the Falcon scheduler combines work-stealing queues with a two-tier cache. The tuning matrix in section 4 is the result of three months of profiling and is confidential.' });
  add({ id: 'ts-013', kind: 'document', title: 'scheduler_core.ts (repository snapshot)', date: D('2026-06-13'), dateConfidence: 'derived', custodianId: 'cust-marcus', personIds: ['p-elena'], participants: [{ personId: 'p-elena', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['source-code'], ext: 'ts', body: 'Repository snapshot of scheduler_core.ts at the time of the audit-log clones (ts-003). Exported for forensic comparison against any later similar code.' });
  add({ id: 'ts-014', kind: 'email', title: 'Exit interview summary - Reyes', date: D('2026-06-19'), dateConfidence: 'verified', custodianId: 'cust-hannah', personIds: ['p-hannah', 'p-karen'], participants: P('p-hannah', 'p-karen'), organizationIds: ['org-leg'], conceptTags: ['resignation'], body: 'Exit interview completed. Reyes confirmed return of laptop and badge, denied retaining company material, and declined to name her new employer. No exit device scan was performed (process gap noted).' });
  add({ id: 'ts-015', kind: 'note', title: 'Forensic timeline notes (draft)', date: D('2026-07-15'), dateConfidence: 'derived', custodianId: 'cust-ivan', personIds: ['p-ivan'], participants: [{ personId: 'p-ivan', role: 'author' }], organizationIds: ['org-sec'], conceptTags: ['exfiltration-signal'], ext: 'md', body: 'Working timeline: resignation June 2; clones June 13-14 (ts-003); USB June 15 (ts-004); personal forward June 16 (ts-005/006); last day June 19; Helix start June 29. Alternative explanations to test: approved debug transfer (ts-008, different date/device), approved OSS (ts-007, scope-limited).' });
  add({ id: 'ts-016', kind: 'email', title: 'Reminder: exit device scans', date: D('2026-07-20'), dateConfidence: 'verified', custodianId: 'cust-ivan', personIds: ['p-grace', 'p-ivan'], participants: P('p-grace', 'p-ivan'), organizationIds: ['org-sec'], conceptTags: ['policy'], body: 'Following the Reyes matter, exit device scans are now mandatory for departing engineers with production repository access.' });
  add({ id: 'ts-017', kind: 'note', title: 'Teams chat - #falcon-war-room (Nightjar)', date: D('2026-04-23'), dateConfidence: 'verified', custodianId: 'cust-sofia', personIds: ['p-sofia', 'p-raj', 'p-elena', 'p-marcus'], participants: [{ personId: 'p-sofia', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['falcon-scheduler', 'workplace-chat'], ext: 'txt', threadId: 'chat-war-room', body: 'Teams chat extract, #falcon-war-room. Sofia: Marcus just presented Elena\'s scheduler benchmark as a team result and forgot her name twice. Raj: She built the thing. Elena: I am done being invisible. Nightjar calls again Friday. Sofia: Your mystery headhunter has a codename now? Elena: Do not put a company name in chat.' });
  add({ id: 'ts-018', kind: 'note', title: 'Teams chat - #falcon-war-room (mirror job)', date: D('2026-06-13'), dateConfidence: 'verified', custodianId: 'cust-grace', personIds: ['p-grace', 'p-ivan', 'p-elena', 'p-raj'], participants: [{ personId: 'p-grace', role: 'author' }], organizationIds: ['org-sec'], conceptTags: ['repo-access', 'workplace-chat', 'exculpatory'], ext: 'txt', threadId: 'chat-war-room', body: 'Teams chat extract, #falcon-war-room. Grace: Reminder that the scheduled FALCON-MIRROR disaster-recovery job performs a full clone at 23:30 under the svc-mirror account. Ivan: Correct, and any clone under a named engineer account is a separate event. Elena: My local cache is corrupt again, so do not panic if I replace it tonight. Raj: Famous last words.' });
  add({ id: 'ts-019', kind: 'email', title: 'Source code escrow verification - April', date: D('2026-04-10'), dateConfidence: 'verified', custodianId: 'cust-karen', personIds: ['p-karen', 'p-ivan', 'p-marcus'], participants: P('p-karen', 'p-ivan', 'p-marcus'), organizationIds: ['org-leg'], conceptTags: ['source-code', 'exculpatory'], body: 'The independent escrow agent verified the sealed Falcon source-code snapshot on NovaChip premises. No source code was sent to HelixWorks or any external party for this April escrow verification, and the sealed media remained in Legal custody.' });
  add({ id: 'ts-020', kind: 'note', title: 'Text message - Reyes to Raj (USB)', date: D('2026-06-17'), dateConfidence: 'verified', custodianId: 'cust-raj', personIds: ['p-elena', 'p-raj'], participants: [{ personId: 'p-elena', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['exfiltration-signal', 'workplace-chat'], ext: 'txt', threadId: 'chat-reyes-raj', body: 'Text message extract. Elena: If Security asks, the USB was the customer debug kit. Raj: That was May, and that serial was logged. Elena: I know. Please do not put this in email. I panicked and need time to think.' });
  add({ id: 'ts-021', kind: 'note', title: 'Teams chat - #falcon-war-room (deleted messages)', date: D('2026-06-17'), dateConfidence: 'derived', custodianId: 'cust-sofia', personIds: ['p-sofia', 'p-raj', 'p-elena'], participants: [{ personId: 'p-sofia', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['workplace-chat', 'falcon-scheduler'], ext: 'txt', threadId: 'chat-war-room', body: 'Teams chat extract with a retention gap. Sofia: Three messages from Elena were deleted here at 18:42. Raj: Do not turn a deletion into a crime scene. Sofia: I only saw a filename over her shoulder: scheduler_core - final FINAL.zip. Raj: Then preserve the chat and stop speculating.' });
  add({ id: 'ts-022', kind: 'email', title: 'For your eyes only - scheduler_core.ts', date: D('2026-06-18'), dateConfidence: 'verified', custodianId: 'cust-elena', personIds: ['p-elena', 'p-oleg'], participants: P('p-elena', 'p-oleg'), organizationIds: ['org-eng'], conceptTags: ['source-code', 'competitor', 'exfiltration-signal'], familyId: 'fam-scheduler-transfer', links: { attachmentIds: ['ts-023'] }, body: 'Oleg - attached is the current NovaChip scheduler_core.ts from my June 13 clone. I know the clean-room rules. Just tell me whether it compiles and do not forward it.' });
  add({ id: 'ts-023', kind: 'document', title: 'scheduler_core.ts (email attachment)', date: D('2026-06-18'), dateConfidence: 'verified', custodianId: 'cust-elena', personIds: ['p-elena'], participants: [{ personId: 'p-elena', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['source-code', 'falcon-scheduler'], ext: 'ts', familyId: 'fam-scheduler-transfer', parentId: 'ts-022', body: 'NovaChip Confidential scheduler core. File: scheduler_core.ts. The exported schedule function uses work-stealing queues and the two-tier Falcon cache. This attachment was exported from the falcon-scheduler repository on June 13.' });
  // Computed smoking-gun fingerprint: the emailed attachment is
  // byte-identical to the internal repository snapshot. The
  // public extract (ts-026) deliberately keeps a different hash.
  for (const id of ['ts-013', 'ts-023']) {
    const lf = records.find((r) => r.id === id)?.loadFile;
    if (lf) { lf.md5 = 'fa1c0de5c0ffee1234567890abcdef42'; if (lf.sec) lf.sec.md5 = lf.md5; }
  }
  add({ id: 'ts-024', kind: 'email', title: 'Re: For your eyes only - scheduler_core.ts', date: D('2026-06-19'), dateConfidence: 'verified', custodianId: 'cust-oleg', personIds: ['p-oleg', 'p-elena'], participants: P('p-oleg', 'p-elena'), organizationIds: ['org-hlx'], conceptTags: ['source-code', 'competitor'], links: { inReplyToId: 'ts-022' }, body: 'Received. The scheduler_core.ts file compiles on my air-gapped laptop. I have not uploaded it to HelixWorks systems, and I have not shown it to Nina.' });
  add({ id: 'ts-025', kind: 'note', title: 'Teams chat - HelixWorks scheduler evaluation', date: D('2026-06-20'), dateConfidence: 'verified', custodianId: 'cust-nina', personIds: ['p-oleg', 'p-nina'], participants: [{ personId: 'p-oleg', role: 'author' }], organizationIds: ['org-hlx'], conceptTags: ['source-code', 'competitor', 'workplace-chat'], ext: 'txt', threadId: 'chat-helix-scheduler', body: 'Teams chat extract. Oleg: I deleted the ZIP Elena sent after the air-gapped build worked. Nina: You what? Stop touching the laptop, preserve everything, and call Legal now. Oleg: It never reached our repo. Nina: That does not make receipt disappear.' });
  add({ id: 'ts-026', kind: 'document', title: 'scheduler_core.ts (public cache-utils extract)', date: D('2026-03-12'), dateConfidence: 'verified', custodianId: 'cust-raj', personIds: ['p-raj', 'p-elena'], participants: [{ personId: 'p-raj', role: 'author' }], organizationIds: ['org-eng'], conceptTags: ['source-code', 'licensing', 'exculpatory'], ext: 'ts', body: 'Public cache-utils extract approved for Apache-2.0 publication. This public scheduler_core.ts contains eviction statistics helpers only. It is not the confidential Falcon scheduler, contains no tuning matrix, and predates the June repository snapshot.' });

  // ---- Background volume: realistic communities + varied docs ----
  const COMMUNITIES: [string, string[]][] = [
    ['falcon-eng', ['p-marcus', 'p-elena', 'p-sofia', 'p-raj']],
    ['legal', ['p-karen', 'p-david', 'p-hannah']],
    ['security', ['p-ivan', 'p-grace', 'p-chris']],
    ['helix', ['p-nina', 'p-oleg']],
  ];
  const TOPICS: [string, string, string[]][] = [
    // concept, title fragment, body templates with {n}/{proj} slots
    ['roadmap', 'Q3 roadmap sync', ['Roadmap item {n}: {proj} milestones moved by {d} days after the dependency review.', 'Updated the {proj} plan: {n} tickets re-scoped, owners assigned, risks logged.']],
    ['release', 'Release candidate notes', ['RC{n} for {proj} passed {d} of 40 regression suites; remaining failures triaged in the tracker.', 'Freeze window for {proj} starts Friday; {n} changes still in review.']],
    ['soc2', 'SOC 2 evidence request', ['Auditors asked for {n} access-review exports covering Q{d}; owners please confirm completion.', 'Control evidence pack {n} uploaded; two exceptions documented with remediation dates.']],
    ['hiring', 'Interview loop schedule', ['Loop for candidate {n} set for Thursday; panel includes {d} interviewers and a coding session.', 'Referral bonus reminder: {n} open roles on the platform team this quarter.']],
    ['vendor', 'Vendor contract renewal', ['Renewal draft {n} redlines sent; liability cap and DPA terms are the open items.', 'Vendor assessment {n}: security questionnaire returned with {d} findings, none critical.']],
    ['patents', 'Invention disclosure review', ['Disclosure {n} reviewed: novelty search requested before the filing deadline.', 'Patent committee notes {n}: two disclosures deferred pending prior-art results.']],
    ['falcon-scheduler', 'Falcon perf run', ['Nightly perf run {n}: p99 latency {d} ms on the standard mix; cache hit rate stable.', 'Scheduler experiment {n} results posted; throughput delta within noise (repeat {d} times).']],
    ['repo-access', 'Repository access review', ['Quarterly access review {n}: {d} stale grants removed across engineering repos.', 'Access request {n} approved for read-only analytics on the build-logs archive.']],
    ['source-code', 'Source code review', ['Source code review {n} for {proj}: {d} comments, two blocking; the source code for the scheduler path needs a second reviewer.', 'License scan {n}: third-party source code in {proj} cleared against the approved list; one copyleft exception documented.', 'Escrow deposit {n}: Falcon source code snapshot verified by the escrow agent; hash recorded in the register.']],
    ['code-quality', 'Code freeze checklist', ['Code freeze item {n}: confirm no debug code remains in the {proj} release branch before sign-off.', 'Static analysis {n} flagged {d} issues in legacy code; owners assigned with due dates.']],
  ];
  const PROJECTS = ['Falcon', 'Kestrel', 'Harrier', 'Osprey', 'Merlin', 'Condor'];
  const start = Date.parse('2026-01-05T00:00:00Z');
  const spanDays = 210;
  let bg = 0;
  while (records.length < target) {
    bg += 1;
    const [, members] = COMMUNITIES[Math.floor(rnd() * COMMUNITIES.length)];
    const sender = members[Math.floor(rnd() * members.length)];
    let recipient = members[Math.floor(rnd() * members.length)];
    if (recipient === sender) recipient = members[(members.indexOf(sender) + 1) % members.length];
    // ~8% cross-organization mail (external-traffic queries).
    if (rnd() < 0.08) {
      const all = PEOPLE.map(([id]) => id).filter((id) => id !== sender);
      recipient = all[Math.floor(rnd() * all.length)];
    }
    const [concept, titleFrag, templates] = TOPICS[Math.floor(rnd() * TOPICS.length)];
    const body = templates[Math.floor(rnd() * templates.length)]
      .split('{n}').join(String(100 + Math.floor(rnd() * 900)))
      .split('{d}').join(String(2 + Math.floor(rnd() * 28)))
      .split('{proj}').join(PROJECTS[Math.floor(rnd() * PROJECTS.length)]);
    const date = new Date(start + Math.floor(rnd() * spanDays) * 86400000).toISOString().slice(0, 10);
    const kindRoll = rnd();
    const kind = kindRoll < 0.62 ? 'email' : kindRoll < 0.85 ? 'note' : 'document';
    const threadId = `thr-${concept}-${Math.floor(Date.parse(date) / (7 * 86400000))}`;
    add({
      id: `bg-${String(bg).padStart(4, '0')}`,
      kind: kind as EvidenceRecord['kind'],
      title: `${titleFrag} ${100 + Math.floor(rnd() * 900)}`,
      body, date, dateConfidence: 'verified',
      custodianId: byId.get(sender)?.cust ?? 'cust-marcus',
      personIds: [sender, recipient],
      participants: kind === 'email'
        ? [
            { personId: sender, role: 'sender' as const },
            { personId: recipient, role: 'recipient' as const },
            // ~25% of generated mail carries a CC (SEC CC field).
            ...(rnd() < 0.25
              ? [{ personId: members[Math.floor(rnd() * members.length)], role: 'cc' as const }]
              : []),
          ]
        : [{ personId: sender, role: 'author' }],
      organizationIds: [byId.get(sender)?.org ?? 'org-eng'],
      conceptTags: [concept],
      threadId: kind === 'email' ? threadId : undefined,
    });
  }

  return {
    people: PEOPLE.map(([id, displayName, , custodianId]) => ({ id, displayName, custodianId })),
    custodians: CUSTODIANS.map(([id, displayName]) => ({ id, displayName })),
    organizations: ORGS.map((o) => ({ id: o.id, displayName: o.name })),
    records,
    groundTruth: {
      bridgePersonId: 'p-elena',
      relevantRecordIds: ['ts-001', 'ts-003', 'ts-004', 'ts-005', 'ts-006', 'ts-011', 'ts-015', 'ts-017', 'ts-020', 'ts-021', 'ts-022', 'ts-023', 'ts-024', 'ts-025'],
      counterevidenceRecordIds: ['ts-007', 'ts-008', 'ts-009', 'ts-010', 'ts-014', 'ts-018', 'ts-019', 'ts-026'],
      decoyRecordIds: ['ts-016'],
      replyBeforeOriginalRecordId: 'ts-002',
      sentinelDateRecordId: 'ts-003',
      communities: Object.fromEntries(COMMUNITIES.map(([k, v]) => [k, v])),
    },
  };
}

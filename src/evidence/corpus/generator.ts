/**
 * Expanded synthetic corpus (M3 REOPENED, owner direction 2026-10-28).
 * A stronger, still-honest evidence foundation for relationship
 * discovery: 10 people in 4 groups, explicit sender/recipient roles,
 * two communities connected ONLY through one planted bridge person,
 * a vendOR thread with chronology defects, and authored concept tags
 * with a documented ground-truth key. ~112 records: an 18-record
 * hand-authored core + seeded template background within communities.
 *
 * Wired as the selectable "Expanded 112" corpus (owner-approved
 * 2026-10-28, headset-tested). Startup corpus is Trade Secret
 * since 2026-11-01 (Fixture 8 retired).
 * Deterministic: same seed -> byte-identical output (tested).
 */
import type { Custodian, EvidenceRecord, ParticipantRole, Person } from '../types.ts';

export interface CorpusGroundTruth {
  bridgePersonId: string;
  relevantRecordIds: string[];
  counterevidenceRecordIds: string[];
  decoyRecordIds: string[];
  replyBeforeOriginalRecordId: string;
  sentinelDateRecordId: string;
  communities: Record<string, string[]>;
}

export interface GeneratedCorpus {
  people: Person[];
  custodians: Custodian[];
  organizations: { id: string; displayName: string }[];
  records: EvidenceRecord[];
  groundTruth: CorpusGroundTruth;
}

const ORGS = [
  { id: 'org-ops', displayName: 'Operations (synthetic)' },
  { id: 'org-fin', displayName: 'Finance (synthetic)' },
  { id: 'org-leg', displayName: 'Legal & Exec (synthetic)' },
  { id: 'org-ven', displayName: 'Vendor Atlas (synthetic)' },
];

const PEOPLE: (Person & { orgId: string })[] = [
  { id: 'p-mara', displayName: 'Mara Ops-Lead', custodianId: 'cust-ops', orgId: 'org-ops' },
  { id: 'p-dev', displayName: 'Dev Engineer', custodianId: 'cust-ops', orgId: 'org-ops' },
  { id: 'p-tom', displayName: 'Tom Planner', custodianId: 'cust-ops', orgId: 'org-ops' },
  { id: 'p-priya', displayName: 'Priya Coordinator', custodianId: 'cust-ops', orgId: 'org-ops' },
  { id: 'p-ines', displayName: 'Ines Finance', custodianId: 'cust-fin', orgId: 'org-fin' },
  { id: 'p-rob', displayName: 'Rob Controller', custodianId: 'cust-fin', orgId: 'org-fin' },
  { id: 'p-sana', displayName: 'Sana Analyst', custodianId: 'cust-fin', orgId: 'org-fin' },
  { id: 'p-june', displayName: 'June Counsel', custodianId: 'cust-leg', orgId: 'org-leg' },
  { id: 'p-omar', displayName: 'Omar Executive', custodianId: 'cust-leg', orgId: 'org-leg' },
  { id: 'p-vic', displayName: 'Vic Vendor-Rep', custodianId: 'cust-ven', orgId: 'org-ven' },
  { id: 'p-ada', displayName: 'Ada Vendor-PM', custodianId: 'cust-ven', orgId: 'org-ven' },
];

const CUSTODIANS: Custodian[] = [
  { id: 'cust-ops', displayName: 'Operations Custodian (synthetic)' },
  { id: 'cust-fin', displayName: 'Finance Custodian (synthetic)' },
  { id: 'cust-leg', displayName: 'Legal Custodian (synthetic)' },
  { id: 'cust-ven', displayName: 'Vendor Custodian (synthetic)' },
];

const provenance = (n: number) => ({
  sourceSystem: 'synthetic-corpus-generator-v1',
  collectionId: 'atlas-expanded-001',
  contentHash: `corpus-hash-${String(n).padStart(3, '0')}`,
  ingestedAt: '2026-10-28T00:00:00Z',
});

const part = (rows: [string, ParticipantRole][]) =>
  rows.map(([personId, role]) => ({ personId, role }));

type CoreSpec = [
  id: string,
  kind: EvidenceRecord['kind'],
  title: string,
  body: string,
  date: string,
  conf: EvidenceRecord['dateConfidence'],
  custodian: string,
  participants: [string, ParticipantRole][],
  concepts: string[],
  links?: EvidenceRecord['links'],
];

// The authored core: the Atlas delivery-date thread, its finance
// shadow-thread, and the bridge (Priya), with two planted defects.
const CORE: CoreSpec[] = [
  ['cx-001', 'email', 'Atlas delivery date proposal', 'Vendor Atlas proposes moving the delivery date from January to March so the revised line can be staffed.', '2026-01-05', 'verified', 'cust-ven',
    [['p-vic', 'sender'], ['p-mara', 'recipient'], ['p-priya', 'cc']], ['delivery-date', 'atlas']],
  ['cx-002', 'email', 'Re: Atlas delivery date proposal', 'Agreed to the March date in your proposal. We will hold the January slot open just in case.', '2026-01-04', 'suspect', 'cust-ops',
    [['p-mara', 'sender'], ['p-vic', 'recipient']], ['delivery-date', 'atlas'], { inReplyToId: 'cx-001', familyId: 'fam-atlas' }],
  ['cx-003', 'document', 'Atlas commercial terms (archived copy)', 'Archived copy of the Atlas commercial terms and rate card, migrated from the legacy file store.', '1980-01-01', 'suspect', 'cust-ops',
    [['p-tom', 'author']], ['atlas', 'terms']],
  ['cx-004', 'email', 'Invoice 441 query', 'Invoice 441 references the Atlas agreement and the March date. Priya, can finance confirm which date governs payment?', '2026-02-01', 'verified', 'cust-ops',
    [['p-mara', 'sender'], ['p-priya', 'recipient']], ['invoice', 'delivery-date']],
  ['cx-005', 'email', 'Re: Invoice 441 query', 'Finance can only pay against the contracted date. If March was agreed, we need that in writing from both sides.', '2026-02-02', 'verified', 'cust-fin',
    [['p-ines', 'sender'], ['p-priya', 'recipient'], ['p-rob', 'cc']], ['invoice', 'payment'], { inReplyToId: 'cx-004', familyId: 'fam-invoice' }],
  ['cx-006', 'email', 'March date confirmed to finance', 'Confirming the revised March delivery for budget purposes, per the vendor thread Priya forwarded.', '2026-02-03', 'derived', 'cust-fin',
    [['p-sana', 'sender'], ['p-ines', 'recipient']], ['delivery-date', 'budget'], { inReplyToId: 'cx-005', familyId: 'fam-invoice' }],
  ['cx-007', 'document', 'Delivery schedule v2', 'Schedule lists January delivery as current. Note: superseded by the March revision under discussion.', '2025-12-15', 'verified', 'cust-ops',
    [['p-tom', 'author']], ['schedule', 'delivery-date']],
  ['cx-008', 'email', 'Staffing for the revised line', 'Dev confirms the revised Atlas line can be staffed from March, not January. January staffing was never resourced.', '2026-01-12', 'verified', 'cust-ops',
    [['p-dev', 'sender'], ['p-mara', 'recipient'], ['p-ada', 'cc']], ['staffing', 'delivery-date']],
  ['cx-009', 'email', 'Vendor side: March commitment', 'Ada confirms Atlas can commit to March. January was a proposal from sales, never an operational commitment.', '2026-01-15', 'verified', 'cust-ven',
    [['p-ada', 'sender'], ['p-vic', 'recipient'], ['p-priya', 'cc']], ['delivery-date', 'atlas']],
  ['cx-010', 'note', 'Call note: date confusion', 'Call with Priya: operations believes March was agreed; finance has only the January schedule on file. Someone needs to reconcile the two threads.', '2026-02-05', 'verified', 'cust-fin',
    [['p-rob', 'author'], ['p-priya', 'mentioned']], ['delivery-date', 'reconciliation']],
  ['cx-011', 'email', 'Legal review: date correspondence', 'June asks for the complete Atlas date correspondence before advising on the payment dispute. Do not rely on forwarded summaries.', '2026-02-06', 'verified', 'cust-leg',
    [['p-june', 'sender'], ['p-omar', 'recipient']], ['legal-review', 'delivery-date']],
  ['cx-012', 'email', 'Re: Legal review', 'Omar: pull the original thread, including anything that points the other way. We need the chronology to hold up.', '2026-02-06', 'verified', 'cust-leg',
    [['p-omar', 'sender'], ['p-june', 'recipient']], ['legal-review'], { inReplyToId: 'cx-011', familyId: 'fam-legal' }],
  ['cx-013', 'email', 'Priya fwd: vendor thread to finance', 'Forwarding the vendor March thread so finance sees the same record operations is relying on.', '2026-02-02', 'verified', 'cust-ops',
    [['p-priya', 'sender'], ['p-ines', 'recipient']], ['delivery-date', 'bridge'], { familyId: 'fam-atlas' }],
  ['cx-014', 'note', 'Ops huddle note (unrelated)', 'Office catering order for Friday. Nothing about any vendor.', '2026-01-20', 'verified', 'cust-ops',
    [['p-tom', 'author']], ['admin']],
  ['cx-015', 'email', 'Weekend rota swap', 'Rota swap for Saturday cover between Sana and Rob.', '2026-01-10', 'verified', 'cust-fin',
    [['p-sana', 'sender'], ['p-rob', 'recipient']], ['admin']],
  ['cx-016', 'document', 'Budget accrual basis', 'Finance accrued against the January schedule because that is the only signed schedule in the finance file.', '2026-02-04', 'verified', 'cust-fin',
    [['p-rob', 'author']], ['budget', 'schedule']],
  ['cx-017', 'email', 'Vendor January slot', 'Vic notes the January slot was released to another customer once March was discussed. Reinstating January is no longer possible.', '2026-02-08', 'verified', 'cust-ven',
    [['p-vic', 'sender'], ['p-ada', 'recipient']], ['delivery-date', 'atlas']],
  ['cx-018', 'email', 'Reconciliation request', 'Priya proposes a single reconciled chronology across operations, finance, and vendor records before finance releases payment 441. She will carry it to Ines once operations agrees.', '2026-02-09', 'verified', 'cust-ops',
    [['p-priya', 'sender'], ['p-mara', 'recipient']], ['reconciliation', 'invoice']],
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMMUNITIES: Record<string, string[]> = {
  ops: ['p-mara', 'p-dev', 'p-tom'],
  finance: ['p-ines', 'p-rob', 'p-sana'],
  legal: ['p-june', 'p-omar'],
  vendor: ['p-vic', 'p-ada'],
};

const TOPICS = [
  ['weekly status', 'Status update: milestones reviewed, no blockers raised this week.', 'status'],
  ['budget review', 'Budget review: forecast held steady against the current plan.', 'budget'],
  ['schedule check', 'Schedule check: upcoming dates reviewed against the team calendar.', 'schedule'],
  ['staffing note', 'Staffing note: coverage confirmed for the next two rotations.', 'staffing'],
  ['document tidy', 'Filing tidy: superseded drafts archived to the team folder.', 'admin'],
  ['vendor rates', 'Rate card comparison circulated for information only.', 'terms'],
] as const;

const pad = (n: number) => String(n).padStart(3, '0');

export function buildCorpus(seed = 42, backgroundCount = 94): GeneratedCorpus {
  const rng = mulberry32(seed);
  const records: EvidenceRecord[] = CORE.map(
    ([id, kind, title, body, date, conf, custodianId, participants, concepts, links], i) => ({
      id, kind, title, body, date,
      dateConfidence: conf,
      custodianId,
      personIds: participants.map(([p]) => p),
      participants: part(participants),
      organizationIds: [PEOPLE.find((p) => p.id === participants[0][0])?.orgId ?? 'org-ops'],
      conceptTags: concepts,
      provenance: provenance(i + 1),
      ...(links ? { links } : {}),
    }),
  );

  // Background: within-community traffic ONLY (plus a little
  // ops-internal Priya traffic). Priya stays the sole Finance<->Vendor
  // bridge: background generation never pairs across communities.
  const groups: string[][] = [
    COMMUNITIES.ops,
    COMMUNITIES.finance,
    COMMUNITIES.legal,
    COMMUNITIES.vendor,
    ['p-priya', 'p-mara', 'p-dev', 'p-tom'],
  ];
  for (let n = 0; n < backgroundCount; n += 1) {
    const group = groups[Math.floor(rng() * groups.length)];
    const sender = group[Math.floor(rng() * group.length)];
    let recipient = group[Math.floor(rng() * group.length)];
    if (recipient === sender) recipient = group[(group.indexOf(sender) + 1) % group.length];
    const [topicTitle, topicBody, concept] = TOPICS[Math.floor(rng() * TOPICS.length)];
    const month = 1 + Math.floor(rng() * 3);
    const day = 1 + Math.floor(rng() * 28);
    const authorOrg = PEOPLE.find((p) => p.id === sender)?.orgId ?? 'org-ops';
    records.push({
      id: `bg-${pad(n + 1)}`,
      kind: rng() > 0.3 ? 'email' : 'note',
      title: `${topicTitle} (${n + 1})`,
      body: topicBody,
      date: `2026-0${month}-${String(day).padStart(2, '0')}`,
      dateConfidence: 'verified',
      custodianId: PEOPLE.find((p) => p.id === sender)?.custodianId ?? 'cust-ops',
      personIds: [sender, recipient],
      participants: part([[sender, 'sender'], [recipient, 'recipient']]),
      organizationIds: [authorOrg],
      conceptTags: [concept],
      provenance: provenance(100 + n),
    });
  }

  records.sort((a, b) => a.id.localeCompare(b.id));
  return {
    people: PEOPLE.map(({ orgId: _orgId, ...person }) => person),
    custodians: CUSTODIANS,
    organizations: ORGS,
    records,
    groundTruth: {
      bridgePersonId: 'p-priya',
      relevantRecordIds: ['cx-001', 'cx-002', 'cx-004', 'cx-005', 'cx-006', 'cx-007', 'cx-008', 'cx-009', 'cx-013', 'cx-016', 'cx-017', 'cx-018'],
      counterevidenceRecordIds: ['cx-002', 'cx-007', 'cx-016'],
      decoyRecordIds: ['cx-014', 'cx-015'],
      replyBeforeOriginalRecordId: 'cx-002',
      sentinelDateRecordId: 'cx-003',
      communities: COMMUNITIES,
    },
  };
}

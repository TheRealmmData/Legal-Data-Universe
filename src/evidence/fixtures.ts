/**
 * TINY SYNTHETIC TEST FIXTURE — engineering test data only.
 * This is NOT the Milestone 3 case corpus (D3 is undecided), contains no
 * real persons or matters, and exists so retrieval/timeline/relationship
 * behaviour can be tested deterministically. 8 records, 2 custodians.
 *
 * Runtime note (2026-11-01, owner direction): the Fixture 8
 * CORPUS was deleted from the product — it is not selectable,
 * not the startup corpus, and nothing in the shipped runtime
 * imports this file. It remains solely as deterministic data
 * for the unit suites in app/scripts/*.test.mjs.
 */
import type { Custodian, EvidenceRecord, Person } from './types.ts';

export const FIXTURE_CUSTODIANS: Custodian[] = [
  { id: 'cust-a', displayName: 'Custodian A (fixture)' },
  { id: 'cust-b', displayName: 'Custodian B (fixture)' },
];

export const FIXTURE_PEOPLE: Person[] = [
  { id: 'p-alex', displayName: 'Alex Fixture', custodianId: 'cust-a' },
  { id: 'p-blair', displayName: 'Blair Fixture', custodianId: 'cust-b' },
  { id: 'p-casey', displayName: 'Casey Fixture' },
];

const provenance = (n: number) => ({
  sourceSystem: 'synthetic-fixture-generator',
  collectionId: 'fixture-set-001',
  contentHash: `fixture-hash-${String(n).padStart(3, '0')}`,
  ingestedAt: '2026-10-27T00:00:00Z',
});

export const FIXTURE_RECORDS: EvidenceRecord[] = [
  {
    id: 'fx-001', kind: 'email', title: 'Atlas delivery date proposal',
    body: 'Vendor Atlas proposes moving the delivery date to March.',
    date: '2026-01-05', dateConfidence: 'verified', custodianId: 'cust-a',
    personIds: ['p-alex', 'p-blair'], provenance: provenance(1),
  },
  {
    id: 'fx-002', kind: 'email', title: 'Re: Atlas delivery date proposal',
    body: 'Agreed to the March date in your proposal.',
    date: '2026-01-04', dateConfidence: 'suspect', custodianId: 'cust-b',
    personIds: ['p-blair', 'p-alex'], provenance: provenance(2),
    links: { inReplyToId: 'fx-001', familyId: 'fam-1' },
  },
  {
    id: 'fx-003', kind: 'document', title: 'Atlas terms archive memo',
    body: 'Archived copy of the Atlas commercial terms.',
    date: '1980-01-01', dateConfidence: 'suspect', custodianId: 'cust-a',
    personIds: ['p-casey'], provenance: provenance(3),
  },
  {
    id: 'fx-004', kind: 'email', title: 'Invoice 441 query',
    body: 'Invoice 441 references the Atlas agreement and the March date.',
    date: '2026-02-01', dateConfidence: 'verified', custodianId: 'cust-a',
    personIds: ['p-alex', 'p-casey'], provenance: provenance(4),
    links: { familyId: 'fam-2' },
  },
  {
    id: 'fx-005', kind: 'note', title: 'Call note (unrelated decoy)',
    body: 'Office catering order for Friday. Nothing about any vendor.',
    date: '2026-01-20', dateConfidence: 'verified', custodianId: 'cust-b',
    personIds: ['p-blair'], provenance: provenance(5),
  },
  {
    id: 'fx-006', kind: 'email', title: 'March date confirmed to finance',
    body: 'Finance confirms budget against the revised March delivery.',
    date: '2026-02-03', dateConfidence: 'derived', custodianId: 'cust-b',
    personIds: ['p-casey', 'p-blair'], provenance: provenance(6),
    links: { inReplyToId: 'fx-004' },
  },
  {
    id: 'fx-007', kind: 'document', title: 'Delivery schedule v2',
    body: 'Schedule lists January delivery, superseded by the March revision.',
    date: '2025-12-15', dateConfidence: 'verified', custodianId: 'cust-a',
    personIds: ['p-alex'], provenance: provenance(7),
  },
  {
    id: 'fx-008', kind: 'email', title: 'Weekend rota (unrelated decoy)',
    body: 'Rota swap for Saturday cover.',
    date: '2026-01-10', dateConfidence: 'verified', custodianId: 'cust-b',
    personIds: ['p-blair', 'p-casey'], provenance: provenance(8),
  },
];

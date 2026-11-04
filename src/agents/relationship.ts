/**
 * Relationship Analyst: people, communications, chronology.
 * Explicit participant roles only — direction is never
 * invented from co-occurrence. Deterministic.
 */
import type { EvidenceStore } from '../evidence/store.ts';
import type { EvidenceRecord } from '../evidence/types.ts';
import { personCounterparties } from '../evidence/analysis.ts';
import type { SpecialistRun } from './types.ts';

export interface RelationshipOutput {
  personId: string;
  personName: string;
  counterparties: { personId: string; name: string; sent: number; received: number; exampleRecordIds: string[] }[];
  crossOrgCounterparties: { personId: string; name: string; orgs: string[]; exampleRecordIds: string[] }[];
  timeline: { date: string; recordId: string; title: string }[];
}

function personOrgs(records: EvidenceRecord[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of records) {
    for (const p of r.personIds) {
      if (!map.has(p)) map.set(p, new Set());
      for (const o of r.organizationIds ?? []) map.get(p)?.add(o);
    }
  }
  return map;
}

export function analyzeRelationships(
  store: EvidenceStore,
  personId: string,
  focusIds: string[],
): SpecialistRun<RelationshipOutput> {
  const records = store.allIds().map((id) => store.getRecord(id)).filter((r) => r != null);
  const orgs = personOrgs(records);
  const myOrgs = orgs.get(personId) ?? new Set<string>();
  const cps = personCounterparties(records, personId);
  const counterparties = cps.map((c) => ({
    personId: c.personId, name: store.personName(c.personId),
    sent: c.sent, received: c.received, exampleRecordIds: c.exampleRecordIds,
  }));
  const crossOrgCounterparties = counterparties
    .map((c) => ({ ...c, orgs: [...(orgs.get(c.personId) ?? [])] }))
    .filter((c) => c.orgs.some((o) => !myOrgs.has(o)))
    .map((c) => ({ personId: c.personId, name: c.name, orgs: c.orgs, exampleRecordIds: c.exampleRecordIds }));
  const timeline = focusIds
    .map((id) => store.getRecord(id))
    .filter((r) => r != null)
    .map((r) => ({ date: r.date.slice(0, 10), recordId: r.id, title: r.title }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.recordId.localeCompare(b.recordId));
  return {
    specialist: 'relationship',
    inputSummary: `counterparties + cross-org + timeline for ${store.personName(personId)}`,
    output: {
      personId, personName: store.personName(personId),
      counterparties, crossOrgCounterparties, timeline,
    },
    provenance: {
      method: 'explicit sender/recipient/cc roles; org = record organizationIds',
      recordIds: [...new Set([...cps.flatMap((c) => c.exampleRecordIds), ...focusIds])],
      scope: `all ${records.length} records`,
    },
  };
}

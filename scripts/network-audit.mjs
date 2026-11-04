/**
 * Network relationship audit (M3 forensic, 2026-10-29).
 * Counts genuine, source-supported relationships in Galaxy 1000 and
 * simulates what the CURRENT galaxy-edge renderer actually emits.
 * Run: node scripts/network-audit.mjs
 */
import { loadGalaxyCorpus } from '../src/evidence/corpus/index.ts';
import { directedCommunicationEdges, communicationEdges } from '../src/evidence/analysis.ts';
import { galaxyPositions } from '../src/galaxy/layout.ts';
import { personOrganizations } from '../src/discovery/leads.ts';

const { store, corpus } = loadGalaxyCorpus(1000);
const records = store.allIds().map((id) => store.getRecord(id));
const n = records.length;
const withRoles = records.filter((r) => r.participants?.length);
const withSenderRecipient = records.filter((r) =>
  r.participants?.some((p) => p.role === 'sender' || p.role === 'author')
  && r.participants?.some((p) => p.role === 'recipient' || p.role === 'cc'));
const replyLinks = records.filter((r) => r.links?.inReplyToId);
const families = new Map();
for (const r of records) {
  if (r.links?.familyId) families.set(r.links.familyId, (families.get(r.links.familyId) ?? 0) + 1);
}
const directed = directedCommunicationEdges(records);
const undirected = communicationEdges(records);
const peopleOrgs = personOrganizations(records);
const orgOf = (pid) => [...(peopleOrgs.get(pid) ?? [])][0];
const crossOrg = directed.filter((e) => orgOf(e.fromPersonId) !== orgOf(e.toPersonId));

// Record-level genuine links: a record IS a sender->recipient act.
// Count record pairs sharing a thread (family), reply links, and
// records sharing an identical sender->recipient channel.
const byPerson = new Map();
for (const r of records) for (const p of r.personIds) {
  if (!byPerson.has(p)) byPerson.set(p, []);
  byPerson.get(p).push(r.id);
}

// Simulate current renderer: top-250 person-pair centroid lines.
const personOrgs2 = personOrganizations(records);
const inputs = records.map((r) => ({
  id: r.id, date: r.date, org: r.organizationIds?.[0] ?? r.custodianId,
  concept: r.conceptTags?.[0] ?? '', custodian: r.custodianId, kind: r.kind,
  participantOrgs: [...new Set(r.personIds.flatMap((p) => [...(personOrgs2.get(p) ?? [])]))],
  sender: r.participants?.find((p) => p.role === 'sender' || p.role === 'author')?.personId,
}));
const pos = galaxyPositions(inputs, 'network');
const authoredBy = new Map();
for (const r of records) for (const p of r.participants ?? []) {
  if (p.role !== 'sender' && p.role !== 'author') continue;
  if (!authoredBy.has(p.personId)) authoredBy.set(p.personId, []);
  authoredBy.get(p.personId).push(r.id);
}
const centroid = (pid) => {
  const ids = authoredBy.get(pid);
  if (!ids?.length) return undefined;
  const s = [0, 0, 0];
  for (const id of ids) { const q = pos.get(id).position; s[0] += q[0]; s[1] += q[1]; s[2] += q[2]; }
  return s.map((v) => v / ids.length);
};
// After remediation: hub endpoints = sent-record centroids +0.42.
const hubPos = new Map();
for (const [pid, allIds] of byPerson) {
  const sentIds = authoredBy.get(pid) ?? [];
  const ids = (sentIds.length ? sentIds : allIds).map((i) => (typeof i === 'string' ? i : records[i].id));
  const s = [0, 0, 0];
  for (const id of ids) { const q = pos.get(id).position; s[0] += q[0]; s[1] += q[1]; s[2] += q[2]; }
  hubPos.set(pid, [s[0] / ids.length, s[1] / ids.length + 0.42, s[2] / ids.length]);
}
const hubLengths = directed.map((e) => {
  const a = hubPos.get(e.fromPersonId); const b = hubPos.get(e.toPersonId);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}).sort((a, b) => a - b);

let emitted = 0; let droppedNoCentroid = 0; let shortLines = 0; const lengths = [];
for (const e of directed.slice(0, 250)) {
  const a = centroid(e.fromPersonId); const b = centroid(e.toPersonId);
  if (!a || !b) { droppedNoCentroid += 1; continue; }
  emitted += 1;
  const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  lengths.push(len);
  if (len < 1.5) shortLines += 1;
}
lengths.sort((a, b) => a - b);

console.log(JSON.stringify({
  records: n,
  people: corpus.people.length,
  orgs: corpus.organizations.map((o) => o.id),
  recordsWithRoles: withRoles.length,
  recordsWithSenderAndRecipient: withSenderRecipient.length,
  replyLinks: replyLinks.length,
  families: Object.fromEntries(families),
  directedPersonEdges: directed.length,
  directedCrossOrg: crossOrg.length,
  undirectedPersonEdges: undirected.length,
  topDirected: directed.slice(0, 8).map((e) => `${e.fromPersonId}->${e.toPersonId} w${e.weight}`),
  crossOrgEdges: crossOrg.map((e) => `${e.fromPersonId}->${e.toPersonId} w${e.weight} [${e.recordIds.slice(0, 4).join(',')}]`),
  currentRenderer: {
    considered: Math.min(250, directed.length), emitted, droppedNoCentroid, shortLinesUnder1_5m: shortLines,
    medianLen: lengths.length ? +lengths[Math.floor(lengths.length / 2)].toFixed(2) : null,
  },
  hubRendererAfter: {
    lines: hubLengths.length,
    medianLen: +hubLengths[Math.floor(hubLengths.length / 2)].toFixed(2),
    minLen: +hubLengths[0].toFixed(2),
  },
}, null, 2));

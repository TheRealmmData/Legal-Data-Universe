/**
 * Read-only evidence analysis utilities (Spatial Intelligence
 * foundation, 2026-10-27). Deterministic, no model calls, no state
 * mutation. Everything returned is labelled `basis: 'observed'` (a
 * fact of the records) vs `'derived'` (computed similarity — an
 * investigative hint, never evidence by itself), keeping the pivot
 * rule: spatial relationships must be explainable.
 *
 * Honest scope: with 8 one-sentence fixture records these functions
 * prove plumbing and invariants, not analytical power. They are
 * written against the generic store so a D3-scale corpus (or a
 * future platform adapter feeding the same store shape) reuses them.
 */
import type { EvidenceStore } from './store.ts';
import type { EvidenceRecord } from './types.ts';

export interface CommunicationEdge {
  personA: string;
  personB: string;
  /** Records on which both people appear. */
  recordIds: string[];
  weight: number;
  basis: 'observed';
  explanation: string;
}

/**
 * Undirected person co-occurrence network. The current record model
 * carries participants (personIds) without sender/recipient roles,
 * so direction is NOT claimed — inventing arrow direction from list
 * order would fabricate evidence.
 */
export function communicationEdges(records: EvidenceRecord[]): CommunicationEdge[] {
  const byPair = new Map<string, CommunicationEdge>();
  for (const record of records) {
    const people = [...new Set(record.personIds)].sort();
    for (let i = 0; i < people.length; i += 1) {
      for (let j = i + 1; j < people.length; j += 1) {
        const key = `${people[i]}--${people[j]}`;
        const existing = byPair.get(key);
        if (existing) {
          existing.recordIds.push(record.id);
          existing.weight = existing.recordIds.length;
        } else {
          byPair.set(key, {
            personA: people[i],
            personB: people[j],
            recordIds: [record.id],
            weight: 1,
            basis: 'observed',
            explanation: `both listed as participants on the same record(s)`,
          });
        }
      }
    }
  }
  return [...byPair.values()].sort(
    (a, b) => b.weight - a.weight || a.personA.localeCompare(b.personA),
  );
}

const tokenize = (record: EvidenceRecord): Set<string> =>
  new Set(
    `${record.title} ${record.body}`
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

export interface SimilarityPair {
  recordA: string;
  recordB: string;
  /** Jaccard similarity over title+body tokens, 0..1. */
  score: number;
  sharedTerms: string[];
  basis: 'derived';
  explanation: string;
}

/**
 * Lexical similarity pairs at/above a threshold. Deliberately NOT
 * called "concept clustering" in output: at fixture scale (5-10
 * words/record) this is shared-vocabulary grouping. True concept
 * work needs the larger labeled corpus (D3) and its ground truth.
 */
export function lexicalSimilarities(
  records: EvidenceRecord[],
  threshold = 0.15,
): SimilarityPair[] {
  const pairs: SimilarityPair[] = [];
  const tokenSets = records.map((r) => [r, tokenize(r)] as const);
  for (let i = 0; i < tokenSets.length; i += 1) {
    for (let j = i + 1; j < tokenSets.length; j += 1) {
      const [ra, a] = tokenSets[i];
      const [rb, b] = tokenSets[j];
      const shared = [...a].filter((t) => b.has(t)).sort();
      const union = a.size + b.size - shared.length;
      const score = union === 0 ? 0 : shared.length / union;
      if (score >= threshold) {
        pairs.push({
          recordA: ra.id,
          recordB: rb.id,
          score: Math.round(score * 100) / 100,
          sharedTerms: shared,
          basis: 'derived',
          explanation: `shared terms: ${shared.join(', ') || '(none)'}`,
        });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

export interface DirectedEdge {
  fromPersonId: string;
  toPersonId: string;
  recordIds: string[];
  weight: number;
  basis: 'observed';
  explanation: string;
}

/**
 * Directed sender -> recipient edges, derived ONLY from records
 * carrying explicit participant roles. Records without roles
 * contribute nothing here (direction is never guessed).
 */
export function directedCommunicationEdges(records: EvidenceRecord[]): DirectedEdge[] {
  const byPair = new Map<string, DirectedEdge>();
  for (const record of records) {
    if (!record.participants) continue;
    const senders = record.participants.filter((p) => p.role === 'sender' || p.role === 'author');
    const recipients = record.participants.filter((p) => p.role === 'recipient' || p.role === 'cc');
    for (const s of senders) {
      for (const r of recipients) {
        if (s.personId === r.personId) continue;
        const key = `${s.personId}->${r.personId}`;
        const existing = byPair.get(key);
        if (existing) {
          existing.recordIds.push(record.id);
          existing.weight = existing.recordIds.length;
        } else {
          byPair.set(key, {
            fromPersonId: s.personId,
            toPersonId: r.personId,
            recordIds: [record.id],
            weight: 1,
            basis: 'observed',
            explanation: 'explicit sender/recipient roles on the source record(s)',
          });
        }
      }
    }
  }
  return [...byPair.values()].sort((a, b) => b.weight - a.weight);
}

export interface CollectionProfile {
  basis: 'derived';
  total: number;
  byKind: { kind: string; count: number }[];
  byCustodian: { custodianId: string; count: number }[];
  byOrganization: { organizationId: string; count: number }[];
  dateRange: { earliest: string; latest: string };
  /** Present only when records carry load-file metadata. */
  byExtension?: { extension: string; count: number }[];
  /** Honest limits computed from the schema actually present. */
  fileTypeNote: string;
  peopleCount: number;
}

/** Exact collection aggregates from stored metadata. Counts are
 * exhaustive over the supplied records; kinds/custodians are the
 * stored fields verbatim — no extension/MIME inference. */
export function collectionProfile(records: EvidenceRecord[]): CollectionProfile {
  const count = (key: (r: EvidenceRecord) => string) => {
    const m = new Map<string, number>();
    for (const r of records) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()]
      .map(([k, count]) => ({ k, count }))
      .sort((a, b) => b.count - a.count || a.k.localeCompare(b.k));
  };
  const dates = records.map((r) => r.date).sort();
  return {
    basis: 'derived',
    total: records.length,
    byKind: count((r) => r.kind).map(({ k, count: c }) => ({ kind: k, count: c })),
    byCustodian: count((r) => r.custodianId).map(({ k, count: c }) => ({ custodianId: k, count: c })),
    byOrganization: count((r) => r.organizationIds?.[0] ?? 'unspecified')
      .map(({ k, count: c }) => ({ organizationId: k, count: c })),
    dateRange: { earliest: dates[0] ?? '', latest: dates[dates.length - 1] ?? '' },
    ...(records.some((r) => r.loadFile)
      ? {
          byExtension: count((r) => r.loadFile?.extension ?? 'none')
            .map(({ k, count: c }) => ({ extension: k, count: c })),
        }
      : {}),
    fileTypeNote: records.some((r) => r.loadFile)
      ? 'Extension/MIME counts computed from load-file metadata present on every record. '
        + 'Word documents = extension docx exactly; do not merge other document kinds into it.'
      : 'Records carry a kind field (email/note/document) but NO file-extension or MIME metadata. '
        + 'A Word (.docx) count is therefore NOT determinable from this collection; '
        + 'kind=document must not be relabelled as Word.',
    peopleCount: new Set(records.flatMap((r) => r.personIds)).size,
  };
}

export interface Counterparty {
  personId: string;
  sent: number;
  received: number;
  total: number;
  exampleRecordIds: string[];
  basis: 'observed';
}

/** Who a person communicated with, from explicit roles only. */
export function personCounterparties(
  records: EvidenceRecord[],
  personId: string,
): Counterparty[] {
  const by = new Map<string, Counterparty>();
  const bump = (other: string, field: 'sent' | 'received', recordId: string) => {
    let c = by.get(other);
    if (!c) {
      c = { personId: other, sent: 0, received: 0, total: 0, exampleRecordIds: [], basis: 'observed' };
      by.set(other, c);
    }
    c[field] += 1;
    c.total += 1;
    if (c.exampleRecordIds.length < 3) c.exampleRecordIds.push(recordId);
  };
  for (const e of directedCommunicationEdges(records)) {
    if (e.fromPersonId === personId) {
      for (const id of e.recordIds) bump(e.toPersonId, 'sent', id);
    } else if (e.toPersonId === personId) {
      for (const id of e.recordIds) bump(e.fromPersonId, 'received', id);
    }
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.personId.localeCompare(b.personId));
}

export interface PersonHubSummary {
  personId: string;
  /** Records the person participates in (any explicit role, or
   * personIds membership when roles are absent). */
  recordIds: string[];
  sent: number;
  received: number;
  basis: 'observed';
}

/** Per-person participation totals for Network hubs. Counts only
 * explicit sender/author and recipient/cc roles; a person with no
 * role-bearing records still appears via personIds membership. */
export function personHubSummaries(records: EvidenceRecord[]): PersonHubSummary[] {
  const byPerson = new Map<string, PersonHubSummary>();
  const hub = (personId: string): PersonHubSummary => {
    let h = byPerson.get(personId);
    if (!h) {
      h = { personId, recordIds: [], sent: 0, received: 0, basis: 'observed' };
      byPerson.set(personId, h);
    }
    return h;
  };
  for (const record of records) {
    const seen = new Set<string>();
    for (const p of record.participants ?? []) {
      const h = hub(p.personId);
      if (!seen.has(p.personId)) { h.recordIds.push(record.id); seen.add(p.personId); }
      if (p.role === 'sender' || p.role === 'author') h.sent += 1;
      if (p.role === 'recipient' || p.role === 'cc') h.received += 1;
    }
    for (const personId of record.personIds) {
      if (!seen.has(personId)) hub(personId).recordIds.push(record.id);
    }
  }
  return [...byPerson.values()].sort(
    (a, b) => b.recordIds.length - a.recordIds.length || a.personId.localeCompare(b.personId));
}

export interface ReplyLink {
  fromRecordId: string;
  toRecordId: string;
  basis: 'observed';
  explanation: string;
}

/** Record-to-record reply links from stored `inReplyToId` metadata.
 * Links whose target is outside the supplied set are omitted —
 * endpoints must both be inspectable records. */
export function replyLinks(records: EvidenceRecord[]): ReplyLink[] {
  const ids = new Set(records.map((r) => r.id));
  return records
    .filter((r) => r.links?.inReplyToId && ids.has(r.links.inReplyToId))
    .map((r) => ({
      fromRecordId: r.id,
      toRecordId: r.links?.inReplyToId as string,
      basis: 'observed' as const,
      explanation: `${r.id} is stored as a reply to ${r.links?.inReplyToId}`,
    }));
}

export interface PersonBridge {
  personId: string;
  /** Communities (person sets) this person connects. */
  connectsPeople: string[];
  recordIds: string[];
  basis: 'derived';
  explanation: string;
}

/**
 * People who co-occur with two or more others who never co-occur
 * with each other — the community-bridge shape over observed
 * co-occurrence. Deterministic; empty when the corpus has none.
 */
export function personBridges(records: EvidenceRecord[]): PersonBridge[] {
  const edges = communicationEdges(records);
  const neighbors = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a)?.add(b);
  };
  edges.forEach((e) => { touch(e.personA, e.personB); touch(e.personB, e.personA); });
  const out: PersonBridge[] = [];
  for (const [person, ns] of neighbors) {
    const list = [...ns];
    const unconnected: string[] = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (!neighbors.get(list[i])?.has(list[j])) unconnected.push(list[i], list[j]);
      }
    }
    if (unconnected.length > 0) {
      const recordIds = edges
        .filter((e) => e.personA === person || e.personB === person)
        .flatMap((e) => e.recordIds);
      out.push({
        personId: person,
        connectsPeople: [...new Set(unconnected)].sort(),
        recordIds: [...new Set(recordIds)],
        basis: 'derived',
        explanation: `${person} appears with people who never appear together (${[...new Set(unconnected)].join(', ')})`,
      });
    }
  }
  return out.sort((a, b) => b.connectsPeople.length - a.connectsPeople.length);
}

export interface BridgeCandidate {
  recordId: string;
  /** The two records this candidate connects. */
  connects: [string, string];
  /** min(sim(candidate,a), sim(candidate,b)) — strength of the weaker leg. */
  score: number;
  basis: 'derived';
  explanation: string;
}

/**
 * Bridge discovery (the lead Explore interaction): records that are
 * lexically close to two records that are NOT close to each other —
 * the "non-obvious connection" shape. Deterministic and fully
 * explained per candidate; a candidate is a question to investigate,
 * never a finding. Returns [] when the corpus has no such structure
 * rather than manufacturing one.
 */
export function bridgeCandidates(
  records: EvidenceRecord[],
  legThreshold = 0.12,
  apartThreshold = 0.1,
): BridgeCandidate[] {
  const sims = lexicalSimilarities(records, 0);
  const simOf = new Map(sims.map((s) => [`${s.recordA}|${s.recordB}`, s.score]));
  const sim = (a: string, b: string) =>
    simOf.get(`${a}|${b}`) ?? simOf.get(`${b}|${a}`) ?? 0;
  const out: BridgeCandidate[] = [];
  for (const candidate of records) {
    const others = records.filter((r) => r.id !== candidate.id);
    for (let i = 0; i < others.length; i += 1) {
      for (let j = i + 1; j < others.length; j += 1) {
        const a = others[i];
        const b = others[j];
        const legA = sim(candidate.id, a.id);
        const legB = sim(candidate.id, b.id);
        const apart = sim(a.id, b.id);
        if (legA >= legThreshold && legB >= legThreshold && apart <= apartThreshold) {
          out.push({
            recordId: candidate.id,
            connects: [a.id, b.id],
            score: Math.round(Math.min(legA, legB) * 100) / 100,
            basis: 'derived',
            explanation: `${candidate.id} shares language with both ${a.id} (${legA.toFixed(2)}) and ${b.id} (${legB.toFixed(2)}), which share little with each other (${apart.toFixed(2)})`,
          });
        }
      }
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export interface ChronologyAnomaly {
  recordId: string;
  kind: 'reply-before-original' | 'suspect-date' | 'sentinel-date';
  detail: string;
  basis: 'observed';
}

/** Date anomalies already detectable from stored metadata alone. */
export function chronologyAnomalies(store: EvidenceStore): ChronologyAnomaly[] {
  const anomalies: ChronologyAnomaly[] = [];
  for (const entry of store.timeline(store.allIds())) {
    if (entry.repliesBeforeOriginal) {
      anomalies.push({
        recordId: entry.recordId,
        kind: 'reply-before-original',
        detail: `stored date ${entry.date} precedes the record it replies to`,
        basis: 'observed',
      });
    }
    if (entry.dateConfidence === 'suspect') {
      anomalies.push({
        recordId: entry.recordId,
        kind: entry.date.startsWith('1980-01-01') || entry.date.startsWith('1970-01-01')
          ? 'sentinel-date'
          : 'suspect-date',
        detail: `stored date ${entry.date} is flagged suspect at ingestion`,
        basis: 'observed',
      });
    }
  }
  return anomalies;
}

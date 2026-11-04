/**
 * Discover — deterministic collection-level lead engine (M4 direction,
 * 2026-10-28 strategy brief). Layer 1 (feature computation) + a
 * transparent deterministic prioritizer standing in for the proposed
 * specialized model. The DiscoveryLead contract is the stable surface:
 * a future fine-tuned specialist or general-model fallback must emit
 * leads that pass validateLead() against the same store — model
 * output never bypasses grounding checks.
 *
 * Discipline carried from the brief:
 * - Deterministic code computes measurements; prioritization only
 *   ranks computed signals. Scores are ranking signals with visible
 *   components, NOT calibrated probabilities.
 * - A lead is a hypothesis for review, never a finding. Every lead
 *   carries limitations and resolves to real record IDs.
 * - Abstention is a valid outcome: weak-signal corpora yield fewer
 *   leads, down to zero. Never manufacture three.
 * - Visualization-derived artifacts (layout isolation, focus limits)
 *   are never treated as evidence; features here derive only from
 *   records (participants, roles, dates, custodians, tags, links).
 */
import {
  chronologyAnomalies,
  directedCommunicationEdges,
  personBridges,
} from '../evidence/analysis.ts';
import type { EvidenceStore } from '../evidence/store.ts';
import type { EvidenceRecord } from '../evidence/types.ts';

export type LeadKind =
  | 'bridge-person'
  | 'chronology-anomaly'
  | 'concept-cluster'
  | 'temporal-concentration'
  | 'cross-org-channel'
  | 'custodian-concentration'
  | 'sequenced-investigation';

export interface DiscoveryLead {
  id: string;
  origin: 'discover';
  kind: LeadKind;
  priority: 'review_recommended' | 'worth_a_look';
  summary: string;
  whyPrioritized: string[];
  supportingRecordIds: string[];
  featureReferences: string[];
  limitations: string[];
  suggestedAction: {
    lens: 'evidence' | 'network' | 'chronology' | 'concepts' | 'custodians' | 'filetypes';
    focusRecordIds: string[];
    question: string;
  };
  /** Sequenced-investigation extensions. Generic Discover leads omit these. */
  demoStep?: 1 | 2 | 3;
  hypothesisId?: string;
  definedFinding?: string;
  followUpQuestions?: string[];
  searchSuggestions?: string[];
  /** Deterministic ranking score; components listed in scoreBasis. */
  score: number;
  scoreBasis: string;
  /** Which route produced this lead. Never silently relabelled. */
  modelRoute: 'deterministic-features' | 'specialist' | 'fallback-general';
  status: 'proposed';
}

export interface CollectionFeatures {
  recordCount: number;
  custodianCounts: Record<string, number>;
  kindCounts: Record<string, number>;
  organizationCounts: Record<string, number>;
  conceptTagCounts: Record<string, number>;
  peopleCount: number;
  dateMin: string | undefined;
  dateMax: string | undefined;
  suspectDateCount: number;
  recordsWithRoles: number;
}

const orgOfRecord = (r: EvidenceRecord): string =>
  r.organizationIds?.[0] ?? r.custodianId;

/** Person -> organization, derived from authored/sent records only. */
export function personOrganizations(records: EvidenceRecord[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const record of records) {
    const org = orgOfRecord(record);
    const authors = (record.participants ?? [])
      .filter((p) => p.role === 'sender' || p.role === 'author')
      .map((p) => p.personId);
    for (const personId of authors.length ? authors : record.personIds) {
      if (!out.has(personId)) out.set(personId, new Set());
      out.get(personId)?.add(org);
    }
  }
  return out;
}

export function computeCollectionFeatures(records: EvidenceRecord[]): CollectionFeatures {
  const count = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };
  const custodianCounts: Record<string, number> = {};
  const kindCounts: Record<string, number> = {};
  const organizationCounts: Record<string, number> = {};
  const conceptTagCounts: Record<string, number> = {};
  const people = new Set<string>();
  let suspectDateCount = 0;
  let recordsWithRoles = 0;
  for (const r of records) {
    count(custodianCounts, r.custodianId);
    count(kindCounts, r.kind);
    count(organizationCounts, orgOfRecord(r));
    (r.conceptTags ?? []).forEach((t) => count(conceptTagCounts, t));
    r.personIds.forEach((p) => people.add(p));
    if (r.dateConfidence === 'suspect') suspectDateCount += 1;
    if (r.participants?.length) recordsWithRoles += 1;
  }
  const dates = records.map((r) => r.date).sort();
  return {
    recordCount: records.length,
    custodianCounts,
    kindCounts,
    organizationCounts,
    conceptTagCounts,
    peopleCount: people.size,
    dateMin: dates[0],
    dateMax: dates[dates.length - 1],
    suspectDateCount,
    recordsWithRoles,
  };
}

interface Candidate extends Omit<DiscoveryLead, 'id' | 'priority'> {}

/**
 * Ranked Discover leads for a corpus. Deterministic: same store in,
 * same leads out (byte-identical JSON), so results are reproducible
 * and unit-testable against ground truth.
 */
export function discoverLeads(
  store: EvidenceStore,
  options: { maxLeads?: number; minScore?: number } = {},
): DiscoveryLead[] {
  const maxLeads = options.maxLeads ?? 3;
  const minScore = options.minScore ?? 3;
  const records = store.allIds()
    .map((id) => store.getRecord(id))
    .filter((r) => r != null);
  if (records.length < 4) return [];
  const personOrgs = personOrganizations(records);
  const candidates: Candidate[] = [];

  // 1) Bridge people: connect others who never co-occur; cross-org
  // bridges are the strongest collection-level signal we compute.
  for (const bridge of personBridges(records).slice(0, 2)) {
    const orgs = new Set<string>();
    [bridge.personId, ...bridge.connectsPeople].forEach((p) =>
      personOrgs.get(p)?.forEach((o) => orgs.add(o)),
    );
    const crossOrg = orgs.size >= 2;
    const score = 4 + Math.min(bridge.connectsPeople.length, 4) + (crossOrg ? 3 : 0);
    candidates.push({
      origin: 'discover',
      kind: 'bridge-person',
      summary: crossOrg
        ? `${store.personName(bridge.personId)} bridges people across ${orgs.size} organizations`
        : `${store.personName(bridge.personId)} connects people who never appear together`,
      whyPrioritized: [
        bridge.explanation,
        crossOrg
          ? `Connected people span organizations: ${[...orgs].sort().join(', ')}`
          : 'Bridge shape is intra-organization on current metadata',
        `${bridge.recordIds.length} supporting record(s) in the corpus`,
      ],
      supportingRecordIds: bridge.recordIds.slice(0, 8),
      featureReferences: [`bridge:${bridge.personId}`, 'graph:co-occurrence'],
      limitations: [
        'A bridge position can reflect a legitimate coordination role',
        'Co-occurrence shows shared records, not information transfer',
      ],
      suggestedAction: {
        lens: 'network',
        focusRecordIds: bridge.recordIds.slice(0, 8),
        question: `What connects the people around ${bridge.personId}, and does any record show information actually moving between them?`,
      },
      score,
      scoreBasis: `base 4 + connects ${Math.min(bridge.connectsPeople.length, 4)} + cross-org ${crossOrg ? 3 : 0}`,
      modelRoute: 'deterministic-features',
      status: 'proposed',
    });
  }

  // 2) Chronology anomalies: defective time is itself investigable.
  const anomalies = chronologyAnomalies(store);
  if (anomalies.length > 0) {
    const ids = [...new Set(anomalies.map((a) => a.recordId))];
    const score = 4 + Math.min(anomalies.length, 3);
    candidates.push({
      origin: 'discover',
      kind: 'chronology-anomaly',
      summary: `${anomalies.length} chronology defect(s) in stored dates`,
      whyPrioritized: anomalies.slice(0, 3).map((a) => `${a.recordId}: ${a.detail}`),
      supportingRecordIds: ids.slice(0, 8),
      featureReferences: anomalies.map((a) => `chronology:${a.kind}`),
      limitations: [
        'A defective timestamp can be a processing/clock artifact',
        'Ordering defects bound what chronology can prove until resolved',
      ],
      suggestedAction: {
        lens: 'chronology',
        focusRecordIds: ids.slice(0, 8),
        question: 'Which sequence does the evidence support once suspect dates are treated as unreliable?',
      },
      score,
      scoreBasis: `base 4 + anomalies ${Math.min(anomalies.length, 3)}`,
      modelRoute: 'deterministic-features',
      status: 'proposed',
    });
  }

  // 3) Concept clusters from AUTHORED concept tags only. (No embedding
  // or semantic clustering exists in this codebase; lexical similarity
  // is never relabelled as conceptual clustering.)
  const byTag = new Map<string, EvidenceRecord[]>();
  for (const r of records) {
    for (const tag of r.conceptTags ?? []) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)?.push(r);
    }
  }
  const tagRanked = [...byTag.entries()]
    .map(([tag, rs]) => ({ tag, rs, orgs: new Set(rs.map(orgOfRecord)) }))
    .filter((x) => x.rs.length >= 3)
    .sort((a, b) => b.rs.length - a.rs.length || a.tag.localeCompare(b.tag));
  for (const { tag, rs, orgs } of tagRanked.slice(0, 1)) {
    const score = 3 + Math.min(rs.length, 5) + (orgs.size >= 2 ? 2 : 0);
    candidates.push({
      origin: 'discover',
      kind: 'concept-cluster',
      summary: `Concept cluster "${tag}" (${rs.length} records, ${orgs.size} organization(s))`,
      whyPrioritized: [
        `${rs.length} records share the authored concept tag "${tag}"`,
        orgs.size >= 2
          ? `Cluster spans organizations: ${[...orgs].sort().join(', ')}`
          : 'Cluster is contained in one organization',
      ],
      supportingRecordIds: rs.map((r) => r.id).slice(0, 8),
      featureReferences: [`cluster:concept-tag:${tag}`],
      limitations: [
        'Concept tags are authored labels on synthetic data, not semantic embeddings',
        'Shared topic does not establish coordination or causation',
      ],
      suggestedAction: {
        lens: 'network',
        focusRecordIds: rs.map((r) => r.id).slice(0, 8),
        question: `What connects the "${tag}" records beyond the shared topic?`,
      },
      score,
      scoreBasis: `base 3 + size ${Math.min(rs.length, 5)} + cross-org ${orgs.size >= 2 ? 2 : 0}`,
      modelRoute: 'deterministic-features',
      status: 'proposed',
    });
  }

  // 4) Temporal concentration: densest calendar month spanning orgs.
  const byMonth = new Map<string, EvidenceRecord[]>();
  for (const r of records) {
    const month = r.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)?.push(r);
  }
  const months = [...byMonth.entries()]
    .map(([month, rs]) => ({ month, rs, orgs: new Set(rs.map(orgOfRecord)) }))
    .sort((a, b) => b.rs.length - a.rs.length || a.month.localeCompare(b.month));
  const densest = months[0];
  if (densest && densest.rs.length >= Math.max(5, records.length / 4)) {
    const score = 3 + (densest.orgs.size >= 2 ? 2 : 0) + 1;
    candidates.push({
      origin: 'discover',
      kind: 'temporal-concentration',
      summary: `Activity concentrates in ${densest.month} (${densest.rs.length} of ${records.length} records)`,
      whyPrioritized: [
        `${densest.rs.length} records stored in ${densest.month}, the densest month`,
        `Spans ${densest.orgs.size} organization(s): ${[...densest.orgs].sort().join(', ')}`,
      ],
      supportingRecordIds: densest.rs.map((r) => r.id).slice(0, 8),
      featureReferences: [`chronology:month:${densest.month}`],
      limitations: [
        'Temporal proximity does not establish causation',
        'Density can reflect collection/processing batches, not events',
      ],
      suggestedAction: {
        lens: 'chronology',
        focusRecordIds: densest.rs.map((r) => r.id).slice(0, 8),
        question: `What changed around ${densest.month}, and what evidence points the other way?`,
      },
      score,
      scoreBasis: `base 3 + cross-org ${densest.orgs.size >= 2 ? 2 : 0} + density 1`,
      modelRoute: 'deterministic-features',
      status: 'proposed',
    });
  }

  // 5) Cross-organization directed channels (explicit roles only).
  const personOrg = (p: string) => [...(personOrgs.get(p) ?? [])][0];
  const crossOrgEdges = directedCommunicationEdges(records).filter((e) => {
    const a = personOrg(e.fromPersonId);
    const b = personOrg(e.toPersonId);
    return a && b && a !== b;
  });
  const topChannel = crossOrgsTop(crossOrgEdges);
  if (topChannel) {
    const score = 3 + Math.min(topChannel.weight, 3) + 1;
    candidates.push({
      origin: 'discover',
      kind: 'cross-org-channel',
      summary: `Directed cross-organization channel: ${topChannel.fromPersonId} -> ${topChannel.toPersonId}`,
      whyPrioritized: [
        `${topChannel.weight} record(s) with explicit sender/recipient roles cross organizations`,
        topChannel.explanation,
      ],
      supportingRecordIds: topChannel.recordIds.slice(0, 8),
      featureReferences: [`channel:${topChannel.fromPersonId}->${topChannel.toPersonId}`],
      limitations: [
        'Cross-organization communication is often authorized business',
        'Direction shows sending, not receipt, reading, or use',
      ],
      suggestedAction: {
        lens: 'network',
        focusRecordIds: topChannel.recordIds.slice(0, 8),
        question: 'Was this cross-organization communication authorized, and what exactly moved?',
      },
      score,
      scoreBasis: `base 3 + weight ${Math.min(topChannel.weight, 3)} + directed 1`,
      modelRoute: 'deterministic-features',
      status: 'proposed',
    });
  }

  // 6) Custodian concentration (processing-intelligence signal).
  const features = computeCollectionFeatures(records);
  const topCustodian = Object.entries(features.custodianCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (topCustodian && topCustodian[1] / records.length >= 0.45 && records.length >= 12) {
    const ids = store.recordsByCustodian(topCustodian[0]);
    candidates.push({
      origin: 'discover',
      kind: 'custodian-concentration',
      summary: `${topCustodian[0]} holds ${topCustodian[1]} of ${records.length} records`,
      whyPrioritized: [
        `One custodian accounts for ${Math.round((topCustodian[1] / records.length) * 100)}% of the collection`,
        'Concentration shapes what any collection-level pattern can mean',
      ],
      supportingRecordIds: ids.slice(0, 8),
      featureReferences: [`custodian:${topCustodian[0]}`],
      limitations: [
        'Concentration usually reflects collection scoping, not conduct',
        'Patterns inside one custodian may not generalize to the matter',
      ],
      suggestedAction: {
        lens: 'evidence',
        focusRecordIds: ids.slice(0, 8),
        question: 'Which apparent patterns survive outside this custodian?',
      },
      score: 3,
      scoreBasis: 'base 3 (concentration >= 45%)',
      modelRoute: 'deterministic-features',
      status: 'proposed',
    });
  }

  // Diversity rule: at most one lead per kind in the presented set —
  // "three things worth investigating" means three distinct
  // investigative directions, not three near-duplicates of one signal.
  const seenKinds = new Set<LeadKind>();
  return candidates
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind))
    .filter((c) => (seenKinds.has(c.kind) ? false : (seenKinds.add(c.kind), true)))
    .slice(0, maxLeads)
    .map((c, i) => ({
      ...c,
      id: `lead-${String(i + 1).padStart(3, '0')}`,
      priority: c.score >= 7 ? ('review_recommended' as const) : ('worth_a_look' as const),
    }));
}

function crossOrgsTop<T extends { weight: number }>(edges: T[]): T | undefined {
  return [...edges].sort((a, b) => b.weight - a.weight)[0];
}

/**
 * Spatial reorganization set for an explored lead. Selecting a lead
 * must rebuild the scene around its evidence neighborhood — not
 * merely open a card: cited records first, then their corpus-wide
 * relationships (shared people / reply links), then (chronology)
 * temporal neighbors so anomalies read in sequence. Deterministic,
 * capped at the detail-orb focus slots.
 */
export function expandFocusForLead(
  store: EvidenceStore,
  lead: DiscoveryLead,
  slots = 8,
): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    if (store.has(id) && !out.includes(id) && out.length < slots) out.push(id);
  };
  lead.suggestedAction.focusRecordIds.forEach(push);
  lead.supportingRecordIds.forEach(push);
  // 1-hop relationships, ranked by how many cited records they touch.
  const cited = [...new Set([...lead.suggestedAction.focusRecordIds, ...lead.supportingRecordIds])];
  const touchCount = new Map<string, number>();
  for (const id of cited) {
    for (const rel of store.related(id)) {
      touchCount.set(rel, (touchCount.get(rel) ?? 0) + 1);
    }
  }
  [...touchCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([id]) => push(id));
  // Chronology: surround cited records with their stored-date
  // neighbors so defects are visible in sequence, not in isolation.
  if (lead.suggestedAction.lens === 'chronology' && out.length < slots) {
    const ordered = store.allIds()
      .map((id) => store.getRecord(id))
      .filter((r) => r != null)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const indexOf = new Map(ordered.map((r, i) => [r.id, i]));
    const neighbors: string[] = [];
    for (const id of cited) {
      const at = indexOf.get(id);
      if (at == null) continue;
      if (ordered[at - 1]) neighbors.push(ordered[at - 1].id);
      if (ordered[at + 1]) neighbors.push(ordered[at + 1].id);
    }
    neighbors.forEach(push);
  }
  return out;
}

/**
 * Contract gate for ANY lead source (deterministic, specialist, or
 * general fallback). Rejects invented citations, unsupported or
 * explanation-free leads, and actions the UI cannot execute.
 */
export function validateLead(
  lead: DiscoveryLead,
  store: EvidenceStore,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!lead.summary.trim()) problems.push('summary is empty');
  if (lead.whyPrioritized.length === 0) problems.push('whyPrioritized is required');
  if (lead.limitations.length === 0) {
    problems.push('limitations are required (a lead without caveats is a conclusion, not a lead)');
  }
  if (lead.supportingRecordIds.length === 0) problems.push('at least one supporting record is required');
  for (const id of lead.supportingRecordIds) {
    if (!store.has(id)) problems.push(`supporting record does not exist: ${id}`);
  }
  for (const id of lead.suggestedAction.focusRecordIds) {
    if (!store.has(id)) problems.push(`focus record does not exist: ${id}`);
  }
  if (!lead.suggestedAction.question.trim()) problems.push('suggested question is empty');
  if (lead.status !== 'proposed') problems.push('new leads must start as proposed, never pre-decided');
  return { ok: problems.length === 0, problems };
}

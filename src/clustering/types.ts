/**
 * Clustering engine contract (2026-11-01).
 *
 * FILE OWNERSHIP (Wonder/Sparky split): everything under
 * `src/clustering/` plus `scripts/cluster-*.mjs`,
 * `scripts/clustering.test.mjs`, and `data/concept-clusters-*.json`
 * is Sparky's. Wonder owns every consumer surface
 * (`src/evidence-ui.ts`, `src/panel.ts`, `public/ui/*`,
 * `src/galaxy/*`, `src/voice.ts`). The ONLY shared file is
 * `package.json` (one appended test line each — coordinate the
 * line, never rewrite the block). The two sides meet exclusively
 * through the artifact files validated by `validateArtifact()`
 * below: Wonder's UI reads committed JSON; Sparky's engines
 * write it. No cross-imports, no DOM in this directory, no
 * model calls without an explicit spend gate.
 */

export interface ClusterArtifactV1 {
  /** Engine id that produced this file, e.g. "tfidf-cosine-single-linkage". */
  method: string;
  /** Exact parameters — a judge must be able to reproduce the file. */
  params: Record<string, string | number | boolean>;
  /** Corpus fingerprint, e.g. "novachip-trade-secret-3000". */
  corpus: string;
  /** Majority-vote agreement with authored tags, 0..1. */
  purityVsAuthored: number;
  /** What the purity number does and does not prove. */
  purityNote: string;
  clusters: ClusterV1[];
}

export interface ClusterV1 {
  /** Stable within the artifact, e.g. "tfidf-01". */
  id: string;
  /** Human-readable basis: top shared terms (TF-IDF) or model label. */
  label: string;
  size: number;
  /** Majority authored tag + share — the honesty readout. */
  majorityAuthored: string;
  majorityShare: number;
  /** size < 5: a flag to inspect, never an emergent group. */
  thin: boolean;
  /** Sorted record ids. */
  recordIds: string[];
}

export const ARTIFACT_VERSION = 1;

/** Structural validation for any artifact any engine writes. */
export function validateArtifact(value: unknown): value is ClusterArtifactV1 {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  if (typeof a.method !== 'string' || a.method.length === 0) return false;
  if (typeof a.params !== 'object' || a.params === null) return false;
  if (typeof a.corpus !== 'string' || a.corpus.length === 0) return false;
  if (typeof a.purityVsAuthored !== 'number'
    || !(a.purityVsAuthored >= 0 && a.purityVsAuthored <= 1)) return false;
  if (typeof a.purityNote !== 'string') return false;
  if (!Array.isArray(a.clusters)) return false;
  const seenIds = new Set<string>();
  const seenRecords = new Set<string>();
  for (const c of a.clusters) {
    if (typeof c !== 'object' || c === null) return false;
    const cl = c as Record<string, unknown>;
    if (typeof cl.id !== 'string' || seenIds.has(cl.id)) return false;
    seenIds.add(cl.id);
    if (typeof cl.label !== 'string') return false;
    if (!Array.isArray(cl.recordIds)) return false;
    for (const id of cl.recordIds) {
      if (typeof id !== 'string' || seenRecords.has(id)) return false;
      seenRecords.add(id);
    }
    if (cl.size !== (cl.recordIds as unknown[]).length) return false;
    if (typeof cl.majorityAuthored !== 'string') return false;
    if (typeof cl.majorityShare !== 'number'
      || !(cl.majorityShare >= 0 && cl.majorityShare <= 1)) return false;
    if (typeof cl.thin !== 'boolean') return false;
  }
  return true;
}

export interface ClusterDocument {
  id: string;
  /** Authored tag for purity measurement (never used as a feature). */
  authored: string;
  tokens: string[];
}

/**
 * Any clustering engine: documents in (ids + token lists for
 * lexical engines, or raw texts for embedding engines),
 * thresholded groups out. Deterministic given identical input.
 */
export interface Clusterer {
  readonly engineId: string;
  cluster(docs: ClusterDocument[], options?: { targetMin?: number; targetMax?: number }): ClusterGroup[];
  /** Method + params block for the artifact header. */
  describe(): { method: string; params: Record<string, string | number | boolean> };
}

export interface ClusterGroup {
  /** Indices into the input docs array. */
  members: number[];
}

/**
 * Any embedding backend: texts in, L2-normalizable float vectors
 * out, in input order. Implementations: local open-weight
 * (offline, $0) and Fireworks-hosted (spend-gated).
 */
export interface Embedder {
  readonly backendId: string;
  /** Cost in USD if known, else null (never guessed). */
  readonly estimatedUsd: number | null;
  embed(texts: string[]): Promise<number[][]>;
}

/** Purity of groups vs authored tags (majority vote, weighted). */
export function purity(
  docs: readonly ClusterDocument[],
  groups: readonly ClusterGroup[],
): { score: number; detail: { size: number; majority: string; majorityCount: number }[] } {
  let correct = 0;
  const detail = groups.map((g) => {
    const tally = new Map<string, number>();
    for (const i of g.members) {
      const t = docs[i].authored;
      tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]
      || (a[0] < b[0] ? -1 : 1));
    const [top, n] = sorted[0] ?? ['', 0];
    correct += n;
    return { size: g.members.length, majority: top, majorityCount: n };
  });
  return { score: docs.length ? correct / docs.length : 0, detail };
}

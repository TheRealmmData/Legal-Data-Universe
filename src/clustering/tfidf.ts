/**
 * TF-IDF + cosine single-linkage engine (2026-11-01). The shipped
 * option-C implementation, behind the Clusterer interface so the
 * Concepts lens, the eval harness, and a future embedding engine
 * share grouping, labeling, and artifact code. Union-find over
 * thresholded edges from the inverted index; deterministic
 * (-similarity, id-pair) union order.
 */
import type { ClusterDocument, Clusterer, ClusterGroup } from './types.ts';
import { fitIdf, vectorize, type SparseVector } from './vector.ts';

export interface TfidfOptions {
  minDf?: number;
  maxDfRatio?: number;
  /** Similarity floor for an edge. */
  tau?: number;
  targetMin?: number;
  targetMax?: number;
}

export const TFIDF_SWEEP = [0.08, 0.1, 0.12, 0.15, 0.18, 0.22, 0.26, 0.32];

export class TfidfClusterer implements Clusterer {
  // engineId + param keys match the committed artifact header
  // byte-for-byte (Wonder's UI already reads that file).
  readonly engineId = 'tfidf-cosine-single-linkage-union-find';
  private minDf: number;
  private maxDfRatio: number;
  private defaultTau: number;
  private lastTau: number | undefined;
  private vectors: SparseVector[] = [];

  constructor(options: TfidfOptions = {}) {
    this.minDf = options.minDf ?? 3;
    this.maxDfRatio = options.maxDfRatio ?? 0.5;
    this.defaultTau = options.tau ?? TFIDF_SWEEP[5];
  }

  describe(): { method: string; params: Record<string, string | number | boolean> } {
    return {
      method: this.engineId,
      params: {
        minDf: this.minDf,
        maxDf: this.maxDfRatio,
        tf: '1+log',
        norm: 'l2',
        ...(this.lastTau !== undefined ? { tau: this.lastTau } : {}),
      },
    };
  }

  vectorsFor(docs: readonly { tokens: string[] }[]): SparseVector[] {
    const model = fitIdf(docs, this.minDf, this.maxDfRatio);
    return docs.map((d) => vectorize(d.tokens, model));
  }

  groupAt(docs: readonly ClusterDocument[], tau: number): { groups: ClusterGroup[]; vectors: SparseVector[] } {
    const vectors = this.vectorsFor(docs);
    this.vectors = vectors;
    this.lastTau = tau;
    return { groups: thresholdCluster(docs, vectors, tau), vectors };
  }

  cluster(
    docs: ClusterDocument[],
    _options: { targetMin?: number; targetMax?: number } = {},
  ): ClusterGroup[] {
    // Interface conformance: fixed default grouping. Threshold
    // SELECTION (sweep + purity comparison) is eval policy and
    // lives in the runner script, which reports it.
    return this.groupAt(docs, this.defaultTau).groups;
  }
}

export function thresholdCluster(
  docs: readonly { id: string }[],
  vectors: readonly SparseVector[],
  tau: number,
): ClusterGroup[] {
  const parent = docs.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (docs[ra].id < docs[rb].id) parent[rb] = ra;
    else parent[ra] = rb;
  };
  const postings = new Map<string, [number, number][]>();
  vectors.forEach((v, i) => {
    for (const [t, w] of v.weights) {
      if (!postings.has(t)) postings.set(t, []);
      (postings.get(t) as [number, number][]).push([i, w]);
    }
  });
  const dots = new Map<number, number>();
  for (const list of postings.values()) {
    for (let x = 0; x < list.length; x += 1) {
      for (let y = x + 1; y < list.length; y += 1) {
        const [i, wi] = list[x];
        const [j, wj] = list[y];
        const key = i < j ? i * 10000 + j : j * 10000 + i;
        dots.set(key, (dots.get(key) ?? 0) + wi * wj);
      }
    }
  }
  const edges: { sim: number; i: number; j: number; tie: string }[] = [];
  for (const [key, dot] of dots) {
    const i = Math.floor(key / 10000);
    const j = key % 10000;
    const sim = dot / (vectors[i].norm * vectors[j].norm);
    if (sim >= tau) {
      const a = docs[i].id;
      const b = docs[j].id;
      edges.push({ sim, i, j, tie: a < b ? `${a}|${b}` : `${b}|${a}` });
    }
  }
  edges.sort((p, q) => q.sim - p.sim || (p.tie < q.tie ? -1 : 1));
  for (const e of edges) union(e.i, e.j);
  const groups = new Map<number, number[]>();
  docs.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    (groups.get(r) as number[]).push(i);
  });
  return [...groups.values()].map((members) => ({ members }));
}

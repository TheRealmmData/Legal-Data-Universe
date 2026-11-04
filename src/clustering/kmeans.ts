/**
 * Cosine k-means with fixed k (2026-11-01). The non-chaining
 * alternative to single-linkage: clusters compete for members
 * by centroid similarity, so one weak shared-vocabulary edge
 * cannot transitively fuse everything. Operates on sparse
 * TF-IDF maps; dense embedding arrays are converted once.
 *
 * Deterministic: initial centroids are k evenly-spaced docs in
 * sorted-id order (no RNG), ties broken by (similarity desc,
 * cluster index asc, id asc), empty clusters re-seeded to the
 * deterministically farthest doc. Same input -> same output.
 */
import type { SparseVector } from './vector.ts';

export interface KMeansResult {
  /** Cluster index per doc, input order. */
  assignments: number[];
  iterations: number;
  converged: boolean;
}

function dotSparse(a: Map<string, number>, b: Map<string, number>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const v = big.get(t);
    if (v !== undefined) dot += w * v;
  }
  return dot;
}

function normalizeCentroid(sum: Map<string, number>): { weights: Map<string, number>; norm: number } {
  let norm = 0;
  for (const w of sum.values()) norm += w * w;
  norm = Math.sqrt(norm) || 1;
  const weights = new Map<string, number>();
  for (const [t, w] of sum) weights.set(t, w / norm);
  return { weights, norm: 1 };
}

export function denseToSparse(vectors: readonly (readonly number[])[]): SparseVector[] {
  return vectors.map((v) => {
    const weights = new Map<string, number>();
    let norm = 0;
    for (let i = 0; i < v.length; i += 1) {
      if (v[i] !== 0) {
        weights.set(`d${i}`, v[i]);
        norm += v[i] * v[i];
      }
    }
    norm = Math.sqrt(norm) || 1;
    for (const [k, w] of weights) weights.set(k, w / norm);
    return { weights, norm: 1 };
  });
}

export function kmeansCosine(
  ids: readonly string[],
  vectors: readonly SparseVector[],
  k: number,
  maxIterations = 60,
): KMeansResult {
  const n = ids.length;
  // Deterministic seeding: k evenly-spaced docs in sorted-id order.
  const order = ids.map((_, i) => i).sort((a, b) => (ids[a] < ids[b] ? -1 : 1));
  let centroids = Array.from({ length: k }, (_, c) => {
    const src = vectors[order[Math.floor((c * n) / k)]];
    return { weights: new Map(src.weights), norm: src.norm };
  });
  const assignments = new Array<number>(n).fill(-1);
  let converged = false;
  let iterations = 0;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    iterations = iter + 1;
    let changed = 0;
    for (let i = 0; i < n; i += 1) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c += 1) {
        const sim = dotSparse(vectors[i].weights, centroids[c].weights) / vectors[i].norm;
        if (sim > bestSim + 1e-12 || (Math.abs(sim - bestSim) <= 1e-12 && c < best)) {
          bestSim = sim;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed += 1;
      }
    }
    // Recompute centroids; re-seed empties deterministically.
    const sums: Map<string, number>[] = Array.from({ length: k }, () => new Map());
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i += 1) {
      const c = assignments[i];
      counts[c] += 1;
      const sum = sums[c];
      for (const [t, w] of vectors[i].weights) sum.set(t, (sum.get(t) ?? 0) + w);
    }
    for (let c = 0; c < k; c += 1) {
      if (counts[c] === 0) {
        // Farthest doc from its own centroid (lowest similarity,
        // lowest index breaks ties) becomes the new seed.
        let far = 0;
        let farSim = Infinity;
        for (let i = 0; i < n; i += 1) {
          const sim = dotSparse(vectors[i].weights, centroids[assignments[i]].weights) / vectors[i].norm;
          if (sim < farSim - 1e-12 || (Math.abs(sim - farSim) <= 1e-12 && i < far)) {
            farSim = sim;
            far = i;
          }
        }
        const src = vectors[far];
        sums[c] = new Map(src.weights);
      }
    }
    centroids = sums.map(normalizeCentroid);
    if (changed === 0) {
      converged = true;
      break;
    }
  }
  return { assignments, iterations, converged };
}

/** Assignments -> member-index groups in cluster-index order. */
export function groupsFromAssignments(assignments: readonly number[], k: number): { members: number[] }[] {
  const groups: number[][] = Array.from({ length: k }, () => []);
  assignments.forEach((c, i) => {
    groups[c].push(i);
  });
  return groups.map((members) => ({ members }));
}

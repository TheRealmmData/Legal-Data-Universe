/**
 * Shared lexical vector machinery (2026-11-01). Extracted verbatim
 * from scripts/cluster-concepts.mjs so the TF-IDF engine and its
 * tests share one implementation: tokenize -> idf -> sparse
 * TF-IDF vectors -> cosine -> top terms. Pure, no I/O.
 */
import type { ClusterDocument } from './types.ts';

export const STOPWORDS = new Set(
  'a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,have,has,had,do,does,did,will,would,can,could,should,may,might,must,shall,it,its,this,that,these,those,they,them,their,you,your,we,our,us,he,she,his,her,them,not,no,yes,all,any,each,every,both,few,more,most,other,some,such,only,own,same,so,than,too,very,can,just,also,per,via,within,without,please,thanks,re,fw,fwd'.split(','),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

export interface TfidfModel {
  idf: Map<string, number>;
  minDf: number;
  maxDfRatio: number;
}

export function fitIdf(docs: readonly { tokens: string[] }[], minDf = 3, maxDfRatio = 0.5): TfidfModel {
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, c] of df) {
    if (c >= minDf && c <= docs.length * maxDfRatio) idf.set(t, Math.log(docs.length / c));
  }
  return { idf, minDf, maxDfRatio };
}

export interface SparseVector {
  weights: Map<string, number>;
  norm: number;
}

export function vectorize(tokens: string[], model: TfidfModel): SparseVector {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    if (model.idf.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  const weights = new Map<string, number>();
  let norm = 0;
  for (const [t, c] of tf) {
    const w = (1 + Math.log(c)) * (model.idf.get(t) ?? 0);
    weights.set(t, w);
    norm += w * w;
  }
  return { weights, norm: Math.sqrt(norm) || 1 };
}

export function cosine(a: SparseVector, b: SparseVector): number {
  const [small, big] = a.weights.size <= b.weights.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small.weights) {
    const v = big.weights.get(t);
    if (v !== undefined) dot += w * v;
  }
  return dot / (a.norm * b.norm);
}

/** Top mean-weight terms per member group = label basis. */
export function topTerms(
  vectors: readonly SparseVector[],
  members: readonly number[],
  n = 3,
): string[] {
  const agg = new Map<string, number>();
  for (const i of members) {
    for (const [t, w] of vectors[i].weights) agg.set(t, (agg.get(t) ?? 0) + w);
  }
  return [...agg.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n).map(([t]) => t);
}

export function labelFor(
  vectors: readonly SparseVector[],
  members: readonly number[],
): string {
  return topTerms(vectors, members).join(' / ');
}

/** Majority authored tag + share for one member group. */
export function majorityTag(
  docs: readonly ClusterDocument[],
  members: readonly number[],
): { tag: string; share: number } {
  const tally = new Map<string, number>();
  for (const i of members) {
    const t = docs[i].authored;
    tally.set(t, (tally.get(t) ?? 0) + 1);
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]
    || (a[0] < b[0] ? -1 : 1));
  const [tag, count] = sorted[0] ?? ['', 0];
  return { tag, share: members.length ? count / members.length : 0 };
}

/**
 * Fireworks embedding backend (2026-11-01). Spend-gated by
 * construction: every spend path requires BOTH an explicit
 * model id AND an explicit approval flag — the module never
 * spends on defaults, and dry-run is the default everywhere.
 *
 * Two modes:
 *  - verify(modelId): ONE tiny /v1/embeddings call proving the
 *    hackathon credit covers that model. Prints dims + latency.
 *    The ONLY call scripts may make without --approve-spend.
 *  - embed(texts, { approveSpend: true }): batched embeddings
 *    for the corpus run. Refuses without the flag.
 *
 * Env (same pattern as server/inference.mjs, never printed):
 *  FIREWORKS_API_KEY, FIREWORKS_BASE_URL (default
 *  https://api.fireworks.ai/inference/v1),
 *  FIREWORKS_EMBEDDING_MODEL (no default — owner pastes the
 *  exact dashboard model id after confirming credit coverage).
 */

export interface FireworksEmbedConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function loadFireworksEmbedConfig(
  env: Record<string, string | undefined>,
  modelOverride?: string,
): FireworksEmbedConfig | { error: string } {
  const apiKey = env.FIREWORKS_API_KEY ?? '';
  if (!apiKey) {
    return { error: 'FIREWORKS_API_KEY is not set (server/.env, gitignored). No call attempted.' };
  }
  const model = modelOverride ?? env.FIREWORKS_EMBEDDING_MODEL ?? '';
  if (!model) {
    return {
      error: 'FIREWORKS_EMBEDDING_MODEL is not set: paste the exact dashboard model id first, '
        + 'after confirming the hackathon credit covers embeddings. No call attempted.',
    };
  }
  return {
    apiKey,
    baseUrl: env.FIREWORKS_BASE_URL ?? 'https://api.fireworks.ai/inference/v1',
    model,
  };
}

export interface EmbeddingVerifyResult {
  ok: true;
  model: string;
  dims: number;
  ms: number;
  /** First values, for a shape sanity glance (never corpus text). */
  sample: number[];
}

async function postEmbeddings(
  config: FireworksEmbedConfig,
  inputs: string[],
  fetchImpl: typeof fetch,
  retries = 5,
): Promise<{ data: { embedding: number[] }[]; usage?: unknown }> {
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: inputs }),
    });
    // eslint-disable-next-line no-await-in-loop
    const text = await res.text();
    if (res.ok) {
      return JSON.parse(text) as { data: { embedding: number[] }[]; usage?: unknown };
    }
    lastError = `Fireworks embeddings HTTP ${res.status}: ${text.slice(0, 200)}`;
    // 429 = service overloaded, not our quota: back off and retry.
    if (res.status === 429 && attempt < retries) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 2000 * (attempt + 1)); });
      continue;
    }
    throw new Error(lastError);
  }
  throw new Error(lastError);
}

/** One tiny call: proves credit coverage for THIS model id. */
export async function verifyEmbeddingModel(
  config: FireworksEmbedConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbeddingVerifyResult> {
  const t0 = Date.now();
  const out = await postEmbeddings(config, ['operational probe: falcon scheduler'], fetchImpl);
  const embedding = out.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Fireworks embeddings: empty embedding in a 200 response — model may not be an embedding model.');
  }
  return {
    ok: true,
    model: config.model,
    dims: embedding.length,
    ms: Date.now() - t0,
    sample: embedding.slice(0, 4),
  };
}

export interface EmbedBatchOptions {
  /** Hard requirement: no flag, no spend. */
  approveSpend: boolean;
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Full-corpus embeddings. Refuses without approveSpend: true. */
export async function embedTexts(
  config: FireworksEmbedConfig,
  texts: string[],
  options: EmbedBatchOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  if (!options.approveSpend) {
    throw new Error('embedTexts refused: pass { approveSpend: true } after the owner confirms credit coverage. Dry-run first.');
  }
  const batchSize = options.batchSize ?? 32;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await postEmbeddings(config, batch, fetchImpl);
    for (const row of res.data ?? []) out.push(row.embedding);
    options.onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  if (out.length !== texts.length) {
    throw new Error(`Fireworks embeddings returned ${out.length} vectors for ${texts.length} texts — aborting, no artifact written.`);
  }
  return out;
}

/** Cosine grouping over dense vectors (same union-find policy as TF-IDF). */
export function groupEmbeddings(
  ids: readonly string[],
  vectors: readonly (readonly number[])[],
  tau: number,
): { members: number[] }[] {
  const parent = ids.map((_, i) => i);
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
    if (ids[ra] < ids[rb]) parent[rb] = ra;
    else parent[ra] = rb;
  };
  const norms = vectors.map((v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1);
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      let dot = 0;
      for (let k = 0; k < vectors[i].length; k += 1) dot += vectors[i][k] * vectors[j][k];
      if (dot / (norms[i] * norms[j]) >= tau) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  ids.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    (groups.get(r) as number[]).push(i);
  });
  return [...groups.values()].map((members) => ({ members }));
}

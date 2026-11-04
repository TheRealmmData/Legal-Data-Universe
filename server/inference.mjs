/**
 * Provider-neutral inference (M4, D16 as amended 2026-10-27).
 * SERVER-SIDE ONLY. This module runs inside the Vite dev-server
 * process (Node), reads credentials from app/server/.env, and is
 * never bundled into the client: no key can reach the browser,
 * the Quest, logs, or the repository. The client talks only to the
 * same-origin /api/chat middleware wired in vite.config.ts.
 *
 * Providers (all OpenAI-compatible chat completions):
 *  - meta:    Meta Model API, default https://api.meta.ai/v1,
 *             primary model muse-spark-1.3 (workshop-verified shape).
 *  - baseten: https://inference.baseten.co/v1, hackathon model
 *             meta-models/muse-spark-open-1026 (owner-confirmed).
 *  - stub:    deterministic canned JSON for offline tests. Clearly
 *             labelled; never presented as a live model.
 */
import { readFileSync } from 'node:fs';

/** Minimal .env parser (KEY=VALUE lines, # comments). No deps. */
export function loadEnvFile(path) {
  const env = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return env;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at <= 0) continue;
    env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return env;
}

export function providerConfig(env) {
  return {
    meta: {
      baseUrl: env.META_BASE_URL || 'https://api.meta.ai/v1',
      apiKey: env.META_API_KEY || '',
      models: {
        primary: env.META_MODEL_PRIMARY || 'muse-spark-1.3',
        comparator: env.META_MODEL_COMPARATOR || '',
      },
    },
    baseten: {
      baseUrl: env.BASETEN_BASE_URL || 'https://inference.baseten.co/v1',
      apiKey: env.BASETEN_API_KEY || '',
      models: {
        primary: env.BASETEN_MODEL || 'meta-models/muse-spark-open-1026',
        comparator: env.BASETEN_MODEL || 'meta-models/muse-spark-open-1026',
      },
    },
    // Prepared 2026-10-27 at owner direction ($100 Fireworks hackathon
    // credits). DORMANT: no live Fireworks call is authorized yet.
    // Model id intentionally has NO default — set FIREWORKS_MODEL to
    // the exact id from the Fireworks model catalog after owner
    // approves spend; do not guess it.
    fireworks: {
      baseUrl: env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1',
      apiKey: env.FIREWORKS_API_KEY || '',
      models: {
        primary: env.FIREWORKS_MODEL || '',
        comparator: env.FIREWORKS_MODEL || '',
      },
    },
  };
}

/** Which provider serves requests; stub only when nothing is configured. */
export function activeProvider(env, config) {
  const wanted = (env.INFERENCE_PROVIDER || '').trim().toLowerCase();
  if (wanted === 'meta' || wanted === 'baseten' || wanted === 'fireworks' || wanted === 'stub') return wanted;
  if (config.meta.apiKey) return 'meta';
  if (config.baseten.apiKey) return 'baseten';
  return 'stub';
}

const STUB_PLAN = {
  steps: [
    { tool: 'search_records', args: { term: 'Atlas' }, reason: 'stub: find the Atlas thread' },
    { tool: 'compare_timeline', args: { recordIds: ['fx-001', 'fx-002', 'fx-004'] }, reason: 'stub: check chronology' },
    { tool: 'search_records', args: { term: 'schedule' }, reason: 'stub: seek evidence pointing the other way' },
  ],
};
const STUB_FINDINGS = {
  findings: [
    {
      claim: 'STUB (no model called): the stored reply agrees to a March date one day before the proposal that proposed it.',
      citations: [
        { recordId: 'fx-001', quote: 'Vendor Atlas proposes moving the delivery date to March.' },
        { recordId: 'fx-002', quote: 'Agreed to the March date in your proposal.' },
      ],
    },
  ],
};

export async function chatCompletion(
  // Muse Spark/Wonder are reasoning models: reasoning tokens draw from
  // the same budget, and a 900-token cap returned empty content in the
  // first live test (2026-10-27). Default must leave room to answer.
  { role = 'primary', messages, maxTokens = 3000, provider: providerOverride },
  env,
  fetchImpl = fetch,
) {
  const config = providerConfig(env);
  const provider = ['meta', 'baseten', 'fireworks', 'stub'].includes(providerOverride)
    ? providerOverride
    : activeProvider(env, config);
  if (provider === 'stub') {
    const joined = messages.map((m) => m.content).join('\n');
    const payload = joined.includes('TASK:SYNTHESIZE') ? STUB_FINDINGS : STUB_PLAN;
    return {
      provider,
      model: 'stub-deterministic (NO MODEL CALLED)',
      text: JSON.stringify(payload),
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
  const pc = config[provider];
  if (!pc.apiKey) throw new Error(`${provider} provider selected but its API key is not configured`);
  const model = role === 'comparator' && pc.models.comparator ? pc.models.comparator : pc.models.primary;
  if (!model) throw new Error(`no ${role} model configured for provider ${provider}`);
  const response = await fetchImpl(`${pc.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pc.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      // Verified live 2026-10-27 on both providers: without this the
      // reasoning models burn the whole token budget thinking and
      // return empty/truncated content. 'low' cut reasoning ~40-200
      // tokens and latency to <2s on probe calls.
      reasoning_effort: env.REASONING_EFFORT || 'low',
    }),
  });
  if (!response.ok) {
    // Never echo headers/keys; status + short body only.
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${provider} inference failed: HTTP ${response.status} ${detail}`);
  }
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return { provider, model, text, usage: data?.usage ?? null };
}

/** Safe public status: booleans and model names, never credentials. */
export function health(env) {
  const config = providerConfig(env);
  return {
    stt: { witConfigured: Boolean(env.WIT_API_TOKEN) },
    activeProvider: activeProvider(env, config),
    configured: {
      meta: Boolean(config.meta.apiKey),
      baseten: Boolean(config.baseten.apiKey),
      fireworks: Boolean(config.fireworks.apiKey && config.fireworks.models.primary),
    },
    models: {
      meta: config.meta.models,
      baseten: config.baseten.models,
      fireworks: config.fireworks.models,
    },
  };
}

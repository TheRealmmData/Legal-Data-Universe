/**
 * Durable tests for the provider-neutral inference layer (M4).
 * Uses ONLY the deterministic stub provider and a fake fetch — no
 * network, no credentials, no spend. Proves: provider selection,
 * OpenAI-compatible request shape for Meta/Baseten, that health
 * output can never leak a key, and that stub plan/synthesis JSON
 * passes the same quote-exact gate live output must pass.
 * Run: node scripts/inference.test.mjs
 */
import {
  activeProvider,
  chatCompletion,
  health,
  loadEnvFile,
  providerConfig,
} from '../server/inference.mjs';
import { validateQuotes } from '../src/ai/contracts.ts';
import { buildSynthesisPrompt, parseModelJson } from '../src/ai/model-client.ts';
import { FIXTURE_RECORDS } from '../src/evidence/fixtures.ts';
import {
  createRateLimiter, handleChatRequest, handleDiagRequest, handleHealthRequest, parseWitTranscript, validateChatBody,
} from '../server/api-handlers.mjs';

// Wit streamed-STT parsing (owner desktop, 2026-11-03): room-mic
// captures make Wit emit MULTIPLE final segments; keeping only
// one segment truncated commands to a few characters.
const witTwoFinals = `{\n  "text": "Find leads",\n  "type": "FINAL_TRANSCRIPTION"\n}\n{\n  "type": "FINAL_TRANSCRIPTION",\n  "text": "Show concept clusters"\n}`;
const witPartialThenFinal = `{"text":"Find lea","type":"PARTIAL_TRANSCRIPTION"}{"text":"Find leads","type":"FINAL_TRANSCRIPTION"}`;
const witEscaped = `{"text":"Ask \\"who emailed Reyes\\"","type":"FINAL_TRANSCRIPTION"}`;
const witPartialOnly = `{"text":"Find lea","type":"PARTIAL_TRANSCRIPTION"}{"text":"Find leads","type":"PARTIAL_TRANSCRIPTION"}`;
let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

check('Wit multi-segment finals concatenate in order (field order irrelevant)',
  parseWitTranscript(witTwoFinals) === 'Find leads Show concept clusters');
check('Wit final wins over partials; partial-only falls back to last partial',
  parseWitTranscript(witPartialThenFinal) === 'Find leads'
  && parseWitTranscript(witPartialOnly) === 'Find leads'
  && parseWitTranscript(witEscaped) === 'Ask "who emailed Reyes"'
  && parseWitTranscript('not json') === '');

// Provider selection + defaults
check('no keys -> stub (never an accidental live call)',
  activeProvider({}, providerConfig({})) === 'stub');
check('baseten key alone -> baseten',
  activeProvider({}, providerConfig({ BASETEN_API_KEY: 'x' })) === 'baseten');
check('explicit INFERENCE_PROVIDER wins',
  activeProvider({ INFERENCE_PROVIDER: 'baseten' }, providerConfig({ META_API_KEY: 'x' })) === 'baseten');
const defaults = providerConfig({});
check('Meta default base + Spark primary',
  defaults.meta.baseUrl === 'https://api.meta.ai/v1' && defaults.meta.models.primary === 'muse-spark-1.3');
check('Baseten default base + exact hackathon model',
  defaults.baseten.baseUrl === 'https://inference.baseten.co/v1'
  && defaults.baseten.models.primary === 'meta-models/muse-spark-open-1026');

// Health output is safe to expose: booleans + model names only
const secret = 'FAKE-API-KEY-FOR-TEST-ONLY-12345';
const h = health({ BASETEN_API_KEY: secret, META_API_KEY: secret });
check('health reports configuration without leaking keys',
  h.configured.baseten === true && h.configured.meta === true
  && !JSON.stringify(h).includes(secret));

// OpenAI-compatible request shape (fake fetch captures, no network)
let captured;
const fakeFetch = async (url, init) => {
  captured = { url, init };
  return {
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: '{"steps":[]}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      };
    },
    async text() { return ''; },
  };
};
const viaBaseten = await chatCompletion(
  { messages: [{ role: 'user', content: 'TASK:PLAN test' }] },
  { INFERENCE_PROVIDER: 'baseten', BASETEN_API_KEY: secret },
  fakeFetch,
);
const sentBody = JSON.parse(captured.init.body);
check('baseten call hits chat/completions with exact model + bearer auth',
  captured.url === 'https://inference.baseten.co/v1/chat/completions'
  && sentBody.model === 'meta-models/muse-spark-open-1026'
  && captured.init.headers.Authorization === `Bearer ${secret}`);
check('usage is propagated for spend accounting',
  viaBaseten.usage?.total_tokens === 15 && viaBaseten.provider === 'baseten');

// Stub plan + synthesis satisfy the live-path gates
const stubPlan = await chatCompletion(
  { messages: [{ role: 'system', content: 'TASK:PLAN' }, { role: 'user', content: 'Atlas?' }] },
  {},
  fakeFetch,
);
const plan = JSON.parse(stubPlan.text);
check('stub plan is bounded, allow-listed, seeks counterevidence',
  stubPlan.provider === 'stub' && plan.steps.length >= 3 && plan.steps.length <= 5
  && plan.steps.every((s) => ['search_records', 'get_record', 'compare_timeline', 'trace_relationships'].includes(s.tool))
  && plan.steps.some((s) => /other way/i.test(s.reason)));
const stubSynth = await chatCompletion(
  { messages: [{ role: 'system', content: 'TASK:SYNTHESIZE' }, { role: 'user', content: 'records...' }] },
  {},
  fakeFetch,
);
const finding = JSON.parse(stubSynth.text).findings[0];
finding.citationIds = [...new Set(finding.citations.map((c) => c.recordId))];
const textOf = (id) => {
  const r = FIXTURE_RECORDS.find((x) => x.id === id);
  return r ? `${r.title} ${r.body}` : undefined;
};
check('stub synthesis quotes verify verbatim (and is labelled STUB)',
  validateQuotes(finding, textOf).ok && finding.claim.startsWith('STUB'));

// .env.example exists and carries no populated secrets
const example = loadEnvFile(new URL('../server/.env.example', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
check('.env.example presets Baseten endpoint/model with empty keys',
  example.BASETEN_BASE_URL === 'https://inference.baseten.co/v1'
  && example.BASETEN_MODEL === 'meta-models/muse-spark-open-1026'
  && example.BASETEN_API_KEY === '' && example.META_API_KEY === '');

// Failure handling (G5): provider errors, timeouts, malformed output
const httpFailFetch = async () => ({
  ok: false,
  status: 500,
  async text() { return 'upstream exploded'; },
  async json() { return {}; },
});
let httpError = '';
try {
  await chatCompletion(
    { messages: [{ role: 'user', content: 'x' }], provider: 'baseten' },
    { BASETEN_API_KEY: secret },
    httpFailFetch,
  );
} catch (e) { httpError = String(e.message); }
check('provider HTTP 500 surfaces sanitized error (status kept, key absent)',
  httpError.includes('HTTP 500') && !httpError.includes(secret));
const timeoutFetch = async () => { throw new Error('The operation was aborted (timeout)'); };
let timeoutError = '';
try {
  await chatCompletion(
    { messages: [{ role: 'user', content: 'x' }], provider: 'meta' },
    { META_API_KEY: secret },
    timeoutFetch,
  );
} catch (e) { timeoutError = String(e.message); }
check('provider timeout propagates as an error, not silent success',
  timeoutError.includes('aborted') && !timeoutError.includes(secret));
let malformedThrew = false;
try { parseModelJson('the model said something unhelpful'); } catch { malformedThrew = true; }
check('malformed model output is rejected, never half-parsed',
  malformedThrew && parseModelJson('```json\n{"a":1}\n```').a === 1);
const fw = providerConfig({});
check('fireworks option is dormant by default (no model id, not auto-selected)',
  fw.fireworks.models.primary === ''
  && fw.fireworks.baseUrl === 'https://api.fireworks.ai/inference/v1'
  && activeProvider({}, providerConfig({ FIREWORKS_API_KEY: 'x' })) === 'stub');

const manyRecords = Array.from({ length: 125 }, (_, i) => ({
  id: `ts-${String(i + 100)}`,
  title: `Record ${i}`,
  body: 'x'.repeat(220),
  date: '2026-01-01',
  dateConfidence: 'verified',
}));
const boundedPrompt = buildSynthesisPrompt({
  objective: 'Focus on ts-222 and ts-223.',
  results: [{ tool: 'search_records', recordIds: manyRecords.map((r) => r.id), facts: ['count=125'] }],
  records: manyRecords,
});
check('synthesis prompt stays under proxy cap and puts focus records first',
  boundedPrompt.length <= 18500
  && boundedPrompt.indexOf('[ts-222]') >= 0
  && boundedPrompt.indexOf('[ts-222]') < boundedPrompt.indexOf('[ts-100]')
  && boundedPrompt.includes('omitted for prompt budget'));

// Production (Vercel) handler contracts: same validation, no file I/O.
const limiter = createRateLimiter(2, 1000);
check('production rate limiter admits a bounded burst then refuses',
  limiter.take('203.0.113.7', 100) && limiter.take('203.0.113.7', 200)
  && !limiter.take('203.0.113.7', 300) && limiter.take('203.0.113.7', 1200));
check('production chat validation rejects oversized/non-string message sets',
  Boolean(validateChatBody({ messages: Array.from({ length: 13 }, () => ({ content: 'x' })) }).error)
  && Boolean(validateChatBody({ messages: [{ content: 42 }] }).error)
  && !validateChatBody({ messages: [{ role: 'user', content: 'ok' }] }).error);
const prodHealth = await handleHealthRequest({ BASETEN_API_KEY: secret }).json();
check('production /api/health leaks no credential',
  prodHealth.activeProvider === 'baseten' && !JSON.stringify(prodHealth).includes(secret));
const prodChat = await handleChatRequest(new Request('https://example.test/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'TASK:PLAN production stub' }] }),
}), {});
const prodChatBody = await prodChat.json();
check('production /api/chat serves the labelled stub without credentials',
  prodChat.status === 200 && prodChatBody.provider === 'stub'
  && String(prodChatBody.model).includes('NO MODEL CALLED'));
const prodDiag = await handleDiagRequest(new Request('https://example.test/api/diag', {
  method: 'POST', body: 'stage-only',
}));
check('production /api/diag acknowledges without persistence', prodDiag.status === 204);

console.log(failures === 0 ? '\nAll inference tests passed.' : `\n${failures} inference test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

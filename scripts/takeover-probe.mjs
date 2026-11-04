/**
 * Meta-model takeover probe: proves the Meta provider route on
 * the existing proxy (explicit per-call override; does NOT
 * change the product's active provider). Prints provider/model,
 * latency, token usage. Run: node scripts/takeover-probe.mjs
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = process.argv[2] ?? 'https://localhost:8081';
const health = await (await fetch(`${base}/api/health`)).json();
console.log('health:', JSON.stringify(health));
const t0 = Date.now();
const res = await fetch(`${base}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    role: 'primary',
    provider: 'meta',
    messages: [
      { role: 'system', content: 'Reply with ONLY JSON: {"steps":[{"tool":"search_records","args":{"term":"Atlas"},"reason":"takeover probe"}]}' },
      { role: 'user', content: 'Objective: Meta takeover connectivity probe' },
    ],
  }),
});
const data = await res.json();
console.log(`meta chat: http=${res.status} ms=${Date.now() - t0} provider=${data.provider} model=${data.model}`);
console.log('usage:', JSON.stringify(data.usage ?? null));
console.log('text[:200]:', String(data.text ?? data.error ?? '').slice(0, 200));
if (!res.ok || data.provider !== 'meta') process.exit(1);

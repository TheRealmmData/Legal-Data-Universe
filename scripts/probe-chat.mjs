/**
 * Live provider probe (existing authorized /api/chat path only).
 * Verifies health + one minimal planner-shaped call. Records
 * provider/model/latency; never prints credentials.
 * Run: node scripts/probe-chat.mjs [baseUrl]
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
    messages: [
      { role: 'system', content: 'Reply with ONLY JSON: {"steps":[{"tool":"search_records","args":{"term":"Atlas"},"reason":"probe"}]}' },
      { role: 'user', content: 'Objective: connectivity probe' },
    ],
  }),
});
const data = await res.json();
console.log(`chat: http=${res.status} ms=${Date.now() - t0} provider=${data.provider} model=${data.model}`);
console.log('text[:200]:', String(data.text ?? data.error ?? '').slice(0, 200));

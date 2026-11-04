/**
 * Takeover daily brief / ask — Meta model via existing proxy
 * (explicit provider override; product default unchanged).
 * Usage:
 *   node scripts/takeover-brief.mjs [--status "one-line status"]
 *   node scripts/takeover-brief.mjs --ask "your question"
 * Context = docs/46 operator packet (read from disk each run).
 * Output is a DRAFT for the human operator; nothing auto-applies.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = process.argv[2] ?? 'https://localhost:8081';
const args = process.argv.slice(2);
const askAt = args.indexOf('--ask');
const statusAt = args.indexOf('--status');
const ask = askAt >= 0 ? args[askAt + 1] : undefined;
const status = statusAt >= 0 ? args[statusAt + 1] : undefined;

const packetPath = fileURLToPath(new URL('../../docs/46-takeover-operator-packet.md', import.meta.url));
const packet = readFileSync(packetPath, 'utf8');

const userPrompt = ask
  ? `Operator question: ${ask}\nAnswer concisely, honor §4 do-not list, mark anything unverified.`
  : `Produce today's takeover brief: (1) the single highest-value next action from packet §3, (2) today's checklist (max 6 items, each with done-criteria), (3) risks to Nov 3 freeze, (4) questions parked for Muse's return. Operator status: ${status ?? '(not supplied)'}`;

const t0 = Date.now();
const res = await fetch(`${base}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    role: 'primary',
    provider: 'meta',
    messages: [
      { role: 'system', content: `You are the takeover assistant described in this operator packet. Follow it exactly.\n\n${packet}` },
      { role: 'user', content: userPrompt },
    ],
  }),
});
const data = await res.json();
if (!res.ok || data.error) {
  console.error(`brief failed: http=${res.status} ${data.error ?? ''}`);
  process.exit(1);
}
console.log(`# Takeover ${ask ? 'answer' : 'daily brief'} — ${data.provider}:${data.model} (${Date.now() - t0} ms, usage ${JSON.stringify(data.usage?.total_tokens ?? '?')} tokens)\n`);
console.log(data.text);

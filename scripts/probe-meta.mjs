/**
 * One bounded Meta-direct probe through the SAME server inference
 * module the app uses (no new provider path, no key printed).
 * Proves Meta inference is operational, not just configured.
 * Run: node scripts/probe-meta.mjs   (1 small call, existing credits)
 */
import { loadEnvFile, chatCompletion } from '../server/inference.mjs';

const fileEnv = loadEnvFile(new URL('../server/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const env = { ...fileEnv, ...process.env, AI_PROVIDER: 'meta' };
const t0 = Date.now();
try {
  const out = await chatCompletion({
    role: 'primary',
    provider: 'meta',
    maxTokens: 300,
    messages: [
      { role: 'system', content: 'Reply with ONLY JSON: {"ok":true}' },
      { role: 'user', content: 'Meta operational probe' },
    ],
  }, env);
  console.log(`meta-probe: ok ms=${Date.now() - t0} provider=${out.provider} model=${out.model}`);
  console.log('text[:120]:', String(out.text ?? '').slice(0, 120));
} catch (e) {
  console.log(`meta-probe: FAILED ms=${Date.now() - t0} ${String(e?.message ?? e).slice(0, 200)}`);
  process.exit(1);
}

/** One bounded Fireworks probe via the app's server inference
 * module (provider override). No key printed. Exit 1 on failure
 * with the sanitized error = precise blocker report. */
import { loadEnvFile, chatCompletion } from '../server/inference.mjs';
const env = { ...loadEnvFile(new URL('../server/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), ...process.env };
const t0 = Date.now();
try {
  const out = await chatCompletion({
    role: 'primary', provider: 'fireworks', maxTokens: 300,
    messages: [
      { role: 'system', content: 'Reply with ONLY JSON: {"ok":true}' },
      { role: 'user', content: 'Fireworks operational probe' },
    ],
  }, env);
  console.log(`fireworks-probe: ok ms=${Date.now() - t0} provider=${out.provider} model=${out.model} usage=${JSON.stringify(out.usage ?? {})}`);
  console.log('text[:120]:', String(out.text ?? '').slice(0, 120));
} catch (e) {
  console.log(`fireworks-probe: FAILED ms=${Date.now() - t0} ${String(e?.message ?? e).slice(0, 250)}`);
  process.exit(1);
}

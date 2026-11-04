/**
 * Live Wit.ai STT verification (desktop/API level — NOT Quest).
 * Sends a wav file directly to Wit /speech using the server
 * token from app/server/.env (never printed).
 * Run: node scripts/probe-stt.mjs <wavPath>
 */
import { readFileSync } from 'node:fs';
import { loadEnvFile } from '../server/inference.mjs';

const env = loadEnvFile(new URL('../server/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
if (!env.WIT_API_TOKEN) { console.log('probe-stt: WIT_API_TOKEN missing'); process.exit(1); }
const audio = readFileSync(process.argv[2]);
const t0 = Date.now();
const res = await fetch('https://api.wit.ai/speech?v=20260513', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.WIT_API_TOKEN}`, 'Content-Type': 'audio/wav' },
  body: audio,
});
const text = await res.text();
let transcript = '';
const finals = [...text.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"[^}]*"type"\s*:\s*"FINAL_TRANSCRIPTION"/g)];
const any = [...text.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
transcript = (finals[finals.length - 1] ?? any[any.length - 1])?.[1]?.replace(/\\"/g, '"') ?? '';
console.log(`probe-stt: http=${res.status} ms=${Date.now() - t0} transcript="${transcript}"`);
if (!res.ok || !transcript) { console.log('raw[:300]:', text.slice(0, 300)); process.exit(1); }

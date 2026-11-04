/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * M4 inference proxy (dev only). Same-origin /api/chat + /api/health
 * served by this Node process over the dev server's HTTPS, so the
 * Quest client never sees a credential and no mixed-content call is
 * needed. Keys are read from app/server/.env at request time (edits
 * apply without restart) and are never logged; usage accounting goes
 * to app/server/usage.log (gitignored). Production hosting is a
 * separate, later decision.
 */
function inferenceProxy(): Plugin {
  let requestCount = 0;
  return {
    name: 'mmdata-inference-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        try {
          const { appendFileSync, writeFileSync } = await import('node:fs');
          const { fileURLToPath } = await import('node:url');
          // @ts-expect-error plain-JS server module, intentionally untyped
          const inference = await import('./server/inference.mjs');
          // @ts-expect-error plain-JS server module, intentionally untyped
          const apiHandlers = await import('./server/api-handlers.mjs');
          const envPath = fileURLToPath(new URL('./server/.env', import.meta.url));
          const logPath = fileURLToPath(new URL('./server/usage.log', import.meta.url));
          const env = inference.loadEnvFile(envPath);
          if (req.url === '/api/diag' && req.method === 'POST') {
            // Crash-forensics telemetry (dev only): client stage
            // beacons land on THIS PC in server/diag.log (gitignored
            // via *.log) so a Quest immersive freeze still leaves
            // evidence readable without owner action. Payload is
            // stage names/health counters only — no evidence data.
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += (chunk as Buffer).length;
              if (size <= 8192) chunks.push(chunk as Buffer);
            }
            const diagPath = fileURLToPath(new URL('./server/diag.log', import.meta.url));
            appendFileSync(diagPath, `${JSON.stringify({ at: new Date().toISOString(), body: Buffer.concat(chunks).toString('utf8').slice(0, 2000) })}\n`);
            res.statusCode = 204;
            return res.end();
          }
          if (req.url === '/api/export-save' && req.method === 'POST') {
            // Dev-only export landing zone: the framed emulator
            // workspace swallows anchor downloads, so the client
            // also POSTs the exact bytes here and they land in
            // app/exports/ on this PC (gitignored). Filename is
            // basename-sanitized; size capped like STT audio x8.
            const { mkdirSync } = await import('node:fs');
            const rawName = String(req.headers['x-filename'] ?? 'export.bin');
            const safeName = rawName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'export.bin';
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += (chunk as Buffer).length;
              if (size <= 16 * 1024 * 1024) chunks.push(chunk as Buffer);
            }
            if (size === 0 || size > 16 * 1024 * 1024) return send(413, { error: 'export body empty or too large' });
            const exportsDir = fileURLToPath(new URL('./exports/', import.meta.url));
            mkdirSync(exportsDir, { recursive: true });
            writeFileSync(exportsDir + safeName, Buffer.concat(chunks));
            console.log(`[export-save] exports/${safeName} bytes=${size}`);
            return send(200, { saved: true, path: `exports/${safeName}`, size });
          }
          if (req.url === '/api/stt' && req.method === 'POST') {
            // Wit.ai STT (owner-approved 2026-10-31). Token stays
            // server-side (server/.env WIT_API_TOKEN), audio is
            // forwarded in memory and never stored. Client always
            // sends 16 kHz WAV (ms4, 2026-11-01: MediaRecorder
            // WebM/Ogg-Opus containers are rejected by Wit, and
            // the old client read `text` while this route returned
            // `transcript` — both keys are now returned so the
            // contract can never silently fork again).
            const witToken = env.WIT_API_TOKEN || '';
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += (chunk as Buffer).length;
              if (size <= 8 * 1024 * 1024) chunks.push(chunk as Buffer);
            }
            if (!witToken) {
              return send(501, { error: 'Speech-to-text is not configured on the server (WIT_API_TOKEN missing in app/server/.env). Voice is unavailable; taps still work.' });
            }
            const audio = Buffer.concat(chunks);
            if (audio.length < 2048) {
              return send(400, { error: 'Audio was too short to contain speech. Tap Voice, speak, then pause a moment.' });
            }
            // Safe diagnostics (Round 4 HTTP 400): content-type +
            // size only, never audio content or credentials.
            console.log(`[stt] content-type=${req.headers['content-type'] ?? '(none)'} bytes=${audio.length}`);
            // Local-dev voice forensics (owner desktop, 2026-11-03):
            // keep ONLY the most recent upload on this PC so a
            // truncated transcript can be replayed/analyzed offline.
            // Gitignored; overwritten every attempt; dev server only.
            try {
              const lastSttPath = fileURLToPath(new URL('./server/last-stt-capture.wav', import.meta.url));
              writeFileSync(lastSttPath, audio);
            } catch { /* diagnostics only */ }
            const sttStarted = Date.now();
            try {
              const ct = String(req.headers['content-type'] || 'audio/wav').split(';')[0];
              if (ct === 'audio/webm') {
                return send(400, { error: 'This browser sent WebM audio, which the speech service rejects. Reload the page so the WAV recorder loads, then try Voice again.' });
              }
              const witRes = await fetch('https://api.wit.ai/speech?v=20260513', {
                method: 'POST',
                headers: { Authorization: `Bearer ${witToken}`, 'Content-Type': ct },
                body: audio as unknown as BodyInit,
              });
              const text = await witRes.text();
              // Shared with the production handler (one parser,
              // never a fork): Wit streams concatenated JSON
              // objects with one FINAL_TRANSCRIPTION per segment;
              // join every final in order.
              const transcript = apiHandlers.parseWitTranscript(text);
              console.log(`[stt] wit http=${witRes.status} ms=${Date.now() - sttStarted} chars=${transcript.length}`);
              if (!witRes.ok) {
                return send(502, {
                  error: `Speech service failed (HTTP ${witRes.status}). Try Voice again; if it repeats, tell the operator to check the Wit.ai token.`,
                  detail: text.slice(0, 160),
                });
              }
              return send(200, { text: transcript, transcript, provider: 'wit.ai' });
            } catch (e) {
              console.log(`[stt] unreachable ms=${Date.now() - sttStarted}`);
              return send(502, { error: `Speech service unreachable from this PC: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
            }
          }
          if (req.url === '/api/tts' && req.method === 'POST') {
            // Spoken assistant replies (owner, 2026-11-01): Wit.ai
            // /synthesize with the same server-side token as STT
            // (verified live: HTTP 200 WAV in ~1 s). Text is the
            // assistant's own log line (capped); audio returns as
            // WAV bytes and is never stored.
            const witToken = env.WIT_API_TOKEN || '';
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            if (!witToken) return send(501, { error: 'TTS not configured (WIT_API_TOKEN missing)' });
            let text = '';
            try {
              text = String(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}').text ?? '').slice(0, 300);
            } catch { return send(400, { error: 'tts body must be JSON {text}' }); }
            if (!text.trim()) return send(400, { error: 'tts text empty' });
            try {
              const witRes = await fetch('https://api.wit.ai/synthesize?v=20260513', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${witToken}`,
                  'Content-Type': 'application/json',
                  Accept: 'audio/wav',
                },
                body: JSON.stringify({ q: text, voice: env.WIT_TTS_VOICE || 'Rebecca' }),
              });
              if (!witRes.ok) {
                return send(502, { error: `Wit.ai TTS failed (HTTP ${witRes.status})` });
              }
              const audio = Buffer.from(await witRes.arrayBuffer());
              console.log(`[tts] chars=${text.length} bytes=${audio.length}`);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'audio/wav');
              return res.end(audio);
            } catch (e) {
              return send(502, { error: `Wit.ai TTS unreachable: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
            }
          }
          if (req.url === '/api/health' && req.method === 'GET') {
            return send(200, inference.health(env));
          }
          if (req.url !== '/api/chat' || req.method !== 'POST') {
            return send(404, { error: 'unknown api route' });
          }
          const cap = Number(env.MAX_PROXY_REQUESTS || 120);
          requestCount += 1;
          if (requestCount > cap) {
            return send(429, { error: `proxy request cap reached (${cap}); restart dev server or raise MAX_PROXY_REQUESTS` });
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const messages = Array.isArray(body.messages) ? body.messages : null;
          if (!messages || messages.length === 0 || messages.length > 12
            || messages.some((m: { content?: unknown }) => typeof m?.content !== 'string' || m.content.length > 20000)) {
            return send(400, { error: 'messages must be 1-12 items with string content <= 20000 chars' });
          }
          const role = body.role === 'comparator' ? 'comparator' : 'primary';
          const provider = ['meta', 'baseten', 'fireworks'].includes(body.provider) ? body.provider : undefined;
          const result = await inference.chatCompletion({ role, messages, maxTokens: 3000, provider }, env);
          appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), n: requestCount, provider: result.provider, model: result.model, usage: result.usage })}\n`);
          return send(200, result);
        } catch (error) {
          // Failure rows (status only, no content/credentials):
          // success-only logging made the 2026-10-29 in-headset
          // Ask failure unreconstructable server-side.
          if (req.url === '/api/chat') {
            try {
              const { appendFileSync: appendFail } = await import('node:fs');
              const { fileURLToPath: toPath } = await import('node:url');
              appendFail(
                toPath(new URL('./server/usage.log', import.meta.url)),
                `${JSON.stringify({ at: new Date().toISOString(), failure: true, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) })}\n`,
              );
            } catch { /* logging must never mask the real error */ }
          }
          return send(502, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), inferenceProxy()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});

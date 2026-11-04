/**
 * Production Web-standard API handlers (Vercel Functions).
 *
 * Same contracts as the Vite dev middleware, but no local-file
 * reads/writes: configuration comes from platform environment
 * variables, telemetry is acknowledgement-only, and usage logs go
 * to stdout without prompts, evidence, audio, or credentials.
 */
import { chatCompletion, health } from './inference.mjs';

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).length;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

export function createRateLimiter(max, windowMs) {
  const buckets = new Map();
  return {
    take(key, now = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.startedAt >= windowMs) {
        buckets.set(key, { startedAt: now, count: 1 });
        return true;
      }
      if (bucket.count >= max) return false;
      bucket.count += 1;
      return true;
    },
  };
}

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const limiters = {
  chat: createRateLimiter(30, 60 * 60 * 1000),
  stt: createRateLimiter(20, 60 * 60 * 1000),
  tts: createRateLimiter(60, 60 * 60 * 1000),
};
let chatRequestsThisInstance = 0;

function demoDisabled(env) {
  return env.PUBLIC_DEMO_ENABLED === '0' || env.PUBLIC_DEMO_ENABLED === 'false';
}

export function validateChatBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0 || messages.length > 12
    || messages.some((m) => typeof m?.content !== 'string' || m.content.length > 20000)) {
    return { error: 'messages must be 1-12 items with string content <= 20000 chars' };
  }
  return {
    messages,
    role: body.role === 'comparator' ? 'comparator' : 'primary',
    provider: ['meta', 'baseten', 'fireworks'].includes(body.provider) ? body.provider : undefined,
  };
}

export function handleHealthRequest(env = process.env) {
  return json(200, health(env));
}

export async function handleDiagRequest(request) {
  // Production has no local forensic file. Drain a bounded body so
  // sendBeacon/fetch completes; never persist or echo payloads.
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > 8192) return json(413, { error: 'diag payload too large' });
  } catch { /* acknowledgement still succeeds */ }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleChatRequest(request, env = process.env, fetchImpl = fetch) {
  if (demoDisabled(env)) return json(503, { error: 'public demo inference is disabled by the operator' });
  const max = positiveInt(env.MAX_PROXY_REQUESTS, 500);
  if (chatRequestsThisInstance >= max) {
    return json(429, { error: 'public demo request budget for this server instance is exhausted; the operator can redeploy or raise MAX_PROXY_REQUESTS' });
  }
  if (!limiters.chat.take(clientIp(request))) {
    return json(429, { error: 'rate limit reached for this address; try again later' });
  }
  const raw = await request.text();
  if (byteLength(raw) > 256 * 1024) return json(413, { error: 'chat request too large' });
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'chat body must be JSON' }); }
  const validated = validateChatBody(body);
  if (validated.error) return json(400, { error: validated.error });
  chatRequestsThisInstance += 1;
  try {
    const result = await chatCompletion({
      role: validated.role,
      messages: validated.messages,
      provider: validated.provider,
      maxTokens: 3000,
    }, env, fetchImpl);
    console.log(JSON.stringify({
      event: 'public-chat-usage', provider: result.provider, model: result.model, usage: result.usage,
    }));
    return json(200, result);
  } catch (error) {
    console.log(JSON.stringify({
      event: 'public-chat-failure',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    }));
    return json(502, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Parse a Wit /speech response body. Wit streams concatenated
 * JSON objects (PARTIALs, then one FINAL_TRANSCRIPTION **per
 * segment** — room microphone captures segment at pauses).
 * Join every final segment in order; fall back to the last
 * partial. The previous keep-only-one-segment logic truncated
 * desktop commands to a fragment (owner, 2026-11-03: live
 * two-phrase audio returned only the first phrase).
 */
export function parseWitTranscript(raw) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) { objects.push(raw.slice(start, i + 1)); start = -1; }
    }
  }
  const finals = [];
  let lastPartial = '';
  for (const text of objects) {
    try {
      const obj = JSON.parse(text);
      if (typeof obj.text !== 'string') continue;
      if (obj.type === 'FINAL_TRANSCRIPTION') finals.push(obj.text.trim());
      else lastPartial = obj.text.trim();
    } catch { /* partial stream object; regex fallback below */ }
  }
  const joined = finals.filter((t, i) => t && t !== finals[i - 1]).join(' ').trim();
  if (joined) return joined;
  if (lastPartial) return lastPartial;
  const any = [...raw.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  const pick = any[any.length - 1]?.[1];
  return pick ? pick.replace(/\\"/g, '"').trim() : '';
}

export async function handleSttRequest(request, env = process.env, fetchImpl = fetch) {
  if (demoDisabled(env)) return json(503, { error: 'public demo speech is disabled by the operator' });
  const token = env.WIT_API_TOKEN || '';
  if (!token) return json(501, { error: 'Speech-to-text is not configured on the server (WIT_API_TOKEN missing). Voice is unavailable; taps still work.' });
  if (!limiters.stt.take(clientIp(request))) return json(429, { error: 'speech rate limit reached; try again later' });
  const audio = Buffer.from(await request.arrayBuffer());
  if (audio.length > 4 * 1024 * 1024) return json(413, { error: 'audio exceeds the 4 MB public-demo limit' });
  if (audio.length < 2048) return json(400, { error: 'Audio was too short to contain speech. Tap Voice, speak, then pause a moment.' });
  const ct = String(request.headers.get('content-type') || 'audio/wav').split(';')[0];
  if (ct === 'audio/webm') {
    return json(400, { error: 'This browser sent WebM audio, which the speech service rejects. Reload the page so the WAV recorder loads, then try Voice again.' });
  }
  try {
    const started = Date.now();
    const res = await fetchImpl('https://api.wit.ai/speech?v=20260513', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': ct },
      body: audio,
    });
    const text = await res.text();
    const transcript = parseWitTranscript(text);
    console.log(JSON.stringify({ event: 'public-stt', status: res.status, ms: Date.now() - started, chars: transcript.length }));
    if (!res.ok) {
      return json(502, {
        error: `Speech service failed (HTTP ${res.status}). Try Voice again; if it repeats, tell the operator to check the Wit.ai token.`,
        detail: text.slice(0, 160),
      });
    }
    return json(200, { text: transcript, transcript, provider: 'wit.ai' });
  } catch (error) {
    return json(502, { error: `Speech service unreachable: ${String(error?.message ?? error).slice(0, 120)}` });
  }
}

export async function handleTtsRequest(request, env = process.env, fetchImpl = fetch) {
  if (demoDisabled(env)) return json(503, { error: 'public demo speech is disabled by the operator' });
  const token = env.WIT_API_TOKEN || '';
  if (!token) return json(501, { error: 'TTS not configured (WIT_API_TOKEN missing)' });
  if (!limiters.tts.take(clientIp(request))) return json(429, { error: 'speech rate limit reached; try again later' });
  const raw = await request.text();
  if (byteLength(raw) > 4096) return json(413, { error: 'tts request too large' });
  let text = '';
  try { text = String(JSON.parse(raw || '{}').text ?? '').slice(0, 300); }
  catch { return json(400, { error: 'tts body must be JSON {text}' }); }
  if (!text.trim()) return json(400, { error: 'tts text empty' });
  try {
    const res = await fetchImpl('https://api.wit.ai/synthesize?v=20260513', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'audio/wav',
      },
      body: JSON.stringify({ q: text, voice: env.WIT_TTS_VOICE || 'Rebecca' }),
    });
    if (!res.ok) return json(502, { error: `Wit.ai TTS failed (HTTP ${res.status})` });
    const audio = await res.arrayBuffer();
    if (audio.byteLength > 4.5 * 1024 * 1024) return json(502, { error: 'Wit.ai TTS response exceeds public-demo size limit' });
    return new Response(audio, {
      status: 200,
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return json(502, { error: `Wit.ai TTS unreachable: ${String(error?.message ?? error).slice(0, 120)}` });
  }
}

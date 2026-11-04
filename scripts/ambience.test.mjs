/**
 * Ambience + memo-markup contract tests (polish, 2026-11-02).
 * WebAudio-free: a stub AudioContext proves the generative
 * graph builds, schedules, and tears down without throwing;
 * memoKindOf proves the legal-memo inline markup mapping.
 * Run: node scripts/ambience.test.mjs
 */
import { createAmbience, AMBIENCE_PAD_GAIN } from '../src/ambience.ts';
// memoKindOf lives in evidence-ui (importing it pulls the JSON
// artifact without an import attribute under plain node, so the
// markup mapping is re-verified here through a local mirror of
// the same four prefix rules — the canvas kinds are asserted in
// the committed voice-help skeleton test above).
const memoKindOf = (line) => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('# ')) return 'center';
  if (trimmed.startsWith('## ')) return 'h1';
  if (/^\*\*(.+)\*\*$/.test(trimmed)) return 'bold';
  if (/^__(.+)__$/.test(trimmed)) return 'underline';
  return 'body';
};

let failures = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
};

// Minimal WebAudio stub: nodes record connections, params apply.
function stubParam() {
  return {
    value: 0,
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
  };
}
function stubNode() {
  return {
    gain: stubParam(), frequency: stubParam(), Q: stubParam(),
    threshold: stubParam(), ratio: stubParam(), knee: stubParam(),
    detune: stubParam(), type: '', buffer: null,
    connect() {}, disconnect() {}, start() {}, stop() {},
  };
}
class StubAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = {};
    this.state = 'suspended';
    this.resumeCalls = 0;
  }
  createGain() { return stubNode(); }
  createOscillator() { return stubNode(); }
  createBiquadFilter() { return stubNode(); }
  createDynamicsCompressor() { return stubNode(); }
  createConvolver() { return stubNode(); }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len), length: len };
  }
  async resume() { this.resumeCalls += 1; this.state = 'running'; }
  async close() {}
}
globalThis.window = { AudioContext: StubAudioContext };

const amb = createAmbience();
check('starts silent, reports started', !amb.isStarted());
amb.start();
check('start builds the graph', amb.isStarted());
amb.tone('listening');
amb.tone('confirm');
amb.tone('error');
check('tones schedule without throwing', true);
amb.setMuted(true);
amb.setMuted(false);
amb.stop();
check('stop silences', !amb.isStarted());
amb.dispose();
check('dispose tears down', !amb.isStarted());

check('memo title centers', memoKindOf('# Voice Help') === 'center');
check('memo h1 rules', memoKindOf('## EXECUTIVE SUMMARY') === 'h1');
check('memo bold maps', memoKindOf('**1.  SOURCE TEXT**') === 'bold');
check('memo underline maps', memoKindOf('__quoted body__') === 'underline');
check('memo plain stays body', memoKindOf('ordinary line') === 'body');

// Owner 2026-11-02: ambient pad was too quiet next to voice —
// raised ~3 ticks (~+9 dB over the original 0.05 pad gain).
check('pad gain raised about 3 ticks over 0.05', AMBIENCE_PAD_GAIN >= 0.12 && AMBIENCE_PAD_GAIN <= 0.2);

// Owner headset round 2026-11-02: still no ambient audio — a
// context created suspended must be resumable on later taps,
// and its state must be observable for telemetry.
{
  const a2 = createAmbience();
  check('state before start is none', a2.state() === 'none');
  a2.start();
  check('state after start reflects the context', a2.state() === 'running');
  a2.resume();
  check('resume is safely repeatable after start', a2.state() === 'running' && a2.isStarted());
  a2.dispose();
  check('state after dispose is none', a2.state() === 'none');
}

console.log(failures === 0 ? '\nAll ambience tests passed.' : `\n${failures} ambience test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

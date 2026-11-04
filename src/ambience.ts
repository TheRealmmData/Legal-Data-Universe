/**
 * Generative ambient soundscape (polish, 2026-11-02). Ported from
 * the Galactic Explorer reference (knowledge/ambient.js): warm,
 * calming, slowly evolving pad crossfading through gentle chord
 * changes, occasional soft pentatonic shimmer in generated
 * reverb. Every sound is synthesized here — no samples, no
 * copied audio.
 *
 * Quest discipline: ONE shared AudioContext owned by PanelSystem
 * (voice capture opens/closes its own context per utterance, so
 * this module never fights it); triangle/sine voices only;
 * per-voice slow gain LFOs so nothing sits static; lowpass
 * warmth; soft compression; low level. All timers are stopped
 * on dispose. No DOM except AudioContext creation.
 */

export interface Ambience {
  start(): void;
  stop(): void;
  setMuted(muted: boolean): void;
  /** Short UI tone (e.g. voice-listening cue). No-op until started. */
  tone(kind: 'listening' | 'confirm' | 'error'): void;
  isStarted(): boolean;
  /**
   * Re-resume the context on a user gesture (owner, 2026-11-02:
   * a context created 'suspended' by autoplay policy stayed
   * suspended forever — start() had already run, so no path
   * ever resumed it, and the pad was silently dead in headset).
   * Safe to call on every tap.
   */
  resume(): void;
  /** AudioContext state for telemetry ('none' before create). */
  state(): string;
  dispose(): void;
}

// Am9 -> Fmaj9 -> Cmaj9 -> Gadd9 (warm low register, GE reference).
const CHORDS: number[][] = [
  [110.0, 164.81, 246.94, 261.63],
  [87.31, 130.81, 220.0, 329.63],
  [130.81, 196.0, 293.66, 493.88],
  [98.0, 146.83, 246.94, 440.0],
];
const SHIMMER = [440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

/**
 * Pad level into the warmth/reverb bus. Owner (2026-11-02):
 * the original 0.05 sat too far under the spoken voice — the
 * headset volume needed for audibility made TTS hurt. Raised
 * "about 3 ticks" (~+9 dB, x2.8); the soft compressor on the
 * master bus keeps peaks tame, and voice playback (separate
 * element path) is unchanged.
 */
export const AMBIENCE_PAD_GAIN = 0.14;

export function createAmbience(): Ambience {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let padBus: GainNode | null = null;
  let started = false;
  let muted = false;
  let chordTimer: ReturnType<typeof setInterval> | null = null;
  let shimmerTimer: ReturnType<typeof setTimeout> | null = null;
  let chordIdx = 0;
  let layers: { gain: GainNode; oscs: { osc: OscillatorNode; lfo: OscillatorNode }[] }[] = [];

  function makeReverbImpulse(seconds = 2.8): AudioBuffer | null {
    if (!ctx) return null;
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(2, Math.floor(rate * seconds), rate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i += 1) {
        // Deterministic-ish decay noise; Math.random is fine for
        // reverb tails (not evidence, not tested).
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6);
      }
    }
    return buf;
  }

  function makePadLayer(freqs: number[], when: number): void {
    if (!ctx || !padBus) return;
    const layerGain = ctx.createGain();
    layerGain.gain.setValueAtTime(0, when);
    layerGain.connect(padBus);
    const oscs = freqs.map((freq, i) => {
      const osc = (ctx as AudioContext).createOscillator();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 3.5;
      const g = (ctx as AudioContext).createGain();
      g.gain.value = [0.34, 0.22, 0.16, 0.1][i] ?? 0.12;
      const lfo = (ctx as AudioContext).createOscillator();
      lfo.frequency.value = 0.045 + i * 0.021;
      const lfoGain = (ctx as AudioContext).createGain();
      lfoGain.gain.value = g.gain.value * 0.45;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      osc.connect(g);
      g.connect(layerGain);
      osc.start(when);
      lfo.start(when);
      return { osc, lfo };
    });
    layers.push({ gain: layerGain, oscs });
  }

  function crossfadeChord(): void {
    if (!ctx || !started) return;
    const t = ctx.currentTime;
    makePadLayer(CHORDS[chordIdx % CHORDS.length], t);
    chordIdx += 1;
    const next = layers[layers.length - 1];
    next.gain.gain.linearRampToValueAtTime(0.9, t + 7);
    for (let i = 0; i < layers.length - 1; i += 1) {
      const old = layers[i];
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 8);
      old.oscs.forEach(({ osc, lfo }) => {
        try { osc.stop(t + 8.5); lfo.stop(t + 8.5); } catch { /* already stopped */ }
      });
    }
    layers = layers.slice(-1);
  }

  function shimmerNote(): void {
    if (!ctx || !padBus || !started || muted) return;
    const t = ctx.currentTime;
    const freq = SHIMMER[Math.floor(Math.random() * SHIMMER.length)];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const harm = ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.value = freq * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    const hg = ctx.createGain();
    hg.gain.value = 0.25;
    osc.connect(g);
    harm.connect(hg);
    hg.connect(g);
    g.connect(padBus);
    osc.start(t);
    harm.start(t);
    osc.stop(t + 6);
    harm.stop(t + 6);
  }

  function ensure(): boolean {
    if (ctx) return true;
    try {
      const AudioCtor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return false;
      ctx = new AudioCtor();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -26;
      comp.ratio.value = 4;
      comp.knee.value = 18;
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(comp);
      comp.connect(ctx.destination);
      const warmth = ctx.createBiquadFilter();
      warmth.type = 'lowpass';
      warmth.frequency.value = 2400;
      warmth.Q.value = 0.4;
      padBus = ctx.createGain();
      padBus.gain.value = AMBIENCE_PAD_GAIN;
      const verb = ctx.createConvolver();
      const impulse = makeReverbImpulse();
      if (impulse) verb.buffer = impulse;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      padBus.connect(warmth);
      warmth.connect(master);
      padBus.connect(verb);
      verb.connect(wet);
      wet.connect(master);
      return true;
    } catch {
      return false;
    }
  }

  function applyGain(): void {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(muted || !started ? 0 : 0.9, ctx.currentTime, 1.6);
  }

  function scheduleShimmer(): void {
    if (!started) return;
    shimmerNote();
    shimmerTimer = setTimeout(scheduleShimmer, 4500 + Math.random() * 5500);
  }

  return {
    start() {
      if (!ensure() || !ctx) return;
      void ctx.resume().catch(() => undefined);
      if (started) return;
      started = true;
      crossfadeChord();
      chordTimer = setInterval(crossfadeChord, 16000);
      shimmerTimer = setTimeout(scheduleShimmer, 3500);
      applyGain();
    },
    stop() {
      started = false;
      if (chordTimer) clearInterval(chordTimer);
      chordTimer = null;
      if (shimmerTimer) clearTimeout(shimmerTimer);
      shimmerTimer = null;
      applyGain();
    },
    setMuted(m: boolean) {
      if (m !== muted) {
        muted = !!m;
        applyGain();
      }
    },
    tone(kind: 'listening' | 'confirm' | 'error') {
      // Short UI earcons on the pad bus (inherit warmth+reverb).
      // listening: soft two-note rise (record cue). confirm: warm
      // single chime. error: low muted pair, felt not alarming.
      if (!ctx || !padBus || !started || muted) return;
      const t = ctx.currentTime;
      // Listening/confirm cues must cut through the pad wash
      // (owner, 2026-11-02: no listening tone was audible at
      // the old 0.05 peaks under reverb) — peaks raised ~8 dB.
      const notes: [number, number, number][] =
        kind === 'listening' ? [[659.25, 0, 0.16], [880.0, 0.18, 0.13]]
        : kind === 'confirm' ? [[523.25, 0, 0.15], [783.99, 0.2, 0.11]]
        : [[220.0, 0, 0.09], [164.81, 0.22, 0.09]];
      for (const [freq, at, peak] of notes) {
        const osc = (ctx as AudioContext).createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = (ctx as AudioContext).createGain();
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(peak, t + at + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.4);
        osc.connect(g);
        g.connect(padBus as GainNode);
        osc.start(t + at);
        osc.stop(t + at + 1.6);
      }
    },
    isStarted() {
      return started;
    },
    resume() {
      if (!ensure() || !ctx) return;
      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => undefined);
      }
    },
    state() {
      return ctx ? String(ctx.state) : 'none';
    },
    dispose() {
      started = false;
      if (chordTimer) clearInterval(chordTimer);
      if (shimmerTimer) clearTimeout(shimmerTimer);
      chordTimer = null;
      shimmerTimer = null;
      layers = [];
      if (ctx) {
        void ctx.close().catch(() => undefined);
        ctx = null;
      }
      master = null;
      padBus = null;
    },
  };
}

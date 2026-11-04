/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  createSystem,
  InputComponent,
  SessionMode,
  UIKitMLAsset,
  VisibilityState,
} from '@iwsdk/core';
import {
  agentRequest, agentStatus, clearStageSetting, conceptModeRequest, DEFAULT_OBJECTIVE, diag, discoverRequest,
  endVoiceTurn, lastVoiceHitNav, lastVoiceSearch, markVoiceTurn, pushSpeech, scopeRequest, searchRequest, setSpeechStatus, speakFlushSignal, speakQueue,
  suggestionSignal, viewRequest, voiceToggleRequest, downloadBlob,
} from './evidence-ui.js';
import { scaleState } from './scale.js';
import {
  bufferRms, correctTranscript, describeIntent, encodeWav16k, forSpokenText, normalizeSpeechLevels, pickBestTranscript, pickSpeechChannel, routeTranscript,
  OUT_OF_SCOPE_MESSAGE, VOICE_HELP_LINES, type VoiceIntent,
} from './voice.js';
import { createAmbience, type Ambience } from './ambience.js';

export class PanelSystem extends createSystem({}) {
  /** Set in init(); update() polls it from the XR face buttons. */
  private voiceToggle: (() => void) | undefined;
  /** Set in init(); voice intents reuse the button handlers. */
  private toggleAmbience: (() => void) | undefined;
  private runInvTyped: (() => void) | undefined;
  private applySuggestionGroup: (() => void) | undefined;
  private lastSuggestionNonce = -1;
  private applyAgentStatus: (() => void) | undefined;
  private lastAgentStatusNonce = -1;
  private lastVoiceToggleNonce = 0;
  private lastSpeakFlushNonce = 0;
  // Generative ambient soundscape (polish, 2026-11-02): one
  // instance owned here; voice capture uses its own per-
  // utterance context and never touches this one.
  private ambience: Ambience | null = null;
  private ambienceWanted = true;
  // First user gesture anywhere unlocks WebAudio (Quest
  // autoplay policy) — ambience starts on it, exactly once.

  // Spoken replies (owner, 2026-11-01): ONE shared player, token
  // cancellation — lines can never overlap (docs/01 LL-003).
  ttsOn = true;
  private ttsBusy = false;
  private ttsAudio: HTMLAudioElement | undefined;
  private ttsUrl: string | undefined;
  private ttsToken = 0;
  private stopSpeaking: (() => void) | undefined;
  // Mic is open (either engine): drainTts must not START a
  // line, or desktop speakers feed the recognizer its own
  // reply (observed 2026-11-04: TTS began 0.4 s after listen
  // start and was transcribed as the user's next command).
  captureActive = false;

  stopTts(): void {
    this.stopSpeaking?.();
  }

  /** Start/stop the pad to match wanted state + first gesture. */
  private applyAmbience(): void {
    if (this.ambienceWanted) {
      if (!this.ambience) this.ambience = createAmbience();
      this.ambience.setMuted(false);
      this.ambience.start();
      this.ambience.resume();
    } else {
      this.ambience?.setMuted(true);
    }
    diag('ambience', {
      wanted: this.ambienceWanted,
      state: this.ambience?.state() ?? 'none',
      started: this.ambience?.isStarted() ?? false,
    });
  }

  private drainTts(): void {
    if (!this.ttsOn || this.ttsBusy || this.captureActive || speakQueue.length === 0) return;
    const text = speakQueue.shift() as string;
    this.ttsBusy = true;
    const token = ++this.ttsToken;
    this.stopSpeaking = () => {
      this.ttsToken += 1;
      try { this.ttsAudio?.pause(); } catch { /* already stopped */ }
      if (this.ttsUrl) URL.revokeObjectURL(this.ttsUrl);
      this.ttsUrl = undefined;
      this.ttsBusy = false;
    };
    void (async () => {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: forSpokenText(text) }),
        });
        if (token !== this.ttsToken) return;
        if (!res.ok) throw new Error(`tts ${res.status}`);
        const blob = await res.blob();
        if (token !== this.ttsToken) return;
        this.ttsUrl = URL.createObjectURL(blob);
        const audio = new Audio(this.ttsUrl);
        this.ttsAudio = audio;
        audio.onended = () => {
          if (this.ttsUrl) URL.revokeObjectURL(this.ttsUrl);
          this.ttsUrl = undefined;
          this.ttsBusy = false;
          this.drainTts();
        };
        audio.onerror = () => { this.ttsBusy = false; diag('tts-playback-error', {}); };
        await audio.play();
        diag('tts-play', { chars: text.length });
      } catch {
        this.ttsBusy = false;
        diag('tts-error', {});
      }
    })();
  }

  update(): void {
    // Flush BEFORE drain (owner headset, 2026-11-04: "hello"
    // routed as greeting but the spoken reply never played).
    // routeVoice ends the old turn (flush nonce++) and queues
    // THIS turn's ack in the same task; draining first started
    // the ack fetch, then the pending flush bumped ttsToken in
    // the same frame and the fetch result was silently dropped.
    // Flushing first still kills previous-turn speech (queue
    // was emptied by endVoiceTurn before the ack existed).
    if (speakFlushSignal.nonce !== this.lastSpeakFlushNonce) {
      this.lastSpeakFlushNonce = speakFlushSignal.nonce;
      this.stopTts();
    }
    this.drainTts();
    if (suggestionSignal.nonce !== this.lastSuggestionNonce) {
      this.lastSuggestionNonce = suggestionSignal.nonce;
      this.applySuggestionGroup?.();
    }
    if (agentStatus.nonce !== this.lastAgentStatusNonce) {
      this.lastAgentStatusNonce = agentStatus.nonce;
      this.applyAgentStatus?.();
    }
    if (voiceToggleRequest.nonce !== this.lastVoiceToggleNonce) {
      this.lastVoiceToggleNonce = voiceToggleRequest.nonce;
      diag('voice-keyboard-x', {});
      this.voiceToggle?.();
    }
    // Push-to-talk without aiming: X (LEFT controller) toggles
    // voice capture. A is jump (owner, 2026-11-01) — never bind
    // it here; trigger = select and squeeze = grab stay untouched.
    if (!this.voiceToggle) return;
    const pads = (this as unknown as {
      input?: {
        xr?: {
          gamepads?: Record<
            string,
            { getButtonDown?: (component: unknown) => boolean } | undefined
          >;
        };
      };
    }).input?.xr?.gamepads;
    if (!pads) return;
    try {
      if (pads.left?.getButtonDown?.(InputComponent.X_Button)) {
        diag('voice-xr-button', {});
        this.voiceToggle();
      }
    } catch { /* input profile without face buttons */ }
  }

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('welcome-panel');
    const xrButton = panel?.getElementById('xr-button');
    const mrButton = panel?.getElementById('mr-button');
    const expandButton = panel?.getElementById('expand-button');
    const compactButton = panel?.getElementById('compact-button');
    const exitButton = panel?.getElementById('exit-button');
    const modeToggle = panel?.getElementById('mode-toggle');
    if (xrButton == null || exitButton == null) {
      return;
    }
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      mrButton?.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }

    // Entry taps are real 2D user activations: unlock audio
    // HERE so the pad is already running when immersive starts
    // (in-XR select events may not grant WebAudio activation).
    const launchVR = () => { unlockAmbience(); this.world.launchXR(); };
    const launchMR = () => {
      unlockAmbience();
      this.world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
    };
    const exitXR = () => this.world.exitXR();
    const dispatch = (action: typeof searchRequest.action, term = '') => () => {
      searchRequest.action = action;
      searchRequest.term = term;
      searchRequest.nonce += 1;
    };
    // Collection suggestions: tokens resolved per ACTIVE corpus
    // in EvidenceUI (fixture: Atlas/March/Invoice/Priya;
    // trade-secret: source code/Falcon/USB/Reyes; galaxy:
    // Priya/Atlas/March/Invoice). Panel text announces the set.
    // Suggestion labels are PRE-RENDERED per set and display-
    // swapped (owner bug: new terms ran under old labels).
    // Groups: ts0/ts1 (Trade Secret sets), at0/at1 (Atlas sets);
    // EvidenceSystem owns which set is active (suggestionSignal).
    const suggestionGroups = ['ts0', 'ts1', 'at0', 'at1'] as const;
    for (const group of suggestionGroups) {
      for (let n = 1; n <= 4; n += 1) {
        const button = panel?.getElementById(`sg-${group}-${n}`);
        const run = dispatch('search', `suggest:${n}`);
        const handler = () => { unlockAmbience(); run(); };
        button?.addEventListener('click', handler);
        this.cleanupFuncs.push(() => button?.removeEventListener('click', handler));
      }
    }
    this.applySuggestionGroup = () => {
      const active = `${suggestionSignal.corpus === 'tradesecret' ? 'ts' : 'at'}${suggestionSignal.idx % 2}`;
      for (const group of suggestionGroups) {
        for (let n = 1; n <= 4; n += 1) {
          panel?.getElementById(`sg-${group}-${n}`)?.setProperties({
            display: group === active ? 'flex' : 'none',
          });
        }
      }
    };
    this.applySuggestionGroup();
    // "AI IS WORKING" strip (owner, 2026-11-02): without it an
    // Ask press gave no visible sign the run had started, so
    // the button got pressed repeatedly. Pinned above the tabs
    // (visible even when tools are collapsed); tapping stops.
    this.applyAgentStatus = () => {
      panel?.getElementById('ai-working')?.setProperties({
        display: agentStatus.busy ? 'flex' : 'none',
      });
    };
    this.applyAgentStatus();
    const wireAction = (id: string, handler: () => void) => {
      const button = panel?.getElementById(id);
      const wrapped = () => {
        // Tap mode is silent (owner, 2026-11-03): any button tap
        // ends the voice turn and flushes queued speech BEFORE
        // the handler runs. Voice-start and confirm-by-tap
        // re-mark the turn inside their handlers.
        endVoiceTurn();
        unlockAmbience();
        handler();
      };
      button?.addEventListener('click', wrapped);
      this.cleanupFuncs.push(() => button?.removeEventListener('click', wrapped));
    };
    // q-all (Clear Search) is wired below where the input lives, so
    // it can also empty the field itself.
    wireAction('q-next', dispatch('next'));
    wireAction('q-prev', dispatch('prev'));
    // Explore-tab Next/Previous Hit cut (owner, 2026-11-03):
    // hit stepping belongs to Search results, not Explore.
    // Search keeps q-next/q-prev; voice next/previous hit and
    // the Investigate Next/Previous Page strip are untouched.
    // Menu page strip (owner, 2026-11-02): Previous/Next Page
    // buttons pinned above the tab row page the source card.
    // The canvas PREV/NEXT planes under the card were cut (same
    // day, dead buttons) — the menu strip is the paging path.
    wireAction('q-page', dispatch('page'));
    wireAction('q-page-prev', dispatch('page-prev'));
    // Contextual tabs (M4 menu-accessibility fix): exactly one group
    // is visible, keeping every control inside the reachable panel
    // area in VR as well as MR.
    // Review tab removed (owner, 2026-11-02): the approve
    // workflow lives in Export — tabs are now Explore /
    // Investigate / Search / Export only.
    type TabName = 'discover' | 'investigate' | 'universe' | 'export';
    let activeTab: TabName = 'universe';
    // Startup is compressed (owner, 2026-11-01): voice, entry, and
    // the bottom "show more tools" control stay available while
    // the tabbed tool groups stay out of the evidence view.
    let collapsed = true;
    let is2D = true;
    const applyUniverseVisibility = () => {
      const show = !is2D && activeTab === 'universe' ? 'flex' : 'none';
      expandButton?.setProperties({ display: show });
      compactButton?.setProperties({ display: show });
      // Exit is persistent across tabs in immersive mode (headset
      // report: exit hidden under Universe was undiscoverable).
      exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
      modeToggle?.setProperties({ display: is2D ? 'none' : 'flex' });
      panel?.getElementById('mode-note')?.setProperties({ display: is2D ? 'none' : 'flex' });
    };
    const applyCollapsed = () => {
      panel?.getElementById('tools-expand')?.setProperties({
        display: collapsed ? 'flex' : 'none',
      });
      panel?.getElementById('tools-collapse')?.setProperties({
        display: collapsed ? 'none' : 'flex',
      });
      panel?.getElementById('tab-row')?.setProperties({
        display: collapsed ? 'none' : 'flex',
      });
      // Page strip pins Previous/Next Page above the tab row
      // and stays visible even when the menu is hidden /
      // compressed (owner, 2026-11-02) — paging the source card
      // must never require expanding the tools first.
      panel?.getElementById('page-strip')?.setProperties({
        display: 'flex',
      });
      for (const name of ['discover', 'investigate', 'universe', 'export'] as TabName[]) {
        panel?.getElementById(`g-${name}`)?.setProperties({
          display: !collapsed && name === activeTab ? 'flex' : 'none',
        });
      }
      applyUniverseVisibility();
    };
    const setTab = (tab: TabName) => () => {
      activeTab = tab;
      applyCollapsed();
    };
    wireAction('tools-expand', () => {
      collapsed = false;
      applyCollapsed();
    });
    wireAction('tools-collapse', () => {
      collapsed = true;
      applyCollapsed();
    });
    applyCollapsed();
    wireAction('tab-discover', setTab('discover'));
    wireAction('tab-investigate', setTab('investigate'));
    // Review tab removed (owner, 2026-11-02): approval lives in
    // Export. Entering Export always renders the approval queue
    // first — grouped decisions, never a hidden list.
    wireAction('tab-universe', setTab('universe'));
    wireAction('tab-export', () => { setTab('export')(); agentRequest.action = 'show-queue'; agentRequest.nonce += 1; });
    // Revised-M3 view controls: corpus + lens (data/view swaps only;
    // investigation state, findings, and decisions persist).
    const dispatchView = (patch: Partial<typeof viewRequest>) => () => {
      Object.assign(viewRequest, patch);
      viewRequest.nonce += 1;
    };
    wireAction('corpus-expanded', dispatchView({ corpus: 'expanded' }));
    // Galaxy 1000 button retired (owner, 2026-11-01) — wiring
    // removed with the button. Voice galaxy requests are
    // declined with guidance (corpus case below), not switched.
    // Trade Secret is the only corpus in the UI now (owner,
    // 2026-11-01) — its button is gone too; startup loads it.
    wireAction('corpus-galaxy500', dispatchView({ corpus: 'galaxy', galaxyCount: 500 }));
    wireAction('lens-evidence', dispatchView({ lens: 'evidence' }));
    wireAction('lens-network', dispatchView({ lens: 'network' }));
    wireAction('lens-chronology', dispatchView({ lens: 'chronology' }));
    // Concepts = computed clusters only (owner, 2026-11-01:
    // authored-tags lens removed). One button, one voice path.
    const setConceptMode = (mode: 'authored' | 'computed') => () => {
      conceptModeRequest.mode = mode;
      conceptModeRequest.nonce += 1;
      dispatchView({ lens: 'concepts' })();
    };
    wireAction('lens-concepts-mode-computed', setConceptMode('computed'));
  wireAction('lens-custodians', dispatchView({ lens: 'custodians' }));
  wireAction('lens-filetypes', dispatchView({ lens: 'filetypes' }));
    // M4 Phase A Discover transport: deterministic leads + explore/ask.
    const dispatchDiscover = (action: typeof discoverRequest.action, index = 0) => () => {
      discoverRequest.action = action;
      discoverRequest.index = index;
      discoverRequest.nonce += 1;
    };
    wireAction('discover-leads', dispatchDiscover('leads'));
    wireAction('lead-1', dispatchDiscover('explore', 0));
    wireAction('lead-2', dispatchDiscover('explore', 1));
    wireAction('lead-3', dispatchDiscover('explore', 2));
    wireAction('lead-ask', dispatchDiscover('ask'));
    // Free-text search. The Horizon `Input` in UIKitML is a Container
    // WRAPPER; the actual pmndrs Input (hidden DOM element +
    // currentSignal) is its `.input` child. Reading `.element` /
    // `.currentSignal` on the wrapper returned undefined, so every
    // free-text query arrived as '' (owner-found defect, 2026-10-27).
    // Read the inner input, and also track keystrokes directly so the
    // executed term is correct even if signal sync lags a frame.
    const searchInput = panel?.getElementById('search-input') as
      | {
          input?: {
            element?: HTMLInputElement;
            currentSignal?: { value?: string };
          };
        }
      | null
      | undefined;
    let typedTerm = '';
    const innerElement = searchInput?.input?.element;
    const trackTyped = () => {
      typedTerm = innerElement?.value ?? typedTerm;
    };
    innerElement?.addEventListener('input', trackTyped);
    // Reopening the keyboard means a NEW term (owner, 2026-11-02):
    // the old term could not be backspaced away on Quest and
    // select-on-focus did not survive the system keyboard, so
    // the field now empties on focus. The executed term is safe
    // in the search session/report — the field is only an input.
    const clearSearchField = () => {
      typedTerm = '';
      if (innerElement) innerElement.value = '';
      const signal = searchInput?.input?.currentSignal;
      // P0 (2026-10-30, telemetry-proven): in the current UIKit on
      // OculusBrowser, currentSignal.value is GETTER-ONLY. This
      // assignment threw `TypeError: Cannot set property value`
      // inside the Clear click handler — before dispatch('clear')
      // ever ran — on three logged Quest attempts, after which
      // that tab's frame heartbeats stopped (immersive freeze).
      // The input element above is already cleared; the signal
      // write is best-effort sync only and must never throw.
      if (signal) {
        try {
          signal.value = '';
        } catch { /* getter-only signal: element clear suffices */ }
      }
    };
    const clearFieldOnFocus = () => clearSearchField();
    innerElement?.addEventListener('focus', clearFieldOnFocus);
    this.cleanupFuncs.push(() => innerElement?.removeEventListener('focus', clearFieldOnFocus));
    wireAction('q-all', () => {
      // Forensic breadcrumb BEFORE touching the input field/signal:
      // if a future Quest death shows clear:panel-click without a
      // following clear:begin (evidence-ui), the field reset or
      // dispatch is implicated; if clear:begin appears, it is not.
      try {
        const prev = sessionStorage.getItem('mmdata-breadcrumbs') ?? '';
        const entries = prev ? prev.split(' > ') : [];
        entries.push(`${new Date().toISOString().slice(11, 19)} clear:panel-click`);
        sessionStorage.setItem('mmdata-breadcrumbs', entries.slice(-10).join(' > '));
      } catch { /* diagnostics only */ }
      diag('clear:panel-click', { clearStage: clearStageSetting() });
      // Stage 0 isolates the input-field/signal write itself: the
      // field is only cleared at stage >= 1.
      if (clearStageSetting() >= 1) {
        clearSearchField();
        diag('clear:field-cleared');
      }
      dispatch('clear')();
      diag('clear:dispatched');
    });
    this.cleanupFuncs.push(() => innerElement?.removeEventListener('input', trackTyped));
    const runFreeText = () => {
      // First non-blank source wins; an intentionally emptied field
      // leaves all three blank and correctly executes no search.
      const term = (
        [
          innerElement?.value,
          searchInput?.input?.currentSignal?.value,
          typedTerm,
        ].find((value) => value?.trim()) ?? ''
      ).trim();
      dispatch('search', term)();
    };
    wireAction('q-run', runFreeText);
    // M4 agent controls (B: preset objective; C: typed objective).
    const dispatchAgent = (action: typeof agentRequest.action, objective = '') => () => {
      agentRequest.action = action;
      agentRequest.objective = objective;
      agentRequest.nonce += 1;
    };
    wireAction('ai-run', dispatchAgent('run', DEFAULT_OBJECTIVE));
    wireAction('ai-stop', dispatchAgent('stop'));
    wireAction('ai-working', dispatchAgent('stop'));
    wireAction('mark-doc-explore', dispatch('mark-doc', 'Explore'));
    wireAction('mark-doc-investigate', dispatch('mark-doc', 'Investigate'));
    wireAction('mark-doc-search', dispatch('mark-doc', 'Search'));
    wireAction('exp-findings', dispatchAgent('export'));
    wireAction('exp-selected', dispatchAgent('export-selected'));
    wireAction('exp-search-report', dispatchAgent('export-search-report'));
    wireAction('exp-docids', dispatchAgent('export-docids-xlsx'));
    wireAction('exp-zip', dispatchAgent('export-zip'));
    wireAction('q-submit-report', dispatch('submit-report'));
    wireAction('q-suggest-more', dispatch('suggest-more'));
    wireAction('q-export-ids', dispatch('export-ids'));
    wireAction('findings-prev', dispatchAgent('finding-prev'));
    wireAction('findings-next', dispatchAgent('finding-next'));
    wireAction('ai-approve', dispatchAgent('approve'));
    wireAction('ai-reject', dispatchAgent('reject'));
    wireAction('ai-approve-all', dispatchAgent('approve-all'));
    // Voice input (ms4 rebuild, 2026-11-01). ONE path on every
    // browser: WebAudio mic -> 16 kHz mono WAV -> POST /api/stt
    // (Wit.ai server-side). Rationale, all live-proven 2026-11-01:
    // the old client read `data.text` while the server returns
    // `transcript`, so no transcript ever landed; and Quest
    // MediaRecorder containers (WebM/Ogg-Opus) are rejected by
    // Wit (Round 4 HTTP 400) while WAV transcribes in ~1.5 s.
    // Recording auto-stops after a short pause (no second tap),
    // commands/searches run at once, free questions are staged
    // for CONFIRM (voice or the "Ask What I Said" tap), and
    // approve/reject/export stay tap-only (src/voice.ts).
    let voicePending = '';
    let voiceListening = false;
    let stopCapture: (() => void) | undefined;
    // Desktop Web Speech is tried first in 2D; once it hard-fails
    // (not-allowed/network) the session falls back to Wit WAV.
    let preferWitStt = false;
    // Voice status + instructions live in the SPEECH LOG window
    // (owner, 2026-11-01) — never on the source inspection
    // card, so the user watches one place while speaking. The
    // evidence-ui 'voice-status' draw path is reserved for
    // out-of-scope scope guidance (same owner session).
    const IDLE_STATUS = 'Tap Voice (or press X) and speak';
    let voiceHintShown = false;
    const fillField = (id: string, value: string) => {
      // Mirror the transcript into the matching text field so the
      // 2D view and the tap path show the same words (best-effort).
      try {
        const el = (panel?.getElementById(id) as
          | { input?: { element?: HTMLInputElement } }
          | null
          | undefined)?.input?.element;
        if (el) {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch { /* mirror only; voice flow never depends on it */ }
    };
    // One bubble per help line (owner, 2026-11-01): a single
    // giant block overflows the speech-log window and reads as
    // a blank/broken log. First line speaks; the rest is read.
    // The same lines also paint the source card (owner session
    // 2026-11-01: the card sat "stuck" on the old keyword hit
    // while help lived only in the log) via the voice-status
    // draw path — a reference card, not a status indicator.
    const sendVoiceHelp = () => {
      pushSpeech('user', '(tapped "Voice Help")');
      pushSpeech('assistant', 'Here is everything voice can do:');
      for (const line of VOICE_HELP_LINES) pushSpeech('assistant', line, { silent: true });
      dispatchAgent('voice-status',
        ['Voice commands — everything voice can do', ...VOICE_HELP_LINES].join('\n'))();
    };
    const confirmPending = () => {
      if (!voicePending) {
        pushSpeech('assistant', 'Nothing is waiting to confirm yet — ask a question first, e.g. "Ask who emailed Reyes about Falcon", or say "help".');
        setSpeechStatus(IDLE_STATUS);
        return;
      }
      const q = voicePending;
      voicePending = '';
      markVoiceTurn(300000);
      pushSpeech('assistant', `Confirmed — asking the AI now: "${q}". Watch the source card for the plan and draft findings.`);
      setTab('discover')();
      setSpeechStatus('AI is working — watch the source card; say STOP anytime');
      dispatchAgent('run', q)();
    };
    const executeIntent = (intent: VoiceIntent, heard: string, fromVoice = true) => {
      switch (intent.kind) {
        case 'presence':
          return;
        case 'greeting':
          // First contact (owner, 2026-11-04): greet back (the
          // describeIntent ack speaks it) and put Voice Help on
          // the card + log so a new user immediately sees what
          // they can say. No fake "(tapped)" user bubble — the
          // real heard greeting is already in the log.
          for (const line of VOICE_HELP_LINES) pushSpeech('assistant', line, { silent: true });
          dispatchAgent('voice-status',
            ['Voice commands — everything voice can do', ...VOICE_HELP_LINES].join('\n'))();
          setSpeechStatus('Say "Find leads" to begin — or anything from Voice Help');
          return;
        case 'empty':
          pushSpeech('assistant', 'I didn\'t catch that — no words made it through. Press X, speak a little closer to the headset mic, then pause.');
          setSpeechStatus('Heard nothing — press X and try again');
          return;
        case 'help':
          sendVoiceHelp();
          return;
        case 'cancel':
          voicePending = '';
          return;
        case 'confirm':
          confirmPending();
          return;
        case 'stop':
          dispatchAgent('stop')();
          return;
        case 'tab': {
          // Review tab removed (owner, 2026-11-02) — approve and
          // review synonyms land on Export, which owns the queue.
          const map: Record<string, TabName> = {
            explore: 'universe', investigate: 'discover', search: 'investigate',
            approve: 'export', review: 'export', export: 'export',
          };
          setTab(map[intent.tab])();
          if (intent.tab === 'approve' || intent.tab === 'export') {
            agentRequest.action = 'show-queue';
            agentRequest.nonce += 1;
          }
          return;
        }
        // Seamless voice (owner, 2026-11-01): changing how the
        // universe is organized must work from ANY module and
        // must not yank the button context — search hits stay
        // highlighted across lens changes (applyLens preserves
        // `searched`; its announce draw is suppressed mid-search).
        case 'lens':
          dispatchView({ lens: intent.lens })();
          return;
        case 'corpus':
          // Galaxy 1000 retired in this version (owner,
          // 2026-11-01): decline with guidance, never switch.
          if (intent.corpus === 'galaxy' && (intent.galaxyCount ?? 1000) >= 1000) {
            pushSpeech('assistant', 'Galaxy 1000 is retired in this version — its testing life is complete. Trade Secret 3000 stays loaded. Say "galaxy 500" only if the owner re-enables the fallback.');
            setSpeechStatus(IDLE_STATUS);
            diag('corpus-galaxy-declined', {});
            return;
          }
          dispatchView(intent.galaxyCount
            ? { corpus: 'galaxy', galaxyCount: intent.galaxyCount }
            : { corpus: intent.corpus })();
          return;
        case 'submit-report':
          dispatch('submit-report')();
          return;
        case 'hit':
          if (fromVoice) lastVoiceHitNav.at = performance.now();
          dispatch('goto-hit', String(intent.index))();
          return;
        case 'soundscape':
          this.toggleAmbience?.();
          return;
        case 'run-typed':
          if (intent.source === 'search') {
            setTab('investigate')();
            runFreeText();
          } else {
            setTab('discover')();
            if (this.runInvTyped) this.runInvTyped();
            else pushSpeech('assistant', 'There is nothing typed yet — type in the Investigate box, or just ask me by voice.');
          }
          return;
        case 'run-investigation':
          setTab('discover')();
          dispatchAgent('run', DEFAULT_OBJECTIVE)();
          return;
        case 'sound':
          this.ttsOn = intent.on;
          try { localStorage.setItem('mmdata-tts', intent.on ? '1' : '0'); } catch { /* storage unavailable */ }
          if (!intent.on) {
            speakQueue.length = 0;
            this.stopTts();
            pushSpeech('assistant', 'Spoken replies OFF. I\'ll keep writing here — say "voice on" to hear me again.');
            speakQueue.length = 0;
          } else {
            pushSpeech('assistant', 'Spoken replies ON. You can hear me now.');
          }
          return;
        case 'leads':
          setTab('discover')();
          dispatchDiscover('leads')();
          return;
        case 'lead':
          setTab('discover')();
          dispatchDiscover('explore', intent.index)();
          return;
        case 'draft':
          setTab('discover')();
          dispatchDiscover('ask')();
          return;
        case 'nav':
          if (fromVoice && (intent.action === 'next' || intent.action === 'prev')) {
            lastVoiceHitNav.at = performance.now();
          }
          dispatch(intent.action)();
          return;
        case 'finding-nav':
          setTab('export')();
          dispatchAgent(intent.action)();
          return;
        case 'panel':
          collapsed = !intent.visible;
          applyCollapsed();
          return;
        case 'scale':
          scaleState.expanded = intent.expanded;
          scaleState.animating = true;
          return;
        case 'search':
          lastVoiceSearch.term = intent.term;
          lastVoiceSearch.at = performance.now();
          setTab('investigate')();
          fillField('search-input', intent.term);
          dispatch('search', intent.term)();
          return;
        case 'ask':
          setTab('discover')();
          fillField('ai-input', intent.question);
          dispatchAgent('run', intent.question)();
          return;
        case 'tap-only':
          void heard;
          return;
        case 'scope':
          scopeRequest.scope = intent.scope;
          scopeRequest.nonce += 1;
          return;
        case 'concept-mode':
          // Authored-tags lens removed (owner): every Concepts
          // request lands on computed clusters.
          conceptModeRequest.mode = 'computed';
          conceptModeRequest.nonce += 1;
          dispatchView({ lens: 'concepts' })();
          return;
        case 'out-of-scope':
          // Source card mirrors the same scope guidance the
          // speech log gets (owner, 2026-11-01): a joke or other
          // out-of-scope ask must never leave stale "not a hit"
          // search text up on the card.
          dispatchAgent('voice-status', OUT_OF_SCOPE_MESSAGE)();
          return;
        case 'stage':
          voicePending = intent.question;
          fillField('ai-input', intent.question);
          fillField('inv-ai-input', intent.question);
          // Audible "please confirm" cue (owner, 2026-11-02).
          this.ambience?.tone('confirm');
          return;
      }
    };
    const routeVoice = (raw: string) => {
      // Barge-in (owner, 2026-11-03): a new spoken command
      // discards speech queued for the previous view, then
      // opens its own voice turn.
      endVoiceTurn();
      // A spoken turn: replies may be spoken back (owner,
      // 2026-11-02). AI-bound turns get the long window so the
      // completion reply still speaks after a slow run.
      markVoiceTurn(120000);
      const intent = routeTranscript(raw, voicePending.length > 0);
      // A concrete command supersedes a staged question
      // (owner desktop, 2026-11-04): leaving it pending kept
      // the session in dictation mode, degrading every later
      // command. Heard-nothing keeps it; stage replaces it.
      if (intent.kind !== 'stage' && intent.kind !== 'confirm'
        && intent.kind !== 'cancel' && intent.kind !== 'empty') {
        voicePending = '';
      }
      if (intent.kind === 'ask' || intent.kind === 'confirm'
        || intent.kind === 'leads' || intent.kind === 'draft') {
        markVoiceTurn(300000);
      }
      diag('voice-transcript', {
        len: raw.trim().length,
        intent: intent.kind,
        heard: correctTranscript(raw).slice(0, 80),
      });
      // Speech log: the user must ALWAYS see what they asked and
      // what happened — immediate or staged (owner, 2026-11-01).
      pushSpeech('user', correctTranscript(raw));
      executeIntent(intent, correctTranscript(raw));
      const ack = describeIntent(intent);
      // Multi-line acks (out-of-scope guidance) become one
      // bubble per line so each fits the log window; only the
      // first line speaks (owner, 2026-11-01).
      if (ack) {
        // Hit stepping speaks ONE line (the hit title from
        // EvidenceSystem); the generic "moved to" ack stays
        // written-only so her voice never reads twice per hit.
        const hitStep = intent.kind === 'hit'
          || (intent.kind === 'nav' && (intent.action === 'next' || intent.action === 'prev'));
        const lines = ack.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
        lines.forEach((line, i) => pushSpeech('assistant', line,
          i === 0 && !hitStep ? {} : { silent: true }));
      }
      // Can't-do guidance is READ ALOUD (owner, 2026-11-02:
      // "she just said no" — the voice-help / Show Tools line
      // is spoken whenever a command can't complete).
      if (intent.kind === 'out-of-scope' || intent.kind === 'explore-unknown') {
        pushSpeech('assistant',
          'That is out of scope for what voice can do. Please press or say: voice help or show tools for more options.');
      }
      if (intent.kind === 'out-of-scope') {
        setSpeechStatus('Outside scope — see the Speech Log');
      } else if (intent.kind === 'stage') {
        setSpeechStatus('Waiting — say CONFIRM or tap "Ask What I Said"');
      } else if (intent.kind === 'ask') {
        setSpeechStatus('AI is working — watch the source card; say STOP anytime');
      } else if (intent.kind !== 'confirm' && intent.kind !== 'empty') {
        setSpeechStatus(IDLE_STATUS);
      }
    };
    const sendForTranscription = async (samples: Float32Array, sampleRate: number) => {
      setSpeechStatus('Transcribing — turning your speech into text…');
      const started = performance.now();
      try {
        const leveled = normalizeSpeechLevels(samples);
        diag('voice-level', {
          gain: Math.round(leveled.gain * 100) / 100,
          peak: Math.round(leveled.peak * 1000),
          rms: Math.round(leveled.rms * 1000),
        });
        const wav = encodeWav16k(leveled.samples, sampleRate);
        const wavBlob = new Blob([wav], { type: 'audio/wav' });
        const res = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: wavBlob,
        });
        const data = (await res.json().catch(() => ({}))) as {
          text?: string; transcript?: string; error?: string;
        };
        const text = (data.text ?? data.transcript ?? '').trim();
        diag('voice-stt', { ok: res.ok, ms: Math.round(performance.now() - started), chars: text.length });
        // Unintelligible-audio diagnostic (owner desktop,
        // 2026-11-03: loud capture, 0-6 transcript chars): hand
        // back EXACTLY what the transcriber received so the owner
        // can hear whether the browser's mic processing garbled
        // it. Desktop only — Quest captures are proven.
        if (text.length <= 8 && !this.world.session) {
          downloadBlob('voice-diagnostic.wav', wavBlob);
          diag('voice-diagnostic-saved', { bytes: wavBlob.size });
          pushSpeech('assistant', 'I could not make out words in that audio, so I saved voice-diagnostic.wav to your browser Downloads. Play it back: if your voice is clear there, the transcriber is at fault; if it is garbled or missing, the browser mic processing is mangling it before it reaches me.');
        }
        if (res.ok && text) routeVoice(text);
        else if (res.ok) executeIntent({ kind: 'empty' }, '');
        else {
          pushSpeech('assistant', `Transcription unavailable (${data.error || `HTTP ${res.status}`}). Every control still works by tap — tell the operator the speech service needs attention.`);
          setSpeechStatus('Transcription unavailable — see log above');
        }
      } catch {
        diag('voice-stt', { ok: false, ms: Math.round(performance.now() - started), chars: 0 });
        pushSpeech('assistant', 'Transcription failed — I could not reach this app\'s server. Check the headset is on the same Wi-Fi as the PC, then press X and try again.');
        setSpeechStatus('Transcription failed — see log above');
      }
    };
    try { this.ttsOn = localStorage.getItem('mmdata-tts') !== '0'; } catch { /* default on */ }
    // Desktop 2D primary engine (owner, 2026-11-03): Chrome/Edge
    // built-in recognition handles a room microphone far better
    // than Wit (loud, clearly-playable captures still returned
    // 0-6 chars). Quest keeps the proven Wit WAV pipeline; any
    // hard Web Speech failure falls back to it for the session.
    const startWebSpeech = (): boolean => {
      const Ctor = (window as unknown as {
        SpeechRecognition?: new () => unknown;
        webkitSpeechRecognition?: new () => unknown;
      }).SpeechRecognition ?? (window as unknown as {
        webkitSpeechRecognition?: new () => unknown;
      }).webkitSpeechRecognition;
      if (!Ctor) return false;
      try {
        const rec = new Ctor() as {
          lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
          start: () => void; stop: () => void;
          onresult: ((e: { resultIndex?: number; results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
          onerror: ((e: { error?: string }) => void) | null;
          onend: (() => void) | null;
        };
        rec.lang = 'en-US';
        // Continuous + interim with OUR silence endpoint
        // (owner, 2026-11-03): single-shot mode finalized at
        // the natural pause between "find" and "leads", so the
        // transcript was one word. Accumulate final segments
        // until 1.6 s of no new results (6 s if nothing heard).
        rec.interimResults = true;
        rec.maxAlternatives = 3;
        rec.continuous = true;
        let settled = false;
        let finalText = '';
        let interimText = '';
        let lastHeardText = '';
        let silenceTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          voiceListening = false;
          this.captureActive = false;
          stopCapture = undefined;
          try { rec.stop(); } catch { /* already ended */ }
          // Continuous Chrome recognition may hold everything as
          // INTERIM until stop() — routing only finals returned
          // empty transcripts for clearly-heard commands (owner,
          // 2026-11-03). The best interim is the fallback text.
          const text = (finalText.trim() || interimText.trim());
          diag('voice-webspeech-result', {
            chars: text.length,
            via: finalText.trim() ? 'final' : 'interim',
          });
          if (text) routeVoice(text);
          else executeIntent({ kind: 'empty' }, '');
        };
        const armSilence = (ms: number) => {
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(finish, ms);
        };
        voiceListening = true;
        this.captureActive = true;
        stopCapture = finish;
        this.ambience?.tone('listening');
        setSpeechStatus(voicePending
          ? 'LISTENING — say CONFIRM, CANCEL, or dictate a replacement'
          : 'LISTENING — speak now, then pause');
        diag('voice-webspeech-start', {});
        armSilence(6000);
        rec.onresult = (event) => {
          const results = event.results as unknown as ArrayLike<{
            isFinal?: boolean;
            length: number;
            [i: number]: { transcript?: string } | undefined;
          }>;
          let heardAnything = false;
          for (let r = event.resultIndex ?? 0; r < results.length; r += 1) {
            const segment = results[r];
            if (!segment) continue;
            heardAnything = true;
            const alts: string[] = [];
            for (let a = 0; a < segment.length; a += 1) {
              const t = segment[a]?.transcript ?? '';
              if (t.trim()) alts.push(t);
            }
            const text = pickBestTranscript(alts, voicePending.length > 0);
            if (segment.isFinal) {
              if (text) finalText = `${finalText} ${text}`.trim();
              interimText = '';
            } else if (text) {
              interimText = text;
            }
          }
          // Endpoint on INTERIM quiet too (owner desktop,
          // 2026-11-04): continuous Chrome holds results
          // interim until stop(), so arming 6 s whenever no
          // FINAL existed made every command wait ~6 s after
          // the user finished speaking. Re-arm only when the
          // heard text actually changes.
          const heardText = `${finalText} ${interimText}`.trim();
          if (heardAnything && heardText !== lastHeardText) {
            lastHeardText = heardText;
            armSilence((finalText || interimText) ? 1600 : 6000);
          }
        };
        rec.onerror = (event) => {
          if (settled) return;
          const error = String(event.error ?? 'unknown');
          diag('voice-webspeech-error', { error: error.slice(0, 60) });
          if (finalText.trim()) { finish(); return; }
          settled = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          voiceListening = false;
          this.captureActive = false;
          stopCapture = undefined;
          if (error === 'no-speech' || error === 'aborted') {
            executeIntent({ kind: 'empty' }, '');
            return;
          }
          preferWitStt = true;
          pushSpeech('assistant', `Browser speech recognition is unavailable here (${error}). Tap Voice again and I will use the server transcriber instead.`);
          setSpeechStatus(IDLE_STATUS);
        };
        rec.onend = () => {
          if (!settled) finish();
        };
        rec.start();
        return true;
      } catch {
        voiceListening = false;
        this.captureActive = false;
        stopCapture = undefined;
        return false;
      }
    };
    const startVoice = async () => {
      markVoiceTurn(120000);
      unlockAmbience();
      this.stopTts();
      // Drop queued-but-unspoken lines too: stopTts pauses
      // only the current line, and the next queued line used
      // to start playing INTO the open mic (2026-11-04).
      speakQueue.length = 0;
      if (voiceListening) { stopCapture?.(); return; }
      if (!this.world.session && !preferWitStt && startWebSpeech()) return;
      let stream: MediaStream;
      try {
        const processed = Boolean(this.world.session);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // Quest keeps the proven processed pipeline. Desktop
            // 2D requests RAW audio: Chrome's EC/NS chain forces
            // a mono downmix of mic-array channels, which can
            // phase-cancel speech before we ever see it (owner,
            // 2026-11-03). Raw stereo lets capture pick the
            // stronger single channel below.
            echoCancellation: processed, noiseSuppression: processed, autoGainControl: processed,
            channelCount: { ideal: 2 },
          },
        });
      } catch {
        pushSpeech('assistant', 'Microphone unavailable — permission was denied or no mic was found. In Quest Browser site settings for this page, Allow the microphone, then press X again.');
        setSpeechStatus('Microphone unavailable — see log above');
        diag('voice-mic-denied', {});
        return;
      }
      // Which physical/virtual input did the browser hand us?
      // A silent capture with a live stream (desktop 2D, owner
      // 2026-11-03: peak RMS 0.001-0.005 vs 0.10+ on Quest) is
      // a wrong-device problem, and the label names it.
      const micTrack = stream.getAudioTracks()[0];
      diag('voice-mic-track', {
        label: (micTrack?.label ?? 'none').slice(0, 80),
        muted: micTrack?.muted ?? true,
        enabled: micTrack?.enabled ?? false,
        state: micTrack?.readyState ?? 'none',
        processed: Boolean(this.world.session),
      });
      if (micTrack?.muted) {
        // A fresh track can report muted until its first frames
        // land; only a PERSISTENT mute is the system-level fault.
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (micTrack?.muted) {
        stream.getTracks().forEach((tr) => tr.stop());
        pushSpeech('assistant', `Your microphone (${micTrack.label || 'input'}) is muted by the system, so I only hear silence. On this PC: Windows Settings > System > Sound > Input — unmute it and check the test bar moves (also check any keyboard mic-mute key). Then try Voice again.`);
        setSpeechStatus('Microphone is MUTED by Windows — see log above');
        return;
      }
      const AudioCtor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) {
        stream.getTracks().forEach((tr) => tr.stop());
        pushSpeech('assistant', 'Voice is not supported in this browser (no WebAudio capture). Use Quest Browser, or tap the on-screen controls.');
        setSpeechStatus('Voice not supported in this browser');
        return;
      }
      const ctx = new AudioCtor();
      try { await ctx.resume(); } catch { /* tap already unlocked audio */ }
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessorNode is deprecated but is the capture API
      // that works identically in Quest Browser without a worklet
      // asset; buffers are small (<=18 s) and copied immediately.
      const processor = ctx.createScriptProcessor(4096, 2, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      const channelChunks: Float32Array[][] = [[], []];
      let captureChannels = 1;
      let total = 0;
      let loudStreak = 0;
      let hasSpoken = false;
      let lastLoudEnd = 0; // sample index at end of last loud buffer
      let peakRms = 0;
      let stopped = false;
      const startedAt = performance.now();
      const SPEECH_RMS = 0.02;
      const SILENCE_MS = 1400;
      const MAX_MS = 18000;
      const NO_SPEECH_MS = 6000;
      const stop = (reason: 'silence' | 'tap' | 'max' | 'no-speech') => {
        if (stopped) return;
        stopped = true;
        voiceListening = false;
        this.captureActive = false;
        stopCapture = undefined;
        try { processor.disconnect(); source.disconnect(); mute.disconnect(); } catch { /* already closed */ }
        stream.getTracks().forEach((tr) => tr.stop());
        void ctx.close().catch(() => undefined);
        diag('voice-capture', {
          reason, ms: Math.round(performance.now() - startedAt),
          peak: Math.round(peakRms * 1000), rate: ctx.sampleRate,
        });
        if (!hasSpoken) {
          executeIntent({ kind: 'empty' }, '');
          return;
        }
        const channelRms = channelChunks.slice(0, captureChannels).map((list) => {
          let sum = 0;
          let count = 0;
          for (const chunk of list) {
            for (let i = 0; i < chunk.length; i += 1) sum += chunk[i] * chunk[i];
            count += chunk.length;
          }
          return count ? Math.sqrt(sum / count) : 0;
        });
        const chosen = pickSpeechChannel(channelRms);
        diag('voice-channel', {
          channels: captureChannels,
          chosen,
          rms: channelRms.map((r) => Math.round(r * 1000)).join('/'),
        });
        const keep = Math.min(total, lastLoudEnd + Math.round(ctx.sampleRate * 0.35));
        const merged = new Float32Array(keep);
        let offset = 0;
        for (const chunk of channelChunks[chosen]) {
          if (offset >= keep) break;
          const slice = chunk.subarray(0, Math.min(chunk.length, keep - offset));
          merged.set(slice, offset);
          offset += slice.length;
        }
        void sendForTranscription(merged, ctx.sampleRate);
      };
      processor.onaudioprocess = (event) => {
        captureChannels = Math.min(2, Math.max(1, event.inputBuffer.numberOfChannels));
        let rms = 0;
        for (let c = 0; c < captureChannels; c += 1) {
          const copy = new Float32Array(event.inputBuffer.getChannelData(c));
          channelChunks[c].push(copy);
          rms = Math.max(rms, bufferRms(copy));
          if (c === 0) total += copy.length;
        }
        if (rms > peakRms) peakRms = rms;
        if (rms >= SPEECH_RMS) {
          loudStreak += 1;
          if (loudStreak >= 2) { hasSpoken = true; lastLoudEnd = total; }
        } else {
          loudStreak = 0;
        }
        const elapsed = performance.now() - startedAt;
        const silenceFor = (total - lastLoudEnd) / ctx.sampleRate * 1000;
        if (elapsed > MAX_MS) stop('max');
        else if (hasSpoken && silenceFor > SILENCE_MS) stop('silence');
        else if (!hasSpoken && elapsed > NO_SPEECH_MS) stop('no-speech');
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      voiceListening = true;
      this.captureActive = true;
      stopCapture = () => stop('tap');
      this.ambience?.tone('listening');
      setSpeechStatus(
        voicePending
          ? 'LISTENING — say CONFIRM, CANCEL, or dictate a replacement'
          : 'LISTENING — speak now, then pause',
      );
      if (!voiceHintShown) {
        voiceHintShown = true;
        pushSpeech('system', 'Try: "Ask who emailed Reyes about Falcon" • "Search for source code" • "Show concept clusters" • "Find leads" • "help". Recording stops by itself when you pause.');
      }
      diag('voice-start', { engine: 'webaudio-wav', rate: ctx.sampleRate });
    };
    this.voiceToggle = () => { void startVoice(); };
    // Entry-button tap beacons (owner session 2026-11-01):
    // diag proves the tap reached code — without this, a dead
    // button and a broken log render are indistinguishable.
    wireAction('voice-button', () => { diag('voice-button-tap', {}); void startVoice(); });
    wireAction('voice-confirm', () => {
      diag('voice-confirm-tap', {});
      pushSpeech('user', '(tapped "Ask What I Said")');
      confirmPending();
    });
    wireAction('voice-help', () => {
      diag('voice-help-tap', {});
      sendVoiceHelp();
    });
    // Ambient soundscape: first user gesture unlocks WebAudio
    // (Quest autoplay policy), so the toggle both starts the pad
    // and flips the label state. Persisted across sessions.
    try {
      this.ambienceWanted = localStorage.getItem('mmdata-ambience') !== '0';
    } catch { /* default on */ }
    const toggleAmbience = () => {
      this.ambienceWanted = !this.ambienceWanted;
      try { localStorage.setItem('mmdata-ambience', this.ambienceWanted ? '1' : '0'); } catch { /* memory only */ }
      this.applyAmbience();
      // The static button label cannot show state, and a tap
      // meant as "turn it up/on" silently muted + persisted OFF
      // in the 2026-11-02 headset test — always say the state.
      pushSpeech('assistant', this.ambienceWanted
        ? 'Soundscape ON — the ambient pad should now be audible under my voice.'
        : 'Soundscape OFF — tap Soundscape again to bring the ambient pad back.',
      { silent: true });
      setSpeechStatus(this.ambienceWanted ? 'Soundscape ON' : 'Soundscape OFF');
    };
    this.toggleAmbience = toggleAmbience;
    wireAction('ambience-toggle', toggleAmbience);
    // Gesture unlock: the pad starts on the first tap anywhere,
    // and RE-resumes on later taps (a context created suspended
    // under autoplay policy otherwise stays dead — the silent
    // pad of the 2026-11-02 headset test).
    const unlockAmbience = () => {
      if (!this.ambienceWanted) return;
      if (!this.ambience || !this.ambience.isStarted()) {
        this.applyAmbience();
      } else if (this.ambience.state() !== 'running') {
        this.ambience.resume();
        diag('ambience-resume', { state: this.ambience.state() });
      }
    };
    // Dedicated AI-question input (Discover tab). Same Horizon Input
    // wrapper shape as the search field: the live value is on the
    // inner `.input` child. An empty question dispatches '' and the
    // evidence system explains — it must NEVER silently substitute
    // the demo preset (owner correction, 2026-10-27).
    const aiInput = panel?.getElementById('ai-input') as
      | {
          input?: {
            element?: HTMLInputElement;
            currentSignal?: { value?: string };
          };
        }
      | null
      | undefined;
    let typedQuestion = '';
    const aiInnerElement = aiInput?.input?.element;
    const trackQuestion = () => {
      typedQuestion = aiInnerElement?.value ?? typedQuestion;
    };
    aiInnerElement?.addEventListener('input', trackQuestion);
    this.cleanupFuncs.push(() => aiInnerElement?.removeEventListener('input', trackQuestion));
    const askTyped = () => {
      const objective = (
        [
          aiInnerElement?.value,
          aiInput?.input?.currentSignal?.value,
          typedQuestion,
        ].find((value) => value?.trim()) ?? ''
      ).trim();
      if (objective) {
        pushSpeech('user', `(typed) ${objective}`);
        setSpeechStatus('AI is working — watch the source card; say STOP anytime');
      }
      dispatchAgent('run', objective)();
    };
    wireAction('ai-ask', askTyped);
    // Search-tab natural language (owner, 2026-11-02): typed
    // text routes through the SAME intent router as voice, so
    // "please search for the term explore" runs the Search
    // expert's term search here — never the Investigator with
    // a "no keyword search is active" card. Genuine questions
    // still go to Investigate (typed text is deliberate, so
    // they run at once instead of staging for CONFIRM, which
    // exists only to catch mishearings). Typed = buttons:
    // speech-log feedback is written, never spoken.
    const routeTypedSearch = (raw: string) => {
      const text = raw.trim();
      if (!text) {
        dispatchAgent('run', '')();
        return;
      }
      const intent = routeTranscript(text, voicePending.length > 0);
      diag('typed-nl', { intent: intent.kind });
      pushSpeech('user', `(typed) ${correctTranscript(text)}`);
      if (intent.kind === 'ask' || intent.kind === 'stage') {
        const q = intent.question;
        setTab('discover')();
        fillField('ai-input', q);
        pushSpeech('assistant',
          `Investigate specialist: asking the AI now: "${q}" — watch the source card.`,
          { silent: true });
        setSpeechStatus('AI is working — watch the source card; say STOP anytime');
        dispatchAgent('run', q)();
        return;
      }
      executeIntent(intent, correctTranscript(text), false);
      const ack = describeIntent(intent);
      if (ack) {
        ack.split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .forEach((line) => pushSpeech('assistant', line, { silent: true }));
      }
      if (intent.kind === 'out-of-scope') {
        setSpeechStatus('Outside scope — examples are in the Speech Log');
      } else if (intent.kind !== 'empty') {
        setSpeechStatus(IDLE_STATUS);
      }
    };
    const invAiInput = panel?.getElementById('inv-ai-input') as typeof aiInput;
    let invTyped = '';
    const invEl = invAiInput?.input?.element;
    const trackInv = () => { invTyped = invEl?.value ?? invTyped; };
    invEl?.addEventListener('input', trackInv);
    this.cleanupFuncs.push(() => invEl?.removeEventListener('input', trackInv));
    const runInvTyped = () => {
      const objective = (
        [invEl?.value, invAiInput?.input?.currentSignal?.value, invTyped]
          .find((v) => v?.trim()) ?? ''
      ).trim();
      routeTypedSearch(objective);
    };
    this.runInvTyped = runInvTyped;
    wireAction('inv-ai-ask', runInvTyped);
    const expandUniverse = () => {
      scaleState.expanded = true;
      scaleState.animating = true;
    };
    const compactUniverse = () => {
      scaleState.expanded = false;
      scaleState.animating = true;
    };
    xrButton.addEventListener('click', launchVR);
    mrButton?.addEventListener('click', launchMR);
    expandButton?.addEventListener('click', expandUniverse);
    compactButton?.addEventListener('click', compactUniverse);
    exitButton.addEventListener('click', exitXR);
    // In-world VR<->MR switch (P1.1): WebXR cannot change session
    // mode in place, so this ends the session and relaunches the
    // opposite mode. If the automatic relaunch loses user
    // activation, the 2D Enter VR/MR buttons are the truthful
    // fallback (one more tap, no browser menus to hunt through).
    let pendingMode: 'vr' | 'mr' | undefined;
    const toggleMode = () => {
      if (pendingMode) return; // a switch is already in flight
      const session = (this.world as unknown as {
        session?: XRSession & { environmentBlendMode?: string };
      }).session;
      const inMR = session?.environmentBlendMode != null
        && session.environmentBlendMode !== 'opaque';
      pendingMode = inMR ? 'vr' : 'mr';
      diag('mode-toggle', { from: inMR ? 'mr' : 'vr', to: pendingMode });
      // Set the expectation BEFORE the hop (owner, 2026-11-04):
      // without this the exit-to-browser reads as a crash. The
      // short hold lets the user actually read it in-headset;
      // the speech log keeps the same line for the 2D moment.
      const targetName = pendingMode === 'mr'
        ? 'Mixed Reality, in your real room'
        : 'full Virtual Reality';
      pushSpeech('assistant',
        `Switching to ${targetName} — you'll pop out to the browser for a moment, then come right back in automatically. Give it a few seconds; no need to tap anything.`,
        { silent: true });
      setSpeechStatus(`Switching to ${targetName} — one moment…`);
      setTimeout(() => {
        exitXR();
        setTimeout(() => {
          if (!pendingMode) return;
          const target = pendingMode;
          pendingMode = undefined;
          diag('mode-toggle-relaunch', { to: target });
          if (target === 'mr') launchMR(); else launchVR();
        }, 900);
      }, 1200);
    };
    modeToggle?.addEventListener('click', toggleMode);
    this.cleanupFuncs.push(() => modeToggle?.removeEventListener('click', toggleMode));
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchVR),
      () => mrButton?.removeEventListener('click', launchMR),
      () => expandButton?.removeEventListener('click', expandUniverse),
      () => compactButton?.removeEventListener('click', compactUniverse),
      () => exitButton.removeEventListener('click', exitXR),
      this.world.visibilityState.subscribe((visibilityState) => {
        is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        mrButton?.setProperties({ display: is2D ? 'flex' : 'none' });
        applyUniverseVisibility();
        if (!is2D) {
          // Ambient sound begins upon entry (owner, 2026-11-02):
          // every immersive entry starts the pad — no toggle
          // archaeology from earlier sessions. The in-session
          // toggle still mutes until the next entry.
          this.ambienceWanted = true;
          try { localStorage.setItem('mmdata-ambience', '1'); } catch { /* memory only */ }
          this.applyAmbience();
          diag('ambience-entry', { state: this.ambience?.state() ?? 'none' });
        }
      }),
    );
  }
}

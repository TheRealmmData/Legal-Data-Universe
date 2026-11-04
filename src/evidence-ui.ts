/**
 * Milestone 3 spatial evidence (new work, 2026-10-27).
 * Binds fixture records to spatial nodes: investigator search dims
 * non-hits and keeps hits full-size, hand/controller selection
 * (Pressed) opens a source panel with content, custodian, date +
 * confidence, participants, and provenance. Uses the tested
 * SearchSession/InvestigationState/evidence adapter.
 *
 * Search transport is explicit-action based: 'search' executes a
 * keyword query, 'clear' restores the full corpus, 'next'/'prev'
 * step through the current hit list. An empty search term never
 * silently means "show all" (owner-found defect, 2026-10-27:
 * free-text queries appeared to return all 8 records).
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  createSystem,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Pressed,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import { StoreEvidenceAdapter, type EvidenceAdapter } from './evidence/adapter.ts';
import { EvidenceStore } from './evidence/store.ts';
import { InvestigationState } from './investigation/state.ts';
import { SearchSession } from './investigation/search-session.ts';
import { abortCurrentChat, inferenceHealth, ModelPlanner, ModelSynthesizer } from './ai/model-client.ts';
import {
  chronologyOrder, nodeVisual, paginate, galaxyEmphasis,
  nodeLabelText, clusterLabelText, focusSummary, focusWindowForHit,
  assembleMemoLines, type MemoLine,
} from './investigation/visual-state.ts';
import {
  loadExpandedCorpus, loadGalaxyCorpus, loadTradeSecretCorpus, recordDomainCheck, type LoadedCorpus,
} from './evidence/corpus/index.ts';
/**
 * Computed concept clusters (option C, 2026-11-01): TF-IDF +
 * cosine single-linkage artifact committed at
 * data/concept-clusters-tfidf.json with method + purity report.
 * Imported (bundled, offline, deterministic) — the Concepts
 * lens reads it in "computed" mode; authored tags stay default.
 */
import TFIDF_CLUSTERS from '../data/concept-clusters-tfidf.json';
import {
  conceptAnchors, custodianAnchors, fileTypeAnchors, galaxyPositions, orgAnchors, GALAXY_CENTER, GALAXY_PALETTE, type GalaxyRecordInput,
} from './galaxy/layout.ts';
import { pickDetailedSlot, pickNearest } from './galaxy/picking.ts';
import {
  chronologyAnomalies, directedCommunicationEdges, personHubSummaries, replyLinks,
  type DirectedEdge, type PersonHubSummary, type ReplyLink,
} from './evidence/analysis.ts';
import { scaleState } from './scale.ts';
import {
  describeSelection,
  emptySelection,
  validateSelectionContext,
  type ActiveLens,
} from './investigation/interaction.ts';
import { runInvestigation, type InterruptSignal } from './ai/runner.ts';
import { routeQuestion } from './ai/query-router.ts';
import { runReyesInvestigation } from './agents/orchestrator.ts';

import { fireworksAssess } from './agents/fireworks-reasoner.ts';
import { makeZip } from './agents/zip.ts';
import { makePdfBytes } from './export/pdf.ts';
import { buildFindingsJsonPayload, buildFindingsMemo, headlineClaim } from './export/findings-memo.ts';
import type { Finding as StateFinding } from './investigation/state.ts';
import {
  emptyMemory, loadDurable, saveDurable, rememberNote, resetDurable,
  noteSearch, noteObjective, memoryLines, type MatterMemory,
} from './investigation/matter-memory.ts';
import {
  discoverLeads, expandFocusForLead, personOrganizations, type DiscoveryLead,
} from './discovery/leads.ts';
import { buildDemoLeads } from './discovery/demo-leads.ts';
import { SEARCH_OUTCOME_HITS, shouldSpeakReply } from './voice.ts';
import type { FindingDraft } from './ai/contracts.ts';

/**
 * Scene focus-slot orbs (renamed from the retired fixture
 * record nodes, 2026-11-01): detail orbs near the panel
 * that rebind to whichever records are in focus. Scene ids in
 * public/scenes/main.iwsdk.scene.json; poses in visual-state.ts.
 */
export const SLOT_NODE_IDS = [
  'ev-slot-1', 'ev-slot-2', 'ev-slot-3', 'ev-slot-4',
  'ev-slot-5', 'ev-slot-6', 'ev-slot-7', 'ev-slot-8',
];

export type SearchAction = 'search' | 'clear' | 'next' | 'prev' | 'goto-hit' | 'page' | 'page-prev' | 'submit-report' | 'suggest-more' | 'export-ids' | 'mark-doc';

/**
 * Crash-forensics telemetry (2026-10-30): fire-and-forget stage
 * beacons to the dev server's /api/diag, which appends them to
 * app/server/diag.log ON THIS PC. Unlike sessionStorage, these are
 * readable after a total Quest tab death with no owner action.
 * Stage/health counters only — never evidence content.
 */
export function diag(stage: string, extra?: Record<string, unknown>): void {
  try {
    void fetch('/api/diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, t: Math.round(performance.now()), ...extra }),
      keepalive: true,
    }).catch(() => { /* diagnostics only */ });
  } catch { /* diagnostics only */ }
}

/**
 * Diagnostic Clear Search stage (0-5, default 5 = full reset).
 * Set once via `?clearStage=N` in the URL; persisted in
 * localStorage so the plain bookmark URL keeps it. Stages:
 * 0 state only · 1 +input-field clear · 2 +panel repaint ·
 * 3 +orb styling/edges · 4 +galaxy colors · 5 +galaxy matrices.
 * Each Quest attempt at a chosen stage is decisive telemetry.
 */
export function clearStageSetting(): number {
  try {
    const param = new URLSearchParams(location.search).get('clearStage');
    if (param != null && /^[0-5]$/.test(param)) {
      localStorage.setItem('mmdata-clear-stage', param);
      return Number(param);
    }
    const stored = localStorage.getItem('mmdata-clear-stage');
    if (stored != null && /^[0-5]$/.test(stored)) return Number(stored);
  } catch { /* defaults below */ }
  return 5;
}

/** Set by panel buttons; consumed by EvidenceSystem. */
export const searchRequest: { action: SearchAction; term: string; nonce: number } = {
  action: 'clear',
  term: '',
  nonce: 0,
};

/** Non-immersive pointer transport (BrowserControlsSystem writes,
 * EvidenceSystem reads). Coordinates are NDC -1..1. */
export const browserPointerState: {
  active: boolean; x: number; y: number; overPanel: boolean;
} = { active: false, x: 0, y: 0, overPanel: false };
export const browserPickRequest: { nonce: number } = { nonce: 0 };

export type AgentAction = 'run' | 'stop' | 'approve' | 'reject' | 'approve-all' | 'export' | 'export-selected' | 'voice-status' | 'finding-prev' | 'finding-next' | 'show-queue' | 'remove-term' | 'export-search-report' | 'export-docids-xlsx' | 'export-zip';

/** M4 agent transport; set by panel buttons, consumed by EvidenceSystem. */
export const agentRequest: { action: AgentAction; objective: string; nonce: number } = {
  action: 'run',
  objective: '',
  nonce: 0,
};

export const DEFAULT_OBJECTIVE =
  'Who knew about the Falcon work before the resignation, and what evidence points the other way?';

/**
 * Speech log (owner request, 2026-11-01): a chat-style record in
 * its own window left of the buttons panel, so the user can
 * ALWAYS see what they asked and what the assistant did about
 * it — whether the command ran at once or is awaiting
 * confirmation. panel.ts appends; EvidenceSystem renders.
 */
export type SpeechLogEntry = { role: 'user' | 'assistant' | 'system'; text: string };
export const speechLogEntries: SpeechLogEntry[] = [];
export const speechLogSignal = { nonce: 0 };
/**
 * Spoken-reply queue (owner, 2026-11-01): assistant bubbles are
 * also SPOKEN via /api/tts (Wit synthesize, server-side token).
 * Long entries (help text) are read, not spoken. PanelSystem
 * owns the single player; panel.ts drains this queue.
 */
export const speakQueue: string[] = [];
export const speakSignal = { nonce: 0 };
/**
 * Active voice-turn window (owner, 2026-11-02): panel.ts marks
 * a turn when the user actually speaks (or confirms a spoken
 * question by tap). Assistant replies are SPOKEN only inside
 * the window — button-driven work updates the log silently.
 */
export const voiceTurn = { untilMs: 0 };
export function markVoiceTurn(windowMs = 120000): void {
  voiceTurn.untilMs = performance.now() + windowMs;
}
/**
 * End the spoken-reply era immediately (owner, 2026-11-03):
 * clicking through buttons/views without voice must be silent,
 * and queued speech from a previous view must not keep reading
 * after the view changes. Panel taps and 2D view presets call
 * this BEFORE their handler (voice-start and confirm flows
 * re-mark the turn inside their handlers, after this flush).
 * The panel polls speakFlushSignal to stop current playback.
 */
export const speakFlushSignal = { nonce: 0 };
export function endVoiceTurn(): void {
  voiceTurn.untilMs = 0;
  speakQueue.length = 0;
  speakFlushSignal.nonce += 1;
}
/** AI run state for the panel's "AI is working" indicator. */
export const agentStatus = { busy: false, nonce: 0 };
export function pushSpeech(role: SpeechLogEntry['role'], text: string, opts?: { silent?: boolean }): void {
  const clean = text.trim();
  if (!clean) return;
  const last = speechLogEntries[speechLogEntries.length - 1];
  if (last && last.role === role && last.text === clean) return;
  speechLogEntries.push({ role, text: clean });
  if (speechLogEntries.length > 80) {
    speechLogEntries.splice(0, speechLogEntries.length - 80);
  }
  speechLogSignal.nonce += 1;
  // Multi-line guidance (help, out-of-scope) speaks only its
  // first line — the rest is reading, not listening (2026-11-01).
  if (role === 'assistant' && !opts?.silent && clean.length <= 300
    && shouldSpeakReply(performance.now(), voiceTurn.untilMs)) {
    speakQueue.push(clean);
    if (speakQueue.length > 3) speakQueue.splice(0, speakQueue.length - 3);
    speakSignal.nonce += 1;
  }
}
/** Set by voice search so the outcome ("N highlighted") can be logged. */
export const lastVoiceSearch: { term: string; at: number } = { term: '', at: 0 };
/**
 * Set ONLY by a voice hit request ("next hit", "show me the
 * first hit") in panel.ts. Hit-by-hit announcements are spoken
 * solely for these asks (owner, 2026-11-02: reading every hit
 * aloud while button-stepping is annoying) and consumed by
 * the first announcement that uses the mark.
 */
export const lastVoiceHitNav: { at: number } = { at: 0 };
export function consumeVoiceHitNav(): boolean {
  const fresh = lastVoiceHitNav.at > 0 && performance.now() - lastVoiceHitNav.at < 8000;
  lastVoiceHitNav.at = 0;
  return fresh;
}

/**
 * Live voice status for the speech-log status bar (LISTENING /
 * TRANSCRIBING / STAGED / idle). Owner (2026-11-01): voice
 * instructions and listening indicators live IN the speech log,
 * never on the source inspection card.
 */
export const speechStatus: { text: string } = { text: 'Press X (left controller) and speak' };
export function setSpeechStatus(text: string): void {
  if (speechStatus.text === text) return;
  speechStatus.text = text;
  speechLogSignal.nonce += 1;
}

export type CorpusMode = 'expanded' | 'galaxy' | 'tradesecret';

/** Galaxy corpus sizes: 1,000 = M3 target (2026-10-29 scale-up);
 * 500 remains selectable as the owner-verified fallback. */
export const GALAXY_TARGET_COUNT = 1000;
export const GALAXY_FALLBACK_COUNT = 500;
export type LensName = 'evidence' | 'network' | 'chronology' | 'concepts' | 'custodians' | 'filetypes';

/**
 * Revised-M3 view transport (Universe tab). Switching corpus swaps
 * the evidence DATA behind the same adapter/state — findings,
 * decisions, and audit persist; the proven interactive nodes act
 * as detail orbs over the larger corpus (see switchCorpus).
 */
export const viewRequest: {
  corpus: CorpusMode; lens: LensName; galaxyCount: number; nonce: number;
} = {
  corpus: 'tradesecret',
  lens: 'evidence',
  galaxyCount: GALAXY_TARGET_COUNT,
  nonce: 0,
};

export type DiscoverAction = 'leads' | 'explore' | 'ask';

/**
 * Discover transport (M4 Phase A, 2026-10-28 overnight). 'leads'
 * runs the deterministic feature prioritizer (no model call),
 * 'explore' reorganizes the universe around a lead, 'ask' runs the
 * bounded agent on the lead's staged question.
 */
export const discoverRequest: { action: DiscoverAction; index: number; nonce: number } = {
  action: 'leads',
  index: 0,
  nonce: 0,
};

/** Keyboard push-to-talk transport (owner, 2026-11-03): in the
 * 2D browser the panel copy said "Press X" but only the XR
 * controller X was wired. BrowserControls bumps this nonce on
 * the X key; the panel polls it and toggles voice capture. */
export const voiceToggleRequest: { nonce: number } = { nonce: 0 };

/** Investigation-scope transport (owner, 2026-11-01): voice
 * "hits only" / "whole universe" sets the bound the next
 * investigative answer is filtered to. Consumed in update(). */
export const scopeRequest: { scope: 'hits' | 'universe'; nonce: number } = {
  scope: 'universe',
  nonce: 0,
};

/** Concepts-source transport (owner, 2026-11-01): voice or the
 * Explore toggle switches authored <-> computed clusters. */
export const conceptModeRequest: { mode: 'authored' | 'computed'; nonce: number } = {
  mode: 'computed',
  nonce: 0,
};

/** Active suggestion set for panel label swapping: button
 * LABELS are pre-rendered per set and display-swapped, so the
 * label always matches the term the button runs (owner bug:
 * new terms ran under old labels, 2026-11-01). */
export const suggestionSignal: { corpus: string; idx: number; nonce: number } = {
  corpus: 'tradesecret', idx: 0, nonce: 0,
};

const peopleById = new Map<string, string>();
const custodianById = new Map<string, string>();

interface StylableMaterial {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  clone(): StylableMaterial;
}

export class EvidenceSystem extends createSystem({
  pressed: { required: [Pressed] },
}) {
  /**
   * Recognizable File-Types categories (owner, 2026-11-01),
   * derived from the collected loadFile extension — plus the
   * title-marked Teams/text exports. Anything else (including
   * genuinely unknown extensions) lives under Other, so every
   * record keeps an accurate home in the lens.
   */
  static fileTypeCategory(extension: string | undefined, title: string): string {
    if (/^Teams chat\b/.test(title)) return 'Teams Chat';
    if (/^Text message\b/.test(title)) return 'Text Message';
    switch ((extension ?? '').toLowerCase()) {
      case 'msg': case 'eml': return 'Email';
      case 'docx': case 'doc': return 'Word';
      case 'xlsx': case 'xls': case 'csv': return 'Excel';
      case 'pptx': case 'ppt': return 'PowerPoint';
      case 'pdf': return 'PDF';
      case 'html': case 'htm': return 'HTML';
      case 'log': return 'Log';
      case 'md': return 'Markdown';
      case 'txt': return 'Text';
      case 'mp3': case 'wav': case 'm4a': return 'Audio';
      case 'mp4': case 'mov': case 'mkv': return 'Video';
      case 'png': case 'jpg': case 'jpeg': case 'gif': return 'Image';
      default: return 'Other';
    }
  }
  // Boot placeholders only: init() immediately loads the startup
  // corpus (Trade Secret) through switchCorpus, replacing all three.
  private store = new EvidenceStore([], [], []);
  private adapter: EvidenceAdapter = new StoreEvidenceAdapter(this.store, []);
  private state = new InvestigationState();
  private session = new SearchSession(this.adapter, this.state, {
    id: 'boot',
    version: '1',
  });
  private nodeByObject = new Map<Object3D, string>();
  private materialsByObject = new Map<Object3D, StylableMaterial[]>();
  private hits = new Set<string>();
  private searched = false;
  private lastTerm = '';
  /**
   * Concepts-lens cluster source (owner, 2026-11-01): 'authored'
   * (corpus conceptTags, default) or 'computed' (TF-IDF artifact).
   * The authored theory tags and the machine clusters are
   * separate overlays that never masquerade as each other.
   */
  private conceptMode: 'authored' | 'computed' = 'computed';
  /** recordId -> computed cluster (id + label) from the artifact. */
  private computedConcepts = new Map<string, { clusterId: string; label: string }>();
  /**
   * Investigation scope (owner, 2026-11-01): 'universe' (default,
   * current behavior) or 'hits' (stay inside the highlighted
   * search hits). Set by voice ("hits only" / "whole
   * universe"). Deliberately NOT stacked highlight state: there
   * is still exactly one highlight set, so dimming, hit
   * stepping, reports, and exports keep one meaning. Scope only
   * bounds what investigation may conclude from.
   */
  private investScope: 'universe' | 'hits' = 'universe';
  // Matches the initial transport nonce so startup does not fire a
  // spurious "search cleared" before the investigator does anything.
  private lastNonce = 0;
  private selectedId: string | undefined;
  private lastAgentNonce = 0;
  private lastScopeNonce = 0;
  private lastConceptModeNonce = 0;
  private agentBusy = false;
  private agentBusySince = 0;
  private agentSignal: InterruptSignal = { interrupted: false };
  private pendingFindings: { draft: FindingDraft; findingId: string; runLabel: string }[] = [];
  private matterMemory: MatterMemory = {
    ...emptyMemory(),
    durableNotes: loadDurable(typeof localStorage !== 'undefined' ? localStorage : undefined),
  };
  private suggestionSetIdx = 0;
  // Owner-vision work-product state (typed, separated):
  private markedDocs: { id: string; module: string; reason: string }[] = [];
  private excludedReportTerms = new Set<string>();
  /** Answer candidates NOT yet drafted — user decides (vision). */
  private candidates: { drafts: FindingDraft[]; question: string; runLabel: string } | undefined;
  private runCounter = 0;
  /** Finding currently displayed for decision (P0.1 traceability):
   * decisions act on THIS draft, never silently on queue head. */
  private displayedFindingId: string | undefined;
  /** Retrospective step review of the most recent run (kept fast
   * live; reviewable afterwards on the outcome panel). */
  private lastRunSteps: string[] = [];
  private draftsByFindingId = new Map<string, { draft: FindingDraft; findingId: string; runLabel?: string }>();
  private visited = new Set<string>();
  private corpusMode: CorpusMode = 'tradesecret';
  private lens: LensName = 'evidence';
  private lastViewNonce = 0;
  private slotObjects: Object3D[] = [];
  private homePositions: Vector3[] = [];
  private focusIds: string[] = [];
  private layoutTargets = new Map<Object3D, Vector3>();
  private layoutAnimating = false;
  private edgeLines: LineSegments | undefined;
  private edgePairs: [string, string][] = [];
  // Spatial labels (2026-10-28 acceptance: dates + organizations must
  // be readable IN SPACE, not only on the source panel).
  // Galaxy field (M3, 2026-10-29): every record in the active
  // scaled corpus is an instance in a single draw call; states are
  // expressed by color/scale, never by hiding records.
  private galaxyCache: LoadedCorpus | undefined;
  private galaxyCaches = new Map<number, LoadedCorpus>();
  private tradeSecretCache: LoadedCorpus | undefined;
  private galaxyCount = GALAXY_TARGET_COUNT;
  private galaxyInputs: GalaxyRecordInput[] = [];
  private galaxyMesh: InstancedMesh | undefined;
  private galaxyIds: string[] = [];
  private galaxyCurrent = new Float32Array(0);
  private galaxyFrom = new Float32Array(0);
  private galaxyTo = new Float32Array(0);
  private galaxyOrgColor = new Map<string, Color>();
  private galaxyAnimating = false;
  private galaxyPickReady = false;
  private galaxyHoverId: string | undefined;
  private galaxyHoverSprite: Sprite | undefined;
  private galaxyAnchors: Sprite[] = [];
  private galaxyEdges: LineSegments[] = [];
  private galaxyEdgeBaseOpacity: number[] = [];
  private selectionEdges: LineSegments | undefined;
  private networkChannels: DirectedEdge[] = [];
  private networkHubs: PersonHubSummary[] = [];
  private networkReplyLinks: ReplyLink[] = [];
  private hubPositions = new Map<string, [number, number, number]>();
  private personHomeOrg = new Map<string, string>();
  private galaxyLastHoverMs = 0;
  private lastBrowserPickNonce = 0;
  private galaxySession: XRSession | undefined;
  private galaxyInMR: boolean | undefined;
  private readonly galaxyDummy = new Object3D();
  private lastComposedMeshScale = 0;
  private nodeLabels = new Map<Object3D, Sprite>();
  private sceneLabels: Sprite[] = [];
  /** In-world color key sprites (owner, 2026-11-01): a small
   * floating key at the platform's left so node color never
   * needs guessing. Scene-fixed landmark (not panel-locked). */
  private colorKeySprites: Sprite[] = [];
  private orgNames = new Map<string, string>();
  private clusterCenters: { org: string; center: Vector3; count: number }[] = [];
  private chronologyEnds: { first: Vector3; last: Vector3 } | undefined;
  private expandedCache: LoadedCorpus | undefined;
  private peopleNames = new Map<string, string>();
  private custodianNames = new Map<string, string>();
  private pendingObjective: string | undefined;
  private lastLeads: DiscoveryLead[] = [];
  private lastDiscoverNonce = 0;
  private stagedLeadQuestion = '';
  private activeLead: DiscoveryLead | undefined;
  private activeLeadIndex = -1;
  private demoAssessment: ReturnType<typeof runReyesInvestigation> | undefined;
  private definedDraftsByStep = new Map<number, FindingDraft>();
  private draftedDemoSteps = new Set<number>();
  private selectedApprovedFindingId: string | undefined;
  private selectedExportArmed = false;
  private exportArmed = false;
  private panelPages: MemoLine[][] = [];
  private panelPage = 0;
  private baseScales = new Map<Object3D, number>();
  private scaleAnimating = false;
  private panel!: Mesh;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  /**
   * Aim beams (owner, 2026-11-02): the platform ray reads on
   * the center menu but vanishes over the source card, speech
   * log, and empty space — pointing worked, aiming was blind.
   * Two slim gold cylinders + endpoint dots are posed from
   * IWSDK's player.raySpaces (the platform ray's own pose
   * family, NOT the offset three controller groups that made
   * the retired duplicate pair), depth-test off so the beam
   * stays visible against clear space and across panels.
   */
  private aimBeams: { beam: Mesh; dot: Mesh }[] = [];
  private galaxyHoverAlong = 0;
  /** Selected-record locator: bobbing arrow over the instance. */
  private hitArrow: Object3D | undefined;
  private hitSparkles: Object3D | undefined;
  private orbSparkles: Object3D | undefined;
  private selectedPulse = 1;
  /** "Record" caption under the selected detail orb. */
  private recordCaption: Sprite | undefined;
  // Speech log window (mirror of the source card, on the left).
  private speechCtx: CanvasRenderingContext2D | undefined;
  private speechTexture: CanvasTexture | undefined;
  private speechPanel: Mesh | undefined;
  private lastSpeechNonce = -1;
  private speechLocalOffset: Vector3 | undefined;
  private speechLocalQuat: { x: number; y: number; z: number; w: number } | undefined;
  // Locked panel assembly (2026-10-30 final layout decision):
  // only the bottom-left handle moves anything; welcome panel
  // follows handle deltas, source panel keeps a fixed offset.
  private assemblyInit = false;
  private handlePrev: Vector3 | undefined;
  private sourceLocalOffset: Vector3 | undefined;
  private sourceLocalQuat: { x: number; y: number; z: number; w: number } | undefined;
  private handleLabel: Sprite | undefined;

  init(): void {
    // Crash diagnostics: persist the last fatal error so a Quest
    // browser death leaves evidence readable after reload.
    // Rate-limited: a per-frame error must never become a storage
    // write storm that itself degrades the session.
    let lastErrorWriteMs = 0;
    let lastErrorText = '';
    const recordError = (message: string) => {
      const now = performance.now();
      if (message === lastErrorText && now - lastErrorWriteMs < 5000) return;
      if (now - lastErrorWriteMs < 1000) return;
      lastErrorWriteMs = now;
      lastErrorText = message;
      try {
        sessionStorage.setItem('mmdata-last-error', `${new Date().toISOString()} ${message}`.slice(0, 300));
      } catch { /* storage unavailable: diagnostics only */ }
    };
    window.addEventListener('error', (e) => recordError(`error: ${e.message}`));
    window.addEventListener('unhandledrejection', (e) =>
      recordError(`rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
    window.addEventListener('error', (e) => diag('window-error', {
      message: String(e.message).slice(0, 200),
      at: `${String((e as ErrorEvent).filename ?? '').split('/').pop()}:${(e as ErrorEvent).lineno ?? 0}`,
      stack: String((e as ErrorEvent).error?.stack ?? '').slice(0, 600),
    }));
    // Distinguish GPU context loss from loop stalls on-device.
    const glCanvas = (this.renderer as unknown as { domElement?: HTMLCanvasElement } | undefined)?.domElement;
    glCanvas?.addEventListener('webglcontextlost', (e) => {
      diag('webgl-context-lost', { status: String((e as WebGLContextEvent).statusMessage ?? '') });
      recordError('webglcontextlost');
    });
    glCanvas?.addEventListener('webglcontextrestored', () => diag('webgl-context-restored'));
    diag('app-start', {
      ua: navigator.userAgent.slice(0, 160),
      clearStage: clearStageSetting(),
      clearLegacy: typeof location !== 'undefined'
        && new URLSearchParams(location.search).has('clearLegacy'),
    });
    this.state.setObjective('NovaChip trade-secret investigation (synthetic corpus, not case evidence)', 'investigator');
    for (const slotId of SLOT_NODE_IDS) {
      const object = this.world.getSceneObject(slotId);
      if (object) {
        this.baseScales.set(object, object.scale.x || 1);
        this.materialsByObject.set(object, cloneMaterials(object));
        this.slotObjects.push(object);
        this.homePositions.push(object.position.clone());
      }
    }
    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(8 * 8 * 6), 3));
    this.edgeLines = new LineSegments(
      edgeGeometry,
      new LineBasicMaterial({ color: 0xe8c56a, transparent: true, opacity: 0.55 }),
    );
    this.edgeLines.frustumCulled = false;
    this.edgeLines.visible = false;
    this.edgeLines.name = 'relationship-edges';
    this.scene.add(this.edgeLines);
    this.buildSourcePanel();
    this.buildSpeechLogPanel();
    this.rebuildLabels();
    // Startup corpus (Fixture 8 retired 2026-11-01 at owner
    // direction): Trade Secret loads through the same proven
    // switch path as the Universe-tab button.
    this.switchCorpus('tradesecret');
    this.queries.pressed.subscribe('qualify', (entity) => {
      // Controller in hand = point-and-trigger through pickGalaxyNow.
      // The pressed/grab path is the no-controller fallback, so a
      // squeeze never becomes an accidental gaze examination.
      const hasControllerRay = this.galaxyRays().some((ray) =>
        ray.source.startsWith('controller'));
      if (hasControllerRay) return;
      let object: Object3D | null | undefined = entity.object3D;
      while (object) {
        const recordId = this.nodeByObject.get(object);
        if (recordId) {
          const now = performance.now();
          if (recordId === this.lastPickId && now - this.lastPickAt < 900) return;
          this.lastPickAt = now;
          this.lastPickId = recordId;
          void this.select(recordId);
          return;
        }
        object = object.parent;
      }
    });
  }

  update(): void {
    this.updatePanelAssembly();
    this.updateFallRecovery();
    if (browserPickRequest.nonce !== this.lastBrowserPickNonce) {
      this.lastBrowserPickNonce = browserPickRequest.nonce;
      const ray = this.browserPointerRay();
      if (ray) this.pickGalaxyNow([ray]);
    }
    if (searchRequest.nonce !== this.lastNonce) {
      this.lastNonce = searchRequest.nonce;
      void this.handleAction(searchRequest.action, searchRequest.term);
    }
    if (agentRequest.nonce !== this.lastAgentNonce) {
      this.lastAgentNonce = agentRequest.nonce;
      void this.handleAgentAction(agentRequest.action, agentRequest.objective);
    }
    if (discoverRequest.nonce !== this.lastDiscoverNonce) {
      this.lastDiscoverNonce = discoverRequest.nonce;
      this.handleDiscover(discoverRequest.action, discoverRequest.index);
    }
    if (speechLogSignal.nonce !== this.lastSpeechNonce) {
      this.lastSpeechNonce = speechLogSignal.nonce;
      this.drawSpeechLog();
    }
    if (scopeRequest.nonce !== this.lastScopeNonce) {
      this.lastScopeNonce = scopeRequest.nonce;
      this.investScope = scopeRequest.scope;
      diag('invest-scope', {
        scope: scopeRequest.scope,
        hits: this.searched ? this.hits.size : 0,
      });
    }
    if (conceptModeRequest.nonce !== this.lastConceptModeNonce) {
      this.lastConceptModeNonce = conceptModeRequest.nonce;
      this.conceptMode = conceptModeRequest.mode;
      // Both Concepts doors stay visible (owner clarity fix):
      // authored/computed are named choices, not a flip-flop.
      // Re-resolve the concept field + re-layout (same cost as
      // a corpus switch; rare by design).
      this.buildGalaxy();
      this.applyLens(true);
      diag('concept-mode', { mode: conceptModeRequest.mode });
    }
    if (viewRequest.nonce !== this.lastViewNonce) {
      this.lastViewNonce = viewRequest.nonce;
      if (viewRequest.corpus !== this.corpusMode
        || (viewRequest.corpus === 'galaxy' && viewRequest.galaxyCount !== this.galaxyCount)) {
        this.galaxyCount = viewRequest.galaxyCount;
        this.switchCorpus(viewRequest.corpus);
      }
      if (viewRequest.lens !== this.lens) {
        this.lens = viewRequest.lens;
        if (this.lens !== 'evidence') this.state.setMode('explore');
        // Mid-search, a lens change reorganizes the SAME hits
        // (owner seamless flow, 2026-11-01): don't overwrite the
        // search-results source card with a lens announcement.
        this.applyLens(!this.searched);
        if (this.searched) {
          pushSpeech('assistant', `Explore: reorganized by ${this.lens} — your "${this.lastTerm}" hits (${this.hits.size}) stay highlighted.`);
        }
      }
    }
    if (this.pendingClearPanelAtFrame >= 0
      && this.breadcrumbFrame >= this.pendingClearPanelAtFrame) {
      this.pendingClearPanelAtFrame = -1;
      this.markBreadcrumb('clear:panel');
      this.drawIdlePanel('Search cleared');
      this.markBreadcrumb('clear:panel-done');
    }
    this.breadcrumbFrame += 1;
    if (this.breadcrumbFrame % 300 === 0) {
      this.markBreadcrumb(`alive f${this.breadcrumbFrame}`);
    }
    this.updateLayoutAndEdges();
    this.updateGalaxy();
    this.updatePlayZoneExit();
    // Scale encoding writes ONLY during a short transition after a
    // search/selection change, then releases the nodes completely.
    // Continuously writing scale every frame desynchronized the grab
    // handle state (@pmndrs/handle also owns target scale), leaving
    // repositioned nodes non-interactive at their new location
    // (owner-found defect, 2026-10-27 Quest test). The transition is
    // armed AFTER the new search/selection state is stored — arming
    // it before the await let the same frame cancel the animation
    // with stale state, so preset searches updated inconsistently.
    if (!this.scaleAnimating) return;
    let allArrived = true;
    for (const [object, recordId] of this.nodeByObject) {
      const base = this.baseScales.get(object) ?? 1;
      const factor = nodeVisual({
        searched: this.searched,
        isHit: this.hits.has(recordId),
        isSelected: recordId === this.selectedId,
        isVisited: this.visited.has(recordId),
      }).scaleFactor;
      const target = base * factor;
      const current = object.scale.x;
      if (Math.abs(target - current) < 0.005) continue;
      allArrived = false;
      object.scale.setScalar(current + (target - current) * 0.25);
    }
    if (allArrived) this.scaleAnimating = false;
  }

  private async handleAction(action: SearchAction, term: string): Promise<void> {
    if (action === 'page' || action === 'page-prev') {
      if (this.panelPages.length > 1) {
        const delta = action === 'page' ? 1 : -1;
        this.panelPage =
          (this.panelPage + delta + this.panelPages.length) % this.panelPages.length;
        this.renderPanelPage();
      }
      return;
    }
    if (action === 'clear') return this.clearSearch();
    if (action === 'next') return this.navigate(1);
    if (action === 'prev') return this.navigate(-1);
    if (action === 'goto-hit') return this.gotoHit(term);
    if (action === 'mark-doc') return this.markDocIds(term || 'Explore');
    if (action === 'submit-report') return this.submitSearchReport();
    if (action === 'suggest-more') {
      // Additional suggestions WITHOUT discarding set 1: cycles
      // sets; the panel names the exact active terms.
      this.suggestionSetIdx += 1;
      suggestionSignal.corpus = this.corpusMode;
      suggestionSignal.idx = this.suggestionSetIdx;
      suggestionSignal.nonce += 1;
      pushSpeech('assistant', `Search expert: new suggestions prepared — buttons now run: ${this.suggestionsForCorpus().join(', ')}.`);
      const terms = this.suggestionsForCorpus();
      this.drawPanel({
        status: `Suggestion set ${this.suggestionSetIdx + 1} for ${this.corpusLabel()}`,
        title: 'Buttons 1-4 now run these exact searches',
        sections: [{ label: 'Active suggested searches', lines: terms.map((t, i) => `${i + 1}. ${t}`) }],
      });
      return;
    }
    if (action === 'export-ids') return this.exportDocumentIds();
    return this.runSearch(term);
  }

  /** Collection-specific suggested searches (Round 2): resolved
   * from the ACTIVE corpus, never fixture terms in TS universe. */
  private suggestionSets(): string[][] {
    switch (this.corpusMode) {
      case 'tradesecret': return [
        ['scheduler_core', 'personal mailbox', 'USB', 'Reyes'],
        ['Nightjar', 'not put this in email', 'air-gapped', 'escrow'],
      ];
      default: return [['Priya', 'Atlas', 'March', 'Invoice'], ['catering', 'rota', 'Casey', 'schedule']];
    }
  }
  private suggestionsForCorpus(): string[] {
    const sets = this.suggestionSets();
    return sets[this.suggestionSetIdx % sets.length] ?? sets[0] ?? [];
  }

  /**
   * Deliberate submission (Round 2 #8/#10): the CURRENT search
   * becomes a search-term hit report in the Export queue —
   * explicitly NOT an investigative finding. Nothing is
   * submitted automatically; this only runs on the button.
   */
  private submitSearchReport(): void {
    if (!this.searched || !this.lastTerm) {
      this.drawPanel({
        status: 'No search to submit yet',
        title: 'Run a keyword/phrase search first',
        sections: [{ lines: ['Then: review it in the Export tab.'] }],
      });
      return;
    }
    const hitIds = [...this.hits];
    const finding = this.state.addFinding({
      claim: `SEARCH REPORT (not an investigative finding): "${this.lastTerm}" matched ${hitIds.length} of ${this.store.size} records in ${this.corpusLabel()}. Matching rule: case-insensitive substring, hyphen/space equivalent, no stemming.`,
      citationIds: hitIds.slice(0, 25),
      question: `Search report: ${this.lastTerm}`,
      groundedBy: 'metadata',
      title: `Search report — ${this.lastTerm}`,
      citations: [],
      sourceLabel: 'Deterministic search execution',
    });
    const entry = {
      draft: { claim: finding.claim, citationIds: finding.citationIds, citations: [], status: 'draft' as const, groundedBy: 'metadata' as const },
      findingId: finding.id,
      runLabel: `search report (${this.corpusLabel()})`,
    };
    this.pendingFindings.push(entry);
    this.draftsByFindingId.set(finding.id, entry);
    this.displayedFindingId = finding.id;
    this.drawPendingFinding('SEARCH REPORT queued for Export');
  }

  /** Document ID list export (demo-critical work product):
   * current search's hit IDs as a production-queue-ready list. */
  private exportDocumentIds(): void {
    if (!this.searched || this.hits.size === 0) {
      this.drawPanel({
        status: 'No document IDs to export',
        title: 'Run a search with hits first',
        sections: [{ lines: ['Export Document IDs downloads the CURRENT hit list.'] }],
      });
      return;
    }
    const ids = [...this.hits].sort();
    downloadJson('document-id-list.json', {
      type: 'document-id-list',
      corpus: this.corpusLabel(),
      query: this.lastTerm,
      rule: 'case-insensitive substring; hyphen/space equivalent; no stemming',
      count: ids.length,
      documentIds: ids,
      exportedAt: new Date().toISOString(),
      note: 'Synthetic demonstration data — not client evidence.',
    });
    this.drawPanel({
      status: `Exported ${ids.length} document IDs`,
      title: 'document-id-list.json downloaded',
      sections: [{ label: 'Query', lines: [this.lastTerm, `Scope: ${this.corpusLabel()}, exhaustive.`] }],
    });
  }

  private async runSearch(term: string): Promise<void> {
    let query = term.trim();
    const suggest = /^suggest:([1-4])$/.exec(query);
    if (suggest) {
      query = this.suggestionsForCorpus()[Number(suggest[1]) - 1] ?? query;
    }
    if (!query) {
      // Defined empty-query behavior: no search runs, nothing is
      // recorded, current results stay as they are.
      this.drawPanel({
        status: 'No keyword entered',
        title: 'Type a keyword, then Run My Search',
        sections: [
          {
            label: 'Try',
            lines: ['catering  .  rota  .  schedule  .  Casey  .  fx-004'],
          },
          {
            label: 'Or clear',
            lines: ['Clear Search restores all records.'],
          },
        ],
      });
      return;
    }
    const found = await this.session.query(query);
    this.searched = true;
    this.matterMemory = noteSearch(this.matterMemory, query);
    this.lastTerm = query;
    this.hits = new Set(this.session.hitList());
    this.selectedId = undefined;
    if (found.length > 0) {
      // Spatialize the first 8 hits; all hits stay inspectable.
      this.focusIds = this.session.hitList().slice(0, 8);
      this.rebindSlots();
      this.applyLens();
    }
    this.refreshNodeStyling();
    const total = this.store.size;
    const execution = this.session.getLastExecution();
    // Speech log outcome for voice-initiated searches: the ack in
    // the log said "Searching…"; this is the verifiable result.
    if (
      lastVoiceSearch.term
      && lastVoiceSearch.term.toLowerCase() === query.toLowerCase()
      && performance.now() - lastVoiceSearch.at < 20000
    ) {
      const hits = execution?.hitCount ?? found.length;
      pushSpeech(
        'assistant',
        hits > 0
          ? `Search expert: "${query}" — ${hits} of ${total} documents highlighted. ${SEARCH_OUTCOME_HITS}`
          : `Search expert: "${query}" — no documents matched. Everything is dimmed; say "clear search" to restore.`,
      );
      lastVoiceSearch.term = '';
    }
    this.drawPanel({
      status: `${execution?.hitCount ?? found.length} of ${total} records match "${query}"`,
      title: found.length ? 'Matching records stay bright' : 'No records matched',
      sections: [
        {
          label: 'Hits (in step-through order)',
          lines: found.length
            ? wrap(this.session.hitList().join('  ->  '), 48)
            : ['Every node is dimmed: nothing matched.'],
        },
        {
          label: 'Retrieval trace (reproducible)',
          lines: [
            this.corpusLabel(),
            `Operation: ${execution?.operation ?? 'keyword-substring'} - literal text match`,
            `Executed query: "${execution?.executedQuery ?? query}"`,
            `Complete matches: ${execution?.hitCount ?? found.length} of ${total}; returned: ${execution?.returnedCount ?? found.length}${execution?.truncated ? ' (TRUNCATED - raise limit)' : ' (exhaustive, no truncation)'}`,
            focusSummary(Math.min(this.focusIds.length, Math.max(found.length, 1)), total),
            'Detail orbs are updated for these hits; all hits inspectable via Next Hit.',
            `Execution ${execution?.id ?? 'n/a'} at ${execution?.at ?? ''}`,
          ],
        },
        {
          label: 'Scope',
          lines: [this.scopeLine()],
        },
        {
          label: 'Next step',
          lines: found.length
            ? [
                'Tap a bright node, or use Next Hit / Prev Hit.',
                'Each Next Hit OPENS that record on this panel',
                'and brings it into the node window - every hit',
                'is openable, not only the first 8.',
                'Tip: search a document ID (e.g. bg-075) to',
                'jump straight to that record.',
              ]
            : ['Try another keyword, or Clear Search.'],
        },
      ],
    });
  }

  private definedDraftForLead(lead: DiscoveryLead | undefined): FindingDraft | undefined {
    return lead?.demoStep ? this.definedDraftsByStep.get(lead.demoStep) : undefined;
  }

  private demoLeadAlreadyDrafted(lead: DiscoveryLead | undefined): boolean {
    if (!lead?.demoStep) return false;
    return this.draftedDemoSteps.has(lead.demoStep)
      || this.state.listFindings().some((f) => f.demoStep === lead.demoStep);
  }

  private demoNextStepLines(lead: DiscoveryLead): string[] {
    const step = lead.demoStep ?? 0;
    const next = step < 3 ? `Explore Lead ${step + 1}` : 'open Export';
    return [
      ...(this.demoLeadAlreadyDrafted(lead)
        ? ['THIS LEAD IS ALREADY DRAFTED: decide it in Export,']
        : ['APPROVE THIS FINDING: tap Prepare Draft Finding,']),
      'then Approve Draft Finding in Export. That is the fastest path.',
      'ASK AI A FOLLOW-UP: type or say "ask ..." — try:',
      ...(lead.followUpQuestions ?? []).map((q) => `• ${q}`),
      `MOVE ON WITHOUT DRAFTING: ${next}. Nothing from this`,
      'lead is queued unless you Prepare Draft Finding.',
    ].flatMap((l) => wrap(l, 62));
  }

  private queueFindingDraft(
    draft: FindingDraft,
    question: string,
    runLabel: string,
    runId?: number,
  ): string {
    const finding = this.state.addFinding({
      claim: draft.claim,
      citationIds: draft.citationIds,
      runId,
      question,
      groundedBy: draft.groundedBy ?? 'quote',
      title: draft.title,
      citations: draft.citations,
      counterCitations: draft.counterCitations,
      gaps: draft.gaps,
      verdict: draft.verdict,
      leadId: draft.leadId,
      demoStep: draft.demoStep,
      sourceLabel: draft.sourceLabel ?? runLabel,
    });
    const entry = { draft, findingId: finding.id, runLabel };
    this.pendingFindings.push(entry);
    this.draftsByFindingId.set(finding.id, entry);
    this.displayedFindingId = finding.id;
    if (draft.demoStep) this.draftedDemoSteps.add(draft.demoStep);
    return finding.id;
  }

  private queueDefinedDemoDraft(lead: DiscoveryLead, reason: string): boolean {
    const draft = this.definedDraftForLead(lead);
    if (!draft || !lead.demoStep || this.demoLeadAlreadyDrafted(lead)) return false;
    this.queueFindingDraft(
      draft,
      lead.suggestedAction.question,
      `defined Lead ${lead.demoStep} specialist draft`,
    );
    this.stagedLeadQuestion = '';
    this.activeLead = undefined;
    this.activeLeadIndex = -1;
    this.candidates = undefined;
    diag('demo-defined-draft-fallback', { step: lead.demoStep, reason: reason.slice(0, 120) });
    this.drawPendingFinding(`Defined Lead ${lead.demoStep} draft queued — ${reason}`);
    return true;
  }

  // --- M4 Discover (Phase A: deterministic leads, no model call) ----

  private handleDiscover(action: DiscoverAction, index: number): void {
    if (action === 'ask') {
      this.requestDraftFromContext('Prepare Draft Finding');
      return;
    }
    if (action === 'leads') {
      this.state.setMode('explore');
      const demoLeads = this.corpusMode === 'tradesecret' ? buildDemoLeads(this.store) : [];
      if (demoLeads.length === 3) {
        // The defined finding for each lead comes from the actual
        // multi-specialist pipeline over this store, QC included.
        // It is cached here; Prepare still gives the live model
        // first attempt and uses this draft only as fallback.
        this.demoAssessment = runReyesInvestigation(this.store);
        this.definedDraftsByStep = new Map(
          (this.demoAssessment.workProduct?.draftFindings ?? [])
            .filter((d) => d.demoStep != null)
            .map((d) => [d.demoStep as number, d]),
        );
        this.lastLeads = demoLeads;
      } else {
        this.demoAssessment = undefined;
        this.definedDraftsByStep.clear();
        this.lastLeads = discoverLeads(this.store);
      }
      if (this.lastLeads.length === 0) {
        this.drawPanel({
          status: 'No lead clears the bar in this corpus',
          title: 'Discover abstains (honest no-signal)',
          sections: [
            {
              label: 'Why',
              lines: [
                'Computed signals (bridges, anomalies, clusters,',
                'channels, concentration) are all below threshold.',
                'Discover never manufactures leads to fill a quota.',
              ],
            },
            { label: 'Next step', lines: ['Investigate tab: run your own keyword search.'] },
          ],
        });
        return;
      }
      const sequenced = this.lastLeads.some((l) => l.demoStep != null);
      this.drawPanel({
        status: sequenced
          ? 'Investigation leads ready: follow the evidence from acquisition to the smoking gun'
          : `I found ${this.lastLeads.length} thing(s) worth investigating`,
        title: sequenced
          ? 'Did Reyes deliver NovaChip\'s Falcon source code to a competitor?'
          : 'Collection-level priorities - deterministic features (no model call)',
        sections: [
          ...this.lastLeads.map((lead, i) => ({
            label: lead.demoStep
              ? `Lead ${i + 1}`
              : `Lead ${i + 1} - ${lead.kind} (${lead.priority.split('_').join(' ')})`,
            lines: [
              ...wrap(lead.summary, 48),
              ...lead.whyPrioritized.slice(0, 2).flatMap((w) => wrap(`Why: ${w}`, 48)),
              ...(lead.definedFinding ? wrap(`Defined finding: ${lead.definedFinding}`, 48) : []),
              ...(lead.searchSuggestions?.length ? [`Try searches: ${lead.searchSuggestions.join(' · ')}`] : []),
              `Explore: Discover tab -> Explore Lead ${i + 1}`,
            ],
          })),
          {
            label: 'Scope',
            lines: [
              this.scopeLine(),
              'Discover analyzes the ENTIRE active corpus;',
              'an Investigate search filter does not limit it.',
              ...(sequenced ? ['Each lead opens in a different lens and ends in a defined, approvable draft finding. Follow-ups are optional.'] : []),
            ],
          },
        ],
      });
      return;
    }
    // explore
    // Lead buttons (owner, 2026-11-02): the card said "2
    // things" while 3 Explore buttons sat on the menu. The
    // engine can return FEWER than 3 when signals are thin —
    // the buttons are positional (Explore Lead N = Nth lead),
    // so a missing lead is a clear "not ready" card, never a
    // stale press on an older lead.
    const lead = this.lastLeads[index];
    if (!lead) {
      this.drawPanel({
        status: index < this.lastLeads.length
          ? 'Run Find Leads first'
          : `Only ${this.lastLeads.length} lead(s) found — Lead ${index + 1} does not exist`,
        title: `Lead ${index + 1} is not ready`,
        sections: [{ lines: ['Discover tab: Find Leads, then Explore Lead 1-3.'] }],
      });
      return;
    }
    // Reorganize around the lead's evidence neighborhood (cited
    // records + corpus-wide relationships + chronology context),
    // not just the cited set — the spatial story is the point.
    const focus = expandFocusForLead(this.store, lead);
    this.focusIds = focus;
    this.lens = lead.suggestedAction.lens;
    viewRequest.lens = this.lens;
    if (this.lens !== 'evidence') this.state.setMode('explore');
    // Lead-grounded drafting (Round 3): staged question carries
    // the lead's supporting records so Prepare Draft Finding
    // investigates THIS lead — or reports insufficient evidence.
    this.activeLead = lead;
    this.activeLeadIndex = index;
    this.candidates = undefined;
    this.stagedLeadQuestion = this.demoLeadAlreadyDrafted(lead)
      ? ''
      : `${lead.suggestedAction.question} Focus on these supporting records: ${lead.supportingRecordIds.join(', ')}. If they do not support a finding, say so.`;
    this.state.addLead({
      title: lead.summary,
      source: 'agent',
      recordIds: lead.supportingRecordIds,
      rationale: `Discover (${lead.modelRoute}): ${lead.whyPrioritized.join('; ')}`,
    });
    this.rebindSlots();
    this.applyLens(false);
    this.drawPanel({
      status: lead.demoStep
        ? `Exploring lead ${index + 1}`
        : `Exploring lead ${index + 1}: ${lead.kind}`,
      title: lead.summary,
      sections: [
        { label: 'Why prioritized', lines: lead.whyPrioritized.flatMap((w) => wrap(w, 62)) },
        ...(lead.definedFinding ? [{
          label: 'Defined finding to test (specialist-checked)',
          lines: [
            ...wrap(this.definedDraftForLead(lead)?.claim ?? lead.definedFinding, 62),
            'Prepare Draft Finding asks the live model to test this on the shown evidence; the specialist draft is the fallback if the live draft cannot be quote-verified.',
          ],
        }] : []),
        ...(lead.searchSuggestions?.length ? [{
          label: 'Interesting searches from this perspective',
          lines: lead.searchSuggestions.map((s) => `Search: ${s}`),
        }] : []),
        { label: 'Limitations', lines: lead.limitations.flatMap((w) => wrap(w, 62)) },
        {
          label: 'Next Steps',
          lines: lead.demoStep ? this.demoNextStepLines(lead) : [
            'Tap nodes to read this lead\'s sources.',
            'Or tap Prepare Draft Finding to run the AI on',
            'this lead\'s question:',
            ...wrap(`"${lead.suggestedAction.question}"`, 62),
            'Drafts wait in the Export tab for your decision.',
          ],
        },
      ],
    });
  }

  // --- Revised M3: corpus switching, focus slots, edges, lenses ------

  /**
   * ONE drafting door (owner, 2026-11-02): the menu button, the
   * typed draft request, and voice "prepare draft finding" all
   * land here. No lead gate, no "choose a lead" dead end: an
   * answer, an explored lead, a decision queue, or any
   * selected / highlighted record is enough to draft. Only
   * true nothing-to-draft explains what to do instead.
   */
  private requestDraftFromContext(invokedAs: string): void {
    // A decision queue is itself the thing to decide.
    if (this.pendingFindings.length) {
      this.drawPendingFinding();
      return;
    }
    // Sequenced leads: after optional follow-ups, Prepare still means
    // the lead's DEFINED finding, not whichever follow-up answer
    // happened to be staged last.
    if (this.activeLead?.demoStep && this.stagedLeadQuestion && !this.agentBusy) {
      void this.runAgent(this.stagedLeadQuestion, true);
      return;
    }
    // A staged answer drafts directly.
    if (this.candidates?.drafts.length) {
      this.queueCandidates();
      return;
    }
    // A running investigation will leave candidates; say so
    // instead of erroring, so the next press drafts them.
    if (this.agentBusy) {
      this.drawPanel({
        status: 'AI is still working on your question',
        title: 'Press Prepare Draft Finding again when it answers',
        sections: [{ lines: ['The run will leave its answer as staged candidates — the next press drafts them for the Export tab.'] }],
      });
      return;
    }
    // An explored lead runs its own question as a draft run.
    if (this.stagedLeadQuestion) {
      void this.runAgent(this.stagedLeadQuestion, true);
      return;
    }
    // Any investigator finding grounds a draft run.
    if (this.selectedId || this.hits.size > 0) {
      const anchor = this.selectedId
        ? `Draft a finding grounded in record ${this.selectedId}.`
        : `Draft a finding grounded in these highlighted records: ${[...this.hits].slice(0, 12).join(', ')}.`;
      void this.runAgent(anchor, true);
      return;
    }
    // True dead end: say what to do, never "choose a lead".
    diag('draft-no-context', { invokedAs });
    this.drawPanel({
      status: 'Nothing to draft yet',
      title: 'Ask a question or explore a lead first',
      sections: [{ lines: [`Investigate: ask anything ("ask who emailed Reyes"), explore a lead, or select / highlight records — then ${invokedAs}.`] }],
    });
  }

  private switchCorpus(mode: CorpusMode): void {
    this.corpusMode = mode;
    this.lastLeads = [];
    this.stagedLeadQuestion = '';
    this.activeLead = undefined;
    this.activeLeadIndex = -1;
    this.demoAssessment = undefined;
    this.definedDraftsByStep.clear();
    this.searched = false;
    this.hits.clear();
    this.selectedId = undefined;
    this.session.clearSearch();
    {
      const loaded = mode === 'tradesecret'
        ? (this.tradeSecretCache ??= loadTradeSecretCorpus())
        : mode === 'galaxy'
          ? (this.galaxyCache = this.galaxyCaches.get(this.galaxyCount)
            ?? (() => {
              const fresh = loadGalaxyCorpus(this.galaxyCount);
              this.galaxyCaches.set(this.galaxyCount, fresh);
              return fresh;
            })())
          : (this.expandedCache ??= loadExpandedCorpus());
      this.peopleNames = new Map(loaded.corpus.people.map((p) => [p.id, p.displayName]));
      this.custodianNames = new Map(loaded.corpus.custodians.map((c) => [c.id, c.displayName]));
      this.orgNames = new Map(loaded.corpus.organizations.map((o) => [o.id, o.displayName]));
      this.store = loaded.store;
      this.adapter = loaded.adapter;
      this.session = new SearchSession(this.adapter, this.state, {
        id: loaded.corpusId,
        version: loaded.corpusVersion,
      });
      this.focusIds = loaded.corpus.groundTruth.relevantRecordIds.slice(0, 8);
      this.rebindSlots();
      this.buildGalaxy();
      this.drawPanel({
        status: `${mode === 'tradesecret' ? 'Trade Secret' : mode === 'galaxy' ? 'Galaxy' : 'Expanded'} corpus: all ${this.store.size} records surround you`,
        title: 'Every record is a node in the 360-degree universe',
        sections: [
          {
            label: 'How to read the universe',
            lines: [
              'Direction around you = organization territory.',
              'Distance = stored date: EARLIEST nearest the',
              'platform, LATEST farthest (same in every lens).',
              'Color = producing organization (see COLOR KEY).',
              'Bright + large = search hit.',
              'Point at any node and select to open its source.',
            ],
          },
          {
            label: 'Color key (what node color means)',
            lines: this.colorKeyLines(),
          },
          {
            label: 'Try',
            lines: mode === 'tradesecret'
              ? ['Say: "Search for source code" . "Falcon" . "USB" . "Reyes"', 'Or press X and ask the AI a question.']
              : ['Search: March  .  Priya  .  invoice', 'Then Universe tab: Network or Chronology lens.'],
          },
        ],
      });
    }
    this.applyLens();
  }

  private rebindSlots(): void {
    this.nodeByObject.clear();
    this.slotObjects.forEach((object, i) => {
      const recordId = this.focusIds[i];
      object.visible = recordId != null;
      if (recordId) this.nodeByObject.set(object, recordId);
    });
    this.rebuildEdges();
    this.refreshNodeStyling();
  }

  private rebuildEdges(): void {
    const focus = this.focusIds
      .map((id) => this.store.getRecord(id))
      .filter((r) => r != null);
    const focusSet = new Set(focus.map((r) => r.id));
    const pairs = new Set<string>();
    const add = (a: string, b: string) => {
      if (a !== b && focusSet.has(a) && focusSet.has(b)) {
        pairs.add([a, b].sort().join('|'));
      }
    };
    // Record-to-record edges: shared participant (observed), or a
    // reply link (observed). Lines are NOT directly selectable;
    // relationships are inspected via either endpoint's source card
    // (Relationships section) - disclosed on the panel.
    for (let i = 0; i < focus.length; i += 1) {
      for (let j = i + 1; j < focus.length; j += 1) {
        if (focus[i].personIds.some((p) => focus[j].personIds.includes(p))) {
          add(focus[i].id, focus[j].id);
        }
      }
    }
    for (const record of focus) {
      if (record.links?.inReplyToId) add(record.id, record.links.inReplyToId);
    }
    this.edgePairs = [...pairs].map((p) => p.split('|') as [string, string]);
    if (this.edgeLines) {
      this.edgeLines.visible = this.corpusMode === 'expanded' && this.edgePairs.length > 0;
    }
  }

  private applyLens(announce = false): void {
    this.layoutTargets.clear();
    const slotByRecord = new Map<string, Object3D>();
    this.slotObjects.forEach((object, i) => {
      const id = this.focusIds[i];
      if (id) slotByRecord.set(id, object);
    });
    this.clusterCenters = [];
    this.chronologyEnds = undefined;
    if (this.lens === 'chronology') {
      const ordered = chronologyOrder(
        this.focusIds.map((id) => this.store.getRecord(id)).filter((r) => r != null),
      );
      const byX = [...this.homePositions].sort((a, b) => a.x - b.x);
      ordered.forEach((record, rank) => {
        const object = slotByRecord.get(record.id);
        if (object && byX[rank]) this.layoutTargets.set(object, byX[rank].clone());
      });
      if (byX.length > 0) {
        this.chronologyEnds = {
          first: byX[0].clone(),
          last: byX[byX.length - 1].clone(),
        };
      }
    } else if (this.lens === 'network') {
      // Cluster slots by the sender/author organization: four
      // territories along the arc, members fanned inside their own.
      const groups = new Map<string, Object3D[]>();
      for (const [recordId, object] of slotByRecord) {
        const record = this.store.getRecord(recordId);
        const org = record?.organizationIds?.[0] ?? record?.custodianId ?? 'unknown';
        if (!groups.has(org)) groups.set(org, []);
        groups.get(org)?.push(object);
      }
      const centers = [...groups.keys()];
      centers.forEach((org, gi) => {
        const members = groups.get(org) ?? [];
        const center = this.homePositions[
          Math.min(this.homePositions.length - 1, Math.floor(((gi + 0.5) / centers.length) * this.homePositions.length))
        ];
        if (center) {
          this.clusterCenters.push({ org, center: center.clone(), count: members.length });
        }
        members.forEach((object, mi) => {
          const offset = new Vector3((mi % 3 - 1) * 0.3, Math.floor(mi / 3) * 0.3, (mi % 2) * 0.14);
          if (center) this.layoutTargets.set(object, center.clone().add(offset));
        });
      });
    } else {
      this.slotObjects.forEach((object, i) => {
        if (this.homePositions[i]) this.layoutTargets.set(object, this.homePositions[i].clone());
      });
    }
    this.layoutAnimating = this.layoutTargets.size > 0;
    this.rebuildLabels();
    this.retargetGalaxy();
    if (announce && this.lens === 'chronology') {
      const ordered = chronologyOrder(
        this.focusIds.map((id) => this.store.getRecord(id)).filter((r) => r != null),
      );
      const anomalies = new Map(chronologyAnomalies(this.store).map((a) => [a.recordId, a]));
      this.drawPanel({
        status: 'CHRONOLOGY LENS - spiral from center (oldest) outward (latest)',
        title: 'Stored-date order of the records in space',
        sections: [
          { label: 'Scope', lines: [this.scopeLine()] },
          { label: 'Dates in this corpus (actual)', lines: this.corpusDateAnchors() },
          {
            label: 'Timeline (same order as the nodes)',
            lines: ordered.map((r) => {
              const anomaly = anomalies.get(r.id);
              return `${r.date}  ${r.id}${anomaly ? `  !! ${anomaly.kind}` : ''} (${r.dateConfidence})`;
            }),
          },
          {
            label: 'How to read it',
            lines: [
              'DIRECTION: start at the CENTER (EARLIEST date),',
              'follow the spiral clockwise and OUTWARD to the',
              'LATEST date. Both spiral ends are labelled in',
              'space: EARLIEST at the center, LATEST outside.',
              `EARLIEST: ${[...this.galaxyInputs].sort((a, b) => a.date.localeCompare(b.date))[0]?.date.slice(0, 10) ?? '?'}  ->  LATEST: ${[...this.galaxyInputs].sort((a, b) => b.date.localeCompare(a.date))[0]?.date.slice(0, 10) ?? '?'}`,
              'Each node carries its date label in space;',
              '!! marks a suspect date. Suspect dates keep',
              'their stored place - a record sitting absurdly',
              'early is itself evidence.',
              'Tap any node for its full source + provenance.',
            ],
          },
        ],
      });
    } else if (announce && this.lens === 'concepts') {
      const counts = new Map<string, number>();
      for (const i of this.galaxyInputs) counts.set(i.concept, (counts.get(i.concept) ?? 0) + 1);
      const small = [...counts.entries()].filter(([, n]) => n < 5).map(([c]) => c);
      const computed = this.conceptMode === 'computed';
      this.drawPanel({
        status: computed
          ? 'CONCEPT CLUSTERS LENS - COMPUTED (TF-IDF + cosine)'
          : 'CONCEPT CLUSTERS LENS - AUTHORED concept tags',
        title: 'What the collection is about, spatially',
        sections: [
          { label: 'Scope', lines: [this.scopeLine()] },
          {
            label: computed ? 'Computed clusters (shared vocabulary)' : 'Concepts in this corpus (actual counts)',
            lines: [...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([c, n]) => `${c || '(untagged)'}: ${n}`),
          },
          {
            label: 'How to read it',
            lines: [
              'Direction = concept cluster; distance = date',
              '(EARLIEST nearest, LATEST farthest); height',
              'separates concepts; color = organization.',
              ...(computed
                ? ['COMPUTED: TF-IDF + cosine single-linkage over',
                  'extracted text (no model, no credit, fully',
                  'offline — artifact + purity report committed).',
                  'Labels are top shared terms, not attorney',
                  'theory: verify before citing.']
                : ['HONEST SCOPE: clusters are the corpus authored',
                  'concept tags, not learned embeddings (method',
                  'section below).']),
              ...(small.length
                ? [`Thin clusters (<5 records: ${small.slice(0, 4).join(', ')}) are`,
                  'single-theory tags, not emergent groups —',
                  'treat them as flags to inspect, not findings.']
                : []),
            ],
          },
          ...(!computed ? [{
            label: 'Method (how these clusters were made)',
            lines: [
              'Each record carries 1 authored concept tag from',
              'the synthetic corpus builder (seeded topic list,',
              'not text similarity). Real clustering (Reveal /',
              'Relativity style) embeds document text, then',
              'groups by semantic similarity — planned for an',
              'imported collection; not what you see here.',
              'Tap "Computed clusters" (Explore tab) or say',
              '"computed concepts" for the machine overlay.',
            ],
          }] : [{
            label: 'Switch back',
            lines: [
              'Tap "Authored tags" (Explore tab) or say',
              '"authored concepts" to return to theory tags.',
            ],
          }]),
          { label: 'Color key (what node color means)', lines: this.colorKeyLines() },
        ],
      });
    } else if (announce && this.lens === 'custodians') {
      const counts = new Map<string, number>();
      for (const i of this.galaxyInputs) counts.set(i.custodian, (counts.get(i.custodian) ?? 0) + 1);
      this.drawPanel({
        status: 'CUSTODIANS LENS - grouped by record custodian',
        title: 'Whose files are these, spatially',
        sections: [
          { label: 'Scope', lines: [this.scopeLine()] },
          {
            label: 'Custodians in this corpus (actual counts)',
            lines: [...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([c, n]) => `${this.custodianNames.get(c) ?? c}: ${n}`),
          },
          {
            label: 'How to read it',
            lines: [
              'Direction = custodian (actual collection',
              'metadata); distance = date (EARLIEST nearest,',
              'LATEST farthest); color = organization;',
              'height separates organizations. Tap any',
              'node for source. Custodian = the person in',
              'custody (SEC CUSTODIAN), never a department.',
            ],
          },
          { label: 'Color key (what node color means)', lines: this.colorKeyLines() },
        ],
      });
    } else if (announce && this.lens === 'filetypes') {
      const counts = new Map<string, number>();
      for (const i of this.galaxyInputs) counts.set(i.fileType ?? 'unknown/other', (counts.get(i.fileType ?? 'unknown/other') ?? 0) + 1);
      const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      // Legal-memo card (owner template, 2026-11-02): centered
      // bold title, bold executive summary, numbered SCOPE then
      // FILE TYPES with a/b/c lettered items. Scope/state lines
      // live at the bottom, never above the summary.
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      this.drawPanel({
        status: `${this.store.size} records in corpus - ${ordered.length} file types`,
        title: 'File Type Lens',
        sections: [
          {
            label: '# File Type Lens',
            lines: [
              '## EXECUTIVE SUMMARY',
              ...wrap('**This is the File Type Lens. This lens groups the data by file extension or MIME type based on the SEC standard delivery rules. This shows what formats the collection holds.**', 48),
              '',
            ],
          },
          {
            numbered: '1.',
            label: 'Scope (what you are looking at)',
            lines: [this.scopeLine()],
          },
          {
            numbered: '2.',
            label: 'File types (actual)',
            lines: ordered.flatMap(([t, n], i) => [
              `${letters[i] ?? 'z'}.  ${t} — ${n} record(s)`,
            ]),
          },
          { label: 'Color key (what node color means)', lines: this.colorKeyLines() },
        ],
      });
    } else if (announce && this.lens === 'network') {
      this.drawPanel({
        status: 'NETWORK LENS - grouped by organization',
        title: 'Gold lines = shared person or reply link (observed)',
        sections: [
          { label: 'Scope', lines: [this.scopeLine()] },
          {
            label: 'Galaxy legend (actual corpus)',
            lines: [
              ...this.galaxyLegendLines(),
              'Galaxy grouping: each record sits toward the',
              "organizations of its participants; bridges",
              'sit between territories, fanned by sender.',
              ...this.networkLegendLines(),
            ],
          },
          {
            label: 'How to read it',
            lines: [
              'Clusters are labeled by author organization.',
              'A line means the two records share a person or',
              'one replies to the other. Lines are not tappable:',
              'tap either endpoint node and read Relationships.',
              'A node with no line may still link to records',
              'elsewhere in the universe - its Relationships',
              'list is corpus-wide. Isolation here is a prompt',
              'to inspect, not proof.',
              this.corpusLabel(),
            ],
          },
        ],
      });
    } else if (announce && this.lens === 'evidence') {
      this.drawPanel({
        status: 'EVIDENCE LENS - grouped by producing organization',
        title: 'The collection as organization territories',
        sections: [
          { label: 'Scope', lines: [this.scopeLine()] },
          {
            label: 'What this view shows',
            lines: [
              'Direction = organization territory (who',
              'produced the record). Inside each territory,',
              'records sub-group by concept; height bands',
              'separate custodians and record kinds.',
              'Distance = date (EARLIEST nearest, LATEST',
              'farthest); color = organization.',
            ],
          },
          { label: 'Color key (what node color means)', lines: this.colorKeyLines() },
        ],
      });
    }
  }

  /**
   * Rebuild all spatial labels for the current focus set + lens.
   * Node labels ride on the slot objects (grab-moves carry them);
   * organization cluster labels and chronology direction labels are
   * scene-level. Text rules are pure helpers in visual-state.ts.
   */
  private nodeLabelTexts = new Map<Object3D, string>();

  private rebuildLabels(): void {
    // Cache by text: unchanged labels keep their canvas/texture.
    // Recreating every sprite canvas on each lens/search change
    // churned GPU textures inside already-heavy frames.
    for (const sprite of this.sceneLabels) this.disposeSprite(sprite);
    this.sceneLabels = [];
    const anomalies = new Set(chronologyAnomalies(this.store).map((a) => a.recordId));
    const seen = new Set<Object3D>();
    this.slotObjects.forEach((object, i) => {
      const recordId = this.focusIds[i];
      if (!recordId) return;
      const record = this.store.getRecord(recordId);
      if (!record) return;
      const flagged = anomalies.has(recordId);
      const text = nodeLabelText(record, this.lens, flagged);
      seen.add(object);
      const existing = this.nodeLabels.get(object);
      if (existing && this.nodeLabelTexts.get(object) === text) return;
      if (existing) this.disposeSprite(existing);
      const sprite = this.makeLabelSprite(
        text,
        0.115,
        this.lens === 'chronology' && flagged,
      );
      sprite.position.set(0, 0.34, 0);
      sprite.name = `label-${recordId}`;
      object.add(sprite);
      this.nodeLabels.set(object, sprite);
      this.nodeLabelTexts.set(object, text);
    });
    for (const [object, sprite] of this.nodeLabels) {
      if (!seen.has(object)) {
        this.disposeSprite(sprite);
        this.nodeLabels.delete(object);
        this.nodeLabelTexts.delete(object);
      }
    }
    if (this.lens === 'network') {
      for (const { org, center, count } of this.clusterCenters) {
        const display =
          this.orgNames.get(org) ?? this.custodianNames.get(org) ?? custodianById.get(org) ?? org;
        const sprite = this.makeLabelSprite(clusterLabelText(display, count), 0.21, true);
        sprite.position.copy(center).add(new Vector3(0, 0.98, 0));
        sprite.name = `cluster-${org}`;
        this.scene.add(sprite);
        this.sceneLabels.push(sprite);
      }
    }
    // Earliest/Latest directional sprites removed 2026-10-30
    // (owner: they contradicted the spatial spiral reading).
    // Date quartile anchors in the galaxy remain as metadata.
  }

  private makeLabelSprite(text: string, heightM: number, accent = false, textColor?: string): Sprite {
    const font = '600 52px sans-serif';
    const probe = document.createElement('canvas').getContext('2d');
    if (probe) probe.font = font;
    const textW = Math.ceil(probe?.measureText(text).width ?? text.length * 30);
    const canvas = document.createElement('canvas');
    canvas.width = textW + 48;
    canvas.height = 92;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(10, 13, 18, 0.84)';
      ctx.strokeStyle = textColor ?? (accent ? '#e8c56a' : 'rgba(232, 197, 106, 0.45)');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(3, 3, canvas.width - 6, canvas.height - 6, 22);
      ctx.fill();
      ctx.stroke();
      ctx.font = font;
      ctx.fillStyle = textColor ?? (accent ? '#f5d90a' : '#f2f4f8');
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 24, canvas.height / 2 + 2);
    }
    const texture = new CanvasTexture(canvas);
    texture.anisotropy = 4;
    const sprite = new Sprite(
      new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    // P0 (2026-10-29): three's Sprite.raycast THROWS when the
    // raycaster has no camera set — exactly how XR hand/controller
    // raycasters run every immersive frame. Label sprites (children
    // of RayInteractable nodes + scene-level) therefore killed the
    // XR frame loop on entry: brief scene, then black, system UI
    // unaffected; 2D unaffected (pointer path sets a camera).
    // Labels are visual only — never raycast them.
    sprite.raycast = () => {};
    sprite.scale.set(heightM * (canvas.width / canvas.height), heightM, 1);
    return sprite;
  }

  private disposeSprite(sprite: Sprite): void {
    sprite.material.map?.dispose();
    sprite.material.dispose();
    sprite.removeFromParent();
  }

  // --- Galaxy field: every record represented, one draw call ------

  private buildGalaxy(): void {
    if (this.galaxyMesh) {
      this.scene.remove(this.galaxyMesh);
      this.galaxyMesh.geometry.dispose();
      (this.galaxyMesh.material as MeshBasicMaterial).dispose();
      this.galaxyMesh = undefined;
    }
    // Computed-cluster overlay (option C): recordId -> cluster
    // label from the committed artifact. Unknown ids (other
    // corpora) fall back to authored tags.
    this.computedConcepts.clear();
    try {
      const artifact = TFIDF_CLUSTERS as unknown as {
        clusters: { id: string; label: string; recordIds: string[] }[];
      };
      for (const cluster of artifact?.clusters ?? []) {
        for (const id of cluster.recordIds ?? []) {
          this.computedConcepts.set(id, { clusterId: cluster.id, label: cluster.label });
        }
      }
    } catch { /* authored fallback */ }
    const records = this.store.allIds()
      .map((id) => this.store.getRecord(id))
      .filter((r) => r != null);
    const personOrgs = personOrganizations(records);
    this.galaxyInputs = records.map((r) => {
      // fileTypeCategory is defined below as a static helper.
      const authored = r.conceptTags?.[0] ?? '';
      const computed = this.computedConcepts.get(r.id);
      // Concepts lens reads input.concept: authored tags or the
      // computed overlay, per conceptMode. Both stay inspectable
      // on the source card (theory vs machine, never merged).
      const concept = this.conceptMode === 'computed' && computed
        ? `${computed.label}`
        : authored;
      return {
      id: r.id,
      date: r.date,
      org: r.organizationIds?.[0] ?? r.custodianId,
      concept,
      custodian: r.custodianId,
      kind: r.kind,
      participantOrgs: [...new Set(r.personIds.flatMap((p) => [...(personOrgs.get(p) ?? [])]))],
      sender: r.participants?.find((p) => p.role === 'sender' || p.role === 'author')?.personId,
      fileType: EvidenceSystem.fileTypeCategory(r.loadFile?.extension, r.title),
      ...(() => {
        const check = this.corpusMode === 'tradesecret' ? recordDomainCheck(r) : undefined;
        return check
          ? { senderDomain: check.senderDomain, domainOk: check.domainOk, homeOrgOk: check.homeOrgOk }
          : {};
      })(),
      };
    });
    // Network relationship cache (computed once per corpus build,
    // never per frame): genuine directed channels, person hubs,
    // record-level reply links, and each person's home organization
    // (majority org of records they sent/authored).
    this.networkChannels = directedCommunicationEdges(records);
    this.networkHubs = personHubSummaries(records);
    this.networkReplyLinks = replyLinks(records);
    this.personHomeOrg = new Map();
    {
      const tally = new Map<string, Map<string, number>>();
      for (const r of records) {
        const org = r.organizationIds?.[0] ?? r.custodianId;
        for (const p of r.participants ?? []) {
          if (p.role !== 'sender' && p.role !== 'author') continue;
          if (!tally.has(p.personId)) tally.set(p.personId, new Map());
          const m = tally.get(p.personId) as Map<string, number>;
          m.set(org, (m.get(org) ?? 0) + 1);
        }
      }
      for (const [personId, orgs] of tally) {
        this.personHomeOrg.set(personId,
          [...orgs.entries()].sort((a, b) => b[1] - a[1])[0][0]);
      }
    }
    this.galaxyIds = this.galaxyInputs.map((i) => i.id);
    const orgs = [...new Set(this.galaxyInputs.map((i) => i.org))].sort();
    this.galaxyOrgColor = new Map(
      orgs.map((org, i) => [org, new Color(GALAXY_PALETTE[i % GALAXY_PALETTE.length].hex)]),
    );
    const positions = galaxyPositions(this.galaxyInputs, this.lens);
    const n = this.galaxyInputs.length;
    this.galaxyCurrent = new Float32Array(n * 3);
    this.galaxyFrom = new Float32Array(n * 3);
    this.galaxyTo = new Float32Array(n * 3);
    this.galaxyInputs.forEach((input, i) => {
      const p = positions.get(input.id)?.position ?? [0, 0, -4];
      this.galaxyCurrent.set(p, i * 3);
      this.galaxyTo.set(p, i * 3);
    });
    const mesh = new InstancedMesh(
      new IcosahedronGeometry(0.045, 1),
      new MeshBasicMaterial({ toneMapped: false }),
      Math.max(n, 1),
    );
    mesh.name = 'evidence-galaxy';
    mesh.frustumCulled = false;
    mesh.position.set(GALAXY_CENTER[0], GALAXY_CENTER[1], GALAXY_CENTER[2]);
    this.galaxyMesh = mesh;
    this.scene.add(mesh);
    this.initGalaxyPicking();
    this.rebuildGalaxyAnchors();
    this.refreshGalaxyStates();
  }

  private galaxyAnchorKey = '';
  /** Frame number at which the deferred post-clear panel paint runs
   * (-1 = none). Frame-counted, never same-frame: the previous
   * boolean flag was consumed by the very update() that set it. */
  private pendingClearPanelAtFrame = -1;
  private breadcrumbFrame = 0;

  /** Crash breadcrumbs: last stages before a Quest browser death,
   * readable on the idle panel after reload. Writes are throttled
   * by callers to stage transitions + a 1s heartbeat. */
  private markBreadcrumb(stage: string): void {
    try {
      const prev = sessionStorage.getItem('mmdata-breadcrumbs') ?? '';
      const entries = prev ? prev.split(' > ') : [];
      entries.push(`${new Date().toISOString().slice(11, 19)} ${stage}`);
      sessionStorage.setItem('mmdata-breadcrumbs', entries.slice(-10).join(' > '));
    } catch { /* diagnostics only */ }
    // Same stages also beacon to the PC (server/diag.log) with GPU
    // resource counters, so evidence survives total tab death.
    const info = (this.renderer as unknown as {
      info?: { memory?: { geometries?: number; textures?: number }; programs?: unknown[] };
    } | undefined)?.info;
    diag(stage, {
      frame: this.breadcrumbFrame,
      lens: this.lens,
      corpus: this.corpusMode,
      records: this.galaxyIds.length,
      searched: this.searched,
      geo: info?.memory?.geometries,
      tex: info?.memory?.textures,
      programs: Array.isArray(info?.programs) ? info.programs.length : undefined,
    });
  }

  private retargetGalaxy(): void {
    if (!this.galaxyMesh || this.galaxyInputs.length === 0) return;
    const positions = galaxyPositions(this.galaxyInputs, this.lens);
    this.galaxyFrom.set(this.galaxyCurrent);
    let maxDelta = 0;
    this.galaxyInputs.forEach((input, i) => {
      const p = positions.get(input.id)?.position;
      if (p) {
        this.galaxyTo.set(p, i * 3);
        maxDelta = Math.max(maxDelta,
          Math.abs(p[0] - this.galaxyCurrent[i * 3]),
          Math.abs(p[1] - this.galaxyCurrent[i * 3 + 1]),
          Math.abs(p[2] - this.galaxyCurrent[i * 3 + 2]));
      }
    });
    // Same-lens retargets (e.g. Clear Search) must not restart a
    // full-field morph to identical positions.
    this.galaxyAnimating = maxDelta > 0.01;
    const anchorKey = `${this.lens}|${this.corpusMode}|${this.galaxyCount}`;
    if (anchorKey !== this.galaxyAnchorKey) {
      this.galaxyAnchorKey = anchorKey;
      this.rebuildGalaxyAnchors();
      this.rebuildGalaxyEdges();
    }
  }

  /** Person hub positions (Network lens): centroid of the records
   * the person SENT/authored (participation centroid as fallback),
   * raised above their cluster. Sent-centroids keep two-person
   * communities distinct — participation centroids coincide when
   * two people only ever appear on each other's records, which
   * collapsed their channel line to zero length in the audit. */
  private computeHubPositions(): void {
    this.hubPositions = new Map();
    const indexOf = new Map(this.galaxyIds.map((id, i) => [id, i]));
    const sentBy = new Map<string, string[]>();
    for (const id of this.store.allIds()) {
      const record = this.store.getRecord(id);
      for (const p of record?.participants ?? []) {
        if (p.role !== 'sender' && p.role !== 'author') continue;
        if (!sentBy.has(p.personId)) sentBy.set(p.personId, []);
        sentBy.get(p.personId)?.push(id);
      }
    }
    for (const hub of this.networkHubs) {
      const ids = sentBy.get(hub.personId)?.length ? sentBy.get(hub.personId) as string[] : hub.recordIds;
      const sum: [number, number, number] = [0, 0, 0];
      let count = 0;
      for (const id of ids) {
        const i = indexOf.get(id);
        if (i == null) continue;
        sum[0] += this.galaxyTo[i * 3];
        sum[1] += this.galaxyTo[i * 3 + 1];
        sum[2] += this.galaxyTo[i * 3 + 2];
        count += 1;
      }
      if (count > 0) {
        this.hubPositions.set(hub.personId,
          [sum[0] / count, sum[1] / count + 0.42, sum[2] / count]);
      }
    }
  }

  private channelIsCrossOrg(edge: DirectedEdge): boolean {
    const a = this.personHomeOrg.get(edge.fromPersonId);
    const b = this.personHomeOrg.get(edge.toPersonId);
    return a != null && b != null && a !== b;
  }

  /** Galaxy-scale relationship lines (Network lens only). Audited
   * 2026-10-29: this corpus has 11 people and 29 genuine directed
   * channels (7 cross-organization) — lines therefore connect
   * LABELED person hubs, never abstract record centroids (median
   * 0.23 m, invisible inside clusters). Gold = cross-organization
   * channel; pale = within-organization; white = stored reply link
   * between two actual records. Nothing is inferred. */
  private rebuildGalaxyEdges(): void {
    for (const lines of this.galaxyEdges) {
      lines.geometry.dispose();
      (lines.material as LineBasicMaterial).dispose();
      lines.removeFromParent();
    }
    this.galaxyEdges = [];
    this.galaxyEdgeBaseOpacity = [];
    const mesh = this.galaxyMesh;
    if (!mesh || this.lens !== 'network' || this.galaxyInputs.length === 0) return;
    this.computeHubPositions();
    const addLines = (positions: number[], color: number, opacity: number, name: string) => {
      if (positions.length === 0) return;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      const lines = new LineSegments(
        geometry,
        new LineBasicMaterial({ color, transparent: true, opacity }),
      );
      lines.name = name;
      lines.frustumCulled = false;
      mesh.add(lines);
      this.galaxyEdges.push(lines);
      this.galaxyEdgeBaseOpacity.push(opacity);
    };
    const within: number[] = [];
    const cross: number[] = [];
    for (const edge of this.networkChannels) {
      const a = this.hubPositions.get(edge.fromPersonId);
      const b = this.hubPositions.get(edge.toPersonId);
      if (a && b) (this.channelIsCrossOrg(edge) ? cross : within).push(...a, ...b);
    }
    addLines(within, 0x8fa3c8, 0.45, 'galaxy-edges-within-org');
    addLines(cross, 0xe8c56a, 0.95, 'galaxy-edges-cross-org');
    const indexOf = new Map(this.galaxyIds.map((id, i) => [id, i]));
    const replies: number[] = [];
    for (const link of this.networkReplyLinks) {
      const ia = indexOf.get(link.fromRecordId);
      const ib = indexOf.get(link.toRecordId);
      if (ia == null || ib == null) continue;
      replies.push(
        this.galaxyTo[ia * 3], this.galaxyTo[ia * 3 + 1], this.galaxyTo[ia * 3 + 2],
        this.galaxyTo[ib * 3], this.galaxyTo[ib * 3 + 1], this.galaxyTo[ib * 3 + 2],
      );
    }
    addLines(replies, 0xffffff, 0.9, 'galaxy-edges-replies');
    this.rebuildSelectionEdges();
  }

  /** Selected record's immediate Network connections: lines from
   * the record to its sender and recipient hubs, base channels
   * dimmed while a selection is active. Cheap (few lines, no
   * textures) so Clear Search may call it too. */
  private rebuildSelectionEdges(): void {
    if (this.selectionEdges) {
      this.selectionEdges.geometry.dispose();
      (this.selectionEdges.material as LineBasicMaterial).dispose();
      this.selectionEdges.removeFromParent();
      this.selectionEdges = undefined;
    }
    const dim = this.lens === 'network' && this.selectedId != null;
    this.galaxyEdges.forEach((lines, i) => {
      (lines.material as LineBasicMaterial).opacity =
        this.galaxyEdgeBaseOpacity[i] * (dim ? 0.35 : 1);
    });
    const mesh = this.galaxyMesh;
    if (!mesh || !dim || !this.selectedId) return;
    const record = this.store.getRecord(this.selectedId);
    const idx = this.galaxyIds.indexOf(this.selectedId);
    if (!record || idx < 0) return;
    const from: [number, number, number] = [
      this.galaxyCurrent[idx * 3], this.galaxyCurrent[idx * 3 + 1], this.galaxyCurrent[idx * 3 + 2]];
    const positions: number[] = [];
    const people = new Set((record.participants ?? [])
      .filter((p) => p.role === 'sender' || p.role === 'author'
        || p.role === 'recipient' || p.role === 'cc')
      .map((p) => p.personId));
    for (const personId of people) {
      const hub = this.hubPositions.get(personId);
      if (hub) positions.push(...from, ...hub);
    }
    if (positions.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 1 }),
    );
    lines.name = 'galaxy-edges-selected';
    lines.frustumCulled = false;
    mesh.add(lines);
    this.selectionEdges = lines;
  }

  /** In-space legend anchors: organization territories (evidence/
   * network) or actual quartile dates (chronology). Children of the
   * galaxy mesh so MR room-scaling applies to them too. */
  private rebuildGalaxyAnchors(): void {
    for (const sprite of this.galaxyAnchors) this.disposeSprite(sprite);
    this.galaxyAnchors = [];
    this.buildColorKey();
    const mesh = this.galaxyMesh;
    if (!mesh || this.galaxyInputs.length === 0) return;
    const addAnchor = (text: string, position: [number, number, number], size = 0.26) => {
      const sprite = this.makeLabelSprite(text, size, true);
      // Cluster labels ride clearly ABOVE their node clouds,
      // staggered by label so neighbors (e.g. Word/Email) do
      // not sit on top of each other (owner, 2026-11-01).
      const stagger = ([...text].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 3) * 0.24;
      sprite.position.set(position[0], position[1] + 0.62 + stagger, position[2]);
      mesh.add(sprite);
      this.galaxyAnchors.push(sprite);
    };
    if (this.lens === 'concepts') {
      for (const anchor of conceptAnchors(this.galaxyInputs)) {
        addAnchor(`${anchor.concept} · ${anchor.count}`, anchor.position);
      }
    } else if (this.lens === 'custodians') {
      // Custodian sectors get FIRST + LAST name labels (owner,
      // 2026-11-01) — "Reyes, Elena" reads as "Elena Reyes".
      for (const anchor of custodianAnchors(this.galaxyInputs)) {
        const display = this.custodianFirstLast(
          this.custodianNames.get(anchor.custodian) ?? anchor.custodian,
        );
        addAnchor(`${display} · ${anchor.count}`, anchor.position);
      }
    } else if (this.lens === 'filetypes') {
      // File-type sectors get extension labels with counts.
      for (const anchor of fileTypeAnchors(this.galaxyInputs)) {
        addAnchor(`${anchor.fileType} · ${anchor.count}`, anchor.position);
      }
    } else if (this.lens === 'chronology') {
      const sorted = [...this.galaxyInputs].sort(
        (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      // Spiral endpoints, labelled in the owner's words
      // (2026-11-01): the CENTER start reads EARLIEST, the far
      // end reads LATEST. Direction of travel (center outward)
      // is stated on the source card.
      const ends: [number, string][] = [
        [0, `EARLIEST · ${sorted[0]?.date.slice(0, 10) ?? '?'}`],
        [sorted.length - 1, `LATEST · ${sorted[sorted.length - 1]?.date.slice(0, 10) ?? '?'}`],
      ];
      for (const [at, text] of ends) {
        const record = sorted[Math.min(sorted.length - 1, Math.max(0, at))];
        if (!record) continue;
        const idx = this.galaxyIds.indexOf(record.id);
        if (idx < 0) continue;
        addAnchor(text, [
          this.galaxyTo[idx * 3],
          this.galaxyTo[idx * 3 + 1] + 0.55,
          this.galaxyTo[idx * 3 + 2],
        ]);
      }
      for (const q of [0.25, 0.5, 0.75]) {
        const record = sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
        const idx = this.galaxyIds.indexOf(record.id);
        if (idx < 0) continue;
        addAnchor(record.date, [
          this.galaxyTo[idx * 3],
          this.galaxyTo[idx * 3 + 1] + 0.35,
          this.galaxyTo[idx * 3 + 2],
        ]);
      }
    } else {
      for (const anchor of orgAnchors(this.galaxyInputs)) {
        const display = this.orgNames.get(anchor.org) ?? anchor.org;
        // Organization territory labels, larger + higher (owner,
        // 2026-11-01): it must be obvious which org is which.
        const raised: [number, number, number] = [
          anchor.position[0], anchor.position[1] + 0.3, anchor.position[2]];
        addAnchor(`${display.replace(/\s*\(synthetic\)\s*$/, '')} · ${anchor.count}`, raised, 0.3);
      }
      if (this.lens === 'network') {
        // Person hub labels: the identifiable endpoints of every
        // channel line (name + sent/received counts from explicit
        // roles). Persistent while the Network lens is active.
        this.computeHubPositions();
        for (const hub of this.networkHubs) {
          const at = this.hubPositions.get(hub.personId);
          if (!at) continue;
          const name = this.peopleNames.get(hub.personId) ?? hub.personId;
          addAnchor(`${name} · sent ${hub.sent} / received ${hub.received}`,
            [at[0], at[1] + 0.18, at[2]]);
        }
      }
    }
  }

  /**
   * In-world color key: a small floating stack at the platform's
   * left (inside the empty middle, r≈2.9 < R_NEAR so no node
   * sits behind it). Title + one line per producing org in its
   * own node color. Scene-fixed landmark; the source card
   * carries the same key with domain-verification counts.
   */
  private buildColorKey(): void {
    for (const sprite of this.colorKeySprites) this.disposeSprite(sprite);
    this.colorKeySprites = [];
    const orgs = [...new Set(this.galaxyInputs.map((i) => i.org))].sort();
    if (orgs.length === 0) return;
    const lines: [string, string][] = [['COLOR = PRODUCING ORG', '#f5d90a']];
    orgs.forEach((org, i) => {
      const display = (this.orgNames.get(org) ?? org).replace(/\s*\(synthetic\)\s*$/, '');
      const count = this.galaxyInputs.filter((x) => x.org === org).length;
      lines.push([`${display} (${count})`, GALAXY_PALETTE[i % GALAXY_PALETTE.length].hex]);
    });
    lines.forEach(([text, color], k) => {
      const sprite = this.makeLabelSprite(text, k === 0 ? 0.13 : 0.11, false, color);
      // Raised well above cluster height (owner: the key used
      // to sit inside the left-hand node clouds, 2026-11-01).
      sprite.position.set(-2.55, 3.3 - k * 0.3, -1.5);
      sprite.name = `color-key-${k}`;
      this.scene.add(sprite);
      this.colorKeySprites.push(sprite);
    });
  }

  /** Legend lines computed from the ACTUAL corpus (never decorative). */
  private galaxyLegendLines(): string[] {    const orgs = [...new Set(this.galaxyInputs.map((i) => i.org))].sort();
    return orgs.map((org, i) => {
      const display = (this.orgNames.get(org) ?? org).replace(/\s*\(synthetic\)\s*$/, '');
      const count = this.galaxyInputs.filter((x) => x.org === org).length;
      return `${GALAXY_PALETTE[i % GALAXY_PALETTE.length].name}: ${display} (${count})`;
    });
  }

  /**
   * Color key (owner session 2026-11-01): node color = the
   * record's PRODUCING organization, DOMAIN-VERIFIED at the
   * company level — the sender/author mailbox domain matches
   * the record org's corporate domain (novachip.com vs
   * helixworks.com). NovaChip sub-orgs share one domain, so
   * their distinct hues remain authored territory encoding;
   * records whose sender home-org differs from the record org
   * are counted below as explained exceptions, never hidden.
   */
  private colorKeyLines(): string[] {
    const withCheck = this.galaxyInputs.filter((i) => i.domainOk !== undefined);
    const bad = withCheck.filter((i) => !i.domainOk);
    const crossFunc = withCheck.filter((i) => i.domainOk && !i.homeOrgOk);
    return [
      'Color = producing organization, domain-verified:',
      'sender mailbox domain matches record org domain.',
      ...this.galaxyLegendLines(),
      ...(withCheck.length
        ? [`Domain check: ${withCheck.length - bad.length}/${withCheck.length} verified`
          + (bad.length ? `; ${bad.length} cross-company (listed):` : '.')
          + (crossFunc.length ? ` ${crossFunc.length} cross-functional (sender home-org differs):` : '')]
        : []),
      ...bad.slice(0, 4).map((i) => `  ${i.id.toUpperCase()} from ${i.senderDomain}`),
      ...crossFunc.slice(0, 4).map((i) => `  ${i.id.toUpperCase()} (home-org differs, same domain)`),
      ...(bad.length + crossFunc.length > 8
        ? [`  (+${bad.length + crossFunc.length - 8} more — same explained patterns)`]
        : []),
    ];
  }

  /** "Reyes, Elena" -> "Elena Reyes" for in-world labels
   * (owner: custodians read as first + last name). Passes
   * through anything without a comma untouched. */
  private custodianFirstLast(display: string): string {
    const comma = display.indexOf(',');
    if (comma < 0) return display;
    const last = display.slice(0, comma).trim();
    const first = display.slice(comma + 1).trim();
    if (!last || !first) return display;
    return `${first} ${last}`;
  }

  /** Network legend from the audited relationship cache: counts
   * first (honest sparsity), then the actual channels by name. */
  private networkLegendLines(): string[] {
    const name = (id: string) => this.peopleNames.get(id)
      ?? peopleById.get(id) ?? id;
    const cross = this.networkChannels.filter((e) => this.channelIsCrossOrg(e));
    const top = [...this.networkChannels]
      .sort((a, b) => b.weight - a.weight).slice(0, 6);
    return [
      `${this.networkHubs.length} people · ${this.networkChannels.length} sender->recipient channels`,
      `${cross.length} cross-organization (GOLD lines) · ${this.networkReplyLinks.length} reply links (WHITE)`,
      'Pale lines = within-organization channels.',
      'Lines join LABELED person hubs (name + sent/received',
      'counts float over each cluster). Select any record:',
      'bright lines join it to its sender/recipient hubs.',
      'Busiest channels (record count):',
      ...top.map((e) => `  ${name(e.fromPersonId)} -> ${name(e.toPersonId)}: ${e.weight}`),
      ...(cross.length ? [
        'Cross-organization channels (why gold lines exist):',
        ...cross.map((e) => `  ${name(e.fromPersonId)} -> ${name(e.toPersonId)}: ${e.recordIds.join(', ').toUpperCase()}`),
      ] : []),
      'Every line comes from explicit sender/recipient roles',
      'or a stored reply link. No proximity is invented.',
    ];
  }

  private corpusDateAnchors(): string[] {
    const dates = this.galaxyInputs.map((i) => i.date).sort();
    if (dates.length === 0) return [];
    const at = (q: number) => dates[Math.min(dates.length - 1, Math.floor(q * dates.length))];
    return [
      `Earliest ${at(0)} -> latest ${at(1)} (stored dates)`,
      `Quartiles: ${at(0.25)} · ${at(0.5)} · ${at(0.75)}`,
      'Spiral starts at the center (oldest) and winds',
      'outward twice around you; height band = organization.',
    ];
  }

  private galaxyScaleFor(id: string): number {
    if (id === this.selectedId) return 2.4 * this.selectedPulse;
    if (id === this.galaxyHoverId) return 2;
    if (this.searched) return this.hits.has(id) ? 1.6 : 0.7;
    if (this.activeLead) return this.focusIds.includes(id) ? 1.6 : 0.7;
    return this.visited.has(id) ? 1.15 : 1;
  }

  private composeGalaxyInstance(i: number): void {
    const mesh = this.galaxyMesh;
    if (!mesh) return;
    this.galaxyDummy.position.set(
      this.galaxyCurrent[i * 3],
      this.galaxyCurrent[i * 3 + 1],
      this.galaxyCurrent[i * 3 + 2],
    );
    // Constant WORLD node size (owner, 2026-11-01): universe
    // expansion spreads positions, it must not inflate nodes
    // (expanded nodes blocked their own labels). Local scale
    // counteracts the mesh scale exactly.
    this.galaxyDummy.scale.setScalar(
      this.galaxyScaleFor(this.galaxyIds[i]) / Math.max(mesh.scale.x, 0.001),
    );
    this.galaxyDummy.rotation.set(0, 0, 0);
    this.galaxyDummy.updateMatrix();
    mesh.setMatrixAt(i, this.galaxyDummy.matrix);
    // needsUpdate is set ONCE by callers after composing, never
    // per instance (one buffer upload per change, not per node).
  }

  private composeGalaxyMatrices(): void {
    const mesh = this.galaxyMesh;
    if (!mesh) return;
    for (let i = 0; i < this.galaxyIds.length; i += 1) {
      this.composeGalaxyInstance(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private refreshGalaxyStates(includeMatrices = true): void {
    const mesh = this.galaxyMesh;
    if (!mesh) return;
    const tmp = new Color();
    const WHITE = new Color('#ffffff');
    const FALLBACK = new Color('#9aa5ce');
    const leadFocus = new Set(this.focusIds);
    this.galaxyInputs.forEach((input, i) => {
      tmp.copy(this.galaxyOrgColor.get(input.org) ?? FALLBACK);
      const emphasis = galaxyEmphasis({
        searched: this.searched,
        isHit: this.hits.has(input.id),
        isSelected: input.id === this.selectedId,
        leadActive: this.activeLead != null,
        isLeadFocus: leadFocus.has(input.id),
      });
      if (emphasis === 'selected') tmp.copy(WHITE);
      else if (emphasis === 'bright') tmp.lerp(WHITE, 0.35);
      else if (emphasis === 'dim') tmp.multiplyScalar(0.3);
      mesh.setColorAt(i, tmp);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (includeMatrices) this.composeGalaxyMatrices();
  }

  /**
   * Locked workspace assembly: the bottom-left gold handle is the
   * ONLY mover. Welcome panel follows handle deltas 1:1; the
   * source panel keeps its initial offset in welcome-local space
   * (immediately right, same facing delta). Dragging buttons or
   * panel surfaces does nothing (no grab component there).
   * Instruction label hides permanently after first real drag.
   */
  private updatePanelAssembly(): void {
    const welcome = this.world.getSceneObject('welcome-panel') as Object3D | undefined;
    const handle = this.world.getSceneObject('panel-handle') as Object3D | undefined;
    if (!welcome || !handle || !this.panel) return;
    welcome.updateWorldMatrix(true, false);
    const handlePos = handle.getWorldPosition(new Vector3());
    if (!this.assemblyInit) {
      this.assemblyInit = true;
      this.handlePrev = handlePos.clone();
      this.sourceLocalOffset = welcome.worldToLocal(this.panel.position.clone());
      const wq = welcome.getWorldQuaternion(new Quaternion());
      // Relative facing: source world quat in welcome frame.
      const inv = wq.clone().invert();
      const rel = inv.multiply(this.panel.quaternion.clone());
      this.sourceLocalQuat = { x: rel.x, y: rel.y, z: rel.z, w: rel.w };
      if (this.speechPanel) {
        this.speechLocalOffset = welcome.worldToLocal(this.speechPanel.position.clone());
        const srel = wq.clone().invert().multiply(this.speechPanel.quaternion.clone());
        this.speechLocalQuat = { x: srel.x, y: srel.y, z: srel.z, w: srel.w };
      }
      let used = false;
      try { used = localStorage.getItem('mmdata-handle-used') === '1'; } catch { /* ignore */ }
      if (!used) {
        const label = this.makeLabelSprite('Hold and drag to move the Legal Data Universe panel', 0.055, true);
        label.position.copy(handlePos).add(new Vector3(0.32, 0.1, 0));
        label.name = 'panel-handle-hint';
        this.scene.add(label);
        this.handleLabel = label;
      }
      return;
    }
    const delta = handlePos.clone().sub(this.handlePrev as Vector3);
    if (delta.lengthSq() > 1e-8) {
      welcome.position.add(delta);
      welcome.updateWorldMatrix(true, false);
      if (delta.length() > 0.02 && this.handleLabel) {
        this.disposeSprite(this.handleLabel);
        this.handleLabel = undefined;
        try { localStorage.setItem('mmdata-handle-used', '1'); } catch { /* ignore */ }
        diag('panel-handle-first-drag', {});
      }
    }
    (this.handlePrev as Vector3).copy(handlePos);
    if (this.handleLabel) {
      this.handleLabel.position.copy(handlePos).add(new Vector3(0.32, 0.1, 0));
    }
    if (this.sourceLocalOffset && this.sourceLocalQuat) {
      this.panel.position.copy(welcome.localToWorld(this.sourceLocalOffset.clone()));
      const wq = welcome.getWorldQuaternion(new Quaternion());
      const rel = this.panel.quaternion.clone();
      rel.set(this.sourceLocalQuat.x, this.sourceLocalQuat.y, this.sourceLocalQuat.z, this.sourceLocalQuat.w);
      this.panel.quaternion.copy(wq.multiply(rel));
    }
    if (this.speechPanel && this.speechLocalOffset && this.speechLocalQuat) {
      this.speechPanel.position.copy(welcome.localToWorld(this.speechLocalOffset.clone()));
      const wq = welcome.getWorldQuaternion(new Quaternion());
      const rel = new Quaternion(
        this.speechLocalQuat.x, this.speechLocalQuat.y,
        this.speechLocalQuat.z, this.speechLocalQuat.w,
      );
      this.speechPanel.quaternion.copy(wq.multiply(rel));
    }
  }

  private updateGalaxy(): void {
    const mesh = this.galaxyMesh;
    if (!mesh || !mesh.visible) return;
    // Frame-loop hardening (2026-11-02 entry crashes): a throw
    // in hover/beam/locator helpers must never kill the XR
    // loop again — log with stack (rate-limited) and continue.
    try {
      this.updateGalaxyHover(performance.now());
    } catch (err) {
      this.diagFrameError('hover', err);
    }
    // MR: shrink the universe to room scale (same blend signal the
    // MixedRealitySystem uses; no scenery list changes needed).
    // Expand/contract range (owner, 2026-11-01): contract pulls
    // the field meaningfully closer, expand pushes it deep into
    // the far room — the old 1.0/1.3 band wasted both ends.
    const inMR = this.isMR();
    const targetScale = (inMR ? 0.5 : 1) * (scaleState.expanded ? 1.9 : 0.72);
    const s = mesh.scale.x + (targetScale - mesh.scale.x) * 0.12;
    mesh.scale.setScalar(s);
    try {
      this.updateAimBeams();
      this.updateSelectionLocator();
    } catch (err) {
      this.diagFrameError('beams-locator', err);
    }
    // Constant world node size requires recomposing while the
    // mesh scale itself is still lerping (expand/contract, MR
    // blend), even when positions are not animating.
    if (Math.abs(s - this.lastComposedMeshScale) > 0.002) {
      this.lastComposedMeshScale = s;
      this.composeGalaxyMatrices();
    }
    if (!this.galaxyAnimating) return;
    let maxDelta = 0;
    for (let i = 0; i < this.galaxyCurrent.length; i += 1) {
      const next = this.galaxyCurrent[i] + (this.galaxyTo[i] - this.galaxyCurrent[i]) * 0.14;
      maxDelta = Math.max(maxDelta, Math.abs(this.galaxyTo[i] - next));
      this.galaxyCurrent[i] = next;
    }
    if (maxDelta < 0.008) {
      this.galaxyCurrent.set(this.galaxyTo);
      this.galaxyAnimating = false;
    }
    this.composeGalaxyMatrices();
  }

  // Picking v2 (2026-10-29 P0): v1 raycast the InstancedMesh from
  // three's XR controller groups, which IWSDK's own input stack
  // never poses — every pick missed on-device while desktop math
  // looked fine. v2 uses only confirmed surfaces: this.camera
  // (System contract), world.session 'select' events, and manual
  // point-to-ray distance over instance positions (no three
  // raycast quirks, ~0.04ms at 1,000). Controller pose is used
  // opportunistically when it is demonstrably live.
  private initGalaxyPicking(): void {
    if (this.galaxyPickReady) return;
    this.galaxyPickReady = true;
    const renderer = this.renderer as unknown as {
      xr?: { getController(i: number): Object3D; getHand(i: number): Object3D };
      domElement?: HTMLElement;
    };
    type XREmitter = { addEventListener(type: string, fn: (event: Event) => void): void };
    if (renderer.xr) {
      for (const i of [0, 1]) {
        const controller = renderer.xr.getController(i);
        (controller as unknown as XREmitter).addEventListener('selectstart', (event) =>
          this.pickGalaxyNow(this.posesFromSelectEvent(event)));
        // Controller squeeze picks too (owner, 2026-11-02):
        // node examination kept "switching to gaze and squeeze"
        // while squeeze itself was never wired — trigger and
        // squeeze now both examine the pointed node.
        (controller as unknown as XREmitter).addEventListener('squeezestart', (event) =>
          this.pickGalaxyNow(this.posesFromSelectEvent(event)));
        const hand = renderer.xr.getHand(i);
        (hand as unknown as XREmitter).addEventListener('pinchstart', () =>
          this.pickGalaxyNow());
      }
    }
    renderer.domElement?.addEventListener('click', () => {
      if (!browserPointerState.active) this.pickGalaxyNow();
    });
  }

  /**
   * ALL candidate picking rays: both controllers, then gaze.
   * Headset defect (2026-10-31): picking died permanently while
   * menus kept working — 927 pick-miss vs 45 selects in diag.log.
   * A single stale/default controller pose (nonzero origin, wrong
   * ray) was being trusted exclusively after input-mode/session
   * changes. Evaluating every candidate and taking the best
   * actual hit makes controller ↔ hand/gaze switching seamless:
   * whichever device the investigator really used produces the
   * hit; dead rays simply miss.
   */
  /**
   * IWSDK-posed target-ray spaces (player.raySpaces, copied
   * from XRInputSource.targetRaySpace by the input stack) —
   * the SAME pose family the visible platform ray uses. These
   * lead every ray list; three's renderer.xr controller groups
   * (historically offset/stale here) stay as fallback tiers.
   */
  private raySpaceRays(): { origin: Vector3; dir: Vector3; source: string }[] {
    const rays: { origin: Vector3; dir: Vector3; source: string }[] = [];
    try {
      const spaces = (this as unknown as {
        player?: { raySpaces?: { left?: Object3D; right?: Object3D } };
      }).player?.raySpaces;
      if (!spaces) return rays;
      const camPos = this.camera.getWorldPosition(new Vector3());
      for (const side of ['left', 'right'] as const) {
        const space = spaces[side];
        if (!space) continue;
        space.updateWorldMatrix(true, false);
        const origin = space.getWorldPosition(new Vector3());
        const dist = origin.distanceTo(camPos);
        if (dist <= 0.05 || dist >= 2.5) continue;
        const dir = new Vector3(0, 0, -1)
          .applyQuaternion(space.getWorldQuaternion(new Quaternion()))
          .normalize();
        rays.push({ origin, dir, source: `rayspace-${side}` });
      }
    } catch { /* input stack without ray spaces: fallbacks below */ }
    return rays;
  }

  private browserPointerRay(): { origin: Vector3; dir: Vector3; source: string } | undefined {
    if (!browserPointerState.active || this.world.session) return undefined;
    this.camera.updateWorldMatrix(true, false);
    const origin = this.camera.getWorldPosition(new Vector3());
    const point = new Vector3(browserPointerState.x, browserPointerState.y, 0.5)
      .unproject(this.camera as unknown as import('@iwsdk/core').PerspectiveCamera);
    const dir = point.sub(origin).normalize();
    if (!isFinite(dir.x + dir.y + dir.z) || dir.lengthSq() < 0.5) return undefined;
    return { origin, dir, source: 'browser-pointer' };
  }

  private galaxyRays(): { origin: Vector3; dir: Vector3; source: string }[] {
    const pointerRay = this.browserPointerRay();
    browserPointerState.overPanel = pointerRay
      ? this.rayHitsPanelFirst(pointerRay.origin, pointerRay.dir, Number.POSITIVE_INFINITY)
      : false;
    const rays: { origin: Vector3; dir: Vector3; source: string }[] = [
      ...(pointerRay ? [pointerRay] : []),
      ...this.raySpaceRays(),
    ];
    const renderer = this.renderer as unknown as {
      xr?: { getController(i: number): Object3D };
    };
    const camPos = this.camera.getWorldPosition(new Vector3());
    if (renderer.xr) {
      for (const i of [0, 1]) {
        const controller = renderer.xr.getController(i);
        const origin = controller.getWorldPosition(new Vector3());
        // Plausibility: a held controller is within arm's reach of
        // the head; parked/default poses at guardian origin are not.
        if (origin.distanceTo(camPos) > 0.05 && origin.distanceTo(camPos) < 2.5) {
          const dir = new Vector3(0, 0, -1)
            .applyQuaternion(controller.getWorldQuaternion(new Quaternion()))
            .normalize();
          rays.push({ origin, dir, source: `controller${i}` });
        }
      }
    }
    // MR controller-ray independence (Round 3): when a controller
    // is plausibly held, selection uses ONLY controller rays —
    // trigger picks the RAY target, never the gaze target. Gaze
    // (pinch) returns automatically when no controller is held.
    if (rays.length === 0) {
      rays.push({
        origin: camPos,
        dir: this.camera.getWorldDirection(new Vector3()).normalize(),
        source: 'gaze',
      });
    }
    return rays;
  }

  /** Nearest instance to a ray — pure math in galaxy/picking.ts
   * (scale-aware radius, hit-preferring during search). */
  private galaxyNearest(
    origin: Vector3,
    dir: Vector3,
  ): { id: string; along: number; score: number } | undefined {
    const mesh = this.galaxyMesh;
    if (!mesh) return undefined;
    const pick = pickNearest({
      positions: this.galaxyCurrent,
      ids: this.galaxyIds,
      scales: (i) => this.galaxyScaleFor(this.galaxyIds[i]),
      meshPosition: [mesh.position.x, mesh.position.y, mesh.position.z],
      meshScale: mesh.scale.x,
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
      hitIds: this.searched ? this.hits : undefined,
      preferredId: this.galaxyHoverId,
      angleTol: this.isMR() ? 0.06 : 0.05,
    });
    return pick ? { id: pick.id, along: pick.along, score: pick.score } : undefined;
  }

  /** MR room-scale signal (same blend the MixedRealitySystem uses). */
  private isMR(): boolean {
    const session = this.world.session as (XRSession & { environmentBlendMode?: string }) | undefined;
    const blend = session?.environmentBlendMode;
    return blend != null && blend !== 'opaque';
  }

  /**
   * Aim beams from IWSDK raySpaces (see aimBeams field note).
   * Beam length stops at the hovered record when one is under
   * the ray, else runs 6 m so the endpoint dot is findable in
   * open space. Hidden outside an immersive session.
   */
  private lastFrameErrorAt = 0;
  private diagFrameError(where: string, err: unknown): void {
    const now = performance.now();
    if (now - this.lastFrameErrorAt < 5000) return;
    this.lastFrameErrorAt = now;
    diag('frame-error', {
      where,
      message: String((err as Error)?.message ?? err).slice(0, 200),
      stack: String((err as Error)?.stack ?? '').slice(0, 600),
    });
  }

  private updateAimBeams(): void {
    if (this.aimBeams.length === 0) {
      const beamGeo = new CylinderGeometry(0.0035, 0.0035, 1, 6, 1, true);
      beamGeo.rotateX(Math.PI / 2);
      beamGeo.translate(0, 0, -0.5);
      const dotGeo = new IcosahedronGeometry(0.014, 1);
      for (let i = 0; i < 2; i += 1) {
        const beam = new Mesh(beamGeo, new MeshBasicMaterial({
          color: 0xe8c56a, transparent: true, opacity: 0.75, depthTest: false,
        }));
        beam.frustumCulled = false;
        beam.visible = false;
        beam.renderOrder = 998;
        beam.name = 'aim-beam';
        beam.raycast = () => {};
        const dot = new Mesh(dotGeo, new MeshBasicMaterial({
          color: 0xffe9a8, transparent: true, opacity: 0.95, depthTest: false,
        }));
        dot.frustumCulled = false;
        dot.visible = false;
        dot.renderOrder = 999;
        dot.name = 'aim-dot';
        dot.raycast = () => {};
        this.scene.add(beam);
        this.scene.add(dot);
        this.aimBeams.push({ beam, dot });
      }
    }
    const inSession = this.world.session != null;
    const rays = inSession ? this.raySpaceRays() : [];
    this.aimBeams.forEach(({ beam, dot }, i) => {
      const ray = rays[i];
      if (!ray) {
        beam.visible = false;
        dot.visible = false;
        return;
      }
      const length = i === 0 && this.galaxyHoverId && this.galaxyHoverAlong > 0
        ? Math.min(this.galaxyHoverAlong, 12)
        : 6;
      beam.visible = true;
      dot.visible = true;
      beam.position.copy(ray.origin);
      beam.quaternion.setFromUnitVectors(
        new Vector3(0, 0, -1),
        ray.dir,
      );
      beam.scale.set(1, 1, length);
      dot.position.set(
        ray.origin.x + ray.dir.x * length,
        ray.origin.y + ray.dir.y * length,
        ray.origin.z + ray.dir.z * length,
      );
    });
  }

  private makeSparkleRing(radius: number, dotR: number): Object3D {
    const ring = new Object3D();
    const geo = new IcosahedronGeometry(dotR, 0);
    for (let i = 0; i < 5; i += 1) {
      const dot = new Mesh(geo, new MeshBasicMaterial({
        color: i % 2 ? 0xffffff : 0xe8c56a, transparent: true, opacity: 0.95, depthTest: false,
      }));
      const a = (i / 5) * Math.PI * 2;
      dot.position.set(Math.cos(a) * radius, (i % 3 - 1) * 0.05, Math.sin(a) * radius);
      dot.renderOrder = 997;
      dot.raycast = () => {};
      ring.add(dot);
    }
    ring.visible = false;
    this.scene.add(ring);
    return ring;
  }

  /**
   * Selected-record locator (owner, 2026-11-02): the open
   * record must be OBVIOUS in both places it lives — the detail
   * orb on the platform gets a "Record" caption underneath and
   * orbiting sparkles; its twin out in the clusters gets the
   * same sparkle motion, a scale pulse, and a big bobbing gold
   * arrow so nobody has to hunt the field for the hit.
   */
  private updateSelectionLocator(): void {
    const now = performance.now();
    this.selectedPulse = 1 + 0.16 * Math.sin(now / 230);
    if (!this.hitArrow) {
      const group = new Object3D();
      group.name = 'hit-arrow';
      const cone = new Mesh(
        new ConeGeometry(0.1, 0.3, 10),
        new MeshBasicMaterial({ color: 0xe8c56a, transparent: true, opacity: 0.95, depthTest: false }),
      );
      cone.rotation.x = Math.PI;
      cone.renderOrder = 997;
      cone.raycast = () => {};
      cone.name = 'hit-arrow-cone';
      const shaft = new Mesh(
        new CylinderGeometry(0.035, 0.035, 0.22, 8),
        new MeshBasicMaterial({ color: 0xe8c56a, transparent: true, opacity: 0.9, depthTest: false }),
      );
      shaft.position.y = 0.25;
      shaft.renderOrder = 997;
      shaft.raycast = () => {};
      group.add(cone);
      group.add(shaft);
      group.visible = false;
      this.scene.add(group);
      this.hitArrow = group;
      this.hitSparkles = this.makeSparkleRing(0.2, 0.022);
      this.orbSparkles = this.makeSparkleRing(0.15, 0.018);
      this.recordCaption = this.makeLabelSprite('Record', 0.085, true);
      this.recordCaption.name = 'record-caption';
      this.recordCaption.visible = false;
    }
    const mesh = this.galaxyMesh;
    const idx = this.selectedId ? this.galaxyIds.indexOf(this.selectedId) : -1;
    if (!mesh || idx < 0) {
      this.hitArrow.visible = false;
      if (this.hitSparkles) this.hitSparkles.visible = false;
      if (this.orbSparkles) this.orbSparkles.visible = false;
      if (this.recordCaption) this.recordCaption.visible = false;
      return;
    }
    const s = mesh.scale.x;
    const wx = mesh.position.x + this.galaxyCurrent[idx * 3] * s;
    const wy = mesh.position.y + this.galaxyCurrent[idx * 3 + 1] * s;
    const wz = mesh.position.z + this.galaxyCurrent[idx * 3 + 2] * s;
    const bob = 0.42 + 0.07 * Math.sin(now / 300);
    this.hitArrow.visible = true;
    this.hitArrow.position.set(wx, wy + bob, wz);
    this.hitArrow.rotation.y = now / 900;
    if (this.hitSparkles) {
      this.hitSparkles.visible = true;
      this.hitSparkles.position.set(wx, wy, wz);
      this.hitSparkles.rotation.y = now / 420;
      const tw = 0.85 + 0.3 * Math.abs(Math.sin(now / 180));
      this.hitSparkles.scale.setScalar(tw);
    }
    // Pulse the instance itself (one recompose per frame).
    this.composeGalaxyInstance(idx);
    mesh.instanceMatrix.needsUpdate = true;
    // Platform detail orb: caption + sparkles when it is shown.
    const slotIdx = this.selectedId ? this.focusIds.indexOf(this.selectedId) : -1;
    const slot = slotIdx >= 0 ? this.slotObjects[slotIdx] : undefined;
    if (slot && slot.visible && this.recordCaption && this.orbSparkles) {
      if (this.recordCaption.parent !== slot) {
        slot.add(this.recordCaption);
        this.recordCaption.position.set(0, -0.36, 0);
      }
      this.recordCaption.visible = true;
      const wp = slot.getWorldPosition(new Vector3());
      this.orbSparkles.visible = true;
      this.orbSparkles.position.copy(wp);
      this.orbSparkles.rotation.y = now / 380;
      this.orbSparkles.scale.setScalar(0.85 + 0.3 * Math.abs(Math.sin(now / 200 + 1)));
    } else {
      if (this.recordCaption) this.recordCaption.visible = false;
      if (this.orbSparkles) this.orbSparkles.visible = false;
    }
  }

  /** UI panels block picks: a squeeze aimed at a panel must never
   * select a record behind it (owner: "BG010 is on the platform,
   * but I didn't pick it"). Conservative spheres at panel poses.
   * ALL panels are live-tracked (owner session 2026-11-01): the
   * old fixed source-panel sphere guarded empty space after the
   * gold-handle drag moved the real card — eating left-side
   * (Security) picks while leaving the moved card unguarded.
   * Radii tightened to match: guard the card, not the sector. */
  private panelGuardSpheres(out: [number, number, number, number][]): void {
    // Sphere guard (restored 2026-11-02): the Box3/setFromObject
    // version crashed Quest entry three times — window-error
    // "Cannot read properties of undefined (reading 'x')" within
    // a second of xr-session-start, killing the frame loop.
    // setFromObject over the UIKit hierarchy is the prime
    // suspect and is removed outright. Stacked spheres cover
    // the tall menu (center + top/bottom, wider middle) at its
    // LIVE grab-moved pose.
    //
    // The spheres use the panel CENTER's live world position,
    // half-height stacked, so a dragged menu stays guarded
    // wherever it is (owner, 2026-11-02: the moved menu kept
    // letting rays through to nodes behind it). Radii cover the
    // full column: wider middle sphere for the tool column.
    out.length = 0;
    try {
      const welcome = this.world.getSceneObject('welcome-panel') as Object3D | undefined;
      const wp = welcome?.getWorldPosition(new Vector3());
      const sp = this.speechPanel?.getWorldPosition(new Vector3());
      const src = this.panel?.getWorldPosition(new Vector3());
      if (wp) {
        // Menu column is ~0.46 m wide at 0.42 scale; height
        // varies with open tool groups, so three overlapping
        // spheres span a ~2 m column centered on the live pose.
        out.push([wp.x, wp.y + 0.62, wp.z, 0.8]);
        out.push([wp.x, wp.y, wp.z, 0.95]);
        out.push([wp.x, wp.y - 0.62, wp.z, 0.8]);
      }
      if (src) out.push([src.x, src.y, src.z, 0.9]);
      if (sp) out.push([sp.x, sp.y, sp.z, 0.9]);
    } catch { /* guard failure must never block or kill picking */ }
  }

  private rayHitsPanelFirst(origin: Vector3, dir: Vector3, hitAlong: number): boolean {
    const panels: [number, number, number, number][] = [];
    this.panelGuardSpheres(panels);
    if (panels.length === 0) return false;
    try {
      const rel = new Vector3();
      for (const [x, y, z, radius] of panels) {
        rel.set(x - origin.x, y - origin.y, z - origin.z);
        const along = rel.dot(dir);
        if (along < 0 || along > hitAlong) continue;
        if (rel.lengthSq() - along * along < radius * radius) return true;
      }
    } catch { /* guard failure must never block or kill picking */ }
    return false;
  }

  private lastPickAt = 0;
  private lastPickId = '';
  // Event-pose presses bypass the generic lock (owner session
  // 2026-11-01, second attempt): a three-group selectstart can
  // arrive first with a stale pose and its 300 ms lock then
  // eats the accurate platform-pose select behind it. Event
  // presses dedupe only against each other (120 ms).
  private lastEventPickAt = 0;

  /**
   * Platform target-ray poses from a WebXR select event, in
   * BOTH candidate conversions (owner session 2026-11-01:
   * gaze+squeeze worked, controller point+trigger did nothing
   * in VR). Whether the reference-space pose is already world
   * (offset-reference-space locomotion) or needs the camera-rig
   * transform (three-style dolly) depends on the host stack;
   * diag ray-compare showed median 27.8° disagreement, so the
   * conversion cannot be guessed. pickGalaxyNow tries raw,
   * then rig-converted, then polled — first tier that hits
   * wins, and diag records which tier fired so the wrong
   * variant can be pruned from evidence, not theory.
   */
  private posesFromSelectEvent(event: Event): { origin: Vector3; dir: Vector3 }[] {
    try {
      const evt = event as unknown as { frame?: XRFrame; inputSource?: XRInputSource };
      const frame = evt.frame;
      const source = evt.inputSource;
      const renderer = this.renderer as unknown as {
        xr?: { getReferenceSpace(): XRReferenceSpace | null };
      };
      const refSpace = renderer.xr?.getReferenceSpace();
      if (!frame || !source || !refSpace) return [];
      const pose = frame.getPose(source.targetRaySpace, refSpace);
      if (!pose) return [];
      const p = pose.transform.position;
      const o = pose.transform.orientation;
      const rawOrigin = new Vector3(p.x, p.y, p.z);
      const rawDir = new Vector3(0, 0, -1)
        .applyQuaternion(new Quaternion(o.x, o.y, o.z, o.w)).normalize();
      const variants = [{ origin: rawOrigin, dir: rawDir }];
      const rig = this.camera.parent;
      if (rig && rig !== (this.scene as unknown as Object3D)) {
        rig.updateWorldMatrix(true, false);
        const origin = rawOrigin.clone().applyMatrix4(rig.matrixWorld);
        const dir = rawDir.clone().transformDirection(rig.matrixWorld);
        if (origin.distanceToSquared(rawOrigin) > 1e-8
          || dir.angleTo(rawDir) > 0.001) {
          variants.push({ origin, dir });
        }
      }
      diag('select-event-ray', { hand: String(source.handedness ?? ''), variants: variants.length });
      return variants;
    } catch {
      return [];
    }
  }

  private pickGalaxyNow(eventPoses?: { origin: Vector3; dir: Vector3 }[]): void {
    const now = performance.now();
    if (eventPoses?.length) {
      if (now - this.lastEventPickAt < 120) return;
      this.lastEventPickAt = now;
      this.lastPickAt = now;
    } else if (now - this.lastPickAt < 300) {
      return;
    }
    // Tiered rays, evaluated SEQUENTIALLY — the first tier that
    // hits anything owns the press (no cross-hand/gaze stealing,
    // no dependence on one guessed pose conversion):
    //   1 select-event-raw   2 select-event-rig
    //   3 polled controllers 4 gaze (galaxyRays fallback order)
    const polled = this.galaxyRays();
    const rays: { origin: Vector3; dir: Vector3; source: string }[] = [
      ...(eventPoses ?? []).map((pose, i) => ({
        ...pose,
        source: i === 0 ? 'select-event-raw' : 'select-event-rig',
      })),
      ...polled,
    ];
    if (eventPoses?.length && polled.length > 0) {
      const best = Math.min(...polled.map((r) =>
        Math.acos(Math.max(-1, Math.min(1, eventPoses[0].dir.dot(r.dir)))) * 180 / Math.PI));
      if (Number.isFinite(best)) diag('ray-compare', { deg: Math.round(best * 10) / 10 });
    }
    const slotCandidates = this.slotObjects.map((object) => {
      const position = object.getWorldPosition(new Vector3());
      return {
        recordId: this.nodeByObject.get(object),
        position: [position.x, position.y, position.z] as const,
        radius: 0.09 * Math.max(object.scale.x, 0.01),
        visible: object.visible,
      };
    });
    const mesh = this.galaxyMesh;
    let blockedId: string | undefined;
    for (const ray of rays) {
      // 1) Detailed focus orbs (point-and-trigger examination).
      const slotHit = pickDetailedSlot({
        slots: slotCandidates,
        origin: [ray.origin.x, ray.origin.y, ray.origin.z],
        dir: [ray.dir.x, ray.dir.y, ray.dir.z],
      });
      if (slotHit) {
        if (this.rayHitsPanelFirst(ray.origin, ray.dir, slotHit.along)) {
          blockedId = slotHit.recordId;
        } else {
          if (slotHit.recordId === this.lastPickId && now - this.lastPickAt < 900) return;
          this.lastPickAt = now;
          this.lastPickId = slotHit.recordId;
          diag('slot-pick-select', {
            id: slotHit.recordId,
            along: Math.round(slotHit.along * 100) / 100,
            via: ray.source,
          });
          void this.select(slotHit.recordId);
          return;
        }
      }
      // 3) Galaxy instances.
      if (!mesh?.visible) continue;
      const hit = this.galaxyNearest(ray.origin, ray.dir);
      if (!hit) continue;
      if (this.rayHitsPanelFirst(ray.origin, ray.dir, hit.along)) {
        blockedId = hit.id;
        continue;
      }
      if (hit.id === this.lastPickId && now - this.lastPickAt < 900) return;
      this.lastPickAt = now;
      this.lastPickId = hit.id;
      diag('pick-select', {
        id: hit.id, along: Math.round(hit.along * 100) / 100, lens: this.lens, via: ray.source,
      });
      void this.select(hit.id);
      return;
    }
    diag(blockedId ? 'pick-blocked-panel' : 'pick-miss', {
      id: blockedId, lens: this.lens, scale: mesh?.scale.x ?? 0,
      rays: rays.map((r) => r.source).join('+'),
    });
  }
  private updateGalaxyHover(nowMs: number): void {
    const mesh = this.galaxyMesh;
    if (!mesh?.visible) return;
    // Attach the WebXR select event lazily (session appears on entry).
    const session = this.world.session as XRSession | undefined;
    if (session && session !== this.galaxySession) {
      this.galaxySession = session;
      session.addEventListener('select', (event) =>
        this.pickGalaxyNow(this.posesFromSelectEvent(event as unknown as Event)));
      session.addEventListener('squeeze', (event) =>
        this.pickGalaxyNow(this.posesFromSelectEvent(event as unknown as Event)));
      const blend = (session as XRSession & { environmentBlendMode?: string }).environmentBlendMode;
      diag('xr-session-start', { blend: blend ?? 'unknown' });
      session.addEventListener('end', () => {
        diag('xr-session-end');
        if (this.galaxySession === session) this.galaxySession = undefined;
        this.noteVisibility();
      });
      session.addEventListener('visibilitychange', () => {
        diag('xr-visibility', {
          state: String((session as XRSession & { visibilityState?: string }).visibilityState ?? ''),
        });
        this.noteVisibility();
      });
      this.noteVisibility();
    }
    if (nowMs - this.galaxyLastHoverMs < 90) return;
    this.galaxyLastHoverMs = nowMs;
    // Hover previews for EVERY aiming device (owner, 2026-11-02:
    // right controller and hand never raised the floating
    // preview). The old code hovered only galaxyRays()[0] —
    // the LEFT ray space whenever it existed — so the right
    // hand could select but never preview. Now every candidate
    // ray is scored and the best (lowest-score) hit previews.
    const hoverRays = this.galaxyRays();
    let hit: { id: string; along: number; score: number } | undefined;
    for (const ray of hoverRays) {
      const candidate = this.galaxyNearest(ray.origin, ray.dir);
      if (!candidate) continue;
      if (this.rayHitsPanelFirst(ray.origin, ray.dir, candidate.along)) continue;
      if (!hit || candidate.score < hit.score) hit = candidate;
    }
    this.galaxyHoverAlong = hit?.along ?? 0;
    const hovered = hit?.id;
    if (hovered === this.galaxyHoverId) return;
    const previous = this.galaxyHoverId;
    this.galaxyHoverId = hovered;
    // Hover changes touch at most two instances — never recompose
    // the whole field for them (Quest GPU churn, 2026-10-29).
    for (const id of [previous, hovered]) {
      const idx = id ? this.galaxyIds.indexOf(id) : -1;
      if (idx >= 0) this.composeGalaxyInstance(idx);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.updateHoverLabel();
  }

  // Visible controller aiming rays are IWSDK's own (the pair the
  // UI interaction stack uses). A custom gold pair drawn here
  // from three's renderer.xr controller groups duplicated them
  // with a rightward offset — 4 rays total (owner-found,
  // 2026-11-01) — so the custom rendering was removed.
  // galaxyRays() picking math is unchanged (M3-accepted).

  /**
   * Play-zone exit and fall recovery.
   *
   * Physical Guardian loss surfaces as `visible-blurred` as well
   * as `hidden`; in either state the platform owns input, so app
   * jump/select cannot be made to work from inside the session.
   * After one sustained second unfocused, exit deterministically
   * to the browser. The timer is event-driven because XR frame
   * callbacks may not run while the session is blurred/hidden.
   *
   * Virtual falls are separate: use World's authored-position
   * reconciliation (the locomotion owner's supported reset), not
   * an ad-hoc camera-parent shift that the locomotor overwrites.
   */
  private unfocusedSince = 0;
  private unfocusedState = '';
  private playZoneExitTimer: ReturnType<typeof setTimeout> | undefined;
  private playZoneExitPending = false;
  private playZoneExited = false;
  private playerSpawn: Vector3 | undefined;
  private lastFallRecoveryAt = 0;
  private fallRecoveryAttempts = 0;
  private lastSaneHeadAt = 0;

  private clearPlayZoneTimer(): void {
    if (this.playZoneExitTimer) clearTimeout(this.playZoneExitTimer);
    this.playZoneExitTimer = undefined;
  }

  private requestPlayZoneExit(reason: string): void {
    if (this.playZoneExited) return;
    this.playZoneExited = true;
    this.playZoneExitPending = true;
    const durationMs = this.unfocusedSince ? Math.round(performance.now() - this.unfocusedSince) : 0;
    diag('play-zone-exit', { state: this.unfocusedState, durationMs, reason });
    pushSpeech('system', 'Left the play area — exited to the browser. Nothing was lost: re-enter VR/MR when ready.');
    try {
      this.world.exitXR();
    } catch { /* if the platform refuses while blurred, pending exit retries on visible */ }
  }

  private noteVisibility(): void {
    const session = this.galaxySession;
    if (!session) {
      this.clearPlayZoneTimer();
      this.unfocusedSince = 0;
      this.unfocusedState = '';
      this.playZoneExitPending = false;
      this.playZoneExited = false;
      return;
    }
    const state = String((session as XRSession & { visibilityState?: string }).visibilityState ?? '');
    const unfocused = state === 'hidden' || state === 'visible-blurred';
    if (unfocused) {
      if (!this.unfocusedSince) {
        this.unfocusedSince = performance.now();
        this.unfocusedState = state;
        diag('play-zone-unfocused', { state });
        this.clearPlayZoneTimer();
        this.playZoneExitTimer = setTimeout(() => {
          this.playZoneExitTimer = undefined;
          this.requestPlayZoneExit('timer');
        }, 1000);
      } else {
        this.unfocusedState = state;
      }
      return;
    }
    const durationMs = this.unfocusedSince ? performance.now() - this.unfocusedSince : 0;
    const shouldExit = this.playZoneExitPending || durationMs >= 1000;
    this.clearPlayZoneTimer();
    this.unfocusedSince = 0;
    const wasState = this.unfocusedState;
    this.unfocusedState = '';
    if (shouldExit) {
      // An earlier exit attempt while blurred may have been
      // ignored by the platform; visible return is the retry point.
      this.playZoneExited = false;
      this.unfocusedState = wasState;
      this.requestPlayZoneExit('visible-return');
    } else if (!shouldExit) {
      this.playZoneExited = false;
      this.playZoneExitPending = false;
    }
  }

  private updatePlayZoneExit(): void {
    // Frame-loop fallback if a browser throttles the timer while
    // unfocused. The event timer above is the primary mechanism.
    if (!this.unfocusedSince || this.playZoneExited) return;
    if (performance.now() - this.unfocusedSince >= 1000) {
      this.requestPlayZoneExit('frame-fallback');
    }
  }

  private updateFallRecovery(): void {
    const head = this.camera.getWorldPosition(new Vector3());
    const horizontal = Math.hypot(head.x, head.z);
    const sane = head.y > -1 && head.y < 12 && horizontal <= 19;
    if (!this.playerSpawn && sane) {
      // Capture before the investigator starts locomoting. XROrigin
      // position is floor-origin space; fall back to authored spawn.
      const origin = (this.player as unknown as Object3D).position;
      this.playerSpawn = origin ? origin.clone() : new Vector3(0, 0, 1);
    }
    if (sane) {
      this.lastSaneHeadAt = performance.now();
      this.fallRecoveryAttempts = 0;
      return;
    }
    if (!this.world.session) return;
    const now = performance.now();
    if (now - this.lastFallRecoveryAt < 2000) return;
    this.lastFallRecoveryAt = now;
    this.fallRecoveryAttempts += 1;
    const spawn = this.playerSpawn ?? new Vector3(0, 0, 1);
    diag('fall-recovery', {
      from: `${Math.round(head.x * 10) / 10},${Math.round(head.y * 10) / 10},${Math.round(head.z * 10) / 10}`,
      attempt: this.fallRecoveryAttempts,
    });
    if (this.fallRecoveryAttempts >= 3) {
      pushSpeech('system', 'I could not restore your position in the virtual play area, so I exited to the browser. Nothing was lost.');
      try { this.world.exitXR(); } catch { /* platform owns session */ }
      return;
    }
    pushSpeech('system', 'You left the virtual floor. Returning you to the arrival platform.');
    try {
      this.world.setAuthoredPlayerPosition(spawn.clone());
    } catch {
      // Last-resort visual rig shift; locomotor reconciliation is
      // expected to make this unnecessary on supported runtimes.
      const rig = this.camera.parent;
      if (rig && rig !== (this.scene as unknown as Object3D)) {
        rig.position.x += spawn.x - head.x;
        rig.position.y += 1.7 - head.y;
        rig.position.z += spawn.z - head.z;
      }
    }
  }

  private updateHoverLabel(): void {
    const mesh = this.galaxyMesh;
    const id = this.galaxyHoverId;
    if (!mesh || !id) {
      if (this.galaxyHoverSprite) this.galaxyHoverSprite.visible = false;
      return;
    }
    const record = this.store.getRecord(id);
    if (!record) return;
    const idx = this.galaxyIds.indexOf(id);
    if (idx < 0) return;
    if (!this.galaxyHoverSprite) {
      this.galaxyHoverSprite = this.makeLabelSprite('', 0.12, true);
      this.galaxyHoverSprite.name = 'galaxy-hover-label';
      this.scene.add(this.galaxyHoverSprite);
    }
    const sprite = this.galaxyHoverSprite;
    const orgName = this.orgNames.get(record.organizationIds?.[0] ?? record.custodianId)
      ?? record.organizationIds?.[0] ?? record.custodianId;
    const author = record.participants?.find((p) => p.role === 'sender' || p.role === 'author');
    const authorName = author
      ? (this.peopleNames.get(author.personId) ?? peopleById.get(author.personId) ?? author.personId)
      : '';
    const hitState = this.searched
      ? (this.hits.has(id) ? `HIT for "${this.lastTerm}"` : `not a hit for "${this.lastTerm}"`)
      : '';
    const lines = [
      `${record.id.toUpperCase()} · ${record.kind}${hitState ? ` · ${hitState}` : ''}`,
      record.title.slice(0, 44),
      `${record.date} · ${orgName}${authorName ? ` · ${authorName}` : ''}`,
    ];
    this.drawHoverSprite(sprite, lines);
    const scale = mesh.scale.x;
    const world = new Vector3(
      mesh.position.x + this.galaxyCurrent[idx * 3] * scale,
      mesh.position.y + this.galaxyCurrent[idx * 3 + 1] * scale + 0.16,
      mesh.position.z + this.galaxyCurrent[idx * 3 + 2] * scale,
    );
    const dist = this.camera.getWorldPosition(new Vector3()).distanceTo(world);
    const h = 0.11 * Math.max(0.7, Math.min(2.4, dist / 3));
    sprite.position.copy(world);
    sprite.scale.set(h * 3.4, h, 1);
    sprite.visible = true;
  }

  private drawHoverSprite(sprite: Sprite, lines: string[]): void {
    const material = sprite.material as SpriteMaterial;
    const texture = material.map as CanvasTexture | null;
    const canvas = texture?.image as HTMLCanvasElement | undefined;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !texture) return;
    // Size ONCE: assigning canvas.width reallocates the backing
    // store + GPU texture; doing it per hover redraw churned GPU
    // memory during head scanning (crash contributor, 2026-10-29).
    if (canvas.width !== 768 || canvas.height !== 226) {
      canvas.width = 768;
      canvas.height = 226;
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = 'rgba(10, 13, 18, 0.88)';
    ctx.strokeStyle = '#e8c56a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(3, 3, canvas.width - 6, canvas.height - 6, 24);
    ctx.fill();
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5d90a';
    ctx.font = '700 52px sans-serif';
    ctx.fillText(lines[0], 28, 42);
    ctx.fillStyle = '#f2f4f8';
    ctx.font = '46px sans-serif';
    ctx.fillText(lines[1], 28, 114);
    ctx.font = '42px sans-serif';
    ctx.fillStyle = '#c8d2e0';
    ctx.fillText(lines[2], 28, 178);
    texture.needsUpdate = true;
  }

  private updateLayoutAndEdges(): void {
    if (this.layoutAnimating) {
      let arrived = true;
      for (const [object, target] of this.layoutTargets) {
        if (object.position.distanceToSquared(target) < 0.0004) continue;
        arrived = false;
        object.position.lerp(target, 0.12);
      }
      if (arrived) this.layoutAnimating = false;
    }
    if (!this.edgeLines?.visible) return;
    const position = this.edgeLines.geometry.getAttribute('position') as BufferAttribute;
    const objectByRecord = new Map<string, Object3D>();
    this.slotObjects.forEach((object, i) => {
      const id = this.focusIds[i];
      if (id) objectByRecord.set(id, object);
    });
    let cursor = 0;
    for (const [a, b] of this.edgePairs) {
      const oa = objectByRecord.get(a);
      const ob = objectByRecord.get(b);
      if (!oa || !ob || cursor + 6 > position.count * 3) continue;
      position.setXYZ(cursor / 3, oa.position.x, oa.position.y, oa.position.z);
      position.setXYZ(cursor / 3 + 1, ob.position.x, ob.position.y, ob.position.z);
      cursor += 6;
    }
    this.edgeLines.geometry.setDrawRange(0, cursor / 3);
    position.needsUpdate = true;
  }

  private clearSearch(): void {
    // VISUAL-STATE RESET (forensic round, 2026-10-29 late). Search
    // never moves galaxy positions — it only recolors/rescales
    // instances and rebinds the detail orbs — so clearing must
    // NOT reset focus, rebind slots, rebuild labels, or recompute
    // layout. The old path did all of that plus two full buffer
    // uploads and a 1100x1300 texture upload inside ONE XR frame
    // (the "frame-split" flag was consumed by the same update()
    // that set it) and hard-froze Quest in VR and MR, repeatedly.
    // Now: state -> orb styling -> ONE galaxy color/scale reset,
    // panel paint deferred by frame counter. Breadcrumbs name the
    // last stage reached if the browser ever dies here again.
    // `?clearLegacy=1` restores the old reconstructive path for
    // on-device A/B isolation only.
    this.markBreadcrumb('clear:begin');
    this.session.clearSearch();
    this.searched = false;
    this.lastTerm = '';
    this.hits.clear();
    this.selectedId = undefined;
    this.markBreadcrumb('clear:state');
    const loaded = this.corpusMode === 'tradesecret' ? this.tradeSecretCache
      : this.corpusMode === 'galaxy' ? this.galaxyCache
        : this.corpusMode === 'expanded' ? this.expandedCache : undefined;
    if (!loaded) {
      this.refreshNodeStyling();
      this.drawIdlePanel('Search cleared');
      this.markBreadcrumb('clear:done-nocorpus');
      return;
    }
    if (typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('clearLegacy')) {
      this.focusIds = loaded.corpus.groundTruth.relevantRecordIds.slice(0, 8);
      this.rebindSlots();
      this.applyLens(false);
      this.drawIdlePanel('Search cleared (legacy path)');
      this.markBreadcrumb('clear:done-legacy');
      return;
    }
    // Diagnostic staging (2026-10-30): the full visual reset STILL
    // froze Quest, so each stage is independently enabled by
    // clearStageSetting() (default 5 = full). Telemetry marks every
    // completed substage on the PC; whichever stage first freezes
    // names its fault domain on the next attempt.
    const stage = clearStageSetting();
    diag('clear:stage-setting', { clearStage: stage });
    if (stage >= 3) {
      this.refreshNodeStyling(false);
      this.rebuildSelectionEdges();
      this.markBreadcrumb('clear:orbs');
    }
    if (stage >= 4) {
      this.refreshGalaxyStates(stage >= 5);
      this.markBreadcrumb(stage >= 5 ? 'clear:colors-matrices' : 'clear:colors-only');
    }
    if (stage >= 2) {
      this.pendingClearPanelAtFrame = this.breadcrumbFrame + 3;
      this.markBreadcrumb('clear:scheduled');
    } else {
      this.markBreadcrumb('clear:done-staged');
    }
  }

  /** Direct hit jump ("open hit three", any module/tab). */
  private async gotoHit(term: string): Promise<void> {
    const viaVoice = consumeVoiceHitNav();
    const silent = viaVoice ? {} : { silent: true as const };
    const list = this.session.hitList();
    const parsed = Number.parseInt(term, 10);
    const idx = parsed === -1 ? list.length - 1 : parsed;
    const id = list[idx];
    if (!id) {
      pushSpeech('assistant', `Search expert: there is no hit ${parsed === -1 ? '(last)' : parsed + 1} — ${list.length} hit(s) in the current search. Run a search first, then say "next hit" or "open hit two".`, silent);
      return;
    }
    await this.select(id);
    const record = this.store.getRecord(id);
    pushSpeech('assistant', `Search expert: hit ${idx + 1} of ${list.length}: "${record?.title ?? id}" (${id}) — opened on the source card.`, silent);
  }

  private async navigate(direction: 1 | -1): Promise<void> {
    const viaVoice = consumeVoiceHitNav();
    const silent = viaVoice ? {} : { silent: true as const };
    const id = direction > 0 ? this.session.nextHit() : this.session.previousHit();
    if (!id) {
      this.drawPanel({
        status: 'No hits to step through',
        title: 'Run a search first',
        sections: [
          {
            label: 'How',
            lines: ['Type a keyword and Run My Search,', 'then step with Next Hit / Prev Hit.'],
          },
        ],
      });
      pushSpeech('assistant', 'Search expert: no hits to step through yet — say "search for Falcon" first.', silent);
      return;
    }
    await this.select(id);
    const list = this.session.hitList();
    const record = this.store.getRecord(id);
    pushSpeech('assistant', `Search expert: hit ${list.indexOf(id) + 1} of ${list.length}: "${record?.title ?? id}" (${id}) — opened on the source card.`, silent);
  }

  private async select(recordId: string): Promise<void> {
    this.selectedId = recordId;
    this.visited.add(recordId);
    // Galaxy detail anchor: the selected record always gets a
    // detailed orb (others stay demoted in galaxy mode, below).
    if ((this.corpusMode === 'galaxy' || this.corpusMode === 'tradesecret') && !this.focusIds.includes(recordId)) {
      this.focusIds = [recordId, ...this.focusIds].slice(0, 8);
      this.rebindSlots();
      this.applyLens(false);
    }
    const { record, provenance } = await this.session.open(recordId);
    // P0 (2026-10-29): a hit outside the rendered detail orbs (e.g. hit
    // 12 of 12) must become a visible, tappable node as its source
    // opens — evidence access never depends on prior rendering.
    let windowNote: string | undefined;
    if (this.searched && record) {
      const hitList = this.session.hitList();
      const idx = hitList.indexOf(recordId);
      if (idx >= 0 && !this.focusIds.includes(recordId)) {
        this.focusIds = focusWindowForHit(hitList, idx);
        this.rebindSlots();
        this.applyLens(false);
        windowNote = `Hit ${idx + 1} of ${hitList.length} is now shown as a detail orb.`;
      }
    }
    this.refreshNodeStyling();
    this.rebuildSelectionEdges();
    if (!record) {
      this.drawPanel({
        status: 'Record not found',
        title: recordId,
        sections: [{ lines: ['Not found in the evidence store.'] }],
      });
      return;
    }
    const nameOf = (id: string) => this.peopleNames.get(id) ?? peopleById.get(id) ?? id;
    const hitTotal = this.session.hitList().length;
    const hitIndex = this.session.hitIndex();
    // State clarity (headset report): keyword-search hits, the AI-
    // retrieved set, and free exploration are three different states
    // and must never share one ambiguous label like "Hit 0 of 0".
    const status = !this.searched
      ? `${this.store.size} records in corpus - no active search (${this.corpusLabel()})`
      : hitTotal > 0
        ? this.hits.has(recordId)
          ? `Keyword hit ${hitIndex + 1} of ${hitTotal} for "${this.lastTerm}"`
          : `Not a hit for "${this.lastTerm}" (${hitTotal} hit(s) in current search)`
        : `Shown bright by AI investigation - no keyword search is active`;
    const byRole = (role: string) =>
      (record.participants ?? []).filter((p) => p.role === role).map((p) => nameOf(p.personId));
    const from = [...byRole('sender'), ...byRole('author')];
    const to = byRole('recipient');
    const cc = byRole('cc');
    const relatedIds = this.store.related(recordId);
    const channelLines = (record.participants ?? [])
      .filter((p) => p.role === 'sender' || p.role === 'author')
      .flatMap((s) => (record.participants ?? [])
        .filter((p) => p.role === 'recipient' || p.role === 'cc')
        .map((r) => this.networkChannels.find(
          (e) => e.fromPersonId === s.personId && e.toPersonId === r.personId))
        .filter((e) => e != null)
        .map((e) => `Channel: ${nameOf(e.fromPersonId)} -> ${nameOf(e.toPersonId)} - ${e.weight} record(s) in corpus${this.channelIsCrossOrg(e) ? ' (CROSS-ORGANIZATION, gold line)' : ''}`));
    const relationshipLines = [
      ...channelLines,
      ...(record.links?.inReplyToId ? [`Replies to: ${record.links.inReplyToId} (tap via search "${record.links.inReplyToId}")`] : []),
      ...(relatedIds.length
        ? wrap(`Shares people/family with: ${relatedIds.join(', ')}`, 48)
        : ['No shared-people or reply relationships in this corpus.']),
      'Gold lines connect records sharing a person or a reply link.',
      'Lines are not tappable - inspect either endpoint node instead.',
      'The list above is corpus-wide, so a node may link beyond',
      'the visible neighbors.',
    ];
    // Executive summary: the three facts an attorney needs before
    // deciding whether to read on — who, when, and search state.
    // Stated, never concluded.
    const executiveSummary = [
      from.length ? `From ${from.join(', ')}${to.length ? ` to ${to.join(', ')}` : ''}.` : null,
      `${record.date} (${record.dateConfidence} confidence).`,
      this.searched
        ? (this.hits.has(recordId)
          ? `Keyword hit ${hitIndex + 1} of ${hitTotal} for "${this.lastTerm}".`
          : `Not a hit for "${this.lastTerm}" (${hitTotal} hit(s) in current search).`)
        : 'No active search — free exploration.',
    ].filter((l): l is string => l !== null).join(' ');
    this.drawPanel({
      status,
      title: `${record.id} - ${record.title}`,
      sections: [
        {
          // Legal-memo format (polish, 2026-11-02): the decision
          // path first — centered title, executive summary, then
          // numbered sections. Never a conclusion, only the path.
          label: `# ${record.id} — ${record.title}`,
          lines: [
            '## EXECUTIVE SUMMARY',
            ...wrap(executiveSummary, 48),
            '',
            `**1.  SOURCE TEXT — read this first**`,
            ...wrap(`"${record.body}"`, 48).map((l) => `__${l}__`),
          ],
        },
        {
          numbered: '2.',
          label: 'Record (who holds it, when)',
          lines: [
            ...(from.length ? [`From: ${from.join(', ')}`] : []),
            ...(to.length ? [`To: ${to.join(', ')}`] : []),
            ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
            ...(from.length || to.length
              ? []
              : [`People (no sender/recipient roles recorded): ${record.personIds.map(nameOf).join(', ')}`]),
            `Custodian: ${this.custodianNames.get(record.custodianId) ?? custodianById.get(record.custodianId) ?? record.custodianId}`,
            `Date: ${record.date} (${record.dateConfidence} confidence)`,
            ...(record.conceptTags?.length ? [`Concepts (authored labels): ${record.conceptTags.join(', ')}`] : []),
            // Machine overlay beside theory (owner, 2026-11-01):
            // both inspectable, never merged into one claim.
            ...(this.computedConcepts.get(record.id)
              ? [`Machine cluster (TF-IDF): ${this.computedConcepts.get(record.id)?.label}`]
              : []),
          ],
        },
        { numbered: '3.', label: 'Relationships (observed)', lines: relationshipLines },
        {
          numbered: '4.',
          label: 'Provenance (where this came from)',
          lines: [
            `${provenance?.sourceSystem ?? 'unknown'} / ${provenance?.collectionId ?? ''}`,
            // File-type truth on the card (owner: Word-cluster
            // confusion is answered by naming the actual file).
            `File type: ${EvidenceSystem.fileTypeCategory(record.loadFile?.extension, record.title)} (${record.loadFile?.extension ?? 'no load file'})`,
            `File: ${record.loadFile?.fileName ?? 'n/a'} · Bates: ${record.loadFile?.bates ?? 'n/a'}`,
            `Hash: ${provenance?.contentHash ?? 'n/a'}`,
          ],
        },
        {
          numbered: '5.',
          label: 'Scope (what you are looking at)',
          lines: [this.scopeLine(), ...(windowNote ? [windowNote] : [])],
        },
      ],
    });
  }

  // --- M4 bounded agent (B: discover; C: directed follow-up) ----------

  private async handleAgentAction(action: AgentAction, objective: string): Promise<void> {
    if (action === 'voice-status') {
      // Preserve the authored memo lines (Voice Help skeleton,
      // scope guidance): flattening them into one paragraph
      // destroyed the template formatting on this card.
      const rawLines = objective.split('\n');
      const titleLine = rawLines.find((l) => l.startsWith('# '));
      const firstLine = rawLines[0] ?? '';
      const bodyLines = rawLines.filter((l) => l !== titleLine && l !== firstLine);
      this.drawPanel({
        status: firstLine.startsWith('# ') ? '' : firstLine,
        title: titleLine ? titleLine.slice(2) : 'Voice',
        sections: [{ lines: bodyLines.length ? bodyLines : rawLines }],
      });
      return;
    }
    if (action === 'stop') {
      this.agentSignal.interrupted = true;
      abortCurrentChat();
      return;
    }
    if (action === 'approve') return this.approveRejectDisplayed('approved');
    if (action === 'reject') return this.approveRejectDisplayed('rejected');
    if (action === 'approve-all') return this.approveAllPending();
    if (action === 'export') return this.exportApproved();
    if (action === 'export-selected') return this.exportSelectedApproved();
    if (action === 'show-queue') return this.showApprovalQueue();
    if (action === 'remove-term') {
      const execs = this.state.listSearchExecutions().filter((e) => !this.excludedReportTerms.has(e.originalQuery));
      const last = execs[execs.length - 1];
      if (last) this.excludedReportTerms.add(last.originalQuery);
      this.drawPanel({
        status: last ? `Removed "${last.originalQuery}" from the hit report` : 'No search term to remove',
        title: 'Cumulative search term hit report',
        sections: this.approvalGroupSections(),
      });
      return;
    }
    if (action === 'export-search-report') return this.exportSearchReportCsv();
    if (action === 'export-docids-xlsx') return this.exportMarkedDocIdsCsv();
    if (action === 'export-zip') return this.exportAllZip();
    if (action === 'finding-prev' || action === 'finding-next') {
      // Explicit draft selection (Round 2 #7/#9): Approve/Reject
      // act ONLY on the displayed (selected) draft.
      if (this.pendingFindings.length === 0) {
        const approved = this.state.approvedFindings();
        if (approved.length) {
          const at = Math.max(0, approved.findIndex((f) => f.id === this.selectedApprovedFindingId));
          const delta = action === 'finding-next' ? 1 : -1;
          const selected = approved[(at + delta + approved.length) % approved.length];
          this.selectedApprovedFindingId = selected?.id;
          this.selectedExportArmed = false;
          this.drawSelectedApprovedFinding();
          return;
        }
        this.drawPanel({
          status: '0 drafts - nothing awaiting decision',
          title: 'Export queue is empty',
          sections: [{ label: 'FINDINGS LIST (Export queue)', lines: this.findingsRegisterLines() }],
        });
        return;
      }
      const idx = this.pendingFindings.findIndex((e) => e.findingId === this.displayedFindingId);
      const delta = action === 'finding-next' ? 1 : -1;
      const next = this.pendingFindings[
        (idx + delta + this.pendingFindings.length) % this.pendingFindings.length
      ] ?? this.pendingFindings[0];
      this.displayedFindingId = next?.findingId;
      this.drawPendingFinding();
      return;
    }
    const question = objective.trim();
    // Explicit drafting request (owner, 2026-11-02): the
    // run RESULT decides the outcome, never a leftover busy
    // flag or a scoped pre-check. The demo tap runs the model;
    // a successful run leaves staged candidates and the draft
    // path below queues them — no "choose a lead" refusal.
    // ALL typed/voice draft requests share requestDraftFromContext.
    if (/^(draft|prepare|queue|add)\b[^.]*\b(finding|draft)\b/i.test(question) || /^draft (it|that|this)\b/i.test(question)) {
      this.requestDraftFromContext(`"${question.slice(0, 60)}"`);
      return;
    }
    // Deterministic router first (final run): navigation,
    // explanation, matter memory, text/metadata/hybrid search
    // and aggregations are COMPUTED (exhaustive, scoped) —
    // the model only sees questions no route can answer.
    const routed = question ? routeQuestion(this.store, question) : null;
    if (routed) {
      this.matterMemory = noteObjective(this.matterMemory, question);
      if (routed.route === 'investigation') return this.runOrchestratedInvestigation();
      if (routed.route === 'navigate' && routed.lens) {
        this.lens = routed.lens as LensName;
        this.applyLens(true);
        return;
      }
      if (routed.route === 'memory') {
        if (routed.memoryAction === 'remember' && routed.memoryText) {
          this.matterMemory = rememberNote(this.matterMemory, routed.memoryText);
          saveDurable(typeof localStorage !== 'undefined' ? localStorage : undefined, this.matterMemory.durableNotes);
        } else if (routed.memoryAction === 'reset') {
          this.matterMemory = resetDurable(this.matterMemory);
          saveDurable(typeof localStorage !== 'undefined' ? localStorage : undefined, []);
        }
        this.drawPanel({
          status: routed.title, title: 'Matter-scoped assistant memory',
          sections: [
            { label: 'Memory (reviewable; say "reset memory" to clear durable)', lines: memoryLines(this.matterMemory).flatMap((l) => wrap(l, 48)) },
            { label: 'Guardrails', lines: ['Memory never changes evidence.', 'Durable notes need your "remember:" command.', 'Nothing is sent for external training.'] },
          ],
        });
        return;
      }
      // Investigation answer sets REPLACE the highlight set
      // (the answer must be visible in space). The previous
      // keyword search is re-runnable in one utterance — and the
      // scope hint below offers hits-only bounding next time.
      const scoped = this.applyInvestScope(routed.recordIds);
      if (scoped.ids.length) {
        this.searched = true;
        this.lastTerm = question;
        this.hits = new Set(scoped.ids);
        this.refreshNodeStyling();
      }
      this.drawPanel({
        status: `Assistant route: ${routed.route}${routed.exhaustive ? ' (exhaustive)' : ''} — ${this.corpusLabel()}`,
        title: routed.title,
        sections: [
          { label: 'Answer (computed, no model guesswork)', lines: routed.lines.flatMap((l) => wrap(l, 48)) },
          { label: 'Scope', lines: [scoped.scopeNote, ...this.scopeHintLines()] },
          { label: 'Next', lines: ['Tap a highlighted node for its source.', 'Search tab: Add Search Report / Export Document IDs.'] },
        ],
      });
      return;
    }
    // NL intent routing (Round 2 #3): "find documents containing
    // X" is RETRIEVAL, not analytics and not a finding. Route to
    // keyword/phrase search; verified hit count comes from the
    // store, and submission to the Export queue stays deliberate.
    const docSearch = /^(?:find|show|list|search(?: for)?|get)\b[^.]*?\b(?:documents|records|emails|files)\b[^.]*?\b(?:containing|mentioning|with|about)\b\s*(?:the phrase\s*)?["']?(.+?)["']?\.?$/i
      .exec(question)
      ?? /\bcontaining the phrase\s+["']?(.+?)["']?\.?$/i.exec(question);
    if (docSearch?.[1]) {
      await this.runSearch(docSearch[1].trim());
      return;
    }
    if (!question) {
      // Never substitute the demo preset for an empty question
      // (owner correction 2026-10-27: that fallback made "Ask AI"
      // feel predetermined). Say exactly what to do instead.
      this.drawPanel({
        status: 'No question typed yet',
        title: 'Ask your own question',
        sections: [
          {
            label: 'How',
            lines: [
              'DISCOVER tab: tap the question field, type',
              'with the Quest keyboard, then Ask My Question.',
              'Or use AI Investigate: Trade Secret for the preset.',
            ],
          },
        ],
      });
      return;
    }
    // Direct investigate (owner, 2026-11-02 round 4): asking a
    // question RUNS the AI on the source card immediately. The
    // old detour (leads card, then find Prepare Draft Finding)
    // read as "the AI didn't run" in the headset, and its
    // staged-lead instructions are retired with it. Drafts are
    // still never auto-approved — you decide in Export.
    this.matterMemory = noteObjective(this.matterMemory, question);
    const leadDraft = Boolean(this.stagedLeadQuestion && question === this.stagedLeadQuestion);
    return this.runAgent(question, leadDraft);
  }

  /** Mark DocIDs for export with provenance (owner vision):
   * Explore marks the selected node; Investigate/Search mark
   * the highlighted set. Deduped by ID+module. */
  private markDocIds(module: string): void {
    const ids = module === 'Explore'
      ? (this.selectedId ? [this.selectedId] : [])
      : [...this.hits];
    if (!ids.length) {
      this.drawPanel({
        status: 'Nothing to mark yet',
        title: module === 'Explore' ? 'Select a node first, then Mark DocID' : 'Run a search or investigation first',
        sections: [{ label: 'Active scope', lines: [this.scopeLine()] }],
      });
      return;
    }
    const reason = module === 'Explore'
      ? `Lens: ${this.lens}`
      : module === 'Search' ? `"${this.lastTerm}" hit` : `Investigation: ${this.lastTerm || 'lead evidence'}`;
    let added = 0;
    for (const id of ids) {
      if (!this.markedDocs.some((m) => m.id === id && m.module === module)) {
        this.markedDocs.push({ id, module, reason });
        added += 1;
      }
    }
    this.drawPanel({
      status: `Marked ${added} new DocID(s) for export (${this.markedDocs.length} total)`,
      title: 'DocIDs live in Approve → Export, with provenance',
      sections: [
        { label: 'Just marked', lines: ids.slice(0, 10).map((id) => `${id} | ${module} | ${reason}`) },
        { label: 'Active scope', lines: [this.scopeLine()] },
      ],
    });
  }

  /** Queue staged candidates as drafts — ONLY on explicit user
   * request (vision: attorney decides when to draft). Never
   * refuses: with no answer, lead, or finding to draft, it says
   * exactly what to do instead of gating on a lead. */
  private queueCandidates(): void {
    if (!this.candidates?.drafts.length) {
      this.drawPanel({
        status: 'Nothing to draft yet',
        title: 'Ask a question or explore a lead first',
        sections: [{ lines: ['Investigate: ask anything ("ask who emailed Reyes"), explore a lead, or select / highlight records — then say "prepare draft finding".'] }],
      });
      return;
    }
    const runId = ++this.runCounter;
    for (const draft of this.candidates.drafts) {
      this.queueFindingDraft(draft, this.candidates.question, this.candidates.runLabel, runId);
    }
    const n = this.candidates.drafts.length;
    this.candidates = undefined;
    this.drawPendingFinding(`Drafted ${n} finding(s) at your request — decide in Approve`);
  }

  /** Approve-tab entry view: three grouped decision lists. */
  private approvalGroupSections(): { label: string; lines: string[] }[] {
    const executions = this.state.listSearchExecutions()
      .filter((e) => !this.excludedReportTerms.has(e.originalQuery));
    const familyOf = new Map<string, Set<string>>();
    for (const id of this.store.allIds()) {
      const r = this.store.getRecord(id);
      const fam = r?.links?.familyId;
      if (fam) {
        if (!familyOf.has(fam)) familyOf.set(fam, new Set());
        familyOf.get(fam)?.add(id);
      }
    }
    const reportLines = executions.length
      ? executions.map((e) => {
          const withFamily = new Set<string>();
          for (const id of e.matchedRecordIds) {
            withFamily.add(id);
            const fam = this.store.getRecord(id)?.links?.familyId;
            if (fam) for (const m of familyOf.get(fam) ?? []) withFamily.add(m);
          }
          return `"${e.originalQuery}": ${e.matchedRecordIds.length} hits · ${withFamily.size} with family · ${new Set(e.matchedRecordIds).size} unique`;
        })
      : ['No searches yet this session.'];
    return [
      { label: 'SEARCH TERM HIT REPORT (cumulative)', lines: reportLines.flatMap((l) => wrap(l, 48)) },
      {
        label: `DOCIDs MARKED FOR EXPORT (${this.markedDocs.length})`,
        lines: this.markedDocs.length
          ? this.markedDocs.slice(0, 15).map((m) => `${m.id} | ${m.module} | ${m.reason}`)
          : ['None marked yet. Use Mark DocID in Explore,', 'Investigate, or Search.'],
      },
    ];
  }

  private showApprovalQueue(): void {
    // The EXPORT tab is the decision desk (Review tab removed,
    // owner 2026-11-02): pending drafts, approved findings, and
    // the downloads live in one place. Zero drafts still offers
    // the whole path — never a bare "0 drafts" wall.
    if (this.pendingFindings.length) {
      this.drawPendingFinding();
      return;
    }
    const approved = this.state.approvedFindings();
    this.drawPanel({
      status: approved.length
        ? `${approved.length} approved finding(s) ready to export`
        : 'EXPORT: 0 drafts awaiting decision',
      title: 'Export — approve drafts, then download',
      sections: [
        { label: 'Pending drafts (tap Previous/Next Draft to select)', lines: this.findingsRegisterLines().length ? this.findingsRegisterLines() : ['None undecided right now.'] },
        { label: 'Approved findings (these WILL export)', lines: approved.length ? approved.map((f, i) => `${f.id === this.selectedApprovedFindingId ? '>> ' : ''}${i + 1}. [APPROVED] (${f.id}) ${headlineClaim(f.claim).slice(0, 90)} (${f.citationIds.join(', ')})`) : ['None approved yet.'] },
        {
          label: 'How to approve a finding',
          lines: [
            '1. Prepare Draft Finding (Investigate tools),',
            'or ask a question and draft its answer.',
            '2. Export tab: Previous/Next Draft to show it.',
            '3. Tap Approve Draft Finding — or Approve All Draft',
            'Findings to approve every waiting draft at once.',
            '4. Below: Export All Approved (PDF Memo), or',
            'choose one approved finding with Previous/Next',
            'and Export Selected Finding (PDF).',
          ],
        },
        ...this.approvalGroupSections(),
      ],
    });
  }

  /**
   * Multi-specialist orchestrated investigation (M4 architecture
   * target): Retrieval → Relationship → Reasoning → QC gate →
   * Work Product. Draft findings enter the Export queue ONLY on
   * QC pass; the attorney still approves/rejects each one.
   */
  private async runOrchestratedInvestigation(): Promise<void> {
    if (!this.store.getRecord('ts-001')) {
      this.drawPanel({
        status: 'Investigation needs the Trade Secret collection',
        title: 'Switch corpus first',
        sections: [{ lines: ['Lenses tab: Corpus: Trade Secret 3000,', 'then ask again: "Assess whether Reyes', 'transferred Falcon source code externally".'] }],
      });
      return;
    }
    const inv = runReyesInvestigation(this.store);
    const runId = ++this.runCounter;
    // Fireworks Evidence Reasoner: adversarial second opinion
    // over the SAME packet; quotes re-verified, failures drop.
    let fwLines: string[] = ['Fireworks reasoner not run.'];
    const packetIds = [...new Set(inv.reasoning.hypotheses.flatMap((h) => [...h.support, ...h.counter].map((c) => c.recordId)))];
    try {
      const fw = await fireworksAssess(this.store, inv.question, packetIds);
      fwLines = [
        `[${fw.provider}:${fw.model}] supporting ${fw.supporting.length}, counter ${fw.counterevidence.length}, dropped-unverified ${fw.droppedUnverified}.`,
        ...fw.supporting.flatMap((s) => wrap(`SUPPORT ${s.recordId}: "${s.quote}" — ${s.note}`, 48)),
        ...fw.counterevidence.flatMap((s) => wrap(`COUNTER ${s.recordId}: "${s.quote}" — ${s.note}`, 48)),
        ...fw.missingProof.flatMap((s) => wrap(`Missing proof: ${s}`, 48)),
        ...fw.followUps.flatMap((s) => wrap(`Follow-up: ${s}`, 48)),
      ];
    } catch (e) {
      fwLines = [`Fireworks reasoner unavailable (${String((e as Error)?.message ?? e).slice(0, 120)}). Deterministic assessment stands.`];
    }
    if (inv.workProduct) {
      // Candidates, not drafts — attorney requests drafting.
      this.candidates = {
        drafts: inv.workProduct.draftFindings,
        question: inv.question,
        runLabel: `orchestrated run #${runId}`,
      };
    }
    const focusIds = [...new Set(inv.reasoning.hypotheses.flatMap((h) => [...h.support, ...h.counter].map((c) => c.recordId)))];
    this.searched = true;
    this.lastTerm = 'Reyes investigation evidence';
    this.hits = new Set(focusIds);
    this.refreshNodeStyling();
    this.drawPanel({
      status: inv.status === 'complete'
        ? `Orchestrated investigation complete — QC PASS, ${inv.workProduct?.draftFindings.length ?? 0} candidate(s) ready (not drafted)`
        : 'QC FAILED — drafts withheld (see failures)',
      title: inv.question,
      sections: [
        {
          label: 'Specialist audit trail',
          lines: inv.audit.flatMap((a) => wrap(`${a.step}. [${a.actor}] ${a.action}: ${a.detail}`, 48)),
        },
        {
          label: 'Hypotheses (Evidence Reasoner)',
          lines: inv.reasoning.hypotheses.flatMap((h) => wrap(`${h.id} [${h.verdict}] ${h.statement}`, 48)),
        },
        { label: 'Overall assessment', lines: wrap(inv.reasoning.overall, 48) },
        { label: 'Fireworks Evidence Reasoner (adversarial check)', lines: fwLines },
        ...(inv.qc.failures.length
          ? [{ label: 'QC failures', lines: inv.qc.failures.flatMap((f) => wrap(f, 48)) }]
          : []),
        {
          label: 'Model routing (actual)',
          lines: wrap(inv.modelRouting, 48),
        },
        {
          label: 'Next',
          lines: ['Export tab: review each draft with Previous/Next Draft.', 'Search tab: Export Document IDs exports', 'the highlighted evidence set.'],
        },
      ],
    });
  }

  private async runAgent(objective: string, draftRequested = false): Promise<void> {
    // A run that already finished (success, error, or stop)
    // must never report "busy" again (owner, 2026-11-02: the
    // demo button worked once, then every later press claimed
    // the AI was still working). A stale busy flag older than
    // the longest bounded run is cleared with a one-line note
    // instead of silently swallowing the new question.
    if (this.agentBusy) {
      const busyMs = performance.now() - (this.agentBusySince ?? performance.now());
      if (busyMs > 180000) {
        diag('ai-busy-stale-reset', { busyMs: Math.round(busyMs) });
        this.agentBusy = false;
        agentStatus.busy = false;
        agentStatus.nonce += 1;
      } else {
        // Never swallow a follow-up question silently: queue it and say so.
        this.pendingObjective = objective;
        this.drawPanel({
          status: 'AI is busy - your follow-up is QUEUED',
          title: objective,
          sections: [
            { label: 'What happens', lines: ['It runs automatically when the current', 'investigation finishes or you Stop AI.'] },
          ],
        });
        return;
      }
    }
    this.agentBusy = true;
    this.agentBusySince = performance.now();
    agentStatus.busy = true;
    agentStatus.nonce += 1;
    setSpeechStatus('AI is working — watch the source card; say STOP anytime');
    this.exportArmed = false;
    this.agentSignal = { interrupted: false };
    // Run identity assigned at START so every panel, draft, audit
    // line, and telemetry event of this run carries it (P0.1:
    // previously incremented only on findings, and the panel
    // kept showing the oldest undecided draft from earlier runs).
    const runId = ++this.runCounter;
    this.lastRunSteps = [];
    diag('ai-run-start', { run: runId, corpus: this.activeCorpusId().id });
    const seen = new Set<string>();
    try {
      const health = await inferenceHealth();
      const liveLabel =
        health.activeProvider === 'stub'
          ? 'STUB provider - NO live model configured'
          : `live via ${health.activeProvider}`;
      // Contextual follow-up: whatever the investigator is currently
      // examining (selected record, undecided draft) is identified to
      // the model AND shown on the panel, so "what about this one?"
      // style questions are anchored — never silently context-free.
      const contextBits: string[] = [];
      // Spatial selection as structured prompt input (interaction.ts):
      // IDs validated against the store before the model sees them.
      const selection = emptySelection('atlas-session', objective);
      selection.activeLens = this.lens as ActiveLens;
      if (this.selectedId) selection.selectedSourceIds = [this.selectedId];
      if (validateSelectionContext(selection, this.store).ok && selection.selectedSourceIds.length) {
        const record = this.store.getRecord(this.selectedId ?? '');
        contextBits.push(
          `spatial selection ${describeSelection(selection)} - record "${record?.title ?? ''}" (${record?.date ?? '?'})`,
        );
      }
      if (this.pendingFindings[0]) {
        contextBits.push(
          `an undecided DRAFT finding awaits your decision: "${this.pendingFindings[0].draft.claim}"`,
        );
      }
      const approved = this.state.approvedFindings();
      if (approved.length) {
        selection.priorFindingIds = approved.map((f) => f.id);
        contextBits.push(
          `investigator has already APPROVED ${approved.length} finding(s): ${approved.map((f) => `"${f.claim.slice(0, 60)}"`).join('; ')} - build on these, do not re-litigate them`,
        );
      }
      const effectiveObjective = [
        objective,
        ...(contextBits.length ? [`[Investigator context: ${contextBits.join('; ')}]`] : []),
        // Hits-only scope is enforced deterministically on the
        // final highlight set below; this line asks the model to
        // prefer in-scope evidence while it reasons.
        ...(this.investScope === 'hits' && this.searched && this.hits.size > 0
          ? [`[Scope: investigate ONLY within these ${this.hits.size} highlighted record IDs: ${[...this.hits].slice(0, 60).join(', ')}${this.hits.size > 60 ? ' …' : ''}]`]
          : []),
      ].join('\n');
      this.state.setObjective(objective, 'investigator');
      const modeLabel = this.stagedLeadQuestion && this.stagedLeadQuestion === objective
        ? 'DISCOVER lead question'
        : `INVESTIGATE (${this.state.mode})`;
      this.drawPanel({
        status: `AI investigating - RUN #${runId} (${liveLabel})`,
        title: objective,
        sections: [
          { label: 'Mode', lines: [`${modeLabel} · ${this.corpusLabel()}`, `Lens: ${this.lens}`] },
          { label: 'Status', lines: ['Asking the model for a bounded plan...'] },
          ...(contextBits.length
            ? [{ label: 'Context carried into this question', lines: contextBits.flatMap((b) => wrap(b, 48)) }]
            : []),
        ],
      });
      const outcome = await runInvestigation(
        this.store,
        new ModelPlanner(),
        new ModelSynthesizer(),
        effectiveObjective,
        this.agentSignal,
        {
          onPlan: (plan) => {
            this.lastRunSteps = plan.steps.map(
              (s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args)}`,
            );
            this.drawPanel({
              status: `RUN #${runId} plan: ${plan.steps.length} step(s) (${liveLabel})`,
              title: objective,
              sections: [
                {
                  label: 'Visible plan',
                  lines: plan.steps.map(
                    (s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args)}`,
                  ),
                },
                { label: 'Control', lines: ['Stop AI halts before the next step.'] },
              ],
            });
          },
          onStep: async (index, call, result) => {
            result.recordIds.forEach((id) => seen.add(id));
            if (call.tool === 'search_records') {
              // Agent searches share the defensible execution record.
              this.state.recordSearchExecution({
                actor: 'agent',
                originalQuery: objective,
                operation: 'keyword-substring (agent tool)',
                executedQuery: String(call.args.term ?? ''),
                corpusId: this.activeCorpusId().id,
                corpusVersion: this.activeCorpusId().version,
                corpusSize: this.store.size,
                hitCount: result.recordIds.length,
                matchedRecordIds: [...result.recordIds],
              });
            }
            this.searched = true;
            this.lastTerm = 'AI investigation';
            this.hits = new Set(seen);
            this.refreshNodeStyling();
            this.lastRunSteps[index] =
              `${index + 1}. ${call.tool} -> ${result.recordIds.length} record(s): ${result.recordIds.slice(0, 6).join(', ')}${result.recordIds.length > 6 ? '…' : ''}`;
            this.drawPanel({
              status: `RUN #${runId} step ${index + 1}: ${call.tool} -> ${result.recordIds.length} record(s)`,
              title: objective,
              sections: [
                { label: 'Tool facts (deterministic)', lines: wrap(result.facts.join(' | '), 48) },
                { label: 'Proof so far', lines: [`${seen.size} record(s) bright in the universe.`] },
              ],
            });
            await delay(900);
          },
        },
      );
      if (outcome.findings.length > 0) {
        const lead = this.state.addLead({
          title: `AI run: ${objective.slice(0, 60)}`,
          source: 'agent',
          recordIds: [...seen],
          rationale: `Bounded run, ${outcome.results.length} tool step(s), status ${outcome.status}`,
        });
        void lead;
        const runLabel = `run #${runId} (${this.corpusLabel()}): "${objective.slice(0, 48)}"`;
        if (!draftRequested) {
          // Answer-first (vision): present as CANDIDATE answer,
          // queue nothing. User may say "draft that finding".
          // Hits-only scope is enforced here on the final set —
          // the model was asked to stay inside, this guarantees it.
          const scoped = this.applyInvestScope([...seen]);
          if (this.investScope === 'hits' && this.searched && this.hits.size > 0) {
            this.hits = new Set(scoped.ids);
            this.refreshNodeStyling();
          }
          this.candidates = { drafts: outcome.findings, question: objective, runLabel };
          // Same answer-first order as the draft card below:
          // answer (summary) -> citations (numbers) -> scope last.
          this.drawPanel({
            status: `Answer ready (run #${runId}) — NOT drafted`,
            title: objective,
            sections: [
              { label: '## EXECUTIVE SUMMARY', lines: outcome.findings.map((f) => f.claim) },
              ...outcome.findings.map((f, i) => ({
                numbered: `${i + 1}.`,
                label: `Citations — the records candidate answer ${i + 1} stands on [${f.groundedBy ?? 'quote'}-grounded]`,
                lines: (f.citations ?? []).length
                  ? (f.citations ?? []).flatMap((c, j) => wrap(`${j + 1}.  ${c.recordId}: "${c.quote}"`, 62))
                  : ['No verbatim quotation survived — treat as a labelled gap, not a conclusion.'],
              })),
              { numbered: `${outcome.findings.length + 1}.`, label: 'Scope (what you are looking at)', lines: [scoped.scopeNote, ...this.scopeHintLines(), this.scopeLine()] },
              ...(this.activeLead?.demoStep ? [{
                label: `Defined finding for Lead ${this.activeLead.demoStep} (shown again)`,
                lines: wrap(this.definedDraftForLead(this.activeLead)?.claim ?? this.activeLead.definedFinding ?? this.activeLead.summary, 62),
              }, {
                label: 'Next Steps',
                lines: this.demoNextStepLines(this.activeLead),
              }] : [{
                label: 'Your move', lines: ['Say or type "draft that finding" to', 'queue it in Approve — or ask a follow-up.'],
              }]),
            ],
          });
          return;
        }
        const demoLead = this.activeLead?.demoStep && objective === this.stagedLeadQuestion
          ? this.activeLead
          : undefined;
        const defined = demoLead ? this.definedDraftForLead(demoLead) : undefined;
        for (const modelDraft of outcome.findings) {
          const draft: FindingDraft = demoLead ? {
            ...modelDraft,
            title: modelDraft.title ?? defined?.title,
            counterCitations: modelDraft.counterCitations ?? defined?.counterCitations,
            gaps: modelDraft.gaps ?? defined?.gaps,
            verdict: modelDraft.verdict ?? defined?.verdict,
            leadId: demoLead.hypothesisId ?? demoLead.id,
            demoStep: demoLead.demoStep,
            sourceLabel: `Live model draft (${runLabel}); defined finding checked by specialists`,
          } : modelDraft;
          this.queueFindingDraft(draft, objective, runLabel, runId);
        }
        if (demoLead) {
          this.stagedLeadQuestion = '';
          this.activeLead = undefined;
          this.activeLeadIndex = -1;
          this.candidates = undefined;
        }
        diag('ai-run-complete', { run: runId, status: outcome.status, findings: outcome.findings.length });
        // Current-run view: the investigator decides THIS run's
        // drafts first; earlier undecided drafts stay queued and
        // are labelled as earlier-run work in the register.
        const firstNew = this.pendingFindings.find(
          (e) => this.state.listFindings().find((f) => f.id === e.findingId)?.runId === runId,
        );
        this.displayedFindingId = firstNew?.findingId;
        this.drawPendingFinding(`RUN #${runId} COMPLETE - ${outcome.findings.length} new draft(s) below`);
      } else {
        diag('ai-run-complete', { run: runId, status: outcome.status, findings: 0 });
        if (draftRequested && this.activeLead?.demoStep && objective === this.stagedLeadQuestion
          && outcome.status !== 'interrupted'
          && this.queueDefinedDemoDraft(this.activeLead, 'live model produced no quote-verified draft')) {
          return;
        }
        this.drawPanel({
          status: `RUN #${runId} finished: ${outcome.status} - NO new findings`,
          title: objective,
          sections: [
            {
              label: 'Honest outcome',
              lines:
                outcome.status === 'interrupted'
                  ? ['You stopped the run. No finding was drafted.']
                  : ['No quote-verified finding survived. This is a', 'labelled gap, not a conclusion. Search', 'independently, or direct a follow-up.'],
            },
            ...(this.lastRunSteps.length
              ? [{ label: 'Run steps (review at your pace)', lines: this.lastRunSteps }]
              : []),
            ...(this.pendingFindings.length
              ? [{
                  label: 'Earlier drafts untouched',
                  lines: [
                    `${this.pendingFindings.length} draft(s) from earlier run(s) still`,
                    'await decision in Review — they are NOT results',
                    'of this run. See register below.',
                  ],
                }]
              : []),
            { label: 'Audit (recent)', lines: outcome.audit.slice(-3).flatMap((a) => wrap(`${a.actor}: ${a.detail}`, 48)) },
            { label: 'Findings register (all runs)', lines: this.findingsRegisterLines() },
          ],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diag('ai-run-failed', { error: message.slice(0, 160), corpus: this.activeCorpusId().id });
      if (draftRequested && this.activeLead?.demoStep && objective === this.stagedLeadQuestion
        && this.queueDefinedDemoDraft(this.activeLead, 'live model unavailable; specialist draft used')) {
        return;
      }
      this.drawPanel({
        status: 'AI run failed - nothing was concluded',
        title: objective,
        sections: [
          { label: 'Error', lines: wrap(message, 48) },
          { label: 'Check', lines: ['If the error says network/proxy: is the dev', 'server running on the PC and this headset on', 'the same Wi-Fi? Reload the page, then retry.', 'Your own search still works (phase A).'] },
          ...(this.stagedLeadQuestion && this.stagedLeadQuestion === objective
            ? [{
                label: 'Your lead question is saved',
                lines: [
                  'Nothing was lost: tap Prepare Draft Finding',
                  'to retry the SAME question.',
                  'Lead, lens, and selections are unchanged.',
                ],
              }]
            : []),
        ],
      });
    } finally {
      this.agentBusy = false;
      this.agentBusySince = 0;
      if (this.pendingObjective) {
        const next = this.pendingObjective;
        this.pendingObjective = undefined;
        // A queued follow-up asked while the model was working
        // re-enters here with the flag clear — guaranteed to run.
        diag('ai-run-dequeue', { objective: next.slice(0, 80) });
        void this.runAgent(next);
      }
      agentStatus.busy = this.agentBusy;
      agentStatus.nonce += 1;
      if (!agentStatus.busy) {
        setSpeechStatus('Press X (left controller) and speak');
      }
    }
  }

  private corpusLabel(): string {
    if (this.corpusMode === 'tradesecret') {
      return `ACTIVE CORPUS: NovaChip Trade Secret ${this.store.size} (${this.tradeSecretCache?.corpusId ?? 'novachip-trade-secret'} v1, synthetic)`;
    }
    if (this.corpusMode === 'galaxy') {
      return `ACTIVE CORPUS: Atlas Galaxy ${this.store.size} (${this.galaxyCache?.corpusId ?? 'atlas-galaxy'} v1)`;
    }
    return 'ACTIVE CORPUS: Atlas Expanded 112 (atlas-expanded-001 v1)';
  }

  /** Machine identity of the active corpus for audit records.
   * Agent search executions previously hardcoded the fixture ID
   * in every mode (inventory G1) — audit labels must be true. */
  private activeCorpusId(): { id: string; version: string } {
    if (this.corpusMode === 'tradesecret' && this.tradeSecretCache) {
      return { id: this.tradeSecretCache.corpusId, version: this.tradeSecretCache.corpusVersion };
    }
    if (this.corpusMode === 'galaxy' && this.galaxyCache) {
      return { id: this.galaxyCache.corpusId, version: this.galaxyCache.corpusVersion };
    }
    if (this.corpusMode === 'expanded' && this.expandedCache) {
      return { id: this.expandedCache.corpusId, version: this.expandedCache.corpusVersion };
    }
    return { id: 'boot', version: '1' };
  }

  /** Always-visible state line: which corpus, which filter, how many
   * nodes are in space (2026-10-29: hidden filter/corpus state let
   * Discover appear to analyze the wrong scope). */
  private scopeLine(): string {
    const search = this.searched
      ? `Search "${this.lastTerm}": ${this.hits.size} hit(s)`
      : 'No active search';
    const scope = this.investScope === 'hits' && this.searched
      ? ' · Investigate scope: HIGHLIGHTED HITS'
      : '';
    return `${this.corpusLabel()} · ${search}${scope} · ${focusSummary(this.focusIds.length, this.store.size)}`;
  }

  /**
   * Bound an answer's record IDs to the highlighted hits when
   * scope is hits-only. Returns the bounded IDs plus a scope
   * label for the panel. Universe scope passes through.
   */
  private applyInvestScope(recordIds: string[]): { ids: string[]; scopeNote: string } {
    if (this.investScope !== 'hits' || !this.searched || this.hits.size === 0) {
      return { ids: recordIds, scopeNote: `Scope: whole universe (${this.corpusLabel()})` };
    }
    const bounded = recordIds.filter((id) => this.hits.has(id));
    return {
      ids: bounded,
      scopeNote: `Scope: your ${this.hits.size} highlighted hit(s) for "${this.lastTerm}" — `
        + `${bounded.length} of ${recordIds.length} answer record(s) inside`,
    };
  }

  /** One-line scope choice hint, shown whenever a search is
   * active and an investigative answer is presented. */
  private scopeHintLines(): string[] {
    if (!this.searched || this.hits.size === 0) return [];
    return this.investScope === 'hits'
      ? [`Investigating inside your ${this.hits.size} hit(s) — say "whole universe" to widen.`]
      : [`Investigating the whole universe — say "hits only" to stay inside your ${this.hits.size} hit(s).`];
  }

  /** Review register lines: every draft with its current status,
   * so "what do I have / what did I approve?" is one glance. */
  private findingsRegisterLines(): string[] {
    const all = this.state.listFindings();
    if (all.length === 0) return ['0 drafts - nothing awaiting decision.'];
    const mark = { draft: 'DRAFT ?', approved: 'APPROVED', rejected: 'REJECTED' } as const;
    return all.flatMap((f, i) => {
      const run = f.runId != null ? `run #${f.runId}` : (this.draftsByFindingId.get(f.id)?.runLabel ?? '');
      const here = f.id === this.displayedFindingId ? ' << DISPLAYED - Approve/Reject act on THIS' : '';
      return wrap(
        `${i + 1}. [${mark[f.status]}] (${f.id}) ${f.claim.slice(0, 100)} (${f.citationIds.join(', ')})${run ? ` — ${run}` : ''}${here}`,
        48,
      );
    });
  }

  private drawPendingFinding(banner?: string): void {
    // Displayed draft = decision target. Defaults to the oldest
    // undecided only when nothing newer was just produced.
    const current =
      this.pendingFindings.find((e) => e.findingId === this.displayedFindingId)
      ?? this.pendingFindings[0];
    this.displayedFindingId = current?.findingId;
    const approvedCount = this.state.approvedFindings().length;
    if (!current) {
      this.drawPanel({
        status: approvedCount
          ? `${approvedCount} approved finding(s) ready to export`
          : 'All draft findings decided',
        title: approvedCount
          ? 'Export — queue clear, downloads ready'
          : 'No drafts and nothing approved yet',
        sections: [
          {
            label: 'Next step',
            lines: approvedCount
              ? [
                `Press Export Approved ONCE to preview exactly`,
                `what will export (${approvedCount} finding(s)), then again to download it.`,
                'Rejected findings are never exported.',
              ]
              : [
                'Ask a question, explore a lead, or Prepare',
                'Draft Finding — then Approve or Reject it here.',
                'Rejected findings never export.',
              ],
          },
          { label: 'Findings register (all runs)', lines: this.findingsRegisterLines() },
        ],
      });
      return;
    }
    const { draft } = current;
    const total = this.draftsByFindingId.size;
    const index = total - this.pendingFindings.length + 1;
    const displayedFinding = this.state.listFindings().find((f) => f.id === current.findingId);
    // Final card order (owner, 2026-11-02): the EXECUTIVE
    // SUMMARY is the answer (the claim itself), the NUMBERS are
    // the citations, and scope + everything else comes last.
    const citationLines = draft.citations.flatMap((c, i) => {
      const record = this.store.getRecord(c.recordId);
      return wrap(
        `${i + 1}.  ${c.recordId} (${record?.date ?? '?'}, ${record?.dateConfidence ?? '?'}): "${c.quote}"`,
        62,
      );
    });
    this.drawPanel({
      status: draft.claim,
      title: `Finding ${current.findingId} — draft, NOT approved, will NOT export (${index} of ${total} undecided, ${current.runLabel})`,
      sections: [
        { label: '## EXECUTIVE SUMMARY', lines: [draft.claim] },
        {
          numbered: '1.',
          label: 'Citations — the records this answer stands on (tap the nodes to inspect)',
          lines: citationLines.length
            ? citationLines
            : [`${draft.citationIds.map((id, i) => `${i + 1}. ${id}`).join('  ')}`],
        },
        {
          numbered: '2.',
          label: 'Contradictory / other evidence',
          lines: [
            ...((draft.counterCitations ?? []).length
              ? draft.counterCitations!.flatMap((c, i) => wrap(`${i + 1}. ${c.recordId}: "${c.quote}"`, 62))
              : ['No counter-citation was supplied with this draft. Search independently before deciding.']),
            ...((draft.gaps ?? []).length
              ? draft.gaps!.flatMap((g) => wrap(`Gap: ${g}`, 62))
              : []),
          ],
        },
        ...(displayedFinding?.groundedBy === 'metadata'
          ? [{
              numbered: '3.',
              label: 'Grounding',
              lines: ['METADATA-GROUNDED: deterministic collection analytics (computed counts). Example records above. No quotation is claimed for the numbers.'],
            }]
          : [{
              numbered: '3.',
              label: 'Grounding',
              lines: ['DOCUMENT-GROUNDED: the quotations in section 1 were machine-verified verbatim against source records.'],
            }]),
        ...(displayedFinding?.question
          ? [{
              numbered: '4.',
              label: 'Question this draft answers',
              lines: wrap(displayedFinding.question, 62),
            }]
          : []),
        {
          numbered: '5.',
          label: 'Decide (Export tab) — target is THIS finding',
          lines: [
            `APPROVE acts ONLY on ${current.findingId}: its text + citations + provenance WILL export.`,
            'REJECT permanently excludes THIS finding only.',
            `Approved so far: ${approvedCount}. Pending: ${this.pendingFindings.length}.`,
          ],
        },
        {
          numbered: '6.',
          label: 'Scope (what you are looking at)',
          lines: [
            this.scopeLine(),
            'Discover analyzes the ENTIRE active corpus;',
            'an Investigate search filter does not limit it.',
          ],
        },
        {
          numbered: '7.',
          label: 'Findings queue (all runs)',
          lines: [
            `Welcome to Export approval. ${this.pendingFindings.length} draft(s) awaiting decision; ${this.matterMemory.sessionSearches.length} search(es) run this session.`,
            'Select Previous/Next Draft to choose; Approve/Reject act on the DISPLAYED item only.',
            ...this.findingsRegisterLines(),
          ].flatMap((l) => wrap(l, 62)),
        },
        ...this.approvalGroupSections(),
        ...(this.lastRunSteps.length
          ? [{ label: 'Latest run steps (review at your pace)', lines: this.lastRunSteps }]
          : []),
      ],
    });
  }

  private approveRejectDisplayed(decision: 'approved' | 'rejected'): void {
    diag('finding-approve-tap', {
      decision,
      pending: this.pendingFindings.length,
      displayed: this.displayedFindingId ?? 'none',
    });
    // Approve/Reject act ONLY on the DISPLAYED draft (owner,
    // 2026-11-02: every approve press errored — an unknown-id
    // throw left the card on a stale error instead of deciding).
    // With several drafts, Previous/Next Draft chooses which one
    // is displayed; Approve then DECIDES that displayed draft.
    // (The former >1 branch redrew the selection card forever,
    // so no multi-finding run could ever be approved on Quest.)
    // A missing finding id logs and advances instead of throwing.
    // Approval lives in the EXPORT tab (Review tab removed,
    // 2026-11-02) — every card names Export, never Review.
    if (this.pendingFindings.length === 0) {
      this.drawPanel({
        status: 'No draft finding is waiting for a decision',
        title: 'Export queue is empty',
        sections: [
          {
            label: 'Next step',
            lines: [
              'Ask a question, explore a lead, or Prepare',
              'Draft Finding — then Approve or Reject it here.',
              'Rejected findings never export.',
            ],
          },
          { label: 'Findings register (all runs)', lines: this.findingsRegisterLines() },
        ],
      });
      return;
    }
    const current =
      this.pendingFindings.find((e) => e.findingId === this.displayedFindingId)
      ?? this.pendingFindings[0];
    this.displayedFindingId = current?.findingId;
    try {
      this.decideFinding(decision);
    } catch (error) {
      diag('finding-decide-failed', {
        finding: current?.findingId ?? 'none',
        error: error instanceof Error ? error.message.slice(0, 160) : String(error),
      });
      this.pendingFindings = this.pendingFindings.filter((e) => e.findingId !== current?.findingId);
      this.displayedFindingId = this.pendingFindings[0]?.findingId;
      this.drawPendingFinding();
    }
  }

  /**
   * Approve EVERY waiting draft in one tap (owner, 2026-11-04).
   * Same per-finding state transition as decideFinding, with the
   * same never-strand-the-queue rule: a stale register id is
   * logged, dropped, and counted — never thrown, never silently
   * approved. Tap-only by design (voice name-checks the button).
   */
  private approveAllPending(): void {
    diag('finding-approve-all-tap', { pending: this.pendingFindings.length });
    if (this.pendingFindings.length === 0) {
      // Identical friendly empty-queue card as single Approve.
      this.approveRejectDisplayed('approved');
      return;
    }
    const queue = [...this.pendingFindings];
    const approvedClaims: string[] = [];
    let lastApprovedId: string | undefined;
    let failed = 0;
    for (const entry of queue) {
      try {
        this.state.decideFinding(entry.findingId, 'approved');
        entry.draft.status = 'approved';
        approvedClaims.push(entry.draft.claim);
        lastApprovedId = entry.findingId;
        diag('finding-decided', { finding: entry.findingId, decision: 'approved', via: 'approve-all' });
      } catch (error) {
        failed += 1;
        diag('finding-decide-failed', {
          finding: entry.findingId,
          via: 'approve-all',
          error: error instanceof Error ? error.message.slice(0, 160) : String(error),
        });
      }
    }
    const processed = new Set(queue.map((e) => e.findingId));
    this.pendingFindings = this.pendingFindings.filter((e) => !processed.has(e.findingId));
    this.displayedFindingId = this.pendingFindings[0]?.findingId;
    if (lastApprovedId) this.selectedApprovedFindingId = lastApprovedId;
    // Re-arm export, exactly as a single decision does.
    this.selectedExportArmed = false;
    this.exportArmed = false;
    this.drawPanel({
      status: approvedClaims.length
        ? `RECORDED: APPROVED ALL - ${approvedClaims.length} draft finding(s) WILL EXPORT`
        : 'No draft could be approved - see the register below',
      title: 'All draft findings approved — ready to export',
      sections: [
        {
          label: '## EXECUTIVE SUMMARY',
          lines: [
            `${approvedClaims.length} draft finding(s) approved in one tap. They will export.`,
            ...(failed
              ? [`${failed} stale draft(s) could not be decided and were dropped from the queue.`]
              : []),
            `Approved total: ${this.state.approvedFindings().length}.`,
          ],
        },
        ...(approvedClaims.length
          ? [{
              numbered: '1.' as const,
              label: 'Approved now',
              lines: approvedClaims.flatMap((c, i) => wrap(`${i + 1}. ${c}`, 62)),
            }]
          : []),
        {
          label: 'Next step',
          lines: [
            'Now use the RIGHT-hand buttons: Export All Approved',
            '(PDF Memo), Export Selected Finding (PDF), or',
            'Export All as ZIP.',
          ],
        },
        { label: 'Findings register (all runs)', lines: this.findingsRegisterLines() },
      ],
    });
  }

  private decideFinding(decision: 'approved' | 'rejected'): void {
    // Decide the DISPLAYED draft (panel shows its ID + claim),
    // never silently the queue head (P0.1/P1.4).
    const at = Math.max(0, this.pendingFindings.findIndex(
      (e) => e.findingId === this.displayedFindingId,
    ));
    const current = this.pendingFindings.splice(at, 1)[0];
    if (!current) {
      this.drawPanel({
        status: 'No draft finding is waiting',
        title: 'Run AI Investigate first',
        sections: [{ lines: ['Approve/Reject act on the finding shown on this panel.'] }],
      });
      return;
    }
    diag('finding-decided', { finding: current.findingId, decision });
    // Advance within the same run first, then oldest remaining.
    const decidedRunId = this.state.listFindings().find((f) => f.id === current.findingId)?.runId;
    const nextSameRun = this.pendingFindings.find(
      (e) => this.state.listFindings().find((f) => f.id === e.findingId)?.runId === decidedRunId,
    );
    this.displayedFindingId = (nextSameRun ?? this.pendingFindings[0])?.findingId;
    try {
      this.state.decideFinding(current.findingId, decision);
    } catch (error) {
      // A missing register id (stale display after corpus
      // switch) must never strand the queue: log it, drop the
      // stale entry, and keep deciding the rest.
      diag('finding-decide-failed', {
        finding: current.findingId,
        error: error instanceof Error ? error.message.slice(0, 160) : String(error),
      });
      this.drawPendingFinding();
      return;
    }
    current.draft.status = decision;
    if (decision === 'approved') this.selectedApprovedFindingId = current.findingId;
    this.selectedExportArmed = false;
    // Re-arm export on every decision: approving after a
    // preview must show the NEW list, not download the old one.
    this.exportArmed = false;
    const banner =
      decision === 'approved'
        ? 'RECORDED: APPROVED - WILL EXPORT (next draft below)'
        : 'RECORDED: REJECTED - EXCLUDED FROM EXPORT (next draft below)';
    if (this.pendingFindings.length > 0) {
      this.drawPendingFinding(banner);
      return;
    }
    this.drawPanel({
      status: current.draft.claim,
      title: decision === 'approved'
        ? `Finding ${current.findingId} — APPROVED, WILL EXPORT (queue empty)`
        : `Finding ${current.findingId} — REJECTED, EXCLUDED FROM EXPORT (queue empty)`,
      sections: [
        { label: '## EXECUTIVE SUMMARY', lines: [current.draft.claim] },
        {
          numbered: '1.',
          label: 'Citations — the records this answer stands on',
          lines: current.draft.citations.length
            ? current.draft.citations.flatMap((c, i) => {
                const record = this.store.getRecord(c.recordId);
                return wrap(
                  `${i + 1}.  ${c.recordId} (${record?.date ?? '?'}, ${record?.dateConfidence ?? '?'}): "${c.quote}"`,
                  62,
                );
              })
            : [`${current.draft.citationIds.map((id, i) => `${i + 1}. ${id}`).join('  ')}`],
        },
        {
          numbered: '2.',
          label: 'Scope (what you were looking at)',
          lines: [
            this.scopeLine(),
            `Approved total: ${this.state.approvedFindings().length}.`,
            'Press Export Approved to preview the export.',
          ],
        },
      ],
    });
  }

  private csvEscape(v: string): string {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }
  private searchReportCsv(): string {
    const rows = ['Term,Hits,WithFamily,Unique,Corpus'];
    const familyOf = new Map<string, Set<string>>();
    for (const id of this.store.allIds()) {
      const fam = this.store.getRecord(id)?.links?.familyId;
      if (fam) { if (!familyOf.has(fam)) familyOf.set(fam, new Set()); familyOf.get(fam)?.add(id); }
    }
    for (const e of this.state.listSearchExecutions()) {
      if (this.excludedReportTerms.has(e.originalQuery)) continue;
      const withFamily = new Set<string>();
      for (const id of e.matchedRecordIds) {
        withFamily.add(id);
        const fam = this.store.getRecord(id)?.links?.familyId;
        if (fam) for (const m of familyOf.get(fam) ?? []) withFamily.add(m);
      }
      rows.push([e.originalQuery, String(e.matchedRecordIds.length), String(withFamily.size), String(new Set(e.matchedRecordIds).size), this.corpusLabel()].map((v) => this.csvEscape(v)).join(','));
    }
    return rows.join('\n') + '\n';
  }
  private markedDocIdsCsv(): string {
    const rows = ['DocID,Module,Reason,Title,Custodian,Date'];
    for (const m of this.markedDocs) {
      const r = this.store.getRecord(m.id);
      rows.push([m.id, m.module, m.reason, r?.title ?? '', r?.loadFile?.sec?.custodian ?? r?.custodianId ?? '', r?.date.slice(0, 10) ?? ''].map((v) => this.csvEscape(v)).join(','));
    }
    return rows.join('\n') + '\n';
  }
  private enrichedFinding(finding: StateFinding): StateFinding {
    const source = this.draftsByFindingId.get(finding.id)?.draft;
    if (!source) return finding;
    return {
      ...finding,
      title: finding.title ?? source.title,
      citations: finding.citations?.length ? finding.citations : source.citations,
      counterCitations: finding.counterCitations ?? source.counterCitations,
      gaps: finding.gaps ?? source.gaps,
      verdict: finding.verdict ?? source.verdict,
      leadId: finding.leadId ?? source.leadId,
      demoStep: finding.demoStep ?? source.demoStep,
      sourceLabel: finding.sourceLabel ?? source.sourceLabel,
    };
  }

  private selectedApprovedFinding(): StateFinding | undefined {
    const approved = this.state.approvedFindings();
    const selected = approved.find((f) => f.id === this.selectedApprovedFindingId) ?? approved[0];
    if (selected) this.selectedApprovedFindingId = selected.id;
    return selected;
  }

  private drawSelectedApprovedFinding(): void {
    const selected = this.selectedApprovedFinding();
    if (!selected) return;
    const approved = this.state.approvedFindings();
    const enriched = this.enrichedFinding(selected);
    this.drawPanel({
      status: `Selected approved finding ${approved.findIndex((f) => f.id === selected.id) + 1} of ${approved.length}: ${selected.id}`,
      title: enriched.title ?? 'Selected approved finding',
      sections: [
        { label: '## EXECUTIVE SUMMARY', lines: [headlineClaim(enriched.claim)] },
        {
          label: 'Citations',
          lines: (enriched.citations ?? []).length
            ? enriched.citations!.flatMap((c, i) => wrap(`${i + 1}. ${c.recordId}: "${c.quote}"`, 62))
            : [`Cited records: ${enriched.citationIds.join(', ')}`],
        },
        {
          label: 'Export just this lead',
          lines: [
            'Use Previous/Next Draft to choose among APPROVED findings when no drafts are pending.',
            'Press Export Selected Finding (PDF), preview, then press it again to download only this finding.',
            'Export All Approved (PDF Memo) remains available for the full set.',
          ],
        },
        { label: 'Findings register (all runs)', lines: this.findingsRegisterLines() },
      ],
    });
  }

  private findingsMemoFor(findings: StateFinding[], selectionLabel: string) {
    const enriched = findings.map((f) => this.enrichedFinding(f));
    const exportedAt = new Date().toISOString();
    const input = {
      corpusLabel: this.corpusLabel(),
      exportedAt,
      findings: enriched,
      audit: this.state.auditTrail(),
      searchExecutions: this.state.listSearchExecutions(),
      store: this.store,
      selectionLabel,
    };
    const memo = buildFindingsMemo(input);
    const pdf = makePdfBytes(memo.lines);
    const json = buildFindingsJsonPayload({
      ...input,
      objective: this.state.objective,
      annotations: this.state.buildExport(enriched.map((f) => f.id)).annotations,
    });
    return { ...memo, pdf, json };
  }

  private exportSelectedApproved(): void {
    const selected = this.selectedApprovedFinding();
    if (!selected) {
      this.drawPanel({
        status: 'Export refused',
        title: 'No approved finding selected',
        sections: [{ lines: ['Approve at least one draft first. With no drafts pending, Previous/Next Draft chooses among approved findings for single export.'] }],
      });
      return;
    }
    if (!this.selectedExportArmed) {
      this.selectedExportArmed = true;
      const enriched = this.enrichedFinding(selected);
      this.drawPanel({
        status: `SINGLE-FINDING EXPORT PREVIEW - only ${selected.id} will export`,
        title: 'Press Export Selected Finding again to download its PDF',
        sections: [
          { label: 'Exactly this approved finding', lines: wrap(headlineClaim(enriched.claim), 62) },
          { label: 'PDF contents', lines: ['Executive summary and finding first; quotations, counterevidence, scope, provenance, searches, and audit appendices at the end. Other approved findings are excluded.'] },
        ],
      });
      return;
    }
    this.selectedExportArmed = false;
    try {
      const built = this.findingsMemoFor([selected], `Single approved finding ${selected.id}`);
      downloadBlob(built.filename, new Blob([built.pdf as BlobPart], { type: 'application/pdf' }));
      diag('export-selected-pdf', { finding: selected.id });
      this.drawPanel({
        status: `Exported only ${selected.id} as a PDF findings memo`,
        title: `${built.filename} - download started (browser Downloads / Files)`,
        sections: [{ label: 'Contents', lines: ['This one approved finding, its verbatim citations and counterevidence, then scope/provenance/search/audit appendices.'] }],
      });
    } catch (error) {
      diag('export-selected-pdf-failed', {
        finding: selected.id,
        error: error instanceof Error ? error.message.slice(0, 160) : String(error),
      });
      this.drawPanel({
        status: 'Single-finding export FAILED - nothing was downloaded',
        title: selected.id,
        sections: [{ lines: wrap(error instanceof Error ? error.message : String(error), 62) }],
      });
    }
  }

  private exportSearchReportCsv(): void {
    downloadBlob('search-term-hit-report.csv', new Blob([this.searchReportCsv()], { type: 'text/csv' }));
    this.drawPanel({ status: 'Search hit report exported (CSV)', title: 'Filterable in Excel', sections: this.approvalGroupSections() });
  }
  private exportMarkedDocIdsCsv(): void {
    if (!this.markedDocs.length) {
      this.drawPanel({ status: 'No DocIDs marked yet', title: 'Mark DocIDs in Explore / Investigate / Search', sections: this.approvalGroupSections() });
      return;
    }
    downloadBlob('marked-docids.csv', new Blob([this.markedDocIdsCsv()], { type: 'text/csv' }));
    this.drawPanel({ status: `Exported ${this.markedDocs.length} marked DocID(s) (Excel CSV)`, title: 'Filter by Module or Reason in Excel', sections: this.approvalGroupSections() });
  }
  private exportAllZip(): void {
    const approved = this.state.approvedFindings();
    try {
      const built = approved.length
        ? this.findingsMemoFor(approved, `All ${approved.length} approved finding(s)`)
        : undefined;
      const zip = makeZip([
        ...(built ? [{ name: built.filename, data: built.pdf }] : []),
        { name: 'approved-findings.json', text: JSON.stringify(built?.json ?? { findings: [], note: 'No approved findings were available.' }, null, 2) },
        { name: 'search-term-hit-report.csv', text: this.searchReportCsv() },
        { name: 'marked-docids.csv', text: this.markedDocIdsCsv() },
        { name: 'README.txt', text: `Legal Data Universe work product\nCorpus: ${this.corpusLabel()}\nSynthetic demonstration data - not client evidence.\nStart with the PDF findings memo. JSON is the machine-readable companion; search reports and DocID lists carry their own provenance.\n` },
      ]);
      downloadBlob('legal-data-universe-work-product.zip', zip);
      diag('export-zip', { approved: approved.length, size: zip.size });
      this.drawPanel({
        status: built ? 'ZIP download started (PDF memo + JSON + hit report + DocIDs)' : 'ZIP download started (reports only - no approved findings/memo)',
        title: 'Find legal-data-universe-work-product.zip in browser Downloads / Files',
        sections: [
          { lines: [`${approved.length} approved finding(s), ${this.markedDocs.length} marked DocID(s).`, 'In Quest Browser, downloads appear under the browser menu > Downloads, and in the Files app.', 'On this PC the dev server also saves a copy in the app > exports folder.'] },
          ...this.approvalGroupSections(),
        ],
      });
    } catch (error) {
      diag('export-zip-failed', {
        approved: approved.length,
        error: error instanceof Error ? error.message.slice(0, 160) : String(error),
      });
      this.drawPanel({
        status: 'ZIP export FAILED - nothing was downloaded',
        title: 'ZIP export failed',
        sections: [
          { lines: wrap(error instanceof Error ? error.message : String(error), 62) },
          ...this.approvalGroupSections(),
        ],
      });
    }
  }

  private exportApproved(): void {
    const approved = this.state.approvedFindings();
    diag('export-tap', { approved: approved.length, armed: this.exportArmed });
    if (!this.exportArmed) {
      if (approved.length === 0) {
        this.drawPanel({
          status: 'Export refused',
          title: 'No approved finding yet',
          sections: [{ lines: ['Approve at least one draft finding first.', 'Rejected and undecided findings never export.'] }],
        });
        return;
      }
      this.exportArmed = true;
      this.drawPanel({
        status: `PDF MEMO PREVIEW - ${approved.length} approved finding(s) will export`,
        title: 'Press Export All Approved again to download the PDF',
        sections: [
          {
            label: 'Exactly these approved findings',
            lines: approved.flatMap((f, i) =>
              wrap(`${i + 1}. [${f.citationIds.join(', ')}] ${headlineClaim(f.claim)}`, 48),
            ),
          },
          {
            label: 'Memo order',
            lines: [
              'Executive summary and approved findings first.',
              'Quotations, counterevidence, gaps, and next steps',
              'follow. Scope, provenance, searches, and audit',
              'are appendices at the end. JSON is in Export ZIP.',
            ],
          },
        ],
      });
      return;
    }
    this.exportArmed = false;
    try {
      const built = this.findingsMemoFor(approved, `All ${approved.length} approved finding(s)`);
      downloadBlob(built.filename, new Blob([built.pdf as BlobPart], { type: 'application/pdf' }));
      diag('export-pdf', { approved: approved.length });
      this.drawPanel({
        status: `Exported ${approved.length} approved finding(s) as a PDF findings memo`,
        title: `${built.filename} - download started (browser Downloads / Files)`,
        sections: [
          { label: 'Contents', lines: ['Findings first, then evidence and counterevidence, with scope/provenance/search/audit appendices at the end.', 'Use Export All as ZIP when you also need the JSON companion and CSV reports.'] },
        ],
      });
    } catch (error) {
      diag('export-pdf-failed', {
        approved: approved.length,
        error: error instanceof Error ? error.message.slice(0, 160) : String(error),
      });
      this.drawPanel({
        status: 'PDF export FAILED - nothing was downloaded',
        title: 'PDF export failed - see message below',
        sections: [{ lines: wrap(error instanceof Error ? error.message : String(error), 48) }],
      });
    }
  }

  /** Opacity applies immediately; scale eases over a short transition.
   * `includeGalaxy=false` skips the galaxy buffer upload when the
   * caller performs its own single reset (Clear Search). */
  private refreshNodeStyling(includeGalaxy = true): void {
    for (const [object, recordId] of this.nodeByObject) {
      const visual = nodeVisual({
        searched: this.searched,
        isHit: this.hits.has(recordId),
        isSelected: recordId === this.selectedId,
        isVisited: this.visited.has(recordId),
      });
      for (const material of this.materialsByObject.get(object) ?? []) {
        material.opacity = visual.opacity;
        material.depthWrite = visual.opacity >= 1;
      }
      // Labels follow node emphasis but stay findable (floor 0.4).
      const label = this.nodeLabels.get(object);
      if (label) label.material.opacity = Math.max(0.4, visual.opacity);
    }
    // Galaxy mode demotes the foreground orbs (owner, 2026-10-29):
    // only the selected record's detail orb shows; the instanced
    // universe is the primary representation.
    if (this.corpusMode === 'galaxy' || this.corpusMode === 'tradesecret') {
      this.slotObjects.forEach((object, i) => {
        object.visible = this.focusIds[i] != null && this.focusIds[i] === this.selectedId;
      });
    }
    if (includeGalaxy) this.refreshGalaxyStates();
    this.scaleAnimating = true;
  }

  private drawIdlePanel(status?: string): void {
    status ??= `${focusSummary(this.focusIds.length, this.store.size)} - no active search`;
    let lastError: string | null = null;
    let breadcrumbs: string | null = null;
    try {
      lastError = sessionStorage.getItem('mmdata-last-error');
      breadcrumbs = sessionStorage.getItem('mmdata-breadcrumbs');
    } catch { /* diagnostics only */ }
    // Insight-first entry (owner direction 2026-10-27): lead with the
    // investigation and the one next action, not control instructions.
    this.drawPanel({
      status,
      title: this.corpusMode === 'tradesecret'
        ? 'Investigation: the NovaChip Falcon source code'
        : 'Investigation: the Atlas delivery date',
      sections: [
        {
          label: 'The question',
          lines: wrap(DEFAULT_OBJECTIVE, 48),
        },
        {
          label: 'Fastest path to insight',
          lines: [
            '1. DISCOVER tab -> AI Investigate: a live Meta',
            '   model plans, searches, and drafts findings',
            '   with verbatim quotations (about 15 seconds).',
            '2. INVESTIGATE tab: run your own searches and',
            '   tap bright nodes to read the sources.',
            '3. HUMAN APPROVAL tab: approve or reject each draft.',
            '   Nothing exports without your approval.',
          ],
        },
        {
          label: 'Reading the universe',
          lines: ['Bright = hit.  Mid = already examined.', 'Dim = no match.  Largest = open here.'],
        },
        ...(lastError
          ? [{ label: 'Last session error (diagnostic)', lines: wrap(lastError, 48) }]
          : []),
        ...(breadcrumbs
          ? [{ label: 'Crash breadcrumbs (diagnostic)', lines: wrap(breadcrumbs, 48) }]
          : []),
        {
          label: 'Clear diagnostic stage',
          lines: [
            `Stage ${clearStageSetting()} of 5 (5 = full reset).`,
            'Set once via ?clearStage=0..5 in the address',
            'bar; it persists. Stages under 5 leave the',
            'scene visually stale ON PURPOSE (isolation).',
          ],
        },
      ],
    });
  }

  private buildSourcePanel(): void {
    const canvas = document.createElement('canvas');
    // Readability pass (2026-10-28 acceptance): +25% canvas resolution
    // and font sizes at the same physical panel size/position.
    canvas.width = 1100;
    canvas.height = 1300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.ctx = ctx;
    this.texture = new CanvasTexture(canvas);
    this.texture.anisotropy = 4;
    this.panel = new Mesh(
      new PlaneGeometry(1.12, 1.32),
      new MeshBasicMaterial({ map: this.texture }),
    );
    this.panel.position.set(1.6, 1.78, -2.35);
    this.panel.rotation.y = -0.42;
    this.panel.name = 'source-inspection-panel';
    this.scene.add(this.panel);
  }

  /**
   * Speech log window: mirror image of the source card, LEFT of
   * the buttons panel (owner, 2026-11-01). Same canvas size,
   * palette, and locked-assembly following, so the three
   * windows read as one workstation. Visual only — no buttons,
   * and picks behind it are blocked like the other panels.
   */
  private buildSpeechLogPanel(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1100;
    canvas.height = 1300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.speechCtx = ctx;
    this.speechTexture = new CanvasTexture(canvas);
    this.speechTexture.anisotropy = 4;
    this.speechPanel = new Mesh(
      new PlaneGeometry(1.12, 1.32),
      new MeshBasicMaterial({ map: this.speechTexture }),
    );
    this.speechPanel.position.set(-1.6, 1.78, -2.35);
    this.speechPanel.rotation.y = 0.42;
    this.speechPanel.name = 'speech-log-panel';
    this.scene.add(this.speechPanel);
    pushSpeech('system', 'Speech log ready. Everything you say — and what I do about it — appears here.');
    // Owner wording (2026-11-01): a single calm instruction, not
    // a jump into example commands the user is not ready for.
    // Short enough to also be spoken once via TTS.
    pushSpeech('assistant', 'Press X on the left controller (or tap Voice on the center menu) to begin voice controls.');
    this.drawSpeechLog();
  }

  private drawSpeechLog(): void {
    const ctx = this.speechCtx;
    if (!ctx || !this.speechTexture) return;
    const W = 1100;
    const H = 1300;
    ctx.fillStyle = '#11141a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#c9a44a';
    ctx.lineWidth = 5;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = '#e8c56a';
    ctx.font = '700 26px sans-serif';
    ctx.fillText('SPEECH LOG - WHAT YOU ASKED / WHAT I DID', 36, 62);
    ctx.font = '400 23px sans-serif';
    ctx.fillStyle = '#9aa3b2';
    ctx.fillText('You on the left, Assistant on the right. Newest at the bottom.', 36, 100);

    // Phone-chat blocks (owner, 2026-11-01): user LEFT,
    // assistant RIGHT, system centered. Bigger type than the
    // source card (34px body) for at-a-glance reading.
    const BODY_FONT = '34px sans-serif';
    const BODY_FONT_BOLD = '700 34px sans-serif';
    const LABEL_FONT = '700 23px sans-serif';
    const LINE_H = 46;
    const MAX_BUBBLE_W = 740;
    const PAD_X = 28;
    type Block = {
      role: SpeechLogEntry['role'];
      label: string;
      lines: string[];
      width: number;
      height: number;
    };
    const blocks: Block[] = [];
    for (const entry of speechLogEntries) {
      const label = entry.role === 'user' ? 'YOU' : entry.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
      const body = entry.role === 'user' ? `"${entry.text}"` : entry.text;
      const lines = wrap(body, entry.role === 'system' ? 52 : 36);
      ctx.font = entry.role === 'user' ? BODY_FONT_BOLD : BODY_FONT;
      const longest = Math.max(
        ...lines.map((line) => ctx.measureText(line).width),
        ctx.measureText(label).width,
      );
      const width = entry.role === 'system'
        ? W - 72
        : Math.min(MAX_BUBBLE_W, Math.ceil(longest) + PAD_X * 2);
      const height = entry.role === 'system'
        ? lines.length * 38 + 14
        : 18 + 32 + lines.length * LINE_H + 16;
      blocks.push({ role: entry.role, label, lines, width, height });
    }
    const CHAT_TOP = 126;
    const CHAT_BOTTOM = 1128;
    const BLOCK_GAP = 18;
    let total = 0;
    const visible: Block[] = [];
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const next = total + blocks[i].height + (visible.length ? BLOCK_GAP : 0);
      if (next > CHAT_BOTTOM - CHAT_TOP) break;
      total = next;
      visible.unshift(blocks[i]);
    }
    // One oversized entry (e.g. the long out-of-scope examples
    // message, owner-found 2026-11-01) must NEVER blank the whole
    // window: fall back to its tail so the newest reply stays seen.
    if (visible.length === 0 && blocks.length > 0) {
      const tail = blocks[blocks.length - 1];
      const maxLines = Math.max(1, Math.floor((CHAT_BOTTOM - CHAT_TOP - 50) / LINE_H));
      const keep = tail.lines.slice(-maxLines);
      const keptHeight = keep.length * LINE_H + 66;
      visible.push({ ...tail, lines: keep, width: tail.width, height: keptHeight });
    }
    let y = CHAT_BOTTOM - total;
    for (const block of visible) {
      if (block.role === 'system') {
        ctx.font = '400 26px sans-serif';
        ctx.fillStyle = '#9aa3b2';
        ctx.textAlign = 'center';
        let ly = y + 32;
        for (const line of block.lines) {
          ctx.fillText(line, W / 2, ly);
          ly += 38;
        }
        ctx.textAlign = 'left';
      } else {
        const isUser = block.role === 'user';
        const x = isUser ? 36 : W - 36 - block.width;
        ctx.beginPath();
        ctx.roundRect(x, y, block.width, block.height, 26);
        ctx.fillStyle = isUser ? 'rgba(38, 84, 124, 0.88)' : 'rgba(66, 54, 16, 0.92)';
        ctx.fill();
        ctx.strokeStyle = isUser ? '#9fd8ff' : '#e8c56a';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.font = LABEL_FONT;
        ctx.fillStyle = isUser ? '#9fd8ff' : '#f5d90a';
        ctx.fillText(block.label, x + PAD_X, y + 44);
        ctx.font = isUser ? BODY_FONT_BOLD : BODY_FONT;
        ctx.fillStyle = isUser ? '#ffffff' : '#f7f3e2';
        let ly = y + 44 + 42;
        for (const line of block.lines) {
          ctx.fillText(line, x + PAD_X, ly);
          ly += LINE_H;
        }
      }
      y += block.height + BLOCK_GAP;
    }

    // Live status bar: the listening/transcribing indicator the
    // owner used to have to hunt for on the source card.
    const status = speechStatus.text;
    const dotColor = status.startsWith('LISTENING')
      ? '#ff7a59'
      : status.startsWith('Transcribing')
        ? '#f5d90a'
        : status.startsWith('Staged')
          ? '#9fd8ff'
          : '#7dc98a';
    ctx.beginPath();
    ctx.roundRect(24, 1144, W - 48, 76, 20);
    ctx.fillStyle = 'rgba(24, 29, 38, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#c9a44a';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(66, 1182, 13, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.font = '700 30px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(status, 96, 1194);
    ctx.fillStyle = '#e8c56a';
    ctx.font = '700 24px sans-serif';
    ctx.fillText('Say HELP for everything voice can do', 36, H - 28);
    this.speechTexture.needsUpdate = true;
  }
  /**
   * Paginated panel renderer: every supplied line renders on some
   * page (paginate() is lossless and unit-tested). The previous
   * renderer silently sliced titles to 2 lines and dropped section
   * lines past the canvas edge — the unreadable/truncated findings
   * the owner hit in the headset.
   */
  // Memo indent: 0 = flush, 1 = one level (a/b/c), 2 = two
  // levels (i/ii/iii). The renderer converts levels to x offset
  // so the card reads like the Word template (owner, 2026-11-02).
  private static readonly MEMO_INDENT_PX = 34;

  private drawPanel(input: {
    status: string;
    title: string;
    sections: { label?: string; lines: string[]; numbered?: string }[];
  }): void {
    // Legal-memo assembly (owner template + reference image,
    // 2026-11-02): centered underlined title, "Executive
    // Summary:" bold-lead paragraph, numbered sections — built
    // uniformly in visual-state.assembleMemoLines so EVERY card
    // follows the template whatever the call site authored.
    const lines: MemoLine[] = assembleMemoLines(input);
    // Pagination page-preservation (owner, 2026-11-01): an
    // identical redraw (every-frame announcements, hover-adjacent
    // repaints) must NOT throw the reader back to page 1.
    // Full-height column (owner, 2026-11-02): the renderer draws
    // top-to-bottom across the whole 1300px canvas, so the page
    // budget matches — 28 lines at current leading.
    const nextPages = paginate(lines, 28);
    const same =
      nextPages.length === this.panelPages.length
      && nextPages.length > 0
      && nextPages.every((page, i) =>
        page.length === (this.panelPages[i] ?? []).length
        && page.every((line, j) => {
          const prev = this.panelPages[i]?.[j];
          return prev != null && line.text === prev.text && line.kind === prev.kind;
        }));
    const keepPage = same ? Math.min(this.panelPage, Math.max(0, nextPages.length - 1)) : 0;
    this.panelPages = nextPages;
    this.panelPage = keepPage;
    this.renderPanelPage();
  }

  private renderPanelPage(): void {
    const { ctx } = this;
    if (!ctx) return;
    const W = 1100;
    const H = 1300;
    // Full-height, full-width reading column (owner,
    // 2026-11-02): body text used the left half and top half of
    // the panel, forcing multi-page documents. The column now
    // runs margin to margin (36px each side) and top (below the
    // banner) to bottom (above the page footer), at a slightly
    // smaller size with ~1/4 tighter gaps — the whole page is
    // reading surface, same legibility.
    const MARGIN = 36;
    const TOP = 114;
    const FOOTER_Y = H - 32;
    const BODY_FONT = 30;
    const BODY_LEAD = 40;
    const SECTION_GAP = 40;
    const BLANK_LEAD = 21;
    ctx.fillStyle = '#11141a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#c9a44a';
    ctx.lineWidth = 5;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    let y = TOP;
    ctx.fillStyle = '#e8c56a';
    ctx.font = '700 21px sans-serif';
    ctx.fillText('SOURCE INSPECTION - SYNTHETIC RECORDS (NOT CASE EVIDENCE)', MARGIN, 58);
    // Memo indentation: lettered/roman body lines shift right so
    // hierarchy reads spatially, like the Word template.
    const indentX = (line: { indent?: number }) => MARGIN + (line.indent ?? 0) * EvidenceSystem.MEMO_INDENT_PX;
    for (const line of this.panelPages[this.panelPage] ?? []) {
      if (y > FOOTER_Y - 48) break;
      if (line.kind === 'blank') {
        y += BLANK_LEAD;
      } else if (line.kind === 'center') {
        // Document title (template): centered, bold, underlined.
        y += 8;
        ctx.fillStyle = '#f5d90a';
        ctx.font = '700 42px sans-serif';
        const w = ctx.measureText(line.text).width;
        const x = MARGIN + Math.max(0, (W - MARGIN * 2 - w) / 2);
        ctx.fillText(line.text, x, y);
        ctx.strokeStyle = '#f5d90a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y + 12);
        ctx.lineTo(x + w, y + 12);
        ctx.stroke();
        y += 66;
      } else if (line.kind === 'summary') {
        // Executive Summary paragraph: bold "Executive
        // Summary:" lead-in, then regular text, flush left,
        // slightly larger than body (the lead).
        ctx.font = '35px sans-serif';
        ctx.fillStyle = '#f4f1e6';
        const lead = 'Executive Summary:';
        if (line.text.startsWith(lead)) {
          ctx.font = '700 35px sans-serif';
          ctx.fillText(lead, MARGIN, y);
          const leadW = ctx.measureText(`${lead} `).width;
          ctx.font = '35px sans-serif';
          ctx.fillText(line.text.slice(lead.length).trimStart(), MARGIN + leadW, y);
        } else {
          ctx.fillText(line.text, MARGIN, y);
        }
        y += 54;
      } else if (line.kind === 'h1') {
        // Un-numbered memo heading (EXECUTIVE SUMMARY): bold,
        // underlined, air above.
        y += 10;
        ctx.fillStyle = '#f5d90a';
        ctx.font = '700 35px sans-serif';
        ctx.fillText(line.text, MARGIN, y);
        ctx.strokeStyle = '#f5d90a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(MARGIN, y + 10);
        ctx.lineTo(MARGIN + ctx.measureText(line.text).width, y + 10);
        ctx.stroke();
        y += 54;
      } else if (line.kind === 'h-numbered' || line.kind === 'bold') {
        // Numbered heading (template): bold, indent level 1,
        // whitespace above arrives via blank separator lines.
        ctx.fillStyle = line.kind === 'bold' ? '#ffffff' : '#e8c56a';
        ctx.font = '700 33px sans-serif';
        ctx.fillText(line.text, indentX(line), y);
        y += SECTION_GAP;
      } else if (line.kind === 'underline') {
        ctx.fillStyle = '#eef1f6';
        ctx.font = `${BODY_FONT}px sans-serif`;
        ctx.fillText(line.text, indentX(line), y);
        ctx.strokeStyle = '#9aa3b2';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(indentX(line), y + 9);
        ctx.lineTo(indentX(line) + ctx.measureText(line.text).width, y + 9);
        ctx.stroke();
        y += BODY_LEAD;
      } else {
        ctx.fillStyle = '#eef1f6';
        ctx.font = `${BODY_FONT}px sans-serif`;
        ctx.fillText(line.text, indentX(line), y);
        y += BODY_LEAD;
      }
    }
    if (this.panelPages.length > 1) {
      ctx.fillStyle = '#e8c56a';
      ctx.font = '700 28px sans-serif';
      ctx.fillText(
        `PAGE ${this.panelPage + 1} OF ${this.panelPages.length} - Previous/Next Page on the menu`,
        MARGIN,
        FOOTER_Y,
      );
    }
    this.texture.needsUpdate = true;
  }
}

/** Clone node materials so per-record dimming never leaks across nodes. */
function cloneMaterials(root: Object3D): StylableMaterial[] {
  const materials: StylableMaterial[] = [];
  root.traverse((child) => {
    const mesh = child as Mesh;
    const material = (mesh as { material?: unknown }).material as
      | StylableMaterial
      | StylableMaterial[]
      | undefined;
    if (!material) return;
    if (Array.isArray(material)) {
      const clones = material.map((m) => {
        const clone = m.clone();
        clone.transparent = true;
        return clone;
      });
      (mesh as { material: unknown }).material = clones;
      materials.push(...clones);
    } else {
      const clone = material.clone();
      clone.transparent = true;
      (mesh as { material: unknown }).material = clone;
      materials.push(clone);
    }
  });
  return materials;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Quest Browser download delivery (owner, 2026-11-03: exports
// silently did nothing on device). Two device rules: the anchor
// must be attached to the DOM before click(), and the object URL
// must outlive the click — revoking it synchronously cancels the
// download before the browser starts it. Downloads land in the
// browser's Downloads / the Files app; JS cannot confirm
// completion, so panels say "download started", never "saved".
export function downloadBlob(filename: string, blob: Blob): void {
  diag('export-download', { filename, size: blob.size });
  // Apple touch delivery (owner iPad, 2026-11-03): Safari treats
  // blob anchor downloads invisibly (or not at all) — the work
  // fired but the judge sees nothing. The Web Share sheet with
  // "Save to Files" is the visible, native door on iPhone/iPad.
  // Desktop and Quest keep the anchor path below (both proven).
  const ua = navigator.userAgent;
  const appleTouch = /iP(hone|ad|od)/.test(ua)
    || (ua.includes('Macintosh') && 'ontouchend' in document);
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title: string }) => Promise<void>;
  };
  if (appleTouch && nav.share && nav.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (nav.canShare({ files: [file] })) {
        void nav.share({ files: [file], title: filename }).then(() => {
          diag('export-share', { filename, ok: true });
        }).catch((error: unknown) => {
          const name = error instanceof Error ? error.name : 'error';
          diag('export-share', { filename, ok: false, error: name });
          if (name !== 'AbortError') anchorDownload(filename, blob);
        });
        saveDevCopy(filename, blob);
        return;
      }
    } catch { /* fall through to the anchor path */ }
  }
  anchorDownload(filename, blob);
  saveDevCopy(filename, blob);
}

function anchorDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Dev-server save copy (owner, 2026-11-03): inside the framed
// emulator workspace the anchor download is swallowed silently
// (export fired, no file anywhere). The local dev server saves
// the same bytes to app/exports/ on this PC; production has no
// such endpoint (404 ignored) because top-level downloads work.
function saveDevCopy(filename: string, blob: Blob): void {
  void fetch('/api/export-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': filename },
    body: blob,
  }).then((res) => {
    diag('export-save-copy', { filename, ok: res.ok, status: res.status });
  }).catch(() => { /* production or offline: anchor path stands */ });
}

function downloadJson(filename: string, payload: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  }));
}

function wrap(text: string, width: number): string[] {  // Hard carriage returns are real paragraph breaks (voice
  // search outcome "Other Suggestions" block, 2026-11-01):
  // preserve them, including blank separator lines.
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length > width) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// Legal-memo inline markup (`# ` title, `## ` summary block,
// **bold**, __underline__) is assembled uniformly by
// assembleMemoLines in investigation/visual-state.ts.

/**
 * Pure visual-state helpers for evidence nodes + panel pagination.
 * Extracted 2026-10-27 (overnight defect fixes) so the rules that
 * decide whether evidence is visible — and whether panel text is
 * ever dropped — are unit-testable outside the XR runtime.
 */

export type NodeTier = 'selected' | 'hit' | 'visited' | 'dimmed' | 'normal';

export interface NodeVisual {
  tier: NodeTier;
  opacity: number;
  scaleFactor: number;
}

/**
 * Evidence must never disappear. A record the investigator has
 * already examined ("visited") keeps a clearly visible tier even
 * when a later search/AI step does not include it — the overnight
 * defect was visited evidence being dimmed to near-invisibility
 * (opacity 0.16) the moment a second node was investigated.
 */
export function nodeVisual(input: {
  searched: boolean;
  isHit: boolean;
  isSelected: boolean;
  isVisited: boolean;
}): NodeVisual {
  if (input.isSelected) return { tier: 'selected', opacity: 1, scaleFactor: 1.6 };
  if (!input.searched) {
    return input.isVisited
      ? { tier: 'visited', opacity: 1, scaleFactor: 1 }
      : { tier: 'normal', opacity: 1, scaleFactor: 1 };
  }
  if (input.isHit) return { tier: 'hit', opacity: 1, scaleFactor: 1 };
  if (input.isVisited) return { tier: 'visited', opacity: 0.62, scaleFactor: 0.85 };
  return { tier: 'dimmed', opacity: 0.3, scaleFactor: 0.55 };
}

export type GalaxyEmphasis = 'selected' | 'bright' | 'dim' | 'normal';

/**
 * Galaxy (instanced universe) emphasis (owner, 2026-11-03):
 * exploring a lead must visibly highlight that lead's evidence —
 * the voice acknowledgement promised "its evidence is
 * highlighted" while only search hits ever lit up. One highlight
 * set at a time: selection wins, an active search outranks lead
 * focus, and lead focus applies only while a lead is active.
 */
export function galaxyEmphasis(input: {
  searched: boolean;
  isHit: boolean;
  isSelected: boolean;
  leadActive: boolean;
  isLeadFocus: boolean;
}): GalaxyEmphasis {
  if (input.isSelected) return 'selected';
  if (input.searched) return input.isHit ? 'bright' : 'dim';
  if (input.leadActive) return input.isLeadFocus ? 'bright' : 'dim';
  return 'normal';
}

/**
 * Split panel lines into pages. Lossless by construction: the
 * concatenation of all pages always equals the input — panel text
 * (evidence, quotations, findings) is never silently truncated,
 * only paged.
 */
/**
 * Chronology lens ordering: stored date ascending, suspect dates keep
 * their place but are flagged by the caller (the anomaly must stay
 * visible in sequence, not be hidden by sorting it away).
 */
export function chronologyOrder<T extends { id: string; date: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function paginate<T>(lines: T[], perPage: number): T[][] {
  if (perPage < 1) throw new Error('perPage must be >= 1');
  if (lines.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }
  return pages;
}

// --- Fixed-panel accessibility (owner acceptance defect, 2026-10-28) --
//
// Two fixed panels can occlude evidence nodes from the spawn viewpoint:
// the menu panel (scene: position [0, 1.95, -2.7], facing +z) and the
// source-inspection panel (evidence-ui: center [1.6, 1.78, -2.35],
// 1.12 x 1.32 m, rotation.y = -0.42). The pre-fix EXPANDED layout put
// center nodes at z = -2.877 — behind the menu plane — leaving them
// unselectable in-headset. Layout constants live here so a unit test
// can guarantee every default node position stays in front of both
// panels. Bounds below are deliberately generous (larger than the
// physical panels) so the guard has margin.

export const COMPACT_POSITIONS: Record<string, [number, number, number]> = {
  'ev-slot-1': [-0.985, 0.98, -0.769],
  'ev-slot-2': [-0.754, 0.98, -0.997],
  'ev-slot-3': [-0.474, 0.98, -1.156],
  'ev-slot-4': [-0.161, 0.98, -1.24],
  'ev-slot-5': [0.161, 0.98, -1.24],
  'ev-slot-6': [0.474, 0.98, -1.156],
  'ev-slot-7': [0.754, 0.98, -0.997],
  'ev-slot-8': [0.985, 0.98, -0.769],
};

/** Room-scale arc pulled inward (x0.8 in x/z vs the M2 original) so no
 * node sits behind either fixed panel from the default viewpoint. */
export const EXPANDED_POSITIONS: Record<string, [number, number, number]> = {
  'ev-slot-1': [-1.828, 1.5, -1.427],
  'ev-slot-2': [-1.399, 1.5, -1.85],
  'ev-slot-3': [-0.88, 1.5, -2.146],
  'ev-slot-4': [-0.299, 1.5, -2.302],
  'ev-slot-5': [0.299, 1.5, -2.302],
  'ev-slot-6': [0.88, 1.5, -2.146],
  'ev-slot-7': [1.399, 1.5, -1.85],
  'ev-slot-8': [1.828, 1.5, -1.427],
};

const MENU_PANEL = { z: -2.7, xAbs: 0.55, yMin: 1.3, yMax: 2.6 };
const SOURCE_PANEL = {
  center: [1.6, 1.78, -2.35] as const,
  halfW: 0.66,
  halfH: 0.76,
  rotY: -0.42,
};

/**
 * True when a node at `p` is NOT hidden behind either fixed panel as
 * seen from the default viewpoint (origin, looking toward -z): it is
 * either in front of the panel plane or outside the panel rectangle.
 */
export function isAccessiblePosition(p: readonly [number, number, number]): boolean {
  const [x, y, z] = p;
  const behindMenu =
    z < MENU_PANEL.z && Math.abs(x) < MENU_PANEL.xAbs && y > MENU_PANEL.yMin && y < MENU_PANEL.yMax;
  if (behindMenu) return false;
  // Source panel: transform into panel-local space (rotate by -rotY).
  const dx = x - SOURCE_PANEL.center[0];
  const dy = y - SOURCE_PANEL.center[1];
  const dz = z - SOURCE_PANEL.center[2];
  const cos = Math.cos(-SOURCE_PANEL.rotY);
  const sin = Math.sin(-SOURCE_PANEL.rotY);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const behindSource =
    localZ < 0 && Math.abs(localX) < SOURCE_PANEL.halfW && Math.abs(dy) < SOURCE_PANEL.halfH;
  return !behindSource;
}

// --- Spatial label text (owner acceptance: dates + organizations) -----

export type LensKind = 'evidence' | 'network' | 'chronology' | 'concepts' | 'custodians' | 'filetypes';

/** Node sprite text: dates carry the chronology lens; IDs carry the rest. */
export function nodeLabelText(
  record: { id: string; date: string },
  lens: LensKind,
  flagged = false,
): string {
  if (lens === 'chronology') return flagged ? `${record.date} !!` : record.date;
  return record.id.toUpperCase();
}

/** Short organization display for cluster sprites (drops provenance noise). */
export function shortOrgName(displayName: string): string {
  return displayName.replace(/\s*\(synthetic\)\s*$/, '').replace(/\s+Custodian$/, '');
}

export function clusterLabelText(displayName: string, memberCount: number): string {
  return `${shortOrgName(displayName)} · ${memberCount}`;
}

/** One-line focus explanation shown wherever corpus size is reported.
 * Since the galaxy field (2026-10-29) every record is represented;
 * detail orbs provide the close-inspection view. The count is not
 * surfaced to users (owner direction: never make them count orbs). */
export function focusSummary(_focusCount: number, corpusSize: number): string {
  return `All ${corpusSize} records in universe · detail orbs in focus`;
}

/**
 * Focus window over an ordered hit list (2026-10-29 M3 blocker:
 * hits beyond the rendered detail orbs could not be opened). Returns
 * the page of `slots` hit IDs containing `index`, backfilled so a
 * short final page still fills the slots. Selecting/stepping to
 * any hit therefore always makes it a visible, tappable node while
 * its source opens — evidence access never depends on which
 * records happen to be rendered.
 */
export function focusWindowForHit(hitIds: readonly string[], index: number, slots = 8): string[] {
  if (hitIds.length === 0 || index < 0) return [];
  if (hitIds.length <= slots) return [...hitIds];
  let start = Math.floor(Math.min(index, hitIds.length - 1) / slots) * slots;
  if (start + slots > hitIds.length) start = hitIds.length - slots;
  return hitIds.slice(start, start + slots);
}

// --- Legal-memo source-card assembly (owner template,
// knowledge/Legal Formatting Template + reference image,
// 2026-11-02). EVERY card, whatever the call site authored,
// comes out in the one format attorneys pattern-read:
//   centered underlined document title
//   (blank line)
//   "Executive Summary:" — bold lead-in, one flush paragraph;
//      the ONLY un-numbered heading (the lead, never buried)
//   (blank line)
//   1. 2. 3. bold numbered headings (indent 1), detail lines
//   indented under them (indent 2), a./b./c. at indent 2,
//   i./ii./iii. at indent 3, blank line between sections.
// Authored markup is honored: a '# ' section label or first
// line becomes the title; an authored '## EXECUTIVE SUMMARY'
// block becomes the summary paragraph; explicit section
// numbers are respected and auto-numbering continues after
// them; **bold** / __underline__ whole lines keep their kinds.
export type MemoLineKind = 'center' | 'summary' | 'h1' | 'h-numbered' | 'bold' | 'underline' | 'body' | 'blank';
export interface MemoLine { text: string; kind: MemoLineKind; indent?: number }
export interface MemoSection { label?: string; lines: string[]; numbered?: string }

function wrapMemo(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') { out.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > width) {
        if (line) out.push(line);
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function memoIndentOf(trimmed: string): number {
  if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)\.\s/i.test(trimmed)) return 3;
  if (/^[a-z]\.\s/.test(trimmed)) return 2;
  return 0;
}

export function assembleMemoLines(input: {
  status: string;
  title: string;
  sections: MemoSection[];
}): MemoLine[] {
  // Work on copies: title/summary extraction consumes lines.
  const sections = input.sections.map((s) => ({ ...s, lines: [...s.lines] }));
  let docTitle = input.title.trim();
  const first = sections[0];
  if (first?.label?.startsWith('# ')) {
    docTitle = first.label.slice(2).trim() || docTitle;
    first.label = undefined;
  } else if (first && first.lines[0]?.startsWith('# ')) {
    docTitle = first.lines[0].slice(2).trim() || docTitle;
    first.lines = first.lines.slice(1);
  }
  // Authored executive summary: '## ...' line plus the body
  // lines that follow it (up to a blank or a heading).
  let summaryText = '';
  outer: for (const section of sections) {
    for (let i = 0; i < section.lines.length; i += 1) {
      if (section.lines[i].startsWith('## ')) {
        const parts: string[] = [];
        let j = i + 1;
        while (j < section.lines.length
          && section.lines[j].trim() !== ''
          && !section.lines[j].startsWith('#')
          && !section.lines[j].startsWith('**')) {
          parts.push(section.lines[j].trim());
          j += 1;
        }
        summaryText = parts.join(' ');
        section.lines = [...section.lines.slice(0, i), ...section.lines.slice(j)];
        break outer;
      }
    }
  }
  if (!summaryText) summaryText = input.status.trim();

  const out: MemoLine[] = [];
  const pushWrapped = (text: string, kind: MemoLineKind, indent: number, width: number) => {
    for (const chunk of wrapMemo(text, width)) {
      out.push(chunk === '' ? { text: '', kind: 'blank' } : { text: chunk, kind, ...(indent ? { indent } : {}) });
    }
  };
  for (const chunk of wrapMemo(docTitle, 52)) {
    if (chunk) out.push({ text: chunk, kind: 'center' });
  }
  out.push({ text: '', kind: 'blank' });
  if (summaryText) {
    pushWrapped(`Executive Summary: ${summaryText}`, 'summary', 0, 62);
    out.push({ text: '', kind: 'blank' });
  }
  let counter = 1;
  sections.forEach((section, sectionIdx) => {
    let underHeading = false;
    if (section.label) {
      let num: string;
      if (section.numbered) {
        num = section.numbered;
        const parsed = Number.parseInt(section.numbered, 10);
        if (Number.isFinite(parsed)) counter = parsed + 1;
      } else {
        num = `${counter}.`;
        counter += 1;
      }
      out.push({ text: `${num}  ${section.label}`, kind: 'h-numbered', indent: 1 });
      underHeading = true;
    }
    for (const raw of section.lines) {
      const trimmed = raw.trimStart();
      if (trimmed === '') { out.push({ text: '', kind: 'blank' }); continue; }
      if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) {
        const kind: MemoLineKind = trimmed.startsWith('## ') ? 'h1' : 'center';
        out.push({ text: trimmed.replace(/^#{1,2}\s/, ''), kind });
        continue;
      }
      const bold = /^\*\*(.+)\*\*$/.exec(trimmed);
      const under = /^__(.+)__$/.exec(trimmed);
      const authoredIndent = memoIndentOf(trimmed);
      if (bold) {
        // An inline numbered bold heading (e.g. **1. SOURCE
        // TEXT**) keeps the auto-counter honest after it.
        const n = /^(\d+)\./.exec(bold[1]);
        if (n) counter = Math.max(counter, Number(n[1]) + 1);
        pushWrapped(bold[1], 'bold', 1, 58);
        underHeading = true;
        continue;
      }
      if (under) { pushWrapped(under[1], 'underline', Math.max(authoredIndent, underHeading ? 2 : 0), 58); continue; }
      pushWrapped(raw, 'body', Math.max(authoredIndent, underHeading ? 2 : 0), 62 - Math.max(authoredIndent, underHeading ? 2 : 0) * 2);
    }
    if (sectionIdx < sections.length - 1 && out[out.length - 1]?.kind !== 'blank') {
      out.push({ text: '', kind: 'blank' });
    }
  });
  return out;
}

/**
 * Galaxy layouts — pure, deterministic spherical placement for the
 * 360-degree evidence universe (M3, 2026-10-29). Every coordinate
 * encodes evidence metadata; nothing is decorative scatter:
 *
 * - Evidence lens: azimuth sector = organization territory (full
 *   360 degrees around the investigator), subcluster = concept tag,
 *   radius = stored-date rank (earliest records nearest the
 *   platform, latest farthest — owner spatial intuition,
 *   2026-11-01, carried by EVERY lens), elevation
 *   band = custodian. You stand inside the collection.
 * - Chronology lens: a two-turn spiral — azimuth and radius grow
 *   monotonically with stored date; elevation band = organization.
 *   (Already earliest-near; unchanged.)
 * - Network lens: direction = weighted centroid of the record's
 *   participant organizations, so bridge records sit between the
 *   territories they connect. Radius = date, earliest nearest.
 *
 * Concept Clusters (owner session 2026-11-01): azimuth sector =
 * authored concept tag over the FULL circle, elevation band =
 * concept (each concept its own height — clusters stack
 * vertically instead of mushing into one band), radius = date.
 * Color is always the record's producing organization.
 *
 * Deterministic per-record jitter (id hash) prevents exact overlap
 * without inventing meaning. Positions are relative to the galaxy
 * center; the renderer places/scales the field (VR full scale,
 * MR room scale).
 */
export interface GalaxyRecordInput {
  id: string;
  date: string;
  org: string;
  concept: string;
  custodian: string;
  kind: string;
  participantOrgs: string[];
  /** Explicit sender/author person id when the record carries one
   * (Network lens sender sub-neighborhoods). Never guessed. */
  sender?: string;
  /**
   * Domain verification (owner, 2026-11-01): the sender/author
   * mailbox domain vs the record org's corporate domain.
   * true = same domain (company-level verified); false =
   * cross-company exception (listed on the color key).
   * homeOrgOk = sender home-org vs record org (sub-org
   * cross-functional signal, e.g. HR writing to Legal).
   */
  domainOk?: boolean;
  homeOrgOk?: boolean;
  /** Sender/author mailbox domain (e.g. novachip.com). */
  senderDomain?: string;
  /** SEC FILE_EXTENSION / MIME group; 'unknown/other' when the
   * corpus carries no load-file metadata (never guessed). */
  fileType?: string;
}

/** Elevation layer per record kind (real metadata, legend-stated). */
const KIND_ELEVATION: Record<string, number> = {
  email: 0,
  note: 0.18,
  document: -0.18,
  report: 0.32,
  attachment: -0.32,
  log: -0.46,
};

export interface GalaxyPlacement {
  position: [number, number, number];
  azimuth: number;
  elevation: number;
  radius: number;
}

export type GalaxyLens = 'evidence' | 'network' | 'chronology' | 'concepts' | 'custodians' | 'filetypes';

export const GALAXY_CENTER: [number, number, number] = [0, 1.38, -0.4];
const R_NEAR = 3.2;
const R_FAR = 10.5;
/**
 * Chronology spiral start azimuth (owner, 2026-11-01): rank 0
 * sits front-right of the platform — right of the menu and the
 * default source-card sightline — instead of behind the menu.
 * az=0 starts at -z (behind the menu at z=-2.7); 1.2 rad puts
 * the start ~28 degrees off the source-card sightline.
 */
const CHRONO_PHASE = 1.2;
/** Particle-field height (owner, 2026-11-01): nodes fill waist
 * (~0.66 m) to above-head (~2.10 m) so travelling through them
 * reads as a particle field, not a thin disc. World y = center
 * 1.38 ± band 0.72. */
const Y_HALF_BAND = 0.72;

/** Organization colors (shared by renderer + panel legend). */
export const GALAXY_PALETTE: { hex: string; name: string }[] = [
  { hex: '#35c4b5', name: 'teal' },
  { hex: '#e8c56a', name: 'gold' },
  { hex: '#7aa2f7', name: 'blue' },
  { hex: '#f7768e', name: 'rose' },
  { hex: '#9ece6a', name: 'green' },
  { hex: '#bb9af7', name: 'violet' },
];

function hash01(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const jitter = (id: string, salt: number, amp: number) => (hash01(id, salt) * 2 - 1) * amp;

/**
 * Head-to-waist vertical band (owner, 2026-11-01): every
 * cluster fills the walkable vertical span instead of sitting
 * on one elevation plane. Returns the elevation angle whose
 * world height lands at a per-record height between waist
 * (center −0.45) and top-of-head (center +0.40), at any radius.
 */
const bandEl = (id: string, salt: number, r: number) => {
  void r;
  // spherical() maps el -> y via el * 0.62 (clamped to the
  // particle band), so invert that gain for a true world band.
  const yLocal = -0.45 + hash01(id, salt) * 0.85;
  return yLocal / 0.62;
};

function spherical(az: number, el: number, r: number): [number, number, number] {
  // Height fills the particle-field band (owner, 2026-11-01):
  // the el gain maps typical lens elevations across most of
  // Y_HALF_BAND instead of huddling near center height. The
  // clamp keeps far records out from under the platform.
  const y = Math.max(-Y_HALF_BAND, Math.min(Y_HALF_BAND, el * 0.62));
  return [r * Math.sin(az), y, -r * Math.cos(az)];
}

/**
 * Menu keep-out (owner, 2026-11-02): pointing at the menu kept
 * selecting cluster nodes BEHIND it. No node is placed in the
 * cone from a standing head (0, 1.6, 0) through the welcome
 * panel's starting pose (0, 2.25, -2.7 in the scene) and beyond
 * it — checked at expanded VR scale (1.9, the startup state).
 * Offenders rotate around the galaxy's Y axis to the nearest
 * cone edge, preserving radius, height, and lens structure.
 */
const MENU_CONE_COS = Math.cos(0.32);
export function avoidMenuCone(
  position: [number, number, number],
): [number, number, number] {
  const head: [number, number, number] = [0, 1.6, 0];
  const panel: [number, number, number] = [0, 2.25, -2.7];
  const pd: [number, number, number] = [
    panel[0] - head[0], panel[1] - head[1], panel[2] - head[2],
  ];
  const pdLen = Math.hypot(pd[0], pd[1], pd[2]) || 1;
  const inside = (p: [number, number, number]): boolean => {
    const w: [number, number, number] = [
      GALAXY_CENTER[0] + p[0] * 1.9,
      GALAXY_CENTER[1] + p[1] * 1.9,
      GALAXY_CENTER[2] + p[2] * 1.9,
    ];
    if (w[2] >= panel[2]) return false;
    const v: [number, number, number] = [w[0] - head[0], w[1] - head[1], w[2] - head[2]];
    const vLen = Math.hypot(v[0], v[1], v[2]) || 1;
    return (v[0] * pd[0] + v[1] * pd[1] + v[2] * pd[2]) / (vLen * pdLen) > MENU_CONE_COS;
  };
  if (!inside(position)) return position;
  const [x, y, z] = position;
  const side = x >= 0 ? 1 : -1;
  for (let step = 1; step <= 12; step += 1) {
    const a = side * step * 0.06;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rotated: [number, number, number] = [x * cos + z * sin, y, -x * sin + z * cos];
    if (!inside(rotated)) return rotated;
  }
  const a = side * 0.75;
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}

function sectorCenters(orgs: string[]): Map<string, number> {
  const out = new Map<string, number>();
  orgs.forEach((org, i) => out.set(org, (i / Math.max(orgs.length, 1)) * Math.PI * 2));
  return out;
}

/** Concept-lens territory labels (same even-sector math). */
export function conceptAnchors(
  records: GalaxyRecordInput[],
): { concept: string; position: [number, number, number]; count: number }[] {
  const concepts = [...new Set(records.map((r) => r.concept))].sort();
  return concepts.map((concept, i) => ({
    concept,
    position: spherical(
      // Sectors divide the circle by N (never N-1): inclusive
      // endpoints put the first and last clusters on top of
      // each other (owner, 2026-11-02). Staggered radius keeps
      // neighbor labels apart.
      concepts.length <= 1 ? 0 : -Math.PI + (i / concepts.length) * Math.PI * 2,
      0.62,
      R_FAR + 0.9 + (i % 2) * 0.8,
    ),
    count: records.filter((r) => r.concept === concept).length,
  }));
}

/** Custodian-lens territory labels (same even-sector math). */
export function custodianAnchors(
  records: GalaxyRecordInput[],
): { custodian: string; position: [number, number, number]; count: number }[] {
  const custodians = [...new Set(records.map((r) => r.custodian))].sort();
  return custodians.map((custodian, i) => ({
    custodian,
    position: spherical(
      custodians.length <= 1 ? 0 : -Math.PI + (i / custodians.length) * Math.PI * 2,
      0.62,
      R_FAR + 0.9 + (i % 2) * 0.8,
    ),
    count: records.filter((r) => r.custodian === custodian).length,
  }));
}

/** File-type-lens territory labels (same even-sector math). */
export function fileTypeAnchors(
  records: GalaxyRecordInput[],
): { fileType: string; position: [number, number, number]; count: number }[] {
  const types = [...new Set(records.map((r) => r.fileType ?? 'unknown/other'))].sort();
  return types.map((fileType, i) => ({
    fileType,
    position: spherical(
      types.length <= 1 ? 0 : -Math.PI + (i / types.length) * Math.PI * 2,
      0.62,
      R_FAR + 0.9 + (i % 2) * 0.8,
    ),
    count: records.filter((r) => (r.fileType ?? 'unknown/other') === fileType).length,
  }));
}

export function orgAnchors(
  records: GalaxyRecordInput[],
): { org: string; position: [number, number, number]; count: number }[] {
  const orgs = [...new Set(records.map((r) => r.org))].sort();
  const centers = sectorCenters(orgs);
  return orgs.map((org) => ({
    org,
    position: spherical(centers.get(org) ?? 0, 0.62, R_FAR + 0.9),
    count: records.filter((r) => r.org === org).length,
  }));
}

export function galaxyPositions(
  records: GalaxyRecordInput[],
  lens: GalaxyLens,
): Map<string, GalaxyPlacement> {
  const out = new Map<string, GalaxyPlacement>();
  if (records.length === 0) return out;
  const orgs = [...new Set(records.map((r) => r.org))].sort();
  const centers = sectorCenters(orgs);
  const sectorHalf = (Math.PI * 2 * 0.42) / Math.max(orgs.length, 1);
  const ordered = [...records].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const dateRank = new Map(ordered.map((r, i) => [r.id, records.length === 1 ? 0 : i / (records.length - 1)]));
  // Concept subcenters within each org sector.
  const conceptOffset = new Map<string, number>();
  for (const org of orgs) {
    const concepts = [...new Set(records.filter((r) => r.org === org).map((r) => r.concept))].sort();
    concepts.forEach((concept, i) => {
      const t = concepts.length === 1 ? 0 : i / (concepts.length - 1) - 0.5;
      conceptOffset.set(`${org}|${concept}`, t * 2 * sectorHalf * 0.82);
    });
  }
  const custodianBand = new Map<string, number>();
  for (const org of orgs) {
    const custodians = [...new Set(records.filter((r) => r.org === org).map((r) => r.custodian))].sort();
    custodians.forEach((c, i) => {
      const t = custodians.length === 1 ? 0 : i / (custodians.length - 1) - 0.5;
      custodianBand.set(`${org}|${c}`, t * 1.25);
    });
  }
  // Vertical neighborhoods (2026-10-29 owner direction): each
  // concept subcluster also sits at its own elevation within its
  // custodian band, so clusters stack into explorable high/low
  // neighborhoods instead of a flattened disc. Elevation remains
  // bounded (clamp below) so nothing demands sustained up/down gaze.
  const conceptElev = new Map<string, number>();
  for (const org of orgs) {
    const concepts = [...new Set(records.filter((r) => r.org === org).map((r) => r.concept))].sort();
    concepts.forEach((concept, i) => {
      const t = concepts.length === 1 ? 0 : i / (concepts.length - 1) - 0.5;
      conceptElev.set(`${org}|${concept}`, t * 1.0);
    });
  }
  const conceptsAll = [...new Set(records.map((r) => r.concept))].sort();
  const custsAll = [...new Set(records.map((r) => r.custodian))].sort();
  const typesAll = [...new Set(records.map((r) => r.fileType ?? 'unknown/other'))].sort();
  const orgDir = (org: string): [number, number, number] => {
    const az = centers.get(org) ?? 0;
    return spherical(az, 0, 1);
  };

  for (const record of records) {
    const rank = dateRank.get(record.id) ?? 0;
    let az = 0;
    let el = 0;
    // Spatial date intuition (owner, 2026-11-01): time flows
    // OUTWARD in every lens — earliest records nearest the
    // platform/center, latest farthest. Chronology below uses
    // the same formula explicitly.
    let r = R_NEAR + (R_FAR - R_NEAR) * rank;
    if (lens === 'filetypes') {
      // File Types (owner vision): sector = SEC file extension /
      // MIME group; records without load-file metadata group
      // explicitly as 'unknown/other'. Radius = date, color = org.
      const ti = Math.max(0, typesAll.indexOf(record.fileType ?? 'unknown/other'));
      const center = typesAll.length <= 1 ? 0 : -Math.PI + (ti / (typesAll.length - 1)) * Math.PI * 2 * 0.92;
      az = center + jitter(record.id, 103, 0.08);
      el = bandEl(record.id, 107, r);
    } else if (lens === 'custodians') {
      // Custodians: azimuth sector = record custodian (actual
      // collection metadata), elevation sub-banded by org,
      // radius = date rank, color = organization.
      const ci = Math.max(0, custsAll.indexOf(record.custodian));
      const center = custsAll.length <= 1 ? 0 : -Math.PI + (ci / (custsAll.length - 1)) * Math.PI * 2 * 0.92;
      az = center + jitter(record.id, 97, 0.08);
      el = bandEl(record.id, 101, r);
    } else if (lens === 'concepts') {
      // Concept Clusters: azimuth sector = authored concept tag
      // over the FULL circle, elevation band = concept (each
      // concept its own height so clusters stack vertically
      // instead of overlapping in one band), radius = date
      // (earliest nearest). Color still = organization.
      // Honest scope: clusters are the corpus's authored concept
      // tags, NOT learned embeddings — the panel legend states
      // this, and single-record clusters are flagged there, not
      // hidden here.
      const ci = Math.max(0, conceptsAll.indexOf(record.concept));
      const conceptCenter = conceptsAll.length <= 1
        ? 0
        : -Math.PI + (ci / conceptsAll.length) * Math.PI * 2;
      const conceptT = conceptsAll.length === 1
        ? 0
        : ci / (conceptsAll.length - 1) - 0.5;
      az = conceptCenter + jitter(record.id, 83, 0.07);
      void conceptT;
      el = bandEl(record.id, 89, r);
    } else if (lens === 'evidence') {
      az = (centers.get(record.org) ?? 0)
        + (conceptOffset.get(`${record.org}|${record.concept}`) ?? 0)
        + jitter(record.id, 11, 0.06);
      el = (conceptElev.get(`${record.org}|${record.concept}`) ?? 0)
        + (KIND_ELEVATION[record.kind] ?? 0)
        + jitter(record.id, 23, 0.07);
    } else if (lens === 'chronology') {
      // Spiral start phase (owner, 2026-11-01): rank 0 begins at
      // azimuth CHRONO_PHASE so the EARLIEST node sits right of
      // the menu/source-card sightline instead of behind it.
      // Radius still grows monotonically with stored date.
      az = CHRONO_PHASE + rank * Math.PI * 4 + jitter(record.id, 31, 0.03);
      r = R_NEAR + (R_FAR - R_NEAR) * rank;
      const orgIdx = orgs.indexOf(record.org);
      el = orgs.length === 1 ? 0 : (orgIdx / (orgs.length - 1) - 0.5) * 1.2
        + jitter(record.id, 41, 0.05);
    } else {
      // Network: direction = weighted centroid of participant orgs
      // (bridges sit between territories), fanned into sender
      // sub-neighborhoods inside the territory so each person's
      // traffic forms its own volumetric cluster around their hub.
      // Depth comes from sender azimuth spread + full-strength
      // concept/custodian elevation + wider radius jitter — all
      // metadata or disclosed anti-overlap jitter, comfort-banded.
      const weights = new Map<string, number>();
      weights.set(record.org, 2);
      for (const org of record.participantOrgs) {
        weights.set(org, (weights.get(org) ?? 0) + 1);
      }
      const sum: [number, number, number] = [0, 0, 0];
      for (const [org, w] of weights) {
        const d = orgDir(org);
        sum[0] += d[0] * w;
        sum[1] += d[1] * w;
        sum[2] += d[2] * w;
      }
      const len = Math.hypot(sum[0], sum[1], sum[2]) || 1;
      const dir: [number, number, number] = [sum[0] / len, sum[1] / len, sum[2] / len];
      const senderAz = record.sender ? (hash01(record.sender, 97) * 2 - 1) * sectorHalf * 0.62 : 0;
      const senderEl = record.sender ? (hash01(record.sender, 113) * 2 - 1) * 0.45 : 0;
      az = Math.atan2(dir[0], -dir[2]) + senderAz + jitter(record.id, 53, 0.1);
      el = Math.asin(Math.max(-1, Math.min(1, dir[1])))
        + senderEl
        + (custodianBand.get(`${record.org}|${record.custodian}`) ?? 0) * 0.65
        + (conceptElev.get(`${record.org}|${record.concept}`) ?? 0) * 1.0
        + jitter(record.id, 67, 0.08);
    }
    el = Math.max(-1.15, Math.min(1.15, el));
    r += jitter(record.id, 71, lens === 'network' ? 0.55 : 0.22);
    out.set(record.id, { position: avoidMenuCone(spherical(az, el, r)), azimuth: az, elevation: el, radius: r });
  }
  return out;
}

/**
 * Galaxy picking math — pure and unit-tested (P0.2, 2026-10-30).
 *
 * Headset evidence driving this design: in MR (mesh scale 0.38)
 * nodes "worked better far away" and near nodes couldn't be
 * selected; a fixed 0.25 m minimum-along excluded close MR
 * nodes, and a fixed angular threshold ignored instance size.
 * Scoring is therefore normalized by each candidate's own
 * pick radius (instance world size vs distance), the minimum
 * along-ray distance scales with the mesh, and — during an
 * active search — genuine hits win ties over nearer non-hits
 * so the highlighted node the investigator aims at is the one
 * selected. Hit preference never invents a hit: the caller
 * still reports the selected record's true hit state.
 */
export interface PickCandidate {
  id: string;
  index: number;
  along: number;
  /** Perpendicular ray distance / pick radius (< 1 = inside). */
  score: number;
  isHit: boolean;
}

export interface DetailedSlotPick {
  recordId: string;
  index: number;
  along: number;
  /** Perpendicular ray distance / slot pick radius (< 1 = inside). */
  score: number;
}

/**
 * Detailed focus-orb picking for handheld point-and-trigger.
 * The slot orbs are ordinary world-space objects (not galaxy
 * instances), so they need the same scale-aware ray scoring in
 * a form that can be reused by controller and gaze candidates.
 */
export function pickDetailedSlot(input: {
  slots: readonly {
    recordId: string | undefined;
    position: readonly [number, number, number];
    /** Effective world radius of the visible orb. */
    radius: number;
    visible?: boolean;
  }[];
  origin: readonly [number, number, number];
  dir: readonly [number, number, number];
}): DetailedSlotPick | undefined {
  const [ox, oy, oz] = input.origin;
  const dirLen = Math.hypot(input.dir[0], input.dir[1], input.dir[2]) || 1;
  const [dx, dy, dz] = [
    input.dir[0] / dirLen, input.dir[1] / dirLen, input.dir[2] / dirLen,
  ];
  let best: DetailedSlotPick | undefined;
  for (let i = 0; i < input.slots.length; i += 1) {
    const slot = input.slots[i];
    if (!slot.recordId || slot.visible === false) continue;
    const rx = slot.position[0] - ox;
    const ry = slot.position[1] - oy;
    const rz = slot.position[2] - oz;
    const along = rx * dx + ry * dy + rz * dz;
    if (along <= 0) continue;
    const distSq = Math.max(rx * rx + ry * ry + rz * rz - along * along, 0);
    const pickRadius = Math.max(slot.radius * 3.0, along * 0.05);
    const score = Math.sqrt(distSq) / pickRadius;
    if (score < 1 && (!best || score < best.score)) {
      best = { recordId: slot.recordId, index: i, along, score };
    }
  }
  return best;
}

export function pickNearest(input: {
  /** Flat local instance positions [x,y,z]*. */
  positions: ArrayLike<number>;
  ids: readonly string[];
  /** Per-instance scale factors (same order); 1 = base size. */
  scales?: (index: number) => number;
  meshPosition: readonly [number, number, number];
  meshScale: number;
  origin: readonly [number, number, number];
  dir: readonly [number, number, number];
  hitIds?: ReadonlySet<string> | undefined;
  /** Currently hovered id: wins unless a challenger is clearly
   * better — stops hover flicker between dense neighbors and
   * makes "what is highlighted is what the trigger selects". */
  preferredId?: string | undefined;
  /** Base instance radius in local units (icosahedron r). */
  baseRadius?: number;
  /**
   * Distance-floor slope (owner, 2026-11-01): MR passes 0.055
   * (room-scale targets are angularly tiny with no visible
   * platform ray); VR keeps 0.04 so far-field picks stay
   * precise and never grab a neighbor.
   */
  angleTol?: number;
}): PickCandidate | undefined {
  const baseRadius = input.baseRadius ?? 0.045;
  const angleTol = input.angleTol ?? 0.04;
  const [ox, oy, oz] = input.origin;
  const dirLen = Math.hypot(input.dir[0], input.dir[1], input.dir[2]) || 1;
  const [dx, dy, dz] = [
    input.dir[0] / dirLen, input.dir[1] / dirLen, input.dir[2] / dirLen,
  ];
  const [mx, my, mz] = input.meshPosition;
  const s = input.meshScale;
  const minAlong = 0.22 * s;
  let best: PickCandidate | undefined;
  let bestScore = Infinity;
  for (let i = 0; i < input.ids.length; i += 1) {
    const rx = mx + input.positions[i * 3] * s - ox;
    const ry = my + input.positions[i * 3 + 1] * s - oy;
    const rz = mz + input.positions[i * 3 + 2] * s - oz;
    const along = rx * dx + ry * dy + rz * dz;
    if (along < minAlong) continue;
    const distSq = rx * rx + ry * ry + rz * rz - along * along;
    const instanceScale = input.scales ? input.scales(i) : 1;
    const pickRadius = Math.max(baseRadius * instanceScale * s * 3.2, along * angleTol);
    const score = Math.sqrt(Math.max(distSq, 0)) / pickRadius;
    if (score >= 1) continue;
    const isHit = input.hitIds?.has(input.ids[i]) ?? false;
    // During search, a hit slightly off-axis beats a non-hit
    // dead-center in front of it (aim intent), by at most 30%.
    // The hovered node gets the same class of bonus so the
    // highlighted candidate stays stable under hand jitter.
    const weighted = score
      * (isHit ? 0.7 : 1)
      * (input.preferredId === input.ids[i] ? 0.75 : 1);
    if (weighted < bestScore) {
      bestScore = weighted;
      best = { id: input.ids[i], index: i, along, score, isHit };
    }
  }
  return best;
}

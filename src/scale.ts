/**
 * Hybrid scale (Milestone 2, extended to evidence nodes in M3).
 * The same detail-orb objects ease between a reachable compact
 * constellation and a room-scale arrangement. Identities preserved; the
 * system releases nodes on arrival so grabbing is never fought.
 */
import { createSystem, Vector3 } from '@iwsdk/core';
import { COMPACT_POSITIONS, EXPANDED_POSITIONS } from './investigation/visual-state.ts';

// Experience begins EXPANDED (owner, 2026-11-01): slots ease
// out to the room-scale layout on load; galaxy scale follows.
export const scaleState = { expanded: true, animating: true };

// Layout constants live in visual-state.ts, where a unit test guards
// them against the fixed-panel occlusion defect (2026-10-28 headset
// acceptance: expanded center nodes sat behind the menu panel).
const COMPACT = COMPACT_POSITIONS;
const EXPANDED = EXPANDED_POSITIONS;

export class ScaleSystem extends createSystem({}) {
  private target = new Vector3();

  update(delta: number): void {
    if (!scaleState.animating) return;
    const layout = scaleState.expanded ? EXPANDED : COMPACT;
    const k = 1 - Math.exp(-3.2 * Math.max(delta, 0.001));
    let allArrived = true;
    for (const [id, position] of Object.entries(layout)) {
      const object = this.world.getSceneObject(id);
      if (!object) continue;
      this.target.set(position[0], position[1], position[2]);
      if (object.position.distanceToSquared(this.target) < 0.0004) continue;
      allArrived = false;
      object.position.lerp(this.target, k);
    }
    if (allArrived) scaleState.animating = false;
  }
}

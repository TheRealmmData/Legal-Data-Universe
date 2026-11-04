/**
 * mmData hackathon — hybrid VR/MR support (new work, 2026-10-26).
 * Smallest passthrough proof: when the active XR session reports a
 * non-opaque environment blend mode (immersive-ar on Quest), hide the
 * VR-only scenery (floor, platform, starfield, formations) so the real
 * room shows through, leaving the same grabbable nodes, beacons, and
 * panel in place. Restores scenery outside MR. No plane detection,
 * anchors, or room scanning are assumed.
 */
import { createSystem } from '@iwsdk/core';

const VR_ONLY_NODES = [
  'atlas-floor',
  'atlas-platform',
  'atlas-starfield',
  'cluster-teal',
  'cluster-gold',
  'cluster-white',
] as const;

export class MixedRealitySystem extends createSystem({}) {
  private inMR: boolean | undefined = undefined;

  update(): void {
    const session = this.world.session as
      | (XRSession & { environmentBlendMode?: string })
      | undefined;
    const blend = session?.environmentBlendMode;
    const nowMR = blend != null && blend !== 'opaque';
    if (nowMR === this.inMR) return;
    this.inMR = nowMR;
    for (const id of VR_ONLY_NODES) {
      const object = this.world.getSceneObject(id);
      if (object) object.visible = !nowMR;
    }
    // Best-effort: hide any dome/sky renderer objects so passthrough
    // is not covered by the VR sky. Names are framework-owned, so
    // match conservatively and restore on the way out.
    this.scene.traverse((object) => {
      const name = (object.name ?? '').toLowerCase();
      if (name.includes('dome') || name.includes('sky')) {
        object.visible = !nowMR;
      }
    });
    this.renderer.setClearAlpha(nowMR ? 0 : 1);
  }
}

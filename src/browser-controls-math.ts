/** Pure math for the non-immersive browser camera. */
export interface OrbitState {
  target: { x: number; y: number; z: number };
  azimuth: number;
  polar: number;
  distance: number;
}

export const ORBIT_LIMITS = {
  minDistance: 1.2,
  maxDistance: 18,
  minPolar: 0.12,
  maxPolar: 1.52,
  targetRadius: 12,
  minTargetY: 0.25,
  maxTargetY: 5,
};

export function pointerToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -(((clientY - rect.top) / rect.height) * 2 - 1),
  };
}

export function isTapGesture(dx: number, dy: number, durationMs: number): boolean {
  return Math.hypot(dx, dy) <= 7 && durationMs >= 0 && durationMs <= 600;
}

export function clampOrbit(state: OrbitState): OrbitState {
  const horizontal = Math.hypot(state.target.x, state.target.z);
  const scale = horizontal > ORBIT_LIMITS.targetRadius
    ? ORBIT_LIMITS.targetRadius / horizontal
    : 1;
  return {
    target: {
      x: state.target.x * scale,
      y: Math.min(ORBIT_LIMITS.maxTargetY, Math.max(ORBIT_LIMITS.minTargetY, state.target.y)),
      z: state.target.z * scale,
    },
    azimuth: state.azimuth,
    polar: Math.min(ORBIT_LIMITS.maxPolar, Math.max(ORBIT_LIMITS.minPolar, state.polar)),
    distance: Math.min(ORBIT_LIMITS.maxDistance, Math.max(ORBIT_LIMITS.minDistance, state.distance)),
  };
}

export function orbitCameraPosition(state: OrbitState): { x: number; y: number; z: number } {
  const s = clampOrbit(state);
  const sinPolar = Math.sin(s.polar);
  return {
    x: s.target.x + s.distance * sinPolar * Math.sin(s.azimuth),
    y: s.target.y + s.distance * Math.cos(s.polar),
    z: s.target.z + s.distance * sinPolar * Math.cos(s.azimuth),
  };
}

/** Ground-plane forward for arrow/WASD movement at an azimuth. */
export function orbitForward(azimuth: number): { x: number; z: number } {
  return { x: -Math.sin(azimuth), z: -Math.cos(azimuth) };
}

export function orbitRight(azimuth: number): { x: number; z: number } {
  return { x: Math.cos(azimuth), z: -Math.sin(azimuth) };
}

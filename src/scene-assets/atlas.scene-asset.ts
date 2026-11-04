/**
 * mmData hackathon — Milestone 2 environment assets (new work, 2026-10-26).
 * Deterministic, side-effect free procedural assets: observatory floor,
 * central platform, luminous placeholder formations (NOT data), grabbable
 * node orbs, and navigation beacons.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  createSceneMaterial,
  createScenePrimitiveObject,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Mesh,
  Points,
  PointsMaterial,
  RGBAFormat,
  UnsignedByteType,
} from '@iwsdk/core';

const floorMaterial = createSceneMaterial({
  id: 'atlas-floor',
  model: 'standard',
  baseColor: '#0b1020',
  roughness: 0.55,
  metalness: 0.35,
});

const platformMaterial = createSceneMaterial({
  id: 'atlas-platform',
  model: 'physical',
  baseColor: '#141c33',
  roughness: 0.32,
  metalness: 0.55,
  clearcoat: 0.5,
  clearcoatRoughness: 0.25,
  envMapIntensity: 1.6,
});

const goldMaterial = createSceneMaterial({
  id: 'atlas-gold',
  model: 'physical',
  baseColor: '#c9a44a',
  roughness: 0.28,
  metalness: 0.85,
  envMapIntensity: 2.2,
});

const orbMaterial = createSceneMaterial({
  id: 'atlas-orb',
  model: 'physical',
  baseColor: '#e8c56a',
  roughness: 0.2,
  metalness: 0.4,
  clearcoat: 0.8,
  clearcoatRoughness: 0.12,
  envMapIntensity: 2.6,
});

const beaconMaterial = createSceneMaterial({
  id: 'atlas-beacon',
  model: 'standard',
  baseColor: '#2dd4bf',
  roughness: 0.4,
  metalness: 0.2,
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Radial soft-dot sprite (no DOM), so points render round on Quest. */
function dotTexture(size = 64): DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(255 * a * a);
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createAtlasFloor(size = 44): Group {
  const floor = createScenePrimitiveObject(
    { geometry: { type: 'plane', size: [size, size] } },
    floorMaterial,
  );
  floor.rotation.x = -Math.PI / 2;
  const root = new Group();
  root.add(floor);
  return root;
}

export function createAtlasPlatform(radius = 2.3): Group {
  const disc = createScenePrimitiveObject(
    {
      geometry: {
        type: 'lathe',
        profile: [
          [0.001, 0],
          [radius, 0],
          [radius + 0.005, 0.03],
          [radius - 0.02, 0.055],
          [0.001, 0.055],
        ],
        segments: 96,
      },
    },
    platformMaterial,
  );
  const ring = createScenePrimitiveObject(
    {
      geometry: {
        type: 'torus',
        radius: radius - 0.18,
        tube: 0.014,
        radialSegments: 8,
        tubularSegments: 160,
      },
    },
    goldMaterial,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.scale.z = 0.35;
  ring.position.y = 0.056;
  const root = new Group();
  root.add(disc, ring);
  return root;
}

/** Luminous two-arm spiral formation. Placeholder scenery, not data. */
export function createCluster(
  seed: number,
  colorHex: string,
  count = 900,
  radius = 2.6,
): Points {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const arm = i % 2 === 0 ? 0 : Math.PI;
    const u = Math.pow(rand(), 0.62);
    const r = radius * u;
    const angle = arm + u * 3.1 + (rand() - 0.5) * 0.55 * (1 - u * 0.6);
    const y = (rand() - 0.5) * 0.22 * radius * (1 - u * 0.75);
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * r;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: new Color(colorHex),
    size: 0.055,
    map: dotTexture(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  });
  return new Points(geometry, material);
}

/** Reachable golden node the visitor can grab (first manipulation). */
export function createNodeOrb(radius = 0.09): Mesh {
  return createScenePrimitiveObject(
    { geometry: { type: 'sphere', radius } },
    orbMaterial,
  );
}

/**
 * Ambient depth dust (polish, 2026-11-02): a slow-drifting
 * particle field that gives the volume above, beside, and below
 * the sightline a sense of depth. Deliberately NOT data:
 * faint cool-white points, additive, no picking, no labels, no
 * motion that competes with investigation. Two discs — an upper
 * halo and a low band hugging the floor — plus a far outer
 * veil, all outside the galaxy placement band (r < 3.2 stays
 * empty) so nodes never visually collide with dust.
 */
export function createDepthDust(count = 2600): Points {
  const rand = mulberry32(20261102);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const shell = rand();
    let x = 0;
    let y = 0;
    let z = 0;
    if (shell < 0.38) {
      // Upper halo: wide disc well above head height.
      const r = 4 + rand() * 26;
      const a = rand() * Math.PI * 2;
      x = Math.cos(a) * r;
      y = 3.4 + rand() * 9;
      z = Math.sin(a) * r;
    } else if (shell < 0.68) {
      // Lower band: wide disc between knee height and just
      // above the floor (owner, 2026-11-02) — visible below
      // the sightline, never under the floor where the
      // platform and DomeFade swallow it.
      const r = 4 + rand() * 26;
      const a = rand() * Math.PI * 2;
      x = Math.cos(a) * r;
      y = 0.15 + rand() * 1.1;
      z = Math.sin(a) * r;
    } else {
      // Outer veil: far shell beyond the farthest evidence.
      const theta = rand() * Math.PI * 2;
      const v = rand() * 2 - 1;
      const ring = Math.sqrt(Math.max(0, 1 - v * v));
      const r = 15 + rand() * 22;
      x = Math.cos(theta) * ring * r;
      y = v * r * 0.55;
      z = Math.sin(theta) * ring * r;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new Points(
    geometry,
    new PointsMaterial({
      color: new Color('#9db8dd'),
      size: 0.09,
      map: dotTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
}

/** Slim teal navigation beacon with a bright cap. */
export function createBeacon(height = 1.5): Group {
  const pole = createScenePrimitiveObject(
    {
      geometry: {
        type: 'cylinder',
        radiusTop: 0.018,
        radiusBottom: 0.035,
        height,
      },
    },
    platformMaterial,
  );
  pole.position.y = height / 2;
  const cap = createScenePrimitiveObject(
    { geometry: { type: 'sphere', radius: 0.055 } },
    beaconMaterial,
  );
  cap.position.y = height + 0.05;
  const root = new Group();
  root.add(pole, cap);
  return root;
}

export function createStarfield(count = 1400, radius = 60): Points {
  const rand = mulberry32(20261026);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = rand() * Math.PI * 2;
    const y = rand() * 0.85 + 0.08;
    const ring = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = y * radius * 0.6;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new Points(
    geometry,
    new PointsMaterial({
      color: new Color('#cfe4ff'),
      size: 0.16,
      map: dotTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
}

// What: The procedural sky dome on vertex colours: the gradient of the mountain's sky, the sun with its glow, rings of far peaks with snow caps and puffy clouds, all one mesh round the camera.
// Called by: render/renderer.ts (created with the scene, recoloured by setTint, moved to the camera before each frame).
// Keep: One draw call, no textures, no fog on it (the fog of the world fades into its horizon colour); every colour and number from theme.json `dome`.

/**
 * Z-04 (producer 26.10, «Lavina 19 · Winter look»): the sky of a top obby — a gradient dome in the colours of the
 * mountain (theme.json sky or its tint), a low sun with a soft glow, 2–3 rings of far peaks paler with the distance,
 * puffy clouds of low-poly balls. One BufferGeometry with vertex colours under MeshBasicMaterial: +1 draw call, 0 KB of
 * textures. The colours are kept per vertex as «what it is» (a share of the gradient, a peak tone, a cloud shade) so a
 * tint recolours it without rebuilding.
 */
import { BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { ThemeJson, ThemeTint } from '../content/types.ts';

/** Radius of the dome: inside the camera's far plane (400). */
const R = 360;

export interface Sky {
  readonly mesh: Mesh;
  /** The colours of a mountain (its tint) or of the theme (null). */
  setTint(tint: ThemeTint | null): void;
  /** Keeps the dome round the camera. */
  follow(at: Vector3): void;
}

/** What a vertex shows: 0 — the sky at height share `k`; 1 — the sun (glow share `k`); 2 — a peak of ring `ring`
 * (snow share `k`); 3 — a cloud (light share `k`). */
interface Tag {
  kind: 0 | 1 | 2 | 3;
  k: number;
  ring: number;
}

/** A small deterministic random (mulberry32): the same peaks and clouds every load. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSky(theme: ThemeJson): Sky {
  const d = theme.dome;
  const pos: number[] = [];
  const tags: Tag[] = [];
  const push = (x: number, y: number, z: number, t: Tag): void => {
    pos.push(x, y, z);
    tags.push(t);
  };
  const dir = (az: number, el: number, r: number): [number, number, number] => [Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r];

  // The dome: rings of latitude from below the horizon to the zenith, the colour by the height share.
  const SEG = 24;
  const lats = [-0.5, -0.05, 0, 0.06, 0.14, 0.26, 0.42, 0.62, 0.85, Math.PI / 2];
  const sky = (el: number): Tag => ({ kind: 0, k: Math.max(0, Math.min(1, el / (Math.PI / 2))) ** 0.7, ring: 0 });
  for (let i = 0; i < lats.length - 1; i++)
    for (let j = 0; j < SEG; j++) {
      const a0 = (j / SEG) * Math.PI * 2;
      const a1 = ((j + 1) / SEG) * Math.PI * 2;
      const e0 = lats[i]!;
      const e1 = lats[i + 1]!;
      const quad: Array<[number, number]> = [[a0, e0], [a1, e0], [a1, e1], [a0, e0], [a1, e1], [a0, e1]];
      // Inside view: wound so the faces look in (BackSide is not needed, the material draws both).
      for (const [a, e] of quad) push(...dir(a, e, R), sky(e));
    }

  // The sun: a disc facing the camera with a ring of glow fading into the sky round it.
  const sunAz = Math.atan2(theme.light.sunDir[0], Math.abs(theme.light.sunDir[2]) + d.sunAhead);
  const sunC = new Vector3(...dir(sunAz, d.sunElev, R * 0.97));
  const n = sunC.clone().normalize();
  const u = new Vector3(0, 1, 0).cross(n).normalize();
  const v = n.clone().cross(u).normalize();
  const at = (r: number, a: number): [number, number, number] => {
    const p = sunC.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
    return [p.x, p.y, p.z];
  };
  const SUN_SEG = 20;
  for (let j = 0; j < SUN_SEG; j++) {
    const a0 = (j / SUN_SEG) * Math.PI * 2;
    const a1 = ((j + 1) / SUN_SEG) * Math.PI * 2;
    push(sunC.x, sunC.y, sunC.z, { kind: 1, k: 0, ring: 0 });
    push(...at(d.sunSize, a0), { kind: 1, k: 0, ring: 0 });
    push(...at(d.sunSize, a1), { kind: 1, k: 0, ring: 0 });
    const g = d.sunSize * d.glow;
    for (const [p, k] of [[at(d.sunSize, a0), 0.15], [at(d.sunSize, a1), 0.15], [at(g, a1), 1], [at(d.sunSize, a0), 0.15], [at(g, a1), 1], [at(g, a0), 1]] as const) push(...p, { kind: 1, k, ring: 0 });
  }

  // Far peaks: rings of jagged ridges, the farther the paler; the tops white with snow.
  const rnd = rand(d.seed);
  d.peaks.forEach((ring, ri) => {
    const N = ring.count;
    const r = R * ring.dist;
    const tops: number[] = [];
    for (let j = 0; j < N; j++) tops.push(j % 2 === 0 ? ring.height[0] + rnd() * (ring.height[1] - ring.height[0]) : ring.height[0] * (0.25 + 0.35 * rnd()));
    const off = rnd() * Math.PI * 2;
    for (let j = 0; j < N; j++) {
      const a0 = off + (j / N) * Math.PI * 2;
      const a1 = off + ((j + 1) / N) * Math.PI * 2;
      const h0 = tops[j]!;
      const h1 = tops[(j + 1) % N]!;
      const top = (h: number): Tag => ({ kind: 2, k: h > ring.height[0] * 0.8 ? 1 : 0.15, ring: ri });
      const base: Tag = { kind: 2, k: 0, ring: ri };
      const y0 = -r * 0.12;
      const p = (a: number, y: number): [number, number, number] => [Math.sin(a) * r, y, Math.cos(a) * r];
      // A snow line a third of the way down the high peaks: the cap reads as snow, not as a pale wash.
      const m0 = h0 * 0.62;
      const m1 = h1 * 0.62;
      for (const [q, t] of [[p(a0, y0), base], [p(a1, y0), base], [p(a1, m1), base], [p(a0, y0), base], [p(a1, m1), base], [p(a0, m0), base]] as const) push(...q, t);
      for (const [q, t] of [[p(a0, m0), base], [p(a1, m1), base], [p(a1, h1), top(h1)], [p(a0, m0), base], [p(a1, h1), top(h1)], [p(a0, h0), top(h0)]] as const) push(...q, t);
    }
  });

  // Puffy clouds: a few flattened balls each, lit on top, shaded below.
  const ball = new IcosahedronGeometry(1, 1).toNonIndexed();
  const bp = ball.getAttribute('position');
  for (let c = 0; c < d.clouds.count; c++) {
    const az = rnd() * Math.PI * 2;
    const el = d.clouds.elev[0] + rnd() * (d.clouds.elev[1] - d.clouds.elev[0]);
    const centre = new Vector3(...dir(az, el, R * 0.85));
    const side = new Vector3(Math.cos(az), 0, -Math.sin(az));
    const puffs = 3 + Math.floor(rnd() * 3);
    const size = d.clouds.size * (0.7 + 0.6 * rnd());
    for (let p = 0; p < puffs; p++) {
      const s = size * (p === Math.floor(puffs / 2) ? 1.25 : 0.7 + 0.35 * rnd());
      const o = centre.clone().addScaledVector(side, (p - (puffs - 1) / 2) * size * 1.05).add(new Vector3(0, (rnd() - 0.3) * size * 0.3, 0));
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i);
        const y = bp.getY(i);
        const z = bp.getZ(i);
        push(o.x + x * s * 1.15, o.y + y * s * 0.62, o.z + z * s, { kind: 3, k: Math.max(0, Math.min(1, 0.5 + y * 0.6)), ring: 0 });
      }
    }
  }
  ball.dispose();

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const colors = new Float32BufferAttribute(new Float32Array(pos.length), 3);
  geo.setAttribute('color', colors);
  const mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, side: 2 }));
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  const top = new Color();
  const bottom = new Color();
  const c = new Color();
  const sun = new Color(d.sun);
  const snow = new Color(d.snow);
  const cloud = new Color(d.cloud);
  const cloudShade = new Color(d.cloudShade);
  const ringTone = new Color();
  const setTint = (tint: ThemeTint | null): void => {
    top.set(tint?.sky.top ?? theme.sky.top);
    bottom.set(tint?.sky.bottom ?? theme.sky.bottom);
    tags.forEach((t, i) => {
      if (t.kind === 0) c.copy(bottom).lerp(top, t.k);
      else if (t.kind === 1) c.copy(sun).lerp(c.copy(bottom).lerp(top, d.sunElev / (Math.PI / 2)), t.k);
      else if (t.kind === 2) {
        // A ring: between the zenith blue and the horizon, the farther the nearer the horizon (air in between).
        const ring = d.peaks[t.ring]!;
        ringTone.copy(top).lerp(bottom, ring.haze);
        c.copy(ringTone).lerp(snow, t.k * (1 - ring.haze * 0.5));
      } else c.copy(cloudShade).lerp(cloud, t.k);
      colors.setXYZ(i, c.r, c.g, c.b);
    });
    colors.needsUpdate = true;
  };
  setTint(null);
  return {
    mesh,
    setTint,
    follow(at) {
      mesh.position.copy(at);
    },
  };
}

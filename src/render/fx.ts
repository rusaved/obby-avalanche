// What: Small particles (snow puff, ice-slide trail, gate confetti) in one Points pool with vertex colours, and the wind lines past a fast hero.
// Called by: main.ts; app/fun-view.ts.
// Keep: One draw call for the points and one for the wind lines while any lives, none otherwise; thinned by the quality particles share via setShare(); own seeded generator, no Math.random; pools of 480 and 64.

/**
 * Small particles of the fun and of the gate reward (docs/01-gdd.md 16.4, 16.5): a puff of snow off a trampoline, a
 * snow trail behind the hero on an ice slide, confetti of the zone colour in a gate arch. One Points pool with vertex
 * colours: one draw call while any particle lives, none otherwise; the quality `particles` share thins them out.
 */
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Points, PointsMaterial } from 'three';

const POOL = 480;
const SIZE = 0.42;
/** Wind lines (docs/01-gdd.md 20.3): at most this many, each this long plus a share of the speed, living this long (s). */
const WIND_POOL = 64;
const WIND_LEN = 1.5;
const WIND_LEN_PER_SPEED = 0.04;
const WIND_LIFE: [number, number] = [0.25, 0.4];
const WIND_OPACITY = 0.55;

export type FxKind = 'puff' | 'trail' | 'confetti' | 'spark';

/** Per kind: life (s), pull down (units/s²) and drag (share of the speed kept a second). */
const KIND: Record<FxKind, { life: [number, number]; gravity: number; keep: number }> = {
  puff: { life: [0.45, 0.8], gravity: 6, keep: 0.08 },
  trail: { life: [0.35, 0.6], gravity: -1.5, keep: 0.2 },
  confetti: { life: [1.0, 1.6], gravity: 9, keep: 0.35 },
  // RL-06: sparks of the ice under a sliding hero.
  spark: { life: [0.2, 0.4], gravity: 5, keep: 0.25 },
};

export interface FxParticles {
  points: Points;
  /** The wind lines: streaks of air streaming past the hero (SP-03), one draw call while any lives. */
  lines: LineSegments;
  /** `n` wind lines in a box `spread` wide round (x, y, z), streaming along (dx, dz) at `speed` units/s. */
  wind(x: number, y: number, z: number, dx: number, dz: number, speed: number, n: number, spread: number): void;
  /** A burst of `n` particles around (x, y, z) flying out at up to `speed` units/s (up more than sideways). */
  burst(kind: FxKind, x: number, y: number, z: number, colors: readonly string[], n: number, speed: number, spread: number): void;
  update(dt: number): void;
  setShare(share: number): void;
  /** Living particles of a kind, or the wind lines (test API). */
  alive(kind?: FxKind | 'wind'): number;
  dispose(): void;
}

export function createFx(): FxParticles {
  const pos = new Float32Array(POOL * 3);
  const col = new Float32Array(POOL * 3);
  const vel = new Float32Array(POOL * 3);
  const life = new Float32Array(POOL);
  const kinds: FxKind[] = new Array<FxKind>(POOL).fill('puff');
  const geo = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3);
  const colAttr = new BufferAttribute(col, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setDrawRange(0, 0);
  const mat = new PointsMaterial({ size: SIZE, vertexColors: true, depthWrite: false });
  const points = new Points(geo, mat);
  points.name = 'fx';
  points.frustumCulled = false;
  points.visible = false;
  const wPos = new Float32Array(WIND_POOL * 6);
  const wVel = new Float32Array(WIND_POOL * 3);
  const wLife = new Float32Array(WIND_POOL);
  const wGeo = new BufferGeometry();
  const wAttr = new BufferAttribute(wPos, 3);
  wGeo.setAttribute('position', wAttr);
  wGeo.setDrawRange(0, 0);
  const wMat = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: WIND_OPACITY, depthWrite: false });
  const lines = new LineSegments(wGeo, wMat);
  lines.name = 'fx-wind';
  lines.frustumCulled = false;
  lines.visible = false;
  let wCount = 0;
  let count = 0;
  let share = 1;
  let seed = 1;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const c = new Color();
  const kill = (i: number): void => {
    const last = --count;
    if (i === last) return;
    for (let a = 0; a < 3; a++) {
      pos[i * 3 + a] = pos[last * 3 + a]!;
      col[i * 3 + a] = col[last * 3 + a]!;
      vel[i * 3 + a] = vel[last * 3 + a]!;
    }
    life[i] = life[last]!;
    kinds[i] = kinds[last]!;
  };
  return {
    points,
    lines,
    wind(x, y, z, dx, dz, speed, n, spread) {
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) return;
      const ux = dx / len;
      const uz = dz / len;
      const l = WIND_LEN + WIND_LEN_PER_SPEED * speed;
      for (let m = 0; m < Math.round(n * share) && wCount < WIND_POOL; m++) {
        const i = wCount++;
        const px = x + (rand() - 0.5) * spread;
        const py = y + (rand() - 0.3) * spread * 0.4;
        const pz = z + (rand() - 0.5) * spread;
        wPos.set([px, py, pz, px + ux * l, py, pz + uz * l], i * 6);
        wVel.set([ux * speed, 0, uz * speed], i * 3);
        wLife[i] = WIND_LIFE[0] + (WIND_LIFE[1] - WIND_LIFE[0]) * rand();
      }
      lines.visible = wCount > 0;
    },
    burst(kind, x, y, z, colors, n, speed, spread) {
      const want = Math.max(1, Math.round(n * share));
      const k = KIND[kind];
      for (let m = 0; m < want && count < POOL; m++) {
        const i = count++;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * spread;
        pos[i * 3] = x + Math.cos(a) * r;
        pos[i * 3 + 1] = y + rand() * spread * 0.5;
        pos[i * 3 + 2] = z + Math.sin(a) * r;
        const s = speed * (0.4 + 0.6 * rand());
        vel[i * 3] = Math.cos(a) * s * 0.6;
        vel[i * 3 + 1] = s * (0.6 + 0.6 * rand());
        vel[i * 3 + 2] = Math.sin(a) * s * 0.6;
        c.set(colors[m % colors.length] ?? '#ffffff');
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        life[i] = k.life[0] + (k.life[1] - k.life[0]) * rand();
        kinds[i] = kind;
      }
      points.visible = count > 0;
    },
    update(dt) {
      if (wCount > 0 && dt > 0) {
        for (let i = wCount - 1; i >= 0; i--) {
          wLife[i] = wLife[i]! - dt;
          if (wLife[i]! <= 0) {
            const last = --wCount;
            if (i !== last) {
              wPos.copyWithin(i * 6, last * 6, last * 6 + 6);
              wVel.copyWithin(i * 3, last * 3, last * 3 + 3);
              wLife[i] = wLife[last]!;
            }
            continue;
          }
          for (let e = 0; e < 2; e++) for (let a = 0; a < 3; a++) wPos[i * 6 + e * 3 + a] = wPos[i * 6 + e * 3 + a]! + wVel[i * 3 + a]! * dt;
        }
        wGeo.setDrawRange(0, wCount * 2);
        wAttr.needsUpdate = true;
        lines.visible = wCount > 0;
      }
      if (count === 0 || dt <= 0) return;
      for (let i = count - 1; i >= 0; i--) {
        life[i] = life[i]! - dt;
        if (life[i]! <= 0) {
          kill(i);
          continue;
        }
        const k = KIND[kinds[i]!];
        const drag = Math.pow(k.keep, dt);
        vel[i * 3] = vel[i * 3]! * drag;
        vel[i * 3 + 1] = vel[i * 3 + 1]! * drag - k.gravity * dt;
        vel[i * 3 + 2] = vel[i * 3 + 2]! * drag;
        for (let a = 0; a < 3; a++) pos[i * 3 + a] = pos[i * 3 + a]! + vel[i * 3 + a]! * dt;
      }
      geo.setDrawRange(0, count);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      points.visible = count > 0;
    },
    setShare(v) {
      share = Math.max(0.1, Math.min(1, v));
    },
    alive(kind) {
      if (kind === 'wind') return wCount;
      if (!kind) return count;
      let n = 0;
      for (let i = 0; i < count; i++) if (kinds[i] === kind) n++;
      return n;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      wGeo.dispose();
      wMat.dispose();
    },
  };
}

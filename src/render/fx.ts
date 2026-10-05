/**
 * Small particles of the fun and of the gate reward (docs/01-gdd.md 16.4, 16.5): a puff of snow off a trampoline, a
 * snow trail behind the hero on an ice slide, confetti of the zone colour in a gate arch. One Points pool with vertex
 * colours: one draw call while any particle lives, none otherwise; the quality `particles` share thins them out.
 */
import { BufferAttribute, BufferGeometry, Color, Points, PointsMaterial } from 'three';

const POOL = 480;
const SIZE = 0.42;

export type FxKind = 'puff' | 'trail' | 'confetti';

/** Per kind: life (s), pull down (units/s²) and drag (share of the speed kept a second). */
const KIND: Record<FxKind, { life: [number, number]; gravity: number; keep: number }> = {
  puff: { life: [0.45, 0.8], gravity: 6, keep: 0.08 },
  trail: { life: [0.35, 0.6], gravity: -1.5, keep: 0.2 },
  confetti: { life: [1.0, 1.6], gravity: 9, keep: 0.35 },
};

export interface FxParticles {
  points: Points;
  /** A burst of `n` particles around (x, y, z) flying out at up to `speed` units/s (up more than sideways). */
  burst(kind: FxKind, x: number, y: number, z: number, colors: readonly string[], n: number, speed: number, spread: number): void;
  update(dt: number): void;
  setShare(share: number): void;
  /** Living particles of a kind (test API). */
  alive(kind?: FxKind): number;
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
      if (!kind) return count;
      let n = 0;
      for (let i = 0; i < count; i++) if (kinds[i] === kind) n++;
      return n;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

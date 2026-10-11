// What: Decor of the open slope: pets of pets.json walking a patch at the slope edge (penguins) and birds sitting on cliffs, on the borders under a ridge and on the giant's sign; the birds turn to the hero and hop when he comes near.
// Called by: main.ts (createDecor, wire on each new mountain, update every frame); test-api (state, enabled); tests/render/decor.test.ts (decorPlan).
// Keep: Render only — nothing in the sim, no colliders; one InstancedMesh per kind (2 draw calls), colours baked from pets.json and theme petEye; deterministic by the seed; none below theme decor.minQuality.

/**
 * Decor (docs/01-gdd.md 18.7; docs/01a-content.md 17.5). On the mountains whose look is in `walkers.on` a patch
 * `patch` × `patch` at the slope edge of each section (clear of grottos, elements, gates and the camp) holds
 * perSection penguins walking it at `speed` from point to point with a pause; on those of `sitters.on` perSection birds
 * (one look of `looks` a mountain) sit on the fork cliffs, on the borders right under a ridge and on the giant's sign,
 * facing down the slope; the hero nearer than lookAtDist — the bird turns to him, nearer than hopDist — it hops.
 */
import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PetsJson, ThemeJson } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { createRng, type Rng } from '../core/rng.ts';

type DecorCfg = NonNullable<ThemeJson['decor']>;

/** Sizes of a penguin and a bird; a patch keeps this far from the border, its z this far from grottos and elements. */
const WALKER_SIZE = 1.4;
const SITTER_SIZE = 0.8;
const EDGE = 1;
const CLEAR = 4;
const TRIES = 12;
const MAX_WALKERS = 32;
const MAX_SITTERS = 32;
/** A cliff gets a perch every PERCH_STEP along it; a ridge's border perch this far under it. */
const PERCH_STEP = 8;
const UNDER_RIDGE = 3;
/** Pause at a target point; the waddle; the turn of a bird's head; its hop. */
const PAUSE: [number, number] = [0.5, 2];
const WADDLE = 0.12;
const TURN = 6;
const HOP_SEC = 0.5;
const HOP_UP = 0.6;
const HOP_REST = 1;

export interface DecorPlan {
  walkers: Array<{ x: number; z: number; patch: [number, number, number, number] }>;
  sitters: Array<{ x: number; y: number; z: number }>;
  /** The bird look of this mountain (an id of pets.json), null — no birds. */
  bird: string | null;
}

/** The giant's advice sign: its top over the floor at the zone's line and its half width (app/boss-view.ts). */
export interface SignSize {
  top: number;
  half: number;
}

/** Where the decor of a mountain stands: a pure function of the level, its look and the seed. */
export function decorPlan(level: LevelData, look: string, cfg: DecorCfg, seed: number, sign: SignSize): DecorPlan {
  const rng = createRng(seed);
  const plan: DecorPlan = { walkers: [], sitters: [], bird: null };
  const count = (r: [number, number]): number => r[0] + rng.int(r[1] - r[0] + 1);
  const half = level.width / 2;
  const p = cfg.walkers.patch;
  const clear = (side: number, z0: number, z1: number): boolean =>
    !level.niches.some((n) => (n.side === 'left' ? -1 : 1) === side && n.z > z0 - CLEAR && n.z < z1 + CLEAR) &&
    !(level.shapes ?? []).some((s) => s.z1 > z0 - CLEAR && s.z0 < z1 + CLEAR) &&
    !level.gates.some((g) => g.z > z0 - CLEAR && g.z < z1 + CLEAR) &&
    !level.forks.some((f) => f.z1 > z0 - CLEAR && f.z0 < z1 + CLEAR) &&
    !level.safeZones.some(([a, b]) => b > z0 && a < z1) &&
    !level.bosses.some((b) => b.zone[1] > z0 && b.zone[0] < z1);
  if (cfg.walkers.on.includes(look))
    for (const s of level.sections)
      for (let t = 0; t < TRIES; t++) {
        const z = s.z0 + (0.15 + 0.7 * rng.next()) * (s.z1 - s.z0);
        const side = rng.chance(0.5) ? -1 : 1;
        if (!clear(side, z - p / 2, z + p / 2)) continue;
        const cx = side * (half - p / 2 - EDGE);
        const patch: [number, number, number, number] = [cx - p / 2, z - p / 2, cx + p / 2, z + p / 2];
        for (let i = count(cfg.walkers.perSection); i > 0 && plan.walkers.length < MAX_WALKERS; i--)
          plan.walkers.push({ x: patch[0] + rng.next() * p, z: patch[1] + rng.next() * p, patch });
        break;
      }
  if (!cfg.sitters.on.includes(look)) return plan;
  plan.bird = rng.pick(cfg.sitters.looks);
  const borderTop = (x: number, z: number): number | null => {
    const b = level.boxes.find((o) => o.kind === 'border' && x >= o.min[0] && x <= o.max[0] && z >= o.min[2] && z <= o.max[2]);
    return b ? b.max[1] : null;
  };
  for (const s of level.sections) {
    const spots: Array<{ x: number; y: number; z: number }> = [];
    for (const b of level.boxes)
      if (b.kind === 'cliff' && b.min[2] >= s.z0 && b.min[2] < s.z1)
        for (let z = b.min[2] + 2; z <= b.max[2] - 2; z += PERCH_STEP) spots.push({ x: (b.min[0] + b.max[0]) / 2, y: b.max[1], z });
    for (const g of level.gates)
      if (g.kind === 'ridge' && g.z > s.z0 && g.z <= s.z1 + 1)
        for (const side of [-1, 1]) {
          const x = side * (half + 1);
          const y = borderTop(x, g.z - UNDER_RIDGE);
          if (y !== null) spots.push({ x, y, z: g.z - UNDER_RIDGE });
        }
    for (const b of level.bosses)
      if (b.zone[0] >= s.z0 && b.zone[0] < s.z1)
        for (const side of [-1, 1]) spots.push({ x: side * (sign.half - 2), y: level.floorAt(0, b.zone[0]) + sign.top, z: b.zone[0] - 1 });
    for (let i = count(cfg.sitters.perSection); i > 0 && spots.length > 0 && plan.sitters.length < MAX_SITTERS; i--) plan.sitters.push(spots.splice(rng.int(spots.length), 1)[0]!);
  }
  return plan;
}

function baked(geo: BufferGeometry, color: Color): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}
const part = (w: number, h: number, d: number, x: number, y: number, z: number, c: Color): BufferGeometry => baked(new BoxGeometry(w, h, d).translate(x, y, z), c);

/** A block creature of `s` facing +z, feet at y = 0: body of `color`, belly, beak and feet of `accent`, eyes. */
function creature(s: number, color: Color, accent: Color, eye: Color): BufferGeometry {
  const parts = [
    part(s, s, s * 0.8, 0, s / 2, 0, color),
    part(s * 0.6, s * 0.55, 0.04, 0, s * 0.4, s * 0.41, accent),
    part(s * 0.22, s * 0.14, s * 0.22, 0, s * 0.62, s * 0.5, accent),
    part(s * 0.12, s * 0.14, 0.04, -s * 0.22, s * 0.78, s * 0.41, eye),
    part(s * 0.12, s * 0.14, 0.04, s * 0.22, s * 0.78, s * 0.41, eye),
    part(s * 0.28, s * 0.08, s * 0.32, -s * 0.22, 0.04, s * 0.12, accent),
    part(s * 0.28, s * 0.08, s * 0.32, s * 0.22, 0.04, s * 0.12, accent),
  ];
  const g = mergeGeometries(parts, false)!;
  for (const q of parts) q.dispose();
  return g;
}

export interface DecorState {
  walkers: Array<{ x: number; z: number; patch: [number, number, number, number] }>;
  sitters: Array<{ x: number; y: number; z: number; yaw: number; hop: number }>;
  /** Drawn now (quality and enabled). */
  shown: boolean;
}

export interface Decor {
  readonly meshes: readonly InstancedMesh[];
  /** Tests: off — nothing drawn (the +2 draw calls of 18.7 are measured against it). */
  enabled: boolean;
  readonly state: DecorState;
  wire(level: LevelData, look: string | undefined, seed: number): void;
  /** Per frame: the hero's render position; `allowed` — the quality level is at least decor.minQuality. */
  update(hero: { x: number; y: number; z: number }, dt: number, timeSec: number, allowed: boolean): void;
}

export function createDecor(scene: Scene, theme: ThemeJson, pets: PetsJson['pets'], sign: SignSize): Decor {
  const cfg = theme.decor;
  const eye = new Color(theme.materials['petEye']?.color ?? '#000000');
  const lookOf = (id: string): { color: Color; accent: Color } => {
    const p = pets.find((x) => x.id === id);
    return { color: new Color(p?.color ?? '#ffffff'), accent: new Color(p?.accent ?? '#ffffff') };
  };
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const w = cfg ? lookOf(cfg.walkers.look) : null;
  const walkMesh = new InstancedMesh(creature(WALKER_SIZE, w?.color ?? eye, w?.accent ?? eye, eye), mat, MAX_WALKERS);
  const sitMesh = new InstancedMesh(new BufferGeometry(), mat, MAX_SITTERS);
  walkMesh.name = 'decor-walkers';
  sitMesh.name = 'decor-sitters';
  for (const m of [walkMesh, sitMesh]) {
    m.frustumCulled = false;
    m.count = 0;
    m.visible = false;
    scene.add(m);
  }
  let level: LevelData | null = null;
  let walkers: Array<{ x: number; z: number; patch: [number, number, number, number]; tx: number; tz: number; yaw: number; pause: number; rng: Rng }> = [];
  /** `hop` — seconds of the hop left, `rest` — of the rest after it, `home` — the yaw down the slope. */
  let sitters: Array<{ x: number; y: number; z: number; yaw: number; hop: number; rest: number; home: number }> = [];
  const state: DecorState = { walkers: [], sitters: [], shown: false };
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  const fwd = new Vector3(0, 0, 1);
  const roll = new Quaternion();
  const turn = (from: number, to: number, max: number): number => {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + Math.max(-max, Math.min(max, d));
  };

  const decor: Decor = {
    meshes: [walkMesh, sitMesh],
    enabled: true,
    state,
    wire(next, look, seed) {
      level = next;
      const plan = cfg && look ? decorPlan(next, look, cfg, seed, sign) : { walkers: [], sitters: [], bird: null };
      walkers = plan.walkers.map((p, i) => ({ ...p, tx: p.x, tz: p.z, yaw: 0, pause: 0, rng: createRng((seed + i * 7907) >>> 0) }));
      sitters = plan.sitters.map((p) => ({ ...p, yaw: Math.PI, hop: 0, rest: 0, home: Math.PI }));
      if (plan.bird) {
        const b = lookOf(plan.bird);
        sitMesh.geometry.dispose();
        sitMesh.geometry = creature(SITTER_SIZE, b.color, b.accent, eye);
      }
    },
    update(hero, dt, timeSec, allowed) {
      const on = allowed && decor.enabled && level !== null;
      walkMesh.count = on ? walkers.length : 0;
      sitMesh.count = on ? sitters.length : 0;
      walkMesh.visible = walkMesh.count > 0;
      sitMesh.visible = sitMesh.count > 0;
      state.shown = walkMesh.visible || sitMesh.visible;
      if (!on || !level || !cfg) return;
      walkers.forEach((p, i) => {
        let moving = false;
        if (p.pause > 0) p.pause -= dt;
        else {
          const dx = p.tx - p.x;
          const dz = p.tz - p.z;
          const d = Math.hypot(dx, dz);
          const step = cfg.walkers.speed * dt;
          if (d <= step) {
            [p.x, p.z] = [p.tx, p.tz];
            p.tx = p.patch[0] + p.rng.next() * (p.patch[2] - p.patch[0]);
            p.tz = p.patch[1] + p.rng.next() * (p.patch[3] - p.patch[1]);
            p.pause = p.rng.range(PAUSE[0], PAUSE[1]);
          } else {
            p.x += (dx / d) * step;
            p.z += (dz / d) * step;
            p.yaw = turn(p.yaw, Math.atan2(dx, dz), TURN * dt);
            moving = true;
          }
        }
        q.setFromAxisAngle(up, p.yaw);
        if (moving) q.multiply(roll.setFromAxisAngle(fwd, WADDLE * Math.sin(timeSec * 9 + i)));
        walkMesh.setMatrixAt(i, m4.compose(pos.set(p.x, level!.floorAt(p.x, p.z), p.z), q, one));
      });
      walkMesh.instanceMatrix.needsUpdate = true;
      sitters.forEach((b, i) => {
        const d = Math.hypot(hero.x - b.x, hero.z - b.z);
        b.yaw = turn(b.yaw, d < cfg.sitters.lookAtDist ? Math.atan2(hero.x - b.x, hero.z - b.z) : b.home, TURN * dt);
        // A hop on the spot, then a rest before the next one while he stays near.
        if (b.hop > 0) {
          b.hop = Math.max(0, b.hop - dt);
          if (b.hop === 0) b.rest = HOP_REST;
        } else if (b.rest > 0) b.rest -= dt;
        else if (d < cfg.sitters.hopDist) b.hop = HOP_SEC;
        const lift = b.hop > 0 ? HOP_UP * Math.sin((Math.PI * (HOP_SEC - b.hop)) / HOP_SEC) : 0;
        sitMesh.setMatrixAt(i, m4.compose(pos.set(b.x, b.y + lift, b.z), q.setFromAxisAngle(up, b.yaw), one));
      });
      sitMesh.instanceMatrix.needsUpdate = true;
      state.walkers = walkers.map((p) => ({ x: p.x, z: p.z, patch: p.patch }));
      state.sitters = sitters.map((b) => ({ x: b.x, y: b.y, z: b.z, yaw: b.yaw, hop: b.hop }));
    },
  };
  return decor;
}

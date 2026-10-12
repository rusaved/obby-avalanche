// What: Builds LevelData (boxes, ramps, gates, caves, checkpoints, points, collider triangles, the invisible wall) from one worlds.json world; pure and deterministic.
// Called by: main.ts, sim/world.ts, sim/bots.ts, level/validate.ts, app/wave-view.ts, render/threat/avalanche.ts; tests/level/*, tests/sim/*, tests/meta/*
// Keep: Pure TS, no DOM/three; staticTriangles = 9 numbers per triangle with outward normals; GATE_THICKNESS and NICHE_* are shared with validate.ts and meshes.

/**
 * worlds.json → LevelData (docs/02-tech.md 6.1): boxes and ramps for colliders and meshes, gates as dynamic
 * colliders, niches as shelter volumes, checkpoints, spawn. Pure, runs in Node (validator, bot, tests).
 */
import type { Segment, World } from '../content/types.ts';
import type { Aabb, LevelBox, LevelCheckpoint, LevelData, LevelGate, LevelNiche, LevelPoint, LevelPrism, LevelRamp, LevelShape, Vec3 } from './types.ts';

export const FLOOR_THICKNESS = 2;
export const BORDER_HEIGHT = 3;
export const BORDER_WIDTH = 3;
export const NICHE_HEIGHT = 8;
export const NICHE_WALL = 1;
export const GATE_THICKNESS = 1.5;
export const LEDGE_SIZE = 4;
export const KILL_DEPTH = 20;
/** Width of the summit portal arch with its 1-unit pillars when its segment has no `width` (docs/01-gdd.md 5.2); the hero
 * enters across all of it, pillars too (docs/01-gdd.md 19.8). */
export const PORTAL_WIDTH = 10;
/** Treadmill belt inside a cave (docs/01-gdd.md 4.3): 3 units wide, flush with the back wall and as long as the cave
 * (playtest M2: running forward the hero hit the side wall past a 5-unit belt and lost it), room in front of it. */
export const NICHE_BELT_WIDTH = 3;
/** The walls of a throat step in over its funnel in this many blocks (docs/01-gdd.md 18.3). */
export const THROAT_STEPS = 4;
/** A tunnel (docs/01-gdd.md 18.3): the glowing lintel of its mouths, its crystals (size, one every so many units). */
const TUNNEL_LINTEL = 1.2;
const TUNNEL_CRYSTAL = 0.8;
const TUNNEL_CRYSTAL_EVERY = 14;

function num(seg: Segment, key: string, def = 0): number {
  const v = seg[key];
  return typeof v === 'number' ? v : def;
}
function str(seg: Segment, key: string, def = ''): string {
  const v = seg[key];
  return typeof v === 'string' ? v : def;
}

function box(min: Vec3, max: Vec3, material: string, kind: string, solid = true): LevelBox {
  return { min, max, material, kind, solid };
}

/** Pushes the 12 triangles of a box (outward normals). */
function pushBoxTriangles(out: number[], b: Aabb): void {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const quad = (a: Vec3, b2: Vec3, c: Vec3, d: Vec3): void => {
    out.push(...a, ...b2, ...c, ...a, ...c, ...d);
  };
  // top (+y)
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  // bottom (-y)
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  // front (+z)
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  // back (-z)
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  // right (+x)
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  // left (-x)
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
}

function pushRampTriangles(out: number[], r: LevelRamp): void {
  const { x0, x1, z0, z1, y0, y1, thickness: t } = r;
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): void => {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  // top slope
  quad([x0, y0, z0], [x0, y1, z1], [x1, y1, z1], [x1, y0, z0]);
  // bottom
  quad([x0, y0 - t, z0], [x1, y0 - t, z0], [x1, y1 - t, z1], [x0, y1 - t, z1]);
  // front (+z, high end)
  quad([x0, y1 - t, z1], [x1, y1 - t, z1], [x1, y1, z1], [x0, y1, z1]);
  // back (-z, low end)
  quad([x0, y0 - t, z0], [x0, y0, z0], [x1, y0, z0], [x1, y0 - t, z0]);
  // sides
  quad([x1, y0 - t, z0], [x1, y0, z0], [x1, y1, z1], [x1, y1 - t, z1]);
  quad([x0, y0 - t, z0], [x0, y1 - t, z1], [x0, y1, z1], [x0, y0, z0]);
}

/** A convex polygon in XZ turned clockwise seen from above (x right, z up), as prismTriangles needs it. */
export function clockwise(pts: Array<[number, number]>): Array<[number, number]> {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area > 0 ? [...pts].reverse() : pts;
}

/** Pushes the triangles of a prism (outward normals): its polygon on top and under it (a fan), a quad per edge. */
export function prismTriangles(out: number[], p: Pick<LevelPrism, 'pts' | 'y0' | 'y1'>): void {
  const { pts, y0, y1 } = p;
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[0]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    out.push(a[0], y1, a[1], b[0], y1, b[1], c[0], y1, c[1]);
    out.push(a[0], y0, a[1], c[0], y0, c[1], b[0], y0, b[1]);
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    out.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
  }
}

/** Build options from tuning.json (docs/01-gdd.md 19.9): `wallHeight` — the invisible wall over the borders; 0 or absent — none. */
export interface BuildOptions {
  wallHeight?: number | undefined;
}

/**
 * The invisible wall of the slope (docs/01-gdd.md 19.9, Q-048): over every border up to `h` above the floor it borders,
 * over the roof of every grotto in a border, and across both ends of the track (behind the camp, behind the summit portal).
 * Only the hero's capsule meets it: nothing draws it, the camera and the shadow do not see it.
 */
function boundsWalls(boxes: LevelBox[], nicheSegs: Segment[], floors: Segment[], ramps: LevelRamp[], half: number, h: number): Aabb[] {
  const out: Aabb[] = [];
  for (const b of boxes) {
    if (b.kind !== 'border') continue;
    const floorY = b.max[1] - BORDER_HEIGHT;
    out.push({ min: [b.min[0], b.max[1], b.min[2]], max: [b.max[0], floorY + h, b.max[2]] });
  }
  for (const n of nicheSegs) {
    const sign = str(n, 'side') === 'right' ? 1 : -1;
    const y = num(n, 'y');
    const e = num(n, 'edge', half);
    const xOut = sign * (e + BORDER_WIDTH + num(n, 'depth') + NICHE_WALL);
    const len = num(n, 'length');
    out.push({ min: [Math.min(sign * e, xOut), y + NICHE_HEIGHT, n.z - len / 2 - NICHE_WALL], max: [Math.max(sign * e, xOut), y + h, n.z + len / 2 + NICHE_WALL] });
  }
  const pieces = [
    ...floors.map((f) => ({ z0: f.z, z1: f.z + num(f, 'length'), y: num(f, 'y') })),
    ...ramps.map((r) => ({ z0: r.z0, z1: r.z1, y: Math.max(r.y0, r.y1) })),
  ];
  if (pieces.length === 0) return out;
  const x0 = -half - BORDER_WIDTH;
  const x1 = half + BORDER_WIDTH;
  const zStart = Math.min(...pieces.map((p) => p.z0));
  const zEnd = Math.max(...pieces.map((p) => p.z1));
  const yStart = Math.max(...pieces.filter((p) => p.z0 === zStart).map((p) => p.y));
  const yEnd = Math.max(...pieces.filter((p) => p.z1 === zEnd).map((p) => p.y));
  out.push({ min: [x0, yStart - FLOOR_THICKNESS, zStart - BORDER_WIDTH], max: [x1, yStart + h, zStart] });
  out.push({ min: [x0, yEnd - FLOOR_THICKNESS, zEnd], max: [x1, yEnd + h, zEnd + BORDER_WIDTH] });
  return out;
}

/** Half-width of the slope at z (SP-04, docs/01-gdd.md 20.4): world.profile linear between its points, constant past
 * its ends, at a step (two points at one z) the upper one from that z on; without a profile — width / 2. */
export function profileHalf(world: Pick<World, 'width' | 'profile'>, z: number): number {
  const p = world.profile;
  if (!p || p.length === 0) return world.width / 2;
  if (z < p[0]![0]) return p[0]![1];
  for (let i = p.length - 1; i >= 0; i--) {
    const [za, ha] = p[i]!;
    if (z < za) continue;
    const next = p[i + 1];
    if (!next || next[0] === za) return ha;
    return ha + ((next[1] - ha) * (z - za)) / (next[0] - za);
  }
  return p[0]![1];
}

export function buildLevel(world: World, opts: BuildOptions = {}): LevelData {
  const W = world.width;
  const half = W / 2;
  const halfAt = (z: number): number => profileHalf(world, z);
  // The changes of width (SP-04): their floor is the wider one, snow at an angle along their edges, no box borders there.
  const tapers = world.segments.filter((s) => s.type === 'taper').map((t) => [t.z, t.z + num(t, 'length')] as [number, number]);
  const boxes: LevelBox[] = [];
  const ramps: LevelRamp[] = [];
  const gates: LevelGate[] = [];
  const niches: LevelNiche[] = [];
  const checkpoints: LevelCheckpoint[] = [];
  const points: LevelPoint[] = [];
  const tris: number[] = [];

  const floors = world.segments.filter((s) => s.type === 'floor');
  const rampSegs = world.segments.filter((s) => s.type === 'ramp');
  // A grotto with a chest (open slope, docs/01-gdd.md 17.7) is a niche of kind chestGrotto with the chest inside.
  const nicheSegs = world.segments.filter((s) => s.type === 'niche' || s.type === 'chestGrotto');
  // Multiplier of every treadmill of the mountain (flag w1_treadmillMult, docs/01a-content.md 1).
  const mountainTreadmill = world.treadmillMult ?? 1;

  // Floors and ramps with side borders; borders leave a gap where a niche sits.
  const nicheGap = (side: 'left' | 'right', z0: number, z1: number): Array<[number, number]> => {
    const gaps = nicheSegs
      .filter((n) => str(n, 'side') === side)
      .map((n) => [n.z - num(n, 'length') / 2, n.z + num(n, 'length') / 2] as [number, number])
      .filter(([a, b]) => b > z0 && a < z1);
    const spans: Array<[number, number]> = [];
    let cur = z0;
    for (const [a, b] of gaps.sort((p, q) => p[0] - q[0])) {
      if (a > cur) spans.push([cur, Math.min(a, z1)]);
      cur = Math.max(cur, b);
    }
    if (cur < z1) spans.push([cur, z1]);
    return spans;
  };
  /** The spans of [z0, z1] off the changes of width. */
  const offTapers = (z0: number, z1: number): Array<[number, number]> => {
    let spans: Array<[number, number]> = [[z0, z1]];
    for (const [a, b] of tapers)
      spans = spans.flatMap(([p, q]): Array<[number, number]> => (b <= p || a >= q ? [[p, q]] : [...(a > p ? [[p, a] as [number, number]] : []), ...(b < q ? [[b, q] as [number, number]] : [])]));
    return spans;
  };
  // A piece narrower than the track (open slope: carniz blocks and passage ramps) has a border only on the edge it touches;
  // the edge is the slope's at that z (SP-04: every section its own width).
  const addBorders = (z0: number, z1: number, yTop: number, x0 = -half, x1 = half): void => {
    for (const [za, zb] of offTapers(z0, z1)) {
      const e = halfAt((za + zb) / 2);
      for (const side of ['left', 'right'] as const) {
        if ((side === 'left' && x0 > -e + 1e-6) || (side === 'right' && x1 < e - 1e-6)) continue;
        addSide(side, za, zb, yTop, e);
      }
    }
  };
  const addSide = (side: 'left' | 'right', z0: number, z1: number, yTop: number, e: number): void => {
    const sign = side === 'left' ? -1 : 1;
    for (const [a, b] of nicheGap(side, z0, z1)) {
      const xIn = sign * e;
      const xOut = sign * (e + BORDER_WIDTH);
      boxes.push(box([Math.min(xIn, xOut), yTop - FLOOR_THICKNESS, a], [Math.max(xIn, xOut), yTop + BORDER_HEIGHT, b], 'border', 'border'));
    }
  };

  for (const f of floors) {
    const z0 = f.z;
    const z1 = f.z + num(f, 'length');
    const y = num(f, 'y');
    const x0 = num(f, 'x0', -half);
    const x1 = num(f, 'x1', half);
    boxes.push(box([x0, y - num(f, 'thickness', FLOOR_THICKNESS), z0], [x1, y, z1], str(f, 'material', 'track'), 'floor'));
    addBorders(z0, z1, y, x0, x1);
  }
  for (const r of rampSegs) {
    const z0 = r.z;
    const z1 = r.z + num(r, 'length');
    const y0 = num(r, 'y');
    const y1 = y0 + num(r, 'rise');
    const x0 = num(r, 'x0', -half);
    const x1 = num(r, 'x1', half);
    ramps.push({ x0, x1, z0, z1, y0, y1, thickness: FLOOR_THICKNESS, material: str(r, 'material', 'track') });
    addBorders(z0, z1, y1, x0, x1);
  }
  // Ice cliff on a bold lane (docs/01-gdd.md 17.5, 17.7): a winding way up (a ramp the width of the cliff), the cliff, and
  // on top the ledge — a shelter the front passes under (a niche of kind ledge without walls).
  for (const c of world.segments.filter((s) => s.type === 'cliff')) {
    const x0 = num(c, 'x0');
    const x1 = num(c, 'x1');
    const y = num(c, 'y');
    const h = num(c, 'height');
    const z1 = c.z + num(c, 'length');
    const z2 = z1 + num(c, 'top');
    ramps.push({ x0, x1, z0: c.z, z1, y0: y, y1: y + h, thickness: FLOOR_THICKNESS, material: 'ice' });
    boxes.push(box([x0, y - FLOOR_THICKNESS, z1], [x1, y + h, z2], 'ice', 'ledgeCliff'));
    niches.push({
      stretch: num(c, 'stretch'),
      z: (z1 + z2) / 2,
      y: y + h,
      side: str(c, 'side') === 'left' ? 'left' : 'right',
      box: { min: [x0, y + h, z1], max: [x1, y + h + NICHE_HEIGHT, z2] },
      treadmill: 0,
      zone: num(c, 'zone', 0),
      kind: 'ledge',
      lane: 'bold',
    });
  }
  // Fork (docs/01-gdd.md 17.7): an ice cliff down the middle splits the slope into two lanes.
  for (const f of world.segments.filter((s) => s.type === 'fork')) {
    const w = num(f, 'width') / 2;
    const y = num(f, 'y');
    boxes.push(box([num(f, 'x') - w, y - FLOOR_THICKNESS, f.z], [num(f, 'x') + w, y + num(f, 'height'), f.z + num(f, 'length')], 'ice', 'cliff'));
  }

  // The funnel of the summit (docs/01-gdd.md 20.2): on each side a snow solid from the edge of the slope to the portal
  // pillar and on beside the portal to the end — running up anywhere across leads into the portal; its walls are at an
  // angle, so the hero slides along them.
  const prisms: LevelPrism[] = [];
  let funnel: LevelData['funnel'];
  for (const f of world.segments.filter((s) => s.type === 'funnel')) {
    const z1 = f.z + num(f, 'length');
    const zEnd = num(f, 'end');
    const x0 = num(f, 'from');
    const x1 = num(f, 'to');
    const y = num(f, 'y');
    const out = x0 + BORDER_WIDTH;
    for (const sign of [-1, 1]) {
      const pts: Array<[number, number]> = [[sign * x0, f.z], [sign * x1, z1], [sign * x1, zEnd], [sign * out, zEnd], [sign * out, f.z]];
      prisms.push({ pts: clockwise(pts), y0: y - FLOOR_THICKNESS, y1: y + BORDER_HEIGHT, material: 'border', kind: 'funnel' });
    }
    funnel = { z0: f.z, z1, x0, x1 };
  }
  // The change of width past a ridge (SP-04, docs/01-gdd.md 20.4): the floor as wide as the wider side, on each side snow
  // from the slanted edge out to the outer border line — the edge goes from `from` to `to` over its length.
  const taperFloors: Array<{ z0: number; z1: number; a: number; b: number; y: number }> = [];
  for (const t of world.segments.filter((s) => s.type === 'taper')) {
    const z1 = t.z + num(t, 'length');
    const a = num(t, 'from');
    const b = num(t, 'to');
    const y = num(t, 'y');
    const m = Math.max(a, b);
    taperFloors.push({ z0: t.z, z1, a, b, y });
    boxes.push(box([-m, y - FLOOR_THICKNESS, t.z], [m, y, z1], 'track', 'floor'));
    for (const sign of [-1, 1]) {
      const pts: Array<[number, number]> = [[sign * a, t.z], [sign * b, z1], [sign * (m + BORDER_WIDTH), z1], [sign * (m + BORDER_WIDTH), t.z]];
      prisms.push({ pts: clockwise(pts), y0: y - FLOOR_THICKNESS, y1: y + BORDER_HEIGHT, material: 'border', kind: 'taper' });
    }
  }

  // Elements of the open slope (docs/01-gdd.md 18.3): the walls of a throat (stepping in over `funnel` at each end), the
  // ice hall of a tunnel on the calm lane of its fork (its inner wall is the fork cliff) — a shelter at every point.
  const shapes: LevelShape[] = [];
  for (const t of world.segments.filter((s) => s.type === 'throat')) {
    const z0 = t.z;
    const z1 = t.z + num(t, 'length');
    const y = num(t, 'y');
    const outer = halfAt((z0 + z1) / 2) + BORDER_WIDTH;
    const w = num(t, 'width') / 2;
    const f = num(t, 'funnel');
    const h = num(t, 'height');
    const wall = (a: number, b: number, xin: number): void => {
      // Lighter than a cliff (docs/01-gdd.md 19.8): the way between them reads from afar.
      boxes.push(box([-outer, y - FLOOR_THICKNESS, a], [-xin, y + h, b], 'throatWall', 'throatWall'));
      boxes.push(box([xin, y - FLOOR_THICKNESS, a], [outer, y + h, b], 'throatWall', 'throatWall'));
    };
    for (let k = 0; k < THROAT_STEPS; k++) {
      const xin = half - ((half - w) * (k + 1)) / THROAT_STEPS;
      wall(z0 + (f * k) / THROAT_STEPS, z0 + (f * (k + 1)) / THROAT_STEPS, xin);
      wall(z1 - (f * (k + 1)) / THROAT_STEPS, z1 - (f * k) / THROAT_STEPS, xin);
    }
    wall(z0 + f, z1 - f, w);
    shapes.push({ kind: 'throat', z0, z1, y, x0: -w, x1: w, funnel: f, section: num(t, 'section') });
  }
  for (const t of world.segments.filter((s) => s.type === 'tunnel')) {
    const z0 = t.z;
    const z1 = t.z + num(t, 'length');
    const y = num(t, 'y');
    const side = str(t, 'side') === 'left' ? 'left' : 'right';
    const sign = side === 'left' ? -1 : 1;
    const a = num(t, 'inner');
    const b = a + num(t, 'width');
    const h = num(t, 'height');
    const outer = halfAt((z0 + z1) / 2) + BORDER_WIDTH;
    const span = (p: number, q: number): [number, number] => [Math.min(sign * p, sign * q), Math.max(sign * p, sign * q)];
    const [wx0, wx1] = span(b, outer);
    const [rx0, rx1] = span(a, outer);
    const [hx0, hx1] = span(a, b);
    boxes.push(box([wx0, y - FLOOR_THICKNESS, z0], [wx1, y + h + FLOOR_THICKNESS, z1], 'ice', 'tunnelWall'));
    boxes.push(box([rx0, y + h, z0], [rx1, y + h + FLOOR_THICKNESS, z1], 'ice', 'tunnelRoof'));
    // Its mouths glow like a grotto, crystals light the dim hall (docs/01-gdd.md 18.3): drawn only, no colliders.
    for (const ze of [z0, z1]) {
      boxes.push(box([hx0, y + h - TUNNEL_LINTEL, ze - 0.3], [hx1, y + h, ze + 0.3], 'cave', 'tunnelGlow', false));
      for (const xe of [hx0, hx1]) boxes.push(box([xe - 0.3, y, ze - 0.3], [xe + 0.3, y + h, ze + 0.3], 'cave', 'tunnelGlow', false));
    }
    const xc = sign > 0 ? hx1 - TUNNEL_CRYSTAL / 2 - 0.1 : hx0 + TUNNEL_CRYSTAL / 2 + 0.1;
    for (let zc = z0 + TUNNEL_CRYSTAL_EVERY / 2, k = 0; zc < z1 - 2; zc += TUNNEL_CRYSTAL_EVERY, k++) {
      const hc = TUNNEL_CRYSTAL * (k % 2 ? 2.5 : 1.6);
      boxes.push(box([xc - TUNNEL_CRYSTAL / 2, y, zc - TUNNEL_CRYSTAL / 2], [xc + TUNNEL_CRYSTAL / 2, y + hc, zc + TUNNEL_CRYSTAL / 2], 'portal', 'crystal', false));
    }
    niches.push({
      stretch: num(t, 'stretch'),
      z: (z0 + z1) / 2,
      y,
      side,
      box: { min: [hx0, y, z0], max: [hx1, y + h, z1] },
      treadmill: 0,
      zone: num(t, 'zone', 0),
      kind: 'tunnel',
      lane: 'calm',
    });
    shapes.push({ kind: 'tunnel', z0, z1, y, x0: hx0, x1: hx1, side, section: num(t, 'section') });
  }
  for (const c of world.segments.filter((s) => s.type === 'chasm'))
    shapes.push({ kind: 'chasm', z0: c.z, z1: c.z + num(c, 'length'), y: num(c, 'y'), x0: -halfAt(c.z), x1: halfAt(c.z), depth: num(c, 'depth'), section: num(c, 'section') });
  for (const c of world.segments.filter((s) => s.type === 'hump')) {
    const land = c['land'] as [number, number];
    shapes.push({ kind: 'hump', z0: c.z, z1: c.z + num(c, 'length'), y: num(c, 'y'), x0: num(c, 'x0'), x1: num(c, 'x1'), side: str(c, 'side') === 'left' ? 'left' : 'right', land: [land[0], num(c, 'landEnd')], section: num(c, 'section') });
  }

  // Niches: recess outside the track edge, open towards the track (docs/02-tech.md 8.2).
  for (const n of nicheSegs) {
    const side = str(n, 'side') === 'right' ? 'right' : 'left';
    const sign = side === 'left' ? -1 : 1;
    const len = num(n, 'length');
    const depth = num(n, 'depth');
    const y = num(n, 'y');
    const zA = n.z - len / 2;
    const zB = n.z + len / 2;
    // At the edge of the slope where it stands (SP-04: `edge`, the half-width of its section).
    const e = num(n, 'edge', half);
    const xIn = sign * e;
    const xOut = sign * (e + BORDER_WIDTH + depth);
    const lo = Math.min(xIn, xOut);
    const hi = Math.max(xIn, xOut);
    boxes.push(box([lo, y - FLOOR_THICKNESS, zA - NICHE_WALL], [hi, y, zB + NICHE_WALL], 'cave', 'nicheFloor'));
    const backLo = sign === -1 ? lo - NICHE_WALL : hi;
    boxes.push(box([backLo, y, zA - NICHE_WALL], [backLo + NICHE_WALL, y + NICHE_HEIGHT, zB + NICHE_WALL], 'cave', 'nicheWall'));
    boxes.push(box([lo, y, zA - NICHE_WALL], [hi, y + NICHE_HEIGHT, zA], 'cave', 'nicheWall'));
    boxes.push(box([lo, y, zB], [hi, y + NICHE_HEIGHT, zB + NICHE_WALL], 'cave', 'nicheWall'));
    boxes.push(box([lo, y + NICHE_HEIGHT, zA - NICHE_WALL], [hi, y + NICHE_HEIGHT + 1, zB + NICHE_WALL], 'cave', 'nicheRoof'));
    niches.push({
      stretch: num(n, 'stretch'),
      z: n.z,
      y,
      side,
      box: { min: [lo, y, zA], max: [hi, y + NICHE_HEIGHT, zB] },
      treadmill: num(n, 'treadmill', 1) * mountainTreadmill,
      zone: num(n, 'zone', 0),
    });
    const nicheKind = n.type === 'chestGrotto' ? 'chestGrotto' : str(n, 'kind');
    if (nicheKind) niches[niches.length - 1]!.kind = nicheKind;
    const lane = str(n, 'lane');
    if (lane === 'calm' || lane === 'bold') niches[niches.length - 1]!.lane = lane;
    // A grotto of the open slope has no belt (docs/01-gdd.md 17.5): sheltering costs steps.
    if (!(num(n, 'treadmill', 1) > 0)) continue;
    const beltX = sign * (e + BORDER_WIDTH + depth - NICHE_BELT_WIDTH / 2);
    points.push({
      type: 'treadmill',
      x: beltX,
      y,
      z: n.z,
      mult: num(n, 'treadmill', 1) * mountainTreadmill,
      length: len,
      width: NICHE_BELT_WIDTH,
      inNiche: true,
      niche: niches.length - 1,
    });
  }

  // A grotto in a rock (SP-04, docs/01a-content.md 19.2): walls on three sides and a roof, open towards the camp (−z); a
  // shelter by its volume, like a tunnel hall. After the grottos of the edges: their indices stay as they were.
  for (const r of world.segments.filter((s) => s.type === 'island')) {
    const x = num(r, 'x');
    const y = num(r, 'y');
    const a = num(r, 'size') / 2;
    const z0 = r.z - a;
    const z1 = r.z + a;
    boxes.push(box([x - a, y, z0], [x - a + NICHE_WALL, y + NICHE_HEIGHT, z1], 'cave', 'islandWall'));
    boxes.push(box([x + a - NICHE_WALL, y, z0], [x + a, y + NICHE_HEIGHT, z1], 'cave', 'islandWall'));
    boxes.push(box([x - a + NICHE_WALL, y, z1 - NICHE_WALL], [x + a - NICHE_WALL, y + NICHE_HEIGHT, z1], 'cave', 'islandWall'));
    boxes.push(box([x - a, y + NICHE_HEIGHT, z0], [x + a, y + NICHE_HEIGHT + NICHE_WALL, z1], 'cave', 'islandRoof'));
    niches.push({
      stretch: num(r, 'stretch'),
      z: r.z,
      y,
      side: x < 0 ? 'left' : 'right',
      box: { min: [x - a + NICHE_WALL, y, z0], max: [x + a - NICHE_WALL, y + NICHE_HEIGHT, z1 - NICHE_WALL] },
      treadmill: 0,
      zone: num(r, 'zone', 0),
      kind: 'island',
    });
    // On a fork (SP-04): a rock of one lane, like its grottos (the ball never rolls through the cliff to it).
    const lane = str(r, 'lane');
    if (lane === 'calm' || lane === 'bold') niches[niches.length - 1]!.lane = lane;
  }

  /** Boxes only the hero meets (invisible blocks of the base), kept with the invisible wall. */
  const heroOnly: Aabb[] = [];
  for (const s of world.segments) {
    const y = num(s, 'y');
    switch (s.type) {
      case 'gate': {
        const height = num(s, 'height', 12);
        const reward = (s['reward'] as { coins?: number } | undefined)?.coins ?? 0;
        const gate: LevelGate = {
          index: num(s, 'wall'),
          z: s.z,
          y,
          requires: num(s, 'requires'),
          rewardCoins: reward,
          box: { min: [-halfAt(s.z - 0.5), y, s.z - GATE_THICKNESS / 2], max: [halfAt(s.z - 0.5), y + height, s.z + GATE_THICKNESS / 2] },
          height,
          signHeight: num(s, 'signHeight', 7),
          rarity: str(s, 'rarity', 'common'),
        };
        const kind = str(s, 'kind');
        if (kind === 'ridge' || kind === 'boss') gate.kind = kind;
        if (Array.isArray(s['passes'])) {
          gate.passes = (s['passes'] as number[]).slice();
          gate.passWidth = num(s, 'passWidth');
          gate.passLength = num(s, 'passLength');
          gate.rise = num(s, 'rise');
        }
        if (typeof s['digits'] === 'number') gate.digits = s['digits'];
        gates.push(gate);
        break;
      }
      case 'checkpoint':
        // The respawn point: on the axis, or beside a trampoline right behind the gate (layout gateSide, x of the flag).
        checkpoints.push({ z: s.z, y, x: num(s, 'x'), wall: num(s, 'wall'), rarity: str(s, 'rarity', 'common') });
        break;
      case 'gift': {
        const h = num(s, 'height');
        const x = num(s, 'x');
        if (h > 0) {
          boxes.push(box([x - LEDGE_SIZE / 2, y - 0.01, s.z - LEDGE_SIZE / 2], [x + LEDGE_SIZE / 2, y + h, s.z + LEDGE_SIZE / 2], 'ice', 'ledge'));
        }
        const gift: LevelPoint = { type: 'gift', x, y: y + h, z: s.z, zone: num(s, 'zone'), rarity: str(s, 'rarity'), coins: num(s, 'coins'), n: num(s, 'n') };
        // On the path (taken on the run, a note higher each, docs/01-gdd.md 16.4); over a trampoline.
        if (s['path'] === true) gift['path'] = true;
        if (s['pad'] === true) gift['pad'] = true;
        points.push(gift);
        break;
      }
      case 'chestGrotto': {
        // The chest of the grotto (docs/01-gdd.md 17.7): a big gift at its back, back after every avalanche like gifts.
        const sign = str(s, 'side') === 'left' ? -1 : 1;
        const x = sign * (half + BORDER_WIDTH + num(s, 'depth') / 2);
        points.push({ type: 'gift', x, y, z: s.z, zone: num(s, 'zone'), rarity: str(s, 'rarity'), coins: num(s, 'coins'), n: 0, chest: true });
        break;
      }
      case 'jumpPad':
      case 'slide': {
        // Fun between the gates (docs/01-gdd.md 16.4): flat on the floor, not colliders; the sim reads their rectangles.
        const fun: LevelPoint = { type: s.type, x: num(s, 'x'), y, z: s.z, width: num(s, 'width'), length: num(s, 'length'), stretch: num(s, 'stretch') };
        // Elements of the open slope (docs/01-gdd.md 18.3): a plate's own push, a slide's own boost and rise, the element.
        for (const k of ['forward', 'slide', 'rise', 'mult', 'hold', 'shape'] as const) if (s[k] !== undefined) fun[k] = s[k];
        points.push(fun);
        break;
      }
      case 'treadmill':
        points.push({ type: 'treadmill', x: num(s, 'x'), y, z: s.z, mult: num(s, 'mult', 1) * mountainTreadmill, length: num(s, 'length', 10), width: num(s, 'width', 6), inNiche: false });
        break;
      case 'block': {
        // A box of the base (docs/01-gdd.md 19.2): the fence across the ends, a tent or the ice of a locked portal;
        // `invisible` — a collider of the hero only (the bounds), never drawn.
        const b: Aabb = { min: [num(s, 'x0'), num(s, 'y0'), s.z], max: [num(s, 'x1'), num(s, 'y1'), num(s, 'z1')] };
        if (s['invisible'] === true) heroOnly.push(b);
        else boxes.push(box(b.min, b.max, str(s, 'material', 'border'), str(s, 'kind', 'block'), s['solid'] !== false));
        break;
      }
      case 'eggStand':
      case 'chest':
      case 'portal':
      case 'zoneArch':
      case 'decor':
      case 'summit':
      case 'basePortal':
      case 'stand':
        points.push({ type: s.type, x: num(s, 'x'), y, z: s.z, ...Object.fromEntries(Object.entries(s).filter(([k]) => !['type', 'x', 'y', 'z'].includes(k))) });
        break;
      default:
        break;
    }
  }

  for (const b of boxes) if (b.solid) pushBoxTriangles(tris, b);
  for (const r of ramps) pushRampTriangles(tris, r);
  for (const p of prisms) prismTriangles(tris, p);
  const wallHeight = opts.wallHeight ?? 0;
  const bounds = [...(wallHeight > 0 ? boundsWalls(boxes, nicheSegs, floors, ramps, half, wallHeight) : []), ...heroOnly];
  const boundsTris: number[] = [];
  for (const b of bounds) pushBoxTriangles(boundsTris, b);
  // Over a prism the invisible wall stands on it as over a border (docs/01-gdd.md 19.9).
  if (wallHeight > 0) for (const p of prisms) prismTriangles(boundsTris, { pts: p.pts, y0: p.y1, y1: p.y1 - BORDER_HEIGHT + wallHeight });

  // The centre line only: pieces that cover x = 0 (open slope: the side blocks of a carniz do not).
  const centreFloors = floors.filter((f) => num(f, 'x0', -half) <= 0 && num(f, 'x1', half) >= 0);
  const centreRamps = ramps.filter((r) => r.x0 <= 0 && r.x1 >= 0);
  const floorYAt = (z: number): number => {
    for (const r of centreRamps) if (z >= r.z0 && z <= r.z1) return r.y0 + ((r.y1 - r.y0) * (z - r.z0)) / (r.z1 - r.z0);
    let best = 0;
    for (const f of centreFloors) {
      if (z >= f.z && z <= f.z + num(f, 'length')) return num(f, 'y');
      if (f.z <= z) best = num(f, 'y');
    }
    return best;
  };
  const floorAt = (x: number, z: number): number => {
    let top = -Infinity;
    for (const r of ramps) if (z >= r.z0 && z <= r.z1 && x >= r.x0 && x <= r.x1) top = Math.max(top, r.y0 + ((r.y1 - r.y0) * (z - r.z0)) / (r.z1 - r.z0));
    for (const f of floors) if (z >= f.z && z <= f.z + num(f, 'length') && x >= num(f, 'x0', -half) && x <= num(f, 'x1', half)) top = Math.max(top, num(f, 'y'));
    // A change of width (SP-04): its floor up to the slanted edge.
    for (const t of taperFloors) if (z >= t.z0 && z <= t.z1 && Math.abs(x) <= t.a + ((t.b - t.a) * (z - t.z0)) / (t.z1 - t.z0)) top = Math.max(top, t.y);
    return top;
  };

  const minY = Math.min(0, ...floors.map((f) => num(f, 'y')));
  return {
    worldId: world.id,
    worldIndex: world.index,
    length: world.length,
    width: W,
    spawn: [0, floorYAt(world.spawnZ), world.spawnZ],
    killY: minY - KILL_DEPTH,
    staticTriangles: new Float32Array(tris),
    bounds,
    boundsTriangles: new Float32Array(boundsTris),
    boxes,
    ramps,
    ...(prisms.length > 0 ? { prisms } : {}),
    ...(funnel ? { funnel } : {}),
    gates,
    niches,
    checkpoints: checkpoints.sort((a, b) => a.z - b.z),
    points,
    safeZones: world.safeZones,
    forks: world.segments.filter((s) => s.type === 'fork').map((f) => ({ z0: f.z, z1: f.z + num(f, 'length') })),
    bosses: (world.bosses ?? []).map((b) => ({ ...b, zone: [b.zone[0], b.zone[1]] as [number, number], giants: b.giants.map((g) => ({ ...g })) })),
    shapes,
    sections: world.zones.filter((z) => typeof z.stepMult === 'number').map((z) => ({ z0: z.zStart, z1: z.zEnd, mult: z.stepMult as number })),
    floorYAt,
    floorAt,
    halfAt,
  };
}

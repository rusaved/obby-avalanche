/**
 * worlds.json → LevelData (docs/02-tech.md 6.1): boxes and ramps for colliders and meshes, gates as dynamic
 * colliders, niches as shelter volumes, checkpoints, spawn. Pure, runs in Node (validator, bot, tests).
 */
import type { Segment, World } from '../content/types.ts';
import type { Aabb, LevelBox, LevelCheckpoint, LevelData, LevelGate, LevelNiche, LevelPoint, LevelRamp, Vec3 } from './types.ts';

export const FLOOR_THICKNESS = 2;
export const BORDER_HEIGHT = 3;
export const BORDER_WIDTH = 3;
export const NICHE_HEIGHT = 8;
export const NICHE_WALL = 1;
export const GATE_THICKNESS = 1.5;
export const LEDGE_SIZE = 4;
export const KILL_DEPTH = 20;

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

export function buildLevel(world: World): LevelData {
  const W = world.width;
  const half = W / 2;
  const boxes: LevelBox[] = [];
  const ramps: LevelRamp[] = [];
  const gates: LevelGate[] = [];
  const niches: LevelNiche[] = [];
  const checkpoints: LevelCheckpoint[] = [];
  const points: LevelPoint[] = [];
  const tris: number[] = [];

  const floors = world.segments.filter((s) => s.type === 'floor');
  const rampSegs = world.segments.filter((s) => s.type === 'ramp');
  const nicheSegs = world.segments.filter((s) => s.type === 'niche');

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
  const addBorders = (z0: number, z1: number, yTop: number): void => {
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      for (const [a, b] of nicheGap(side, z0, z1)) {
        const xIn = sign * half;
        const xOut = sign * (half + BORDER_WIDTH);
        boxes.push(
          box(
            [Math.min(xIn, xOut), yTop - FLOOR_THICKNESS, a],
            [Math.max(xIn, xOut), yTop + BORDER_HEIGHT, b],
            'border',
            'border',
          ),
        );
      }
    }
  };

  for (const f of floors) {
    const z0 = f.z;
    const z1 = f.z + num(f, 'length');
    const y = num(f, 'y');
    boxes.push(box([-half, y - FLOOR_THICKNESS, z0], [half, y, z1], 'track', 'floor'));
    addBorders(z0, z1, y);
  }
  for (const r of rampSegs) {
    const z0 = r.z;
    const z1 = r.z + num(r, 'length');
    const y0 = num(r, 'y');
    const y1 = y0 + num(r, 'rise');
    ramps.push({ x0: -half, x1: half, z0, z1, y0, y1, thickness: FLOOR_THICKNESS, material: 'track' });
    addBorders(z0, z1, y1);
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
    const xIn = sign * half;
    const xOut = sign * (half + BORDER_WIDTH + depth);
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
      treadmill: num(n, 'treadmill', 1),
    });
    points.push({ type: 'treadmill', x: sign * (half + BORDER_WIDTH + depth / 2), y, z: n.z, mult: num(n, 'treadmill', 1), inNiche: true });
  }

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
          box: { min: [-half, y, s.z - GATE_THICKNESS / 2], max: [half, y + height, s.z + GATE_THICKNESS / 2] },
          height,
          signHeight: num(s, 'signHeight', 7),
          rarity: str(s, 'rarity', 'common'),
        };
        gates.push(gate);
        break;
      }
      case 'checkpoint':
        checkpoints.push({ z: s.z, y, x: 0, wall: num(s, 'wall'), rarity: str(s, 'rarity', 'common') });
        break;
      case 'gift': {
        const h = num(s, 'height');
        const x = num(s, 'x');
        if (h > 0) {
          boxes.push(box([x - LEDGE_SIZE / 2, y - 0.01, s.z - LEDGE_SIZE / 2], [x + LEDGE_SIZE / 2, y + h, s.z + LEDGE_SIZE / 2], 'ice', 'ledge'));
        }
        points.push({ type: 'gift', x, y: y + h, z: s.z, zone: num(s, 'zone'), rarity: str(s, 'rarity'), coins: num(s, 'coins'), n: num(s, 'n') });
        break;
      }
      case 'treadmill':
        points.push({ type: 'treadmill', x: num(s, 'x'), y, z: s.z, mult: num(s, 'mult', 1), length: num(s, 'length', 10), width: num(s, 'width', 6), inNiche: false });
        break;
      case 'eggStand':
      case 'chest':
      case 'portal':
      case 'zoneArch':
      case 'decor':
      case 'summit':
        points.push({ type: s.type, x: num(s, 'x'), y, z: s.z, ...Object.fromEntries(Object.entries(s).filter(([k]) => !['type', 'x', 'y', 'z'].includes(k))) });
        break;
      default:
        break;
    }
  }

  for (const b of boxes) if (b.solid) pushBoxTriangles(tris, b);
  for (const r of ramps) pushRampTriangles(tris, r);

  const floorYAt = (z: number): number => {
    for (const r of ramps) if (z >= r.z0 && z <= r.z1) return r.y0 + ((r.y1 - r.y0) * (z - r.z0)) / (r.z1 - r.z0);
    let best = 0;
    for (const f of floors) {
      if (z >= f.z && z <= f.z + num(f, 'length')) return num(f, 'y');
      if (f.z <= z) best = num(f, 'y');
    }
    return best;
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
    boxes,
    ramps,
    gates,
    niches,
    checkpoints: checkpoints.sort((a, b) => a.z - b.z),
    points,
    safeZones: world.safeZones,
    floorYAt,
  };
}

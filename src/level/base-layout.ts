// What: Generator of the base between the mountains (docs/01-gdd.md 19.2–19.3): base.json and the progress → the World for buildLevel and the LevelData — the fenced field, the arc of portals (passed, own, locked), the base treadmill, the stands, decor.
// Called by: main.ts (enterBase), level/validate-base.ts, sim/base-portals.ts (BasePortal type); tests/level/base.test.ts.
// Keep: Pure and deterministic (the same base.json and progress give the same World byte for byte); every size comes from base.json; no DOM, no three.

/**
 * The base (docs/01-gdd.md 19.2; docs/01a-content.md 18.1): a flat snow field `size` with a fence of snow banks and the
 * invisible wall of 19.9 round it; on the north an arc of arches, one per mountain of the pace (1 on the left as the
 * hero faces +z, N on the right), each facing the middle of the arc; the base treadmill, the stands, tents (solid),
 * fir trees and a snowman. A locked arch is iced over and hard to the hero (an invisible block inside it).
 */
import type { BaseJson, Segment, World } from '../content/types.ts';
import { buildLevel, BORDER_HEIGHT, BORDER_WIDTH, FLOOR_THICKNESS } from './builder.ts';
import type { LevelData } from './types.ts';

export type PortalState = 'passed' | 'own' | 'locked';

/** A portal of the base: its mountain, centre and facing (yaw from +z, the way in), size, state, the ridge label. */
export interface BasePortal {
  world: number;
  id: string;
  x: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  state: PortalState;
  /** The own mountain already begun: «ridge b/c» on its sign; null — none. */
  ridge: { b: number; c: number } | null;
}

/** What of the player's progress the base shows (docs/01-gdd.md 19.3–19.4). */
export interface BaseProgress {
  /** Mountains of the pace in order (index, id). */
  mountains: ReadonlyArray<{ index: number; id: string }>;
  /** Summits done on this tier: mountains 1…summits are passed. */
  summits: number;
  /** Ridges open / all on the own mountain when it is begun; null — not begun. */
  ridge: { b: number; c: number } | null;
  /** Step multiplier of the base treadmill (docs/01a-content.md 18.2, FM-09). */
  treadMult: number;
}

/** The tent of the decor: a solid box (docs/01a-content.md 18.1 «без коллизий, кроме палаток»), its half size and height. */
export const TENT_HALF = 2.5;
export const TENT_HEIGHT = 3;
/** Depth of an arch and of the ice block that closes a locked one (units). */
export const ARCH_DEPTH = 1;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Portals of the base in order of mountains: positions on the arc, facing, state (docs/01-gdd.md 19.3). */
export function basePortals(base: BaseJson, progress: BaseProgress): BasePortal[] {
  const p = base.portals;
  const n = progress.mountains.length;
  const own = progress.summits + 1;
  return progress.mountains.map((m, i) => {
    const deg = n > 1 ? p.toDeg - ((p.toDeg - p.fromDeg) * i) / (n - 1) : (p.toDeg + p.fromDeg) / 2;
    const yaw = (deg * Math.PI) / 180;
    const state: PortalState = m.index <= progress.summits ? 'passed' : m.index === own ? 'own' : 'locked';
    return {
      world: m.index,
      id: m.id,
      x: round3(p.center[0] + p.radius * Math.sin(yaw)),
      z: round3(p.center[1] + p.radius * Math.cos(yaw)),
      yaw: round3(yaw),
      width: p.width,
      height: p.height,
      state,
      ridge: state === 'own' ? progress.ridge : null,
    };
  });
}

/**
 * Step multiplier of the base treadmill after `summits` summits of the tier (docs/01a-content.md 18.2): the finish
 * straight (the last section) of the last mountain passed; ×1 with none (after a rebirth until the first summit).
 */
export function baseTreadMult(worlds: ReadonlyArray<Pick<World, 'index' | 'zones'>>, summits: number): number {
  const last = worlds.find((w) => w.index === summits);
  const zones = (last?.zones ?? []).filter((z) => typeof z.stepMult === 'number');
  return summits > 0 && zones.length ? (zones[zones.length - 1]!.stepMult as number) : 1;
}

/** Belt spots of the base treadmill: one in the middle of each lane (docs/01a-content.md 18.1; its bots run there). */
export function baseBelts(base: BaseJson): Array<{ x: number; z: number }> {
  const t = base.treadmill;
  return Array.from({ length: t.lanes }, (_, k) => ({ x: round3(t.x + (k - (t.lanes - 1) / 2) * t.laneWidth), z: t.z }));
}

/** The World of the base for buildLevel (index 0: no mountain of the pace). */
export function generateBase(base: BaseJson, progress: BaseProgress): World {
  const [W, L] = base.size;
  const half = W / 2;
  const out = half + BORDER_WIDTH;
  const seg: Segment[] = [];
  seg.push({ type: 'floor', z: 0, length: L, y: 0 });
  // The fence across both ends (the sides are the borders of the floor): snow banks as tall as a border.
  for (const [z0, z1] of [[-BORDER_WIDTH, 0], [L, L + BORDER_WIDTH]] as const)
    seg.push({ type: 'block', z: z0, x0: -out, x1: out, y0: -FLOOR_THICKNESS, y1: BORDER_HEIGHT, z1, material: 'border', kind: 'border' });
  for (const pt of basePortals(base, progress)) {
    seg.push({ type: 'basePortal', z: pt.z, x: pt.x, y: 0, yaw: pt.yaw, width: pt.width, height: pt.height, world: pt.world, id: pt.id, state: pt.state, ...(pt.ridge ? { ridgeB: pt.ridge.b, ridgeC: pt.ridge.c } : {}) });
    // A locked arch is hard (docs/01-gdd.md 19.4): an invisible block over its opening, the hero only.
    if (pt.state === 'locked') {
      const r = pt.width / 2;
      seg.push({ type: 'block', z: round3(pt.z - r), z1: round3(pt.z + r), x0: round3(pt.x - r), x1: round3(pt.x + r), y0: 0, y1: pt.height, material: 'ice', kind: 'portalIce', invisible: true });
    }
  }
  const t = base.treadmill;
  for (const b of baseBelts(base)) seg.push({ type: 'treadmill', z: b.z, x: b.x, y: 0, length: t.length, width: t.laneWidth, mult: progress.treadMult, base: true });
  for (const [kind, s] of Object.entries(base.stands)) seg.push({ type: 'stand', z: s.z, x: s.x, y: 0, kind, radius: s.radius, ...('standSec' in s ? { standSec: s.standSec } : {}) });
  for (const [x, z] of base.decor.tents) {
    seg.push({ type: 'decor', z, x, y: 0, kind: 'tent' });
    seg.push({ type: 'block', z: z - TENT_HALF, z1: z + TENT_HALF, x0: x - TENT_HALF, x1: x + TENT_HALF, y0: 0, y1: TENT_HEIGHT, material: 'tent', kind: 'tent', invisible: true });
  }
  for (const [x, z] of base.decor.trees) seg.push({ type: 'decor', z, x, y: 0, kind: 'tree' });
  seg.push({ type: 'decor', z: base.decor.snowman[1], x: base.decor.snowman[0], y: 0, kind: 'snowman' });
  return {
    id: 'base',
    index: 0,
    length: L,
    width: W,
    spawnZ: base.spawn.z,
    stretch: 0,
    wallCount: 0,
    safeZones: [[0, L]],
    zones: [],
    segments: seg,
    treadmillMult: 1,
    bosses: [],
  } as unknown as World;
}

/** The level of the base: built like a mountain, the hero at `spawn` facing the own portal (docs/01-gdd.md 19.2). */
export function buildBase(base: BaseJson, progress: BaseProgress, wallHeight?: number): { world: World; level: LevelData; portals: BasePortal[]; spawnYaw: number } {
  const world = generateBase(base, progress);
  const level = buildLevel(world, { wallHeight });
  level.spawn = [base.spawn.x, 0, base.spawn.z];
  const portals = basePortals(base, progress);
  const own = portals.find((p) => p.state === 'own') ?? portals[0];
  const spawnYaw = own ? Math.atan2(own.x - base.spawn.x, own.z - base.spawn.z) : 0;
  return { world, level, portals, spawnYaw };
}

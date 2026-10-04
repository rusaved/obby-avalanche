/**
 * Golden gift of the avalanche warning (docs/01-gdd.md 4.9; docs/02-tech.md 8.1, `threat.bonus` of kind `goldGift`):
 * from the `fromWave`-th normal wave of the load, one per wave, on the track axis `distMin`–`distMax` above the cave
 * lit on warn (below it when there is no room above), on the ground of the part open for the hero. The hero carries
 * it over his head; the simulation (world.ts) counts it as saved or lost. Bots never take it. Pure TS, no DOM.
 */
import type { GameJson } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import type { Rng } from '../core/rng.ts';
import { HERO_HEIGHT, HERO_RADIUS } from './controller.ts';
import { GIFT_HALF, GIFT_HEIGHT } from './gifts.ts';
import { inSafeZone } from './shelter.ts';

export type BonusConfig = NonNullable<GameJson['threat']['bonus']>;

/** The golden gift is the gift mesh 1.5 times bigger (docs/01-gdd.md 4.9). */
export const BONUS_SCALE = 1.5;
export const BONUS_HALF = GIFT_HALF * BONUS_SCALE;
export const BONUS_HEIGHT = GIFT_HEIGHT * BONUS_SCALE;
/** Clearance around the gift: from walls, obstacles, props, gifts and the safe zones. */
const CLEAR = 1.5;
/** Random tries in a range before a scan along it. */
const TRIES = 12;
const SCAN_STEP = 0.5;
/** Boxes that are ground or caves, not obstacles on the slope. */
const GROUND = new Set(['floor', 'border', 'nicheFloor', 'nicheWall', 'nicheRoof']);
/** Props a gift never stands on or in: belts, egg stands, chests, the portal, decor. */
const PROPS = new Set(['treadmill', 'eggStand', 'chest', 'portal', 'decor', 'gift']);

export interface BonusState {
  x: number;
  y: number;
  z: number;
  /** Gift zone of the point where it lay (its coins × mult are the reward). */
  zone: number;
  carried: boolean;
}

/** Gift zone of the stretch that holds z: the zone of that stretch's cave (the last one past the last wall). */
export function zoneAt(level: LevelData, z: number): number {
  const stretch = level.gates.filter((g) => g.z <= z).length + 1;
  const n = level.niches.find((x) => x.stretch === stretch) ?? level.niches[level.niches.length - 1];
  return n?.zone ?? 0;
}

/** Plain ground at (x, z) for the golden gift: floor or ramp under the whole box, nothing standing there. */
export function bonusGroundOk(level: LevelData, x: number, z: number): boolean {
  const h = BONUS_HALF;
  if (inSafeZone(level, z - h - CLEAR) || inSafeZone(level, z + h + CLEAR)) return false;
  const floor =
    level.boxes.some((b) => b.kind === 'floor' && b.min[0] <= x - h && b.max[0] >= x + h && b.min[2] <= z - h && b.max[2] >= z + h) ||
    level.ramps.some((r) => r.x0 <= x - h && r.x1 >= x + h && r.z0 <= z - h && r.z1 >= z + h);
  if (!floor) return false;
  const lo = [x - h - CLEAR, z - h - CLEAR];
  const hi = [x + h + CLEAR, z + h + CLEAR];
  const blocked = level.boxes.some((b) => b.solid && !GROUND.has(b.kind) && b.min[0] < hi[0]! && b.max[0] > lo[0]! && b.min[2] < hi[1]! && b.max[2] > lo[1]!);
  if (blocked) return false;
  if (level.gates.some((g) => g.box.min[2] < hi[1]! && g.box.max[2] > lo[1]!)) return false;
  return !level.points.some((p) => {
    if (!PROPS.has(p.type)) return false;
    const hw = (typeof p['width'] === 'number' ? (p['width'] as number) / 2 : GIFT_HALF) + h + CLEAR;
    const hl = (typeof p['length'] === 'number' ? (p['length'] as number) / 2 : GIFT_HALF) + h + CLEAR;
    return Math.abs(p.x - x) < hw && Math.abs(p.z - z) < hl;
  });
}

/**
 * Where the golden gift of this wave lies: on the axis `distMin`–`distMax` above cave `cave`, between the walls closed
 * for the hero and short of the summit; no room above — the same distance below; no room below either — null.
 */
export function placeBonus(level: LevelData, cfg: BonusConfig, gatesOpen: readonly boolean[], cave: number, rng: Rng): BonusState | null {
  const n = level.niches[cave];
  if (!n) return null;
  const x = 0;
  const summit = level.safeZones.length > 1 ? (level.safeZones[level.safeZones.length - 1]?.[0] ?? level.length) : level.length;
  let top = summit;
  let bottom = level.safeZones[0]?.[1] ?? 0;
  level.gates.forEach((g, i) => {
    if (gatesOpen[i]) return;
    if (g.z > n.z) top = Math.min(top, g.box.min[2]);
    else bottom = Math.max(bottom, g.box.max[2]);
  });
  const pick = (lo: number, hi: number): number | null => {
    if (hi < lo) return null;
    for (let k = 0; k < TRIES; k++) {
      const z = rng.range(lo, hi);
      if (bonusGroundOk(level, x, z)) return z;
    }
    const start = rng.range(lo, hi);
    for (let d = 0; d <= hi - lo; d += SCAN_STEP) {
      for (const z of [start + d, start - d]) if (z >= lo && z <= hi && bonusGroundOk(level, x, z)) return z;
    }
    return null;
  };
  const z = pick(n.z + cfg.distMin, Math.min(n.z + cfg.distMax, top)) ?? pick(Math.max(n.z - cfg.distMax, bottom), n.z - cfg.distMin);
  if (z === null) return null;
  return { x, y: level.floorYAt(z), z, zone: zoneAt(level, z), carried: false };
}

/** The hero capsule (feet at `y`) touches the golden gift box. */
export function touchesBonus(b: BonusState, x: number, y: number, z: number): boolean {
  const dx = Math.max(0, Math.abs(x - b.x) - BONUS_HALF);
  const dz = Math.max(0, Math.abs(z - b.z) - BONUS_HALF);
  if (dx * dx + dz * dz > HERO_RADIUS * HERO_RADIUS) return false;
  return y < b.y + BONUS_HEIGHT && y + HERO_HEIGHT > b.y;
}

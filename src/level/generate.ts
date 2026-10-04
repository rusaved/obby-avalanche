/**
 * worlds.json generator (docs/02-tech.md, section 3 `gen:worlds`): mountain template of docs/01-gdd.md 5.2
 * applied to the tables of docs/01a-content.md 2–4 that live in content/<pack>/worlds-spec.json.
 * Pure and deterministic: same input → same JSON byte for byte. worlds.json is never edited by hand.
 */
import type { Segment, World, WorldZone, WorldsJson, WorldsSpecJson } from '../content/types.ts';

export const GENERATOR_VERSION = 'gen-worlds/1';

/** Rounding series for treadmill multipliers (docs/01a-content.md, section 2): 1; 1.2; 1.5; 2; 2.5; 3; 4; 5; 6; 8 × 10^k. */
const SERIES = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

export function ceilToSeries(x: number): number {
  if (x <= 0) return 0;
  const k = Math.floor(Math.log10(x));
  for (let e = k; e <= k + 1; e++) {
    const scale = Math.pow(10, e);
    for (const s of SERIES) {
      const v = s * scale;
      if (v >= x - 1e-9) return round3(v);
    }
  }
  return x;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Layout fractions of a stretch (docs/01-gdd.md 5.2): flagged checkpoint and gift 1 in 0–15%, ramp and gifts 2–3 in 15–60%, cave at 70%, wall at 100%. */
export const LAYOUT = {
  checkpoint: 0.05,
  gift1: 0.1,
  rampStart: 0.15,
  rampMaxLen: 20,
  rampMaxFrac: 0.25,
  gift2: 0.47,
  gift3: 0.57,
  nicheCenter: 0.7,
  nicheLength: 10,
  nicheDepth: 4,
  decor: 0.85,
  rise: 6,
  ledgeHeight: 2.5,
  gateHeight: 12,
  gateSignHeight: 7,
  eggStandStretch: 7,
} as const;

export interface GenerateInput {
  spec: WorldsSpecJson;
  balance: { coins: { gatePass: number; chest: number } };
}

export function generateWorlds({ spec, balance }: GenerateInput): WorldsJson {
  const worlds = spec.mountains.map((m, mi) => generateWorld(spec, balance, mi + 1));
  return { schema: 1, generator: GENERATOR_VERSION, worlds };
}

function generateWorld(spec: WorldsSpecJson, balance: GenerateInput['balance'], index: number): World {
  const m = spec.mountains[index - 1];
  if (!m) throw new Error(`generateWorld: no mountain ${index}`);
  const d = m.stretch;
  const n = m.walls.length;
  const camp = spec.campLength;
  const zSummit = camp + n * d;
  const length = zSummit + spec.summitLength;
  const zoneCount = Math.ceil(n / 2);
  const zones: WorldZone[] = [];
  for (let k = 1; k <= zoneCount; k++) {
    const rarity = spec.rarities[k - 1];
    const gift = m.gifts[k - 1];
    if (rarity === undefined || gift === undefined) throw new Error(`${m.id}: zone ${k} has no rarity or gift value`);
    zones.push({ k, rarity, gift, zStart: camp + (2 * k - 2) * d, zEnd: Math.min(camp + 2 * k * d, zSummit) });
  }
  const zoneOf = (i: number): WorldZone => zones[Math.ceil(i / 2) - 1] as WorldZone;
  const firstWall = m.walls[0];
  const lastWall = m.walls[n - 1];
  if (!firstWall || !lastWall) throw new Error(`${m.id}: needs at least one wall`);

  const seg: Segment[] = [];
  let y = 0;

  // Camp (docs/01-gdd.md 5.2): spawn at spawnZ facing up the slope, treadmill of cave 1, egg stand, arrows, decor.
  seg.push({ type: 'floor', z: 0, length: camp, y: 0 });
  seg.push({ type: 'treadmill', z: spec.spawnZ - 10, x: -8, y: 0, length: 10, width: 6, mult: m.campTreadmill ?? firstWall.treadmill });
  seg.push({ type: 'eggStand', z: 30, x: 8, y: 0, egg: m.egg });
  seg.push({ type: 'decor', z: 6, x: -11, y: 0, kind: 'tent' });
  seg.push({ type: 'decor', z: 12, x: 11, y: 0, kind: 'tent' });
  seg.push({ type: 'decor', z: 34, x: -12, y: 0, kind: 'tree' });
  seg.push({ type: 'decor', z: 36, x: 12, y: 0, kind: 'tree' });
  seg.push({ type: 'decor', z: 8, x: 4, y: 0, kind: 'snowman' });
  for (let a = 0; a < 3; a++) seg.push({ type: 'decor', z: 26 + a * 4, x: 0, y: 0, kind: 'arrow' });

  for (let i = 1; i <= n; i++) {
    const wall = m.walls[i - 1] as { requires: number; treadmill: number };
    const z0 = camp + (i - 1) * d;
    const zone = zoneOf(i);
    if (i % 2 === 1) seg.push({ type: 'zoneArch', z: z0, y, zone: zone.k, rarity: zone.rarity });
    if (i >= 2) seg.push({ type: 'checkpoint', z: round3(z0 + LAYOUT.checkpoint * d), y, zone: zone.k, rarity: zone.rarity, wall: i - 1 });
    if (i === LAYOUT.eggStandStretch) seg.push({ type: 'eggStand', z: round3(z0 + LAYOUT.checkpoint * d + 4), x: 8, y, egg: m.egg });

    const rampLen = Math.min(LAYOUT.rampMaxLen, LAYOUT.rampMaxFrac * d);
    const zRamp = z0 + LAYOUT.rampStart * d;
    seg.push({ type: 'floor', z: z0, length: round3(zRamp - z0), y });
    seg.push({ type: 'ramp', z: round3(zRamp), length: round3(rampLen), y, rise: LAYOUT.rise });
    const yTop = y + LAYOUT.rise;
    seg.push({ type: 'floor', z: round3(zRamp + rampLen), length: round3(z0 + d - zRamp - rampLen), y: yTop });

    seg.push({ type: 'gift', z: round3(z0 + LAYOUT.gift1 * d), x: -4, y, height: 0, zone: zone.k, rarity: zone.rarity, coins: zone.gift, n: 1 });
    seg.push({ type: 'gift', z: round3(z0 + LAYOUT.gift2 * d), x: 5, y: yTop, height: 0, zone: zone.k, rarity: zone.rarity, coins: zone.gift, n: 2 });
    seg.push({
      type: 'gift',
      z: round3(z0 + LAYOUT.gift3 * d),
      x: -6,
      y: yTop,
      height: LAYOUT.ledgeHeight,
      zone: zone.k,
      rarity: zone.rarity,
      coins: zone.gift,
      n: 3,
    });
    seg.push({
      type: 'niche',
      z: round3(z0 + LAYOUT.nicheCenter * d),
      y: yTop,
      side: i % 2 === 1 ? 'left' : 'right',
      length: LAYOUT.nicheLength,
      depth: LAYOUT.nicheDepth,
      treadmill: wall.treadmill,
      zone: zone.k,
      stretch: i,
    });
    seg.push({ type: 'decor', z: round3(z0 + LAYOUT.decor * d), x: i % 2 === 1 ? 12 : -12, y: yTop, kind: 'tree' });
    seg.push({
      type: 'gate',
      z: z0 + d,
      y: yTop,
      requires: wall.requires,
      reward: { coins: balance.coins.gatePass * zone.gift },
      height: LAYOUT.gateHeight,
      signHeight: LAYOUT.gateSignHeight,
      wall: i,
      zone: zone.k,
      rarity: zone.rarity,
    });
    y = yTop;
  }

  // Summit (docs/01-gdd.md 5.2): chest, portal, treadmill ×1.5 of cave 12 rounded up along the series, safe zone.
  const lastZone = zones[zones.length - 1] as WorldZone;
  seg.push({ type: 'floor', z: zSummit, length: spec.summitLength, y });
  seg.push({ type: 'summit', z: zSummit, y, wall: n });
  seg.push({ type: 'checkpoint', z: zSummit + 3, y, zone: lastZone.k, rarity: lastZone.rarity, wall: n });
  seg.push({ type: 'treadmill', z: zSummit + 12, x: -8, y, length: 10, width: 6, mult: ceilToSeries(1.5 * lastWall.treadmill) });
  seg.push({ type: 'chest', z: zSummit + 30, x: 0, y, coins: balance.coins.chest * lastZone.gift });
  seg.push({ type: 'portal', z: zSummit + 50, x: 0, y, next: index + 1 <= spec.mountains.length ? index + 1 : null });

  return {
    id: m.id,
    index,
    length,
    width: spec.width,
    spawnZ: spec.spawnZ,
    egg: m.egg,
    stretch: d,
    wallCount: n,
    safeZones: [
      [0, camp],
      [zSummit, length],
    ],
    threat: {
      intervalSec: m.intervalSec,
      firstIntervalSec: spec.threat.firstIntervalSec,
      warnSec: m.warnSec,
      speed: m.speed,
      from: spec.threat.from,
      spawnAhead: spec.threat.spawnAhead,
      firstWaveScripted: spec.threat.firstWaveScripted,
      safeZoneZ: [0, camp],
    },
    zones,
    segments: seg,
    treadmillMult: 1,
  };
}

/** Stable JSON: 2 spaces, trailing newline; key order is the insertion order above. */
export function stringifyWorlds(worlds: WorldsJson): string {
  return JSON.stringify(worlds, null, 2) + '\n';
}

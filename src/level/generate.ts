/**
 * worlds.json generator (docs/02-tech.md, section 3 `gen:worlds`): mountain template of docs/01-gdd.md 5.2
 * applied to the tables of docs/01a-content.md 2–4 that live in content/<pack>/worlds-spec.json.
 * Pure and deterministic: same input → same JSON byte for byte. worlds.json is never edited by hand.
 */
import type { Curve, Segment, World, WorldLayout, WorldZone, WorldsJson, WorldsSpecJson } from '../content/types.ts';
import { moveSpeed } from '../sim/effects/moveSpeed.ts';
import { GIFT_HALF, GIFT_HEIGHT } from '../sim/gifts.ts';
import { HERO_HEIGHT, HERO_RADIUS } from '../sim/controller.ts';
import { PAD_SIZE, SLIDE_LENGTH, SLIDE_WIDTH, TICK, padArc, padGiftBand, type ArcTuning } from './pad-arc.ts';

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

/**
 * Layout `gateSide` (docs/01-gdd.md 16.3), fractions of a stretch and units: the flag in 0–8%, the fun of the stretch in
 * 10–45%, the rise of 3 units in 45–65%, the cave right beside the gate — its upper edge `nicheExit` below the gate
 * (2–6), its lower edge within 16 of it — and the gate at 100%. Six zones a mountain. Fun (16.4): gifts on the path at
 * `pathGifts`; the trampoline right past the gate below (`padRear` units, so that its arc lands before the next gate at
 * the speed of the stretch), its flag beside it at `padFlagX` (a respawn never stands on the pad); the ice slide from
 * 10% (earlier when it would run onto the rise, `slideGap` short of it) with gifts at `slideGifts` of its length.
 */
export const GATE_SIDE = {
  checkpoint: 0.04,
  pathGifts: [0.12, 0.22, 0.32, 0.42],
  funStart: 0.1,
  padRear: 1.2,
  padFlagX: -4,
  slideGap: 0.5,
  slideGifts: [0.25, 0.5, 0.75],
  rampStart: 0.45,
  rampEnd: 0.65,
  rise: 3,
  nicheExit: 3,
  nicheLength: 10,
  nicheDepth: 4,
  decor: 0.8,
  zones: 6,
} as const;

/** Fun of stretch i by turn (docs/01-gdd.md 16.4): i mod 3 = 1 — gifts on the path, 2 — trampoline, 0 — ice slide. */
const FUN_BY_TURN = ['slide', 'giftPath', 'jumpPad'] as const;
export function stretchFun(i: number): (typeof FUN_BY_TURN)[number] {
  return FUN_BY_TURN[i % 3] ?? 'giftPath';
}

/** Gift zone of stretch i of n (docs/01-gdd.md 5.2, 16.3): classic — two stretches a zone, ⌈i/2⌉; gateSide — ⌈6i/n⌉. */
export function zoneOfStretch(i: number, n: number, layout: WorldLayout | undefined): number {
  return layout === 'gateSide' ? Math.ceil((GATE_SIDE.zones * i) / n) : Math.ceil(i / 2);
}

/**
 * `tuning` and `balance.speedCurve`: the layout gateSide places the gift over the trampoline by its arc at the speed of
 * the stretch (src/level/pad-arc.ts); the classic layout does not read them.
 */
export interface GenerateInput {
  spec: WorldsSpecJson;
  balance: { coins: { gatePass: number; chest: number }; speedCurve?: Curve };
  tuning?: ArcTuning;
}

export function generateWorlds({ spec, balance, tuning }: GenerateInput): WorldsJson {
  const worlds = spec.mountains.map((m, mi) => generateWorld(spec, balance, mi + 1, tuning));
  return { schema: 1, generator: GENERATOR_VERSION, worlds };
}

type SpecMountain = WorldsSpecJson['mountains'][number];

function generateWorld(spec: WorldsSpecJson, balance: GenerateInput['balance'], index: number, tuning: ArcTuning | undefined): World {
  const m = spec.mountains[index - 1];
  if (!m) throw new Error(`generateWorld: no mountain ${index}`);
  if (spec.layout === 'gateSide') return generateGateSideWorld(spec, balance, index, m, tuning);
  const d = m.stretch;
  const n = m.walls.length;
  const camp = spec.campLength;
  const zSummit = camp + n * d;
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

  pushCamp(seg, spec, m, firstWall.treadmill);

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

  pushSummit(seg, spec, balance, index, zSummit, y, n, zones, lastWall.treadmill);
  return worldOf(spec, m, index, zSummit, zones, seg);
}

/** Camp (docs/01-gdd.md 5.2): spawn at spawnZ facing up the slope, treadmill of cave 1, egg stand, arrows, decor. */
function pushCamp(seg: Segment[], spec: WorldsSpecJson, m: SpecMountain, firstTreadmill: number): void {
  const camp = spec.campLength;
  seg.push({ type: 'floor', z: 0, length: camp, y: 0 });
  seg.push({ type: 'treadmill', z: spec.spawnZ - 10, x: -8, y: 0, length: 10, width: 6, mult: m.campTreadmill ?? firstTreadmill });
  seg.push({ type: 'eggStand', z: 30, x: 8, y: 0, egg: m.egg });
  seg.push({ type: 'decor', z: 6, x: -11, y: 0, kind: 'tent' });
  seg.push({ type: 'decor', z: 12, x: 11, y: 0, kind: 'tent' });
  seg.push({ type: 'decor', z: 34, x: -12, y: 0, kind: 'tree' });
  seg.push({ type: 'decor', z: 36, x: 12, y: 0, kind: 'tree' });
  seg.push({ type: 'decor', z: 8, x: 4, y: 0, kind: 'snowman' });
  for (let a = 0; a < 3; a++) seg.push({ type: 'decor', z: 26 + a * 4, x: 0, y: 0, kind: 'arrow' });
}

/** Summit (docs/01-gdd.md 5.2): chest, portal, treadmill ×1.5 of the last cave rounded up along the series, safe zone. */
function pushSummit(
  seg: Segment[],
  spec: WorldsSpecJson,
  balance: GenerateInput['balance'],
  index: number,
  zSummit: number,
  y: number,
  n: number,
  zones: WorldZone[],
  lastTreadmill: number,
): void {
  const lastZone = zones[zones.length - 1] as WorldZone;
  seg.push({ type: 'floor', z: zSummit, length: spec.summitLength, y });
  seg.push({ type: 'summit', z: zSummit, y, wall: n });
  seg.push({ type: 'checkpoint', z: zSummit + 3, y, zone: lastZone.k, rarity: lastZone.rarity, wall: n });
  seg.push({ type: 'treadmill', z: zSummit + 12, x: -8, y, length: 10, width: 6, mult: ceilToSeries(1.5 * lastTreadmill) });
  seg.push({ type: 'chest', z: zSummit + 30, x: 0, y, coins: balance.coins.chest * lastZone.gift });
  seg.push({ type: 'portal', z: zSummit + 50, x: 0, y, next: index + 1 <= spec.mountains.length ? index + 1 : null });
}

function worldOf(spec: WorldsSpecJson, m: SpecMountain, index: number, zSummit: number, zones: WorldZone[], seg: Segment[]): World {
  const camp = spec.campLength;
  const length = zSummit + spec.summitLength;
  const world: World = {
    id: m.id,
    index,
    length,
    width: spec.width,
    spawnZ: spec.spawnZ,
    egg: m.egg,
    stretch: m.stretch,
    wallCount: m.walls.length,
    safeZones: [
      [0, camp],
      [zSummit, length],
    ],
    threat: {
      intervalSec: m.intervalSec,
      firstIntervalSec: m.firstIntervalSec ?? spec.threat.firstIntervalSec,
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
  if (spec.layout === 'gateSide') world.layout = 'gateSide';
  if (m.look !== undefined) world.look = m.look;
  return world;
}

/**
 * Mountain of the layout `gateSide` (docs/01-gdd.md 16.3; GATE_SIDE): camp and summit as in 5.2; stretch i of n —
 * flag, fun of the stretch, rise, the cave with the treadmill of gate i right beside it (odd stretches left, even
 * right), gate i. Six zones: stretch i is in zone ⌈6i/n⌉. Egg stands: the camp and the stretch behind gate ⌈n/2⌉.
 */
function generateGateSideWorld(spec: WorldsSpecJson, balance: GenerateInput['balance'], index: number, m: SpecMountain, tuning: ArcTuning | undefined): World {
  const L = GATE_SIDE;
  const d = m.stretch;
  const n = m.walls.length;
  const camp = spec.campLength;
  const zSummit = camp + n * d;
  if (n < L.zones) throw new Error(`${m.id}: layout gateSide needs at least ${L.zones} gates`);
  const zones: WorldZone[] = [];
  for (let k = 1; k <= L.zones; k++) {
    const rarity = spec.rarities[k - 1];
    const gift = m.gifts[k - 1];
    if (rarity === undefined || gift === undefined) throw new Error(`${m.id}: zone ${k} has no rarity or gift value`);
    const first = Math.floor(((k - 1) * n) / L.zones) + 1;
    const last = Math.floor((k * n) / L.zones);
    zones.push({ k, rarity, gift, zStart: camp + (first - 1) * d, zEnd: Math.min(camp + last * d, zSummit) });
  }
  const zoneOf = (i: number): WorldZone => zones[zoneOfStretch(i, n, 'gateSide') - 1] as WorldZone;
  const firstWall = m.walls[0];
  const lastWall = m.walls[n - 1];
  if (!firstWall || !lastWall) throw new Error(`${m.id}: needs at least one wall`);
  const eggStretch = Math.ceil(n / 2) + 1;

  const seg: Segment[] = [];
  let y = 0;
  pushCamp(seg, spec, m, firstWall.treadmill);

  for (let i = 1; i <= n; i++) {
    const wall = m.walls[i - 1] as { requires: number; treadmill: number };
    const z0 = camp + (i - 1) * d;
    const zGate = z0 + d;
    const zone = zoneOf(i);
    if (i === 1 || zoneOf(i - 1).k !== zone.k) seg.push({ type: 'zoneArch', z: z0, y, zone: zone.k, rarity: zone.rarity });
    const fun = stretchFun(i);
    if (i >= 2) {
      const flag: Segment = { type: 'checkpoint', z: round3(z0 + L.checkpoint * d), y, zone: zone.k, rarity: zone.rarity, wall: i - 1 };
      if (fun === 'jumpPad') flag['x'] = L.padFlagX;
      seg.push(flag);
    }
    if (i === eggStretch) seg.push({ type: 'eggStand', z: round3(z0 + L.checkpoint * d + 4), x: 8, y, egg: m.egg });

    const zRamp = round3(z0 + L.rampStart * d);
    const zTop = round3(z0 + L.rampEnd * d);
    seg.push({ type: 'floor', z: z0, length: round3(zRamp - z0), y });
    seg.push({ type: 'ramp', z: zRamp, length: round3(zTop - zRamp), y, rise: L.rise });
    const yTop = y + L.rise;
    seg.push({ type: 'floor', z: zTop, length: round3(zGate - zTop), y: yTop });

    const gift = (z: number, nth: number, extra: Record<string, unknown> = {}): Segment => ({
      type: 'gift',
      z: round3(z),
      x: 0,
      y,
      height: 0,
      zone: zone.k,
      rarity: zone.rarity,
      coins: zone.gift,
      n: nth,
      path: true,
      ...extra,
    });
    if (fun === 'giftPath') L.pathGifts.forEach((f, g) => seg.push(gift(z0 + f * d, g + 1)));
    else if (fun === 'slide') {
      const zs = Math.min(z0 + L.funStart * d, zRamp - L.slideGap - SLIDE_LENGTH);
      seg.push({ type: 'slide', z: round3(zs + SLIDE_LENGTH / 2), x: 0, y, width: SLIDE_WIDTH, length: SLIDE_LENGTH, stretch: i });
      L.slideGifts.forEach((f, g) => seg.push(gift(zs + f * SLIDE_LENGTH, g + 1)));
    } else {
      // The stretch speed: the stat that opened the gate below (docs/02-tech.md 5.4, as the cave fairness).
      const speed = moveSpeed(m.walls[i - 2]?.requires ?? 0, stretchCurve(balance, tuning));
      const pad = padGift(z0 + L.padRear, y, zRamp, zTop, yTop, speed, tuning!, `${m.id}: stretch ${i}`);
      seg.push({ type: 'jumpPad', z: round3(z0 + L.padRear + PAD_SIZE / 2), x: 0, y, width: PAD_SIZE, length: PAD_SIZE, stretch: i });
      seg.push(gift(pad.z, 1, { y: round3(y + pad.height), pad: true }));
    }
    seg.push({
      type: 'niche',
      z: round3(zGate - L.nicheExit - L.nicheLength / 2),
      y: yTop,
      side: i % 2 === 1 ? 'left' : 'right',
      length: L.nicheLength,
      depth: L.nicheDepth,
      treadmill: wall.treadmill,
      zone: zone.k,
      stretch: i,
    });
    seg.push({ type: 'decor', z: round3(z0 + L.decor * d), x: i % 2 === 1 ? 12 : -12, y: yTop, kind: 'tree' });
    seg.push({
      type: 'gate',
      z: zGate,
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

  pushSummit(seg, spec, balance, index, zSummit, y, n, zones, lastWall.treadmill);
  return worldOf(spec, m, index, zSummit, zones, seg);
}

/** Stat → run speed as the game has it: k of balance.json, base and max of tuning.json (src/main.ts). */
function stretchCurve(balance: GenerateInput['balance'], tuning: ArcTuning | undefined): Curve {
  if (!tuning || !balance.speedCurve) throw new Error('layout gateSide: the trampoline needs tuning.json and balance.json speedCurve (gen:worlds passes them)');
  return { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
}

/**
 * The gift over the trampoline (docs/01-gdd.md 16.4): its bottom in the middle of the 20% band above the pad floor
 * (src/level/pad-arc.ts), where the hero flies at the speed of the stretch — at the top of the arc, or earlier when the
 * top is over the rise (from there a plain jump would reach it). Throws when the arc never meets it.
 */
function padGift(rear: number, y: number, zRamp: number, zTop: number, yTop: number, speed: number, tuning: ArcTuning, at: string): { z: number; height: number } {
  const [lo, hi] = padGiftBand(tuning);
  if (lo > hi) throw new Error(`${at}: the trampoline throws ${tuning.fun.padSpeed} — too low for a gift out of reach of a plain jump (tuning.json fun.padSpeed)`);
  const height = round3((lo + hi) / 2);
  const floorYAt = (z: number): number => (z < zRamp ? y : z < zTop ? y + ((yTop - y) * (z - zRamp)) / (zTop - zRamp) : yTop);
  const arc = padArc(rear + (speed * TICK) / 2, y, speed, tuning, floorYAt);
  const zMax = zRamp - GIFT_HALF - HERO_RADIUS - 0.2;
  let best = arc.points[0]!;
  for (const p of arc.points) if (p.z <= zMax && p.y > best.y) best = p;
  const feet = best.y - y;
  if (feet + HERO_HEIGHT < height + 0.5 || feet > height + GIFT_HEIGHT - 0.5) throw new Error(`${at}: the trampoline arc misses its gift (feet ${feet.toFixed(2)} at z ${best.z.toFixed(1)})`);
  return { z: best.z, height };
}

/** Stable JSON: 2 spaces, trailing newline; key order is the insertion order above. */
export function stringifyWorlds(worlds: WorldsJson): string {
  return JSON.stringify(worlds, null, 2) + '\n';
}

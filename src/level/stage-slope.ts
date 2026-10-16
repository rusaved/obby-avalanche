// What: Generator of the stages pace (layout stageSlope, docs/01-gdd.md 22): a mountain as a chain of stages — a ridge asking for a level, one trial of one type across the slope, a safe finish with the trophy button; the maze of the cave stage.
// Called by: level/generate.ts (generateWorlds dispatches on spec.layout); level/validate-stages.ts and tests read its numbers (jumpDistance, padFlight, mazeOf).
// Keep: Pure and deterministic (the same spec, balance and tuning give the same JSON byte for byte, the maze from a seeded walk); every size from the spec or the physics of tuning; worlds keep layout openSlope for the slope machinery.

import type { OpenSpecJson, Segment, StageMaze, StageSpec, StageType, TuningJson, World, WorldBoss, WorldStage, WorldZone } from '../content/types.ts';
import { generateOpenWorlds, passesOf, pushPassages, type OpenInput } from './open-slope.ts';
import { pushDipFloor } from './open-shapes.ts';
import { levelThreshold, nearestLevel, type Levels } from '../sim/levels.ts';
import { moveSpeed } from '../sim/effects/moveSpeed.ts';

/** SD-09: the grotto of a start pad stands this far in from the edge of the field. */
const EDGE_GAP = 4;

export interface StageInput {
  spec: OpenSpecJson;
  balance: OpenInput['balance'] & { levels?: Levels; speedCurve?: { k: number }; upgrade?: { trophyRate?: number } };
  tuning?: OpenInput['tuning'];
}

export function isStageSpec(spec: unknown): spec is OpenSpecJson {
  return (spec as { layout?: string } | null)?.layout === 'stageSlope';
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
/** The carniz of a ridge: the passage ramps are this long (as the open slope, 16.5). */
const PASS_LENGTH = 8;
/** The flag of a stage stands this far past its carniz (the roll-back point, docs/01-gdd.md 22.9). */
const FLAG_PAST = 4;
/** The teleport pad of the camp (docs/01-gdd.md 22.12): clear of the tents, the belt, the egg stand and the arrows. */
const CAMP_TELEPORT: [number, number] = [20, 20];
/** The pit trigger this far under the floor of a trial (a fall counts, RL-03). */
const PIT_TRIGGER = 4;

/** Field-wide trials (chase and avalanche) and the narrow ones (bridge, ledge) of docs/01-gdd.md 22.5–22.6. */
export const STAGE_WIDTH: Record<StageType, WorldStage['width']> = {
  intro: 'field',
  dips: 'field',
  cracks: 'field',
  giant: 'field',
  catapult: 'field',
  avalanche: 'field',
  plates: 'bridge',
  chute: 'bridge',
  throat: 'bridge',
  blizzard: 'bridge',
  maze: 'cave',
};

/** A ridge number of the open slope as the threshold of its nearest level (docs/01-gdd.md 22.2: ±9%, not recounted). */
export function ridgeAsLevel(requires: number, levels: Levels): { level: number; requires: number } {
  const level = nearestLevel(requires, levels);
  return { level, requires: round3(levelThreshold(level, levels)) };
}

/** Flight distance of a plain jump at run speed v (v × 2 v0 / g, as validate.ts jumpDistance). */
export function jumpDistance(tuning: Pick<TuningJson, 'controller'>, v: number): number {
  return (v * 2 * tuning.controller.jumpSpeed) / tuning.controller.gravity;
}

/** Flight distance off a trampoline with its own forward push (fun.padSpeed up, run speed + forward along +Z). */
export function padFlight(tuning: Pick<TuningJson, 'controller' | 'fun'>, v: number, forward: number): number {
  return ((v + forward) * 2 * tuning.fun.padSpeed) / tuning.controller.gravity;
}

/** Seeded walk (mulberry32): the maze of a mountain is the same every build. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The maze of a cave stage (docs/01-gdd.md 22.7): a perfect maze carved by a seeded depth-first walk from the entrance
 * (bottom row, middle column); the real exit — the top-row cell farthest from the entrance; `falseExits` more through
 * the top or the sides, each into the pit.
 */
export function mazeOf(cols: number, rows: number, falseExits: number, seed: number): Omit<StageMaze, 'x0' | 'z0' | 'cell'> {
  const rand = rng(seed);
  const entrance = Math.floor(cols / 2);
  const seen = new Set<number>([entrance]);
  const open: StageMaze['open'] = [];
  const stack: Array<[number, number]> = [[entrance, 0]];
  while (stack.length > 0) {
    const [c, r] = stack[stack.length - 1]!;
    const next = ([[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as Array<[number, number]>).filter(([a, b]) => a >= 0 && a < cols && b >= 0 && b < rows && !seen.has(b * cols + a));
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const [a, b] = next[Math.floor(rand() * next.length)]!;
    seen.add(b * cols + a);
    open.push([c, r, a, b]);
    stack.push([a, b]);
  }
  const dist = mazeDistances(cols, rows, open, entrance);
  let real = 0;
  for (let c = 1; c < cols; c++) if ((dist[(rows - 1) * cols + c] ?? 0) > (dist[(rows - 1) * cols + real] ?? 0)) real = c;
  const exits: StageMaze['exits'] = [{ col: real, row: rows - 1, side: 'top', real: true }];
  const spots: StageMaze['exits'] = [];
  for (let c = 0; c < cols; c++) if (Math.abs(c - real) >= 2) spots.push({ col: c, row: rows - 1, side: 'top', real: false });
  for (let r = 1; r < rows; r++) spots.push({ col: 0, row: r, side: 'left', real: false }, { col: cols - 1, row: r, side: 'right', real: false });
  while (exits.length < 1 + falseExits && spots.length > 0) exits.push(spots.splice(Math.floor(rand() * spots.length), 1)[0]!);
  return { cols, rows, open, entrance, exits };
}

/** A cell with one passage that is neither the way in nor an exit (a dead end of 22.7). */
export function hasDeadEnd(m: Pick<StageMaze, 'cols' | 'open' | 'entrance' | 'exits'>): boolean {
  const links = new Map<number, number>();
  for (const [c, r, a, b] of m.open) for (const i of [r * m.cols + c, b * m.cols + a]) links.set(i, (links.get(i) ?? 0) + 1);
  const exits = new Set(m.exits.map((e) => e.row * m.cols + e.col));
  return [...links.entries()].some(([i, n]) => n === 1 && i !== m.entrance && !exits.has(i));
}

/** Steps from the entrance to every cell along the open passages (−1 — not reached). */
export function mazeDistances(cols: number, rows: number, open: StageMaze['open'], entrance: number): number[] {
  const dist = Array.from({ length: cols * rows }, () => -1);
  const links = Array.from({ length: cols * rows }, () => [] as number[]);
  for (const [c, r, a, b] of open) {
    links[r * cols + c]!.push(b * cols + a);
    links[b * cols + a]!.push(r * cols + c);
  }
  dist[entrance] = 0;
  const queue = [entrance];
  while (queue.length > 0) {
    const i = queue.shift()!;
    for (const j of links[i]!) if (dist[j] === -1) (dist[j] = dist[i]! + 1), queue.push(j);
  }
  return dist;
}

/** The stages pace: every mountain of the spec cut into its stages (docs/01-gdd.md 22.4). */
export function generateStageWorlds({ spec, balance, tuning }: StageInput): World[] {
  const levels = balance.levels;
  const cfg = spec.stages;
  if (!levels) throw new Error('layout stageSlope: balance.json levels is required (docs/01-gdd.md 22.2)');
  if (!cfg) throw new Error('layout stageSlope: worlds-spec.json stages is required (docs/01-gdd.md 22.4)');
  if (!tuning || !balance.speedCurve) throw new Error('layout stageSlope: the trials need tuning.json and balance.json speedCurve');
  const open = generateOpenWorlds({ spec: { ...spec, layout: 'openSlope' }, balance, tuning });
  const curve = { base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed, k: balance.speedCurve.k };
  const speedOf = (level: number): number => round3(moveSpeed(levelThreshold(level, levels), curve));
  const rate = balance.upgrade?.trophyRate ?? 1;
  return open.map((ow, i) => stageWorld(spec, cfg, ow, i + 1, levels, speedOf, tuning as Pick<TuningJson, 'controller' | 'fun'>, rate));
}

/** The coins a mountain of the open slope gives (gifts, ridges, chests): the trophies of its stages (22.8: moved, not recounted). */
function coinsOf(w: World): number {
  let sum = 0;
  for (const s of w.segments) {
    if (s.type === 'gift' || s.type === 'chestGrotto' || s.type === 'chest') sum += (s['coins'] as number | undefined) ?? 0;
    if (s.type === 'gate') sum += (s['reward'] as { coins?: number } | undefined)?.coins ?? 0;
  }
  return sum;
}

/** Two significant digits (a trophy count reads at a glance). */
function nice(x: number): number {
  if (x < 10) return Math.max(1, Math.round(x));
  const p = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
}

function stageWorld(spec: OpenSpecJson, cfg: StageSpec, ow: World, index: number, levels: Levels, speedOf: (level: number) => number, tuning: Pick<TuningJson, 'controller' | 'fun'>, rate: number): World {
  const m = spec.mountains[index - 1]!;
  const plan = cfg.plan[index - 1];
  if (!plan || plan.length < 2) throw new Error(`${m.id}: worlds-spec.json stages.plan has no stages for mountain ${index}`);
  const K = plan.length;
  const half = cfg.field / 2;
  const bw = cfg.bridge / 2;
  const seg: Segment[] = [];
  const stages: WorldStage[] = [];
  const bosses: WorldBoss[] = [];
  const waveZones: Array<[number, number] | [number, number, number]> = [];
  const safe: Array<[number, number]> = [[0, spec.campLength]];

  // Ridge numbers of the open mountain and its giant, spread over the gates of stages 2…K on the log scale (22.2).
  const ridges = ow.segments.filter((s) => s.type === 'gate' && s['kind'] === 'ridge').sort((a, b) => a.z - b.z).map((s) => s['requires'] as number);
  const marks = [...ridges, m.boss.requires];
  const reqAt = (s: number): number => {
    const t = (K <= 2 ? 0 : (s - 2) / (K - 2)) * (marks.length - 1);
    const a = Math.floor(t);
    const b = Math.min(marks.length - 1, a + 1);
    return Math.exp(Math.log(marks[a]!) + (Math.log(marks[b]!) - Math.log(marks[a]!)) * (t - a));
  };
  const carried = index > 1 ? nearestLevel(spec.mountains[index - 2]!.boss.requires, levels) : 1;
  const levelOfStage: number[] = [];
  // `gateK` (LV-12 review «the gates never hold»): every requirement × it before it becomes a level — one data knob.
  for (let s = 1; s <= K; s++) levelOfStage.push(s === 1 ? carried : Math.max(levelOfStage[s - 2] ?? 1, nearestLevel(reqAt(s) * (s === 2 && index === 1 ? 1 : cfg.gateK ?? 1), levels)));

  // Step multipliers and gift zones of the open sections along the same share of the mountain (17.4: moved, not recounted).
  const openZone = (s: number): WorldZone => ow.zones[Math.min(ow.zones.length - 1, Math.floor(((s - 1) * ow.zones.length) / K))]!;
  // Trophies (22.8): the coins of the open mountain over its stages, the last ×trophyGrowth the first.
  const g = cfg.trophyGrowth ** (1 / Math.max(1, K - 1));
  const total = coinsOf(ow);
  const weights = plan.map((_, k) => g ** k);
  const wsum = weights.reduce((a, b) => a + b, 0);
  // The coins of a stage as LV built them (the golden snowflake still pays coins of this size).
  const coinsAt = (s: number): number => nice((total * weights[s - 1]!) / wsum);
  // SD-03 (docs/01-gdd.md 23.3): the trophies of a stage — a ladder of small numbers (1 → 3 → 10 → 20 …) scaled so the
  // mountain's sum is its coins over balance.json upgrade.trophyRate (the coins of a trophy, as the shoes are priced): value
  // moved, not recounted.
  // Stage 1 of mountain 1 is the first minute (no button): its ladder starts at stage 2; on the others at stage 1.
  const ladderFrom = index === 1 ? 1 : 0;
  const ladder = plan.map((_, k) => (k < ladderFrom ? 0 : cfg.trophyLadder?.[k - ladderFrom] ?? cfg.trophyLadder?.[cfg.trophyLadder.length - 1] ?? 1));
  const lsum = ladder.reduce((a, b) => a + b, 0);
  const trophiesOf = (s: number): number => (cfg.trophyLadder ? nice((ladder[s - 1]! * total) / (lsum * rate)) : coinsAt(s));
  // The golden snowflake on the riskiest line (22.8): the first `snowflake.stages` stages of cracks or catapult.
  const cutStages = new Set(plan.flatMap((t, k) => (t === 'cracks' || t === 'catapult' ? [k + 1] : [])).slice(0, cfg.snowflake.stages));

  const floor = (z: number, length: number, y: number, x0 = -half, x1 = half, extra: Record<string, unknown> = {}): void => {
    if (length > 1e-6) seg.push({ type: 'floor', z: round3(z), length: round3(length), y: round3(y), x0: round3(x0), x1: round3(x1), ...extra });
  };
  /** A pit across the slope: the dark floor far down (never stood on) and the trigger of the roll-back (RL-03). */
  const pit = (z: number, length: number, y: number, s: number): void => {
    if (length <= 1e-6) return;
    seg.push({ type: 'floor', z: round3(z), length: round3(length), y: round3(y - cfg.pitDepth), x0: -half, x1: half, material: 'pit', solid: false });
    seg.push({ type: 'pit', z: round3(z), length: round3(length), y: round3(y - PIT_TRIGGER), x0: -half, x1: half, section: s });
  };

  let z = 0;
  let y = 0;
  let wall = 0;
  if (index === 1 && plan[0] === 'intro') {
    // Stage 1 of mountain 1 — the first minute as built (22.1): the open mountain up to its ridge 1 byte for byte, the
    // ridge itself (level 2) and its carniz.
    const r1 = ow.segments.find((s) => s.type === 'gate' && s['kind'] === 'ridge')!;
    for (const s of ow.segments) {
      if (s.z < r1.z) seg.push(s);
      else if (s.z === r1.z && (s.type === 'floor' || s.type === 'ramp') && s['length'] === PASS_LENGTH) seg.push(s);
    }
    seg.push({ ...r1, ...ridgeAsLevel(r1['requires'] as number, levels) });
    wall = 1;
    y = round3((r1['y'] as number) + ((r1['rise'] as number | undefined) ?? 4));
    z = round3(r1.z + PASS_LENGTH);
    stages.push({ n: 1, type: 'intro', z0: spec.campLength, start: spec.campLength, end: r1.z, finish: [r1.z - 12, r1.z], y: 0, level: 1, speed: speedOf(1), width: 'field', trophies: 0, pad: { x: 0, z: r1.z, y: 0 } });
  } else {
    for (const s of ow.segments) if (s.z < spec.campLength && s.type !== 'gift' && s.type !== 'niche') seg.push(s);
    z = spec.campLength;
  }
  seg.push({ type: 'block', z: CAMP_TELEPORT[1] - 3, z1: CAMP_TELEPORT[1] + 3, x0: CAMP_TELEPORT[0] - 3, x1: CAMP_TELEPORT[0] + 3, y0: -0.5, y1: 0.25, material: 'ice', kind: 'campTeleport' });
  const first = stages.length + 1;

  for (let s = first; s <= K; s++) {
    const type = plan[s - 1]!;
    const width = STAGE_WIDTH[type];
    const level = levelOfStage[s - 1]!;
    const v = speedOf(level);
    const D = jumpDistance(tuning, v);
    const zone = openZone(s);
    const z0 = stages.length === 1 && s === first ? round3(z - PASS_LENGTH) : z;
    // The ridge of the stage (22.3): the carniz with passages (one on the axis before a bridge), «Level N» on it. Stage 2 of
    // mountain 1 has the ridge of the first minute (pushed with the intro).
    if (s > 1 && !(stages.length === 1 && s === first)) {
      const yHigh = round3(y + cfg.rise);
      pushPassages(seg, z, y, yHigh, half, width === 'field' ? passesOf(spec, half) : [0], PASS_LENGTH);
      wall++;
      seg.push({ type: 'gate', z, y, kind: 'ridge', requires: round3(levelThreshold(level, levels)), level, reward: { coins: 0 }, height: 10, signHeight: 5.5, rise: cfg.rise, passes: width === 'field' ? passesOf(spec, half) : [0], digits: 6, passWidth: 11, passLength: PASS_LENGTH, wall, zone: s, rarity: zone.rarity });
      y = yHigh;
      z = round3(z + PASS_LENGTH);
      seg.push({ type: 'checkpoint', z: round3(z + FLAG_PAST), y, x: 0, zone: s, rarity: zone.rarity, wall });
    }
    else if (s > 1) seg.push({ type: 'checkpoint', z: round3(z + FLAG_PAST), y, x: 0, zone: s, rarity: zone.rarity, wall });
    floor(z, cfg.start, y);
    const start = round3(z + cfg.start);
    let zb = start;
    let cut: WorldStage['cut'];
    let maze: StageMaze | undefined;

    switch (type) {
      case 'dips': {
        const dipCfg = spec.shapes!.dip!;
        const depth = dipCfg.depthByWorld?.[String(index)] ?? dipCfg.depth;
        const len = dipCfg.down + dipCfg.bottom + dipCfg.up;
        for (let k = 0; k < 3; k++) {
          floor(zb, 12, y);
          zb += 12;
          pushDipFloor(seg, { z0: round3(zb), z1: round3(zb + len), depth }, y, spec.shapes!);
          seg.push({ type: 'dip', z: round3(zb), length: len, y, depth, section: s });
          zb += len;
        }
        floor(zb, 12, y);
        zb += 12;
        break;
      }
      case 'cracks': {
        const n = 3 + (index >= 4 ? 1 : 0) + (index >= 8 ? 1 : 0);
        // SD-04 (docs/01-gdd.md 23.4): with `gapK` the crack is that share of the jump of v(N) — out of reach two levels
        // below (controller.levelJump); absent — 0.45 as LV built it.
        const w = round3(cfg.gapK ? clamp(cfg.gapK * D, 5, 80) : clamp(0.45 * D, 5, 30));
        const run = round3(Math.max(16, 0.6 * v));
        floor(zb, run, y);
        zb += run;
        for (let k = 0; k < n; k++) {
          pit(zb, w, y, s);
          zb += w;
          // The landing past the last crack runs straight into the finish (no free strip, 22.4).
          const after = k === n - 1 ? Math.min(run, 16) : run;
          floor(zb, after, y);
          zb += after;
        }
        break;
      }
      case 'giant': {
        const L = round3(clamp(5 * v, 150, 360));
        floor(zb, L, y);
        const covers = [
          { x: round3(half / 2), z: round3(zb + 0.4 * L), r: 4, h: 6 },
          { x: round3(-half / 2), z: round3(zb + 0.7 * L), r: 4, h: 6 },
        ];
        for (const c of covers) seg.push({ type: 'cover', z: c.z, x: c.x, y, r: c.r, h: c.h, zone: s });
        bosses.push({ zone: [round3(zb), round3(zb + L)], requires: round3(levelThreshold(level, levels)), returnMult: 1.5, giants: [{ speed: Math.floor((v / (1 + (cfg.giantMargin?.[index - 1] ?? cfg.giantMarginRest ?? m.boss.margin))) * 1000) / 1000, patrol: 'chase', seeDist: 0, turnSec: 0.5, ...(cfg.giantSlipPast === false ? { slipPast: false } : {}), ...(cfg.giantSide !== undefined ? { side: cfg.giantSide } : {}) }], width: cfg.field, covers } as WorldBoss);
        zb += L;
        break;
      }
      case 'plates': {
        const n = 4 + (index >= 5 ? 1 : 0);
        const gap = round3(cfg.gapK ? clamp(cfg.gapK * D, 3, 80) : clamp(0.42 * D, 3, 32));
        const plate = round3(clamp(1.1 * D, 10, 90));
        const L = n * plate + (n + 1) * gap;
        pit(zb, L, y, s);
        // The second plates of a mountain step side to side (LV-12 review: the same pattern twice).
        // SD-04: with the long gaps of `gapK` a quarter of a plate — the plates overlap and the jump stays straight.
        const shift = plan.slice(0, s - 1).includes('plates') ? (cfg.gapK ? bw / 4 : bw) : 0;
        let p = zb + gap;
        for (let k = 0; k < n; k++) {
          const x = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * shift;
          floor(p, plate, y, x - bw, x + bw);
          p += plate + gap;
        }
        zb += L;
        break;
      }
      case 'catapult': {
        // The trampoline throws by itself (22.5): a strip across the slope, its own push, a pit 0.7 of the flight.
        // The landing past each pit as long as 0.6 of the flight: the throw of v(N) lands in its middle, before the next pad.
        const forward = round3(clamp(0.5 * v, 8, 40));
        const F = padFlight(tuning, v, forward);
        const c = round3(cfg.catapultK ? clamp(cfg.catapultK * F, 12, 120) : clamp(0.7 * F, 12, 90));
        const land = round3(0.6 * F + 10);
        floor(zb, 10, y);
        for (let k = 0; k < 2; k++) {
          const padZ = k === 0 ? zb + 6 : zb - 4;
          seg.push({ type: 'jumpPad', z: round3(padZ), x: 0, y, width: round3(cfg.field - 4), length: 4, stretch: s, forward, shape: 'catapult' });
          zb = k === 0 ? zb + 10 : zb;
          pit(zb, c, y, s);
          zb += c;
          // The last landing runs into the finish just past the touchdown (no free strip, 22.4).
          const after = k === 0 ? land : round3(Math.max(20, F - c + 16));
          floor(zb, after, y);
          zb += after;
        }
        break;
      }
      case 'chute': {
        const L = round3(clamp(3 * v, 90, 300));
        const cw = index === 1 ? 5 : bw;
        pit(zb, L, y, s);
        floor(zb, L, y, -cw, cw, { material: 'ice' });
        seg.push({ type: 'slide', z: round3(zb + L / 2), x: 0, y, width: round3(2 * cw), length: L, stretch: s, mult: spec.relief?.chute?.mult ?? 1.6 });
        zb += L;
        break;
      }
      case 'throat':
      case 'blizzard': {
        // A ledge 1–3 steps wide over the pit, turning side to side (22.5): three legs (the blizzard — two, wider, in fog).
        const legs = type === 'throat' ? 3 : 2;
        const lw = type === 'throat' ? 5 : 6;
        const leg = round3(clamp((type === 'throat' ? 1.2 : 1.6) * v, 36, 150));
        const off = type === 'throat' ? 12 : 8;
        const L = legs * leg;
        pit(zb, L, y, s);
        for (let k = 0; k < legs; k++) {
          // The first leg on the axis, where the run comes from (LV-12 review: off it, a straight run fell at once).
          const x = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * off;
          floor(zb + k * leg, leg, y, x - lw, x + lw);
          // The turn: a piece across from this leg to the next one.
          if (k < legs - 1) floor(zb + (k + 1) * leg - 2 * lw, 2 * lw, y, -off - lw, off + lw);
        }
        zb += L;
        break;
      }
      case 'avalanche': {
        // The wave comes from the top of the stage on entering (22.5): a run to the end is caught, a grotto in a rock by
        // the axis every `every` × v saves — at v(N) the nearest is within reach of the short warning.
        const L = round3(clamp(7 * v, 210, 900));
        floor(zb, L, y);
        const every = round3(clamp(cfg.avalanche.every * v, 45, 200));
        let k = 0;
        for (let zg = zb + every / 2; zg < zb + L - 10; zg += every, k++) seg.push({ type: 'island', z: round3(zg), x: (k % 2 === 0 ? -1 : 1) * cfg.avalanche.x, y, size: 12, zone: s, stretch: s, ...(cfg.avalanche.through ? { through: true } : {}) });
        waveZones.push([round3(z0), round3(zb + L)]);
        zb += L;
        break;
      }
      case 'maze': {
        const mc = cfg.maze;
        const cols = mc.cols[Math.min(mc.cols.length - 1, index - 1)]!;
        const rows = mc.rows[Math.min(mc.rows.length - 1, index - 1)]!;
        const falseN = mc.falseExits[0] + (index % 2 === 0 ? 1 : 0);
        // The first seed whose maze has a dead end besides its exits (22.7: «2–3 dead ends or false exits»).
        let shape = mazeOf(cols, rows, Math.min(mc.falseExits[1], falseN), index * 7919 + s * 104729);
        for (let a = 1; a < 20 && !hasDeadEnd(shape); a++) shape = mazeOf(cols, rows, Math.min(mc.falseExits[1], falseN), index * 7919 + s * 104729 + a);
        const x0 = round3((-cols * mc.cell) / 2);
        maze = { x0, z0: round3(zb), cell: mc.cell, ...shape };
        const strip = 8;
        const L = rows * mc.cell + strip;
        pit(zb, L, y, s);
        pushMaze(seg, maze, y, mc, s);
        const real = shape.exits.find((e) => e.real)!;
        const cx = x0 + (real.col + 0.5) * mc.cell;
        floor(zb + rows * mc.cell, strip, y, cx - mc.cell / 2 + mc.wall, cx + mc.cell / 2 - mc.wall);
        // A golden beacon over the real way out, above the walls (LV-12 review: without it the maze was a lottery).
        const bz = zb + rows * mc.cell + strip + 3;
        seg.push({ type: 'block', z: round3(bz - 1), z1: round3(bz + 1), x0: round3(cx - 1), x1: round3(cx + 1), y0: y, y1: round3(y + mc.height + 8), material: 'trophyPad', kind: 'beacon', solid: false });
        zb += L;
        break;
      }
      case 'intro':
        throw new Error(`${m.id}: stage ${s} — intro is the first stage of mountain 1 only`);
    }

    // The golden snowflake (22.4, 22.8): a long jump at the side, 1.15 of the plain jump at v(N) — 1.3× speed makes it.
    if (cutStages.has(s)) {
      // The lane of the cut by the fence (12 wide): a pit there, the slope beside it as before.
      const gap = round3(1.15 * D);
      const sign = s % 2 === 0 ? 1 : -1;
      const lx = round3(sign * (half - 6));
      const [p0, p1] = sign > 0 ? [half - 12, half] : [-half, -half + 12];
      floor(zb, gap, y, sign > 0 ? -half : p1, sign > 0 ? p0 : half);
      seg.push({ type: 'floor', z: round3(zb), length: gap, y: round3(y - cfg.pitDepth), x0: round3(p0), x1: round3(p1), material: 'pit', solid: false });
      seg.push({ type: 'pit', z: round3(zb), length: gap, y: round3(y - PIT_TRIGGER), x0: round3(p0), x1: round3(p1), section: s });
      const apex = (tuning.controller.jumpSpeed * tuning.controller.jumpSpeed) / (2 * tuning.controller.gravity);
      seg.push({ type: 'gift', z: round3(zb + gap / 2), x: lx, y: round3(y + apex * 0.8), height: 0, zone: s, rarity: 'mythic', coins: cfg.snowflake.mult * coinsAt(s), n: 0, air: true, col: [round3(y + apex * 0.4), round3(y + apex * 1.2)], snowflake: true });
      cut = { gap, x: lx, z: round3(zb) };
      zb += gap;
    }

    // SD-06 (docs/01-gdd.md 23.6): the avalanche on almost every stage — not the giant's (one trial a stage there) and not
    // the first minute. A grotto in a rock on the start pad beside the axis; the first wave `stageExtraSec` later than a
    // clean run of the body at v(N) — the slow one hides in it or runs on to the safe finish.
    const extra = cfg.avalanche.stageExtraSec;
    // Not in the maze either (SD-09 review: under its walls no grotto is in reach — it is a trial of its own).
    if (extra !== undefined && type !== 'giant' && type !== 'avalanche' && type !== 'maze') {
      // By the edge of the field (SD-09 review: by the axis, seen from the ridge below, it read as a plate in the air).
      seg.push({ type: 'island', z: round3(start - cfg.start / 2), x: (s % 2 === 0 ? -1 : 1) * round3(half - cfg.start / 2 - EDGE_GAP), y: round3(y), size: cfg.start, zone: s, stretch: s, ...(cfg.avalanche.through ? { through: true } : {}) });
      waveZones.push([round3(z0), round3(zb), round3((zb - start) / v + extra)]);
    }
    // The safe finish with the trophy button at the side (22.8): the threats stay out of it.
    const end = round3(zb);
    floor(end, cfg.finish, y);
    // In the frame of the run (LV-12 review: at the fence it stood at the edge of the frame).
    const padX = round3((s % 2 === 0 ? -1 : 1) * Math.min(half - 8, 26));
    const pad = { x: padX, z: round3(end + cfg.finish / 2), y };
    seg.push({ type: 'trophyPad', z: pad.z, x: pad.x, y, stage: s, trophies: trophiesOf(s) });
    seg.push({ type: 'block', z: round3(pad.z - 3), z1: round3(pad.z + 3), x0: round3(pad.x - 3), x1: round3(pad.x + 3), y0: round3(y - 0.5), y1: round3(y + 0.25), material: 'trophyPad', kind: 'trophyPad' });
    // The treadmill of the finish (22.8; the belt of the ridge grotto of 17.4): Speed by the closed ridge, × the step of the stage.
    seg.push({ type: 'treadmill', z: pad.z, x: -padX, y, length: 12, width: 6, mult: zone.stepMult ?? 1 });
    safe.push([end, round3(end + cfg.finish)]);
    stages.push({ n: s, type, z0: round3(z0), start, end, finish: [end, round3(end + cfg.finish)], y, level, speed: v, width, trophies: trophiesOf(s), pad, ...(cut ? { cut } : {}), ...(maze ? { maze } : {}) });
    z = round3(end + cfg.finish);
  }

  // The summit of the open mountain moved to the top of the last stage (5.2: chest, portal, the funnel).
  const top = ow.safeZones[ow.safeZones.length - 1]!;
  const yTop = (ow.segments.find((s) => s.type === 'summit')?.['y'] as number | undefined) ?? 0;
  for (const s of ow.segments)
    if (s.z >= top[0] && s.type !== 'gate' && s.type !== 'gift' && s.type !== 'niche')
      seg.push({ ...s, z: round3(s.z - top[0] + z), y: round3((s['y'] as number) - yTop + y), ...(typeof s['end'] === 'number' ? { end: round3((s['end'] as number) - top[0] + z) } : {}) });
  const length = round3(z + (top[1] - top[0]));
  safe.push([z, length]);

  const zones: WorldZone[] = stages.map((st, k) => {
    const oz = openZone(st.n);
    return { k: st.n, rarity: oz.rarity, gift: oz.gift, stepMult: oz.stepMult ?? 1, zStart: k === 0 ? spec.campLength : st.z0, zEnd: k === stages.length - 1 ? z : stages[k + 1]!.z0 };
  });
  return {
    id: ow.id,
    index,
    length,
    width: cfg.field,
    spawnZ: ow.spawnZ,
    egg: ow.egg,
    stretch: Math.max(...stages.map((st) => round3(st.finish[1] - st.z0))),
    wallCount: wall,
    safeZones: safe,
    threat: { ...ow.threat, spawnMaxZ: Math.max(...waveZones.map((w) => w[1]), spec.campLength), zones: waveZones, zoneFirstSec: cfg.avalanche.firstSec, zoneWarnSec: cfg.avalanche.warnSec, intervalSec: index === 1 ? ow.threat.intervalSec : cfg.avalanche.intervalSec },
    zones,
    segments: seg,
    treadmillMult: ow.treadmillMult,
    layout: 'openSlope',
    ...(bosses.length > 0 ? { bosses } : {}),
    ...(ow.look ? { look: ow.look } : {}),
    profile: [[0, half]],
    stages,
    campTeleport: { x: CAMP_TELEPORT[0], y: 0, z: CAMP_TELEPORT[1] },
  };
}

/** Walls of the maze (22.7): the outer wall with the way in and the exits, the inner walls where no passage is open. */
function pushMaze(seg: Segment[], mz: StageMaze, y: number, mc: StageSpec['maze'], s: number): void {
  const { cols, rows, cell, x0, z0 } = mz;
  const t = mc.wall / 2;
  const opened = new Set(mz.open.map(([c, r, a, b]) => (r === b ? `v${Math.max(c, a)},${r}` : `h${c},${Math.max(r, b)}`)));
  // Floor of the maze: the cells only (the pit around).
  seg.push({ type: 'floor', z: round3(z0), length: round3(rows * cell), y: round3(y), x0: round3(x0), x1: round3(x0 + cols * cell), maze: s });
  opened.add(`h${mz.entrance},0`);
  for (const e of mz.exits) opened.add(e.side === 'top' ? `h${e.col},${rows}` : e.side === 'left' ? `v0,${e.row}` : `v${cols},${e.row}`);
  const box = (xa: number, xb: number, za: number, zb: number): void => {
    seg.push({ type: 'block', z: round3(za), z1: round3(zb), x0: round3(xa), x1: round3(xb), y0: round3(y - 1), y1: round3(y + mc.height), material: 'throatWall', kind: 'throatWall', maze: s });
  };
  // Walls across (along x) at each row line, merged over the cells in a row of closed edges.
  for (let r = 0; r <= rows; r++) {
    let from = -1;
    for (let c = 0; c <= cols; c++) {
      const closed = c < cols && !opened.has(`h${c},${r}`);
      if (closed && from < 0) from = c;
      if (!closed && from >= 0) {
        box(x0 + from * cell - t, x0 + c * cell + t, z0 + r * cell - t, z0 + r * cell + t);
        from = -1;
      }
    }
  }
  // Walls along (along z) at each column line.
  for (let c = 0; c <= cols; c++) {
    let from = -1;
    for (let r = 0; r <= rows; r++) {
      const closed = r < rows && !opened.has(`v${c},${r}`);
      if (closed && from < 0) from = r;
      if (!closed && from >= 0) {
        box(x0 + c * cell - t, x0 + c * cell + t, z0 + from * cell - t, z0 + r * cell + t);
        from = -1;
      }
    }
  }
}

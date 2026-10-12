// What: Content checks of the base (docs/01a-content.md 18.1–18.2): as many portals as mountains, every portal entered by the hero's physics from the spawn, no gap in the fence, the stands and decor clear of the arches and the belts, the base treadmill under section 1 of the next mountain, the texts of the base.
// Called by: level/validate.ts (validatePack, when a pace has base.json); tests/level/base.test.ts.
// Keep: Pure like validate.ts: base.json, worlds, tuning and balance in, messages "base.json: field — what is wrong" out; the way in is the game's (sim/base-portals.ts).

import * as v from 'valibot';
import type { BalanceJson, BaseJson, TuningJson, WorldsJson } from '../content/types.ts';
import { basePortals, baseTreadMult, buildBase, type BasePortal } from './base-layout.ts';
import { BORDER_HEIGHT } from './builder.ts';
import type { LevelData } from './types.ts';
import { createSim } from '../sim/world.ts';
import { basePortalEntered } from '../sim/base-portals.ts';

/** Texts the base shows (docs/01a-content.md 18.8). */
export const BASE_KEYS = ['base.name', 'toast.baseFirst', 'base.goal', 'base.portalRidge', 'base.portalLocked', 'toast.replaySummit', 'toast.baseTreadmill'] as const;
/** The hero walks from the spawn into a portal within this many seconds. */
const REACH_SEC = 12;
/** A point of the base keeps this far from an arch's opening and from the treadmill (units). */
const CLEAR = 1;

const num = v.number();
const pos = v.pipe(v.number(), v.minValue(1e-9, 'expected > 0'));
const nonNeg = v.pipe(v.number(), v.minValue(0));
const xz = v.tuple([num, num]);
const spot = { x: num, z: num, radius: pos };
const baseSchema = v.object({
  enabled: v.boolean(),
  startOnReturn: v.boolean(),
  replayRewards: v.boolean(),
  size: v.tuple([pos, pos]),
  spawn: v.object({ x: num, z: num }),
  portals: v.object({ center: xz, radius: pos, fromDeg: v.pipe(num, v.minValue(-90), v.maxValue(90)), toDeg: v.pipe(num, v.minValue(-90), v.maxValue(90)), width: pos, height: pos }),
  treadmill: v.object({ x: num, z: num, lanes: v.pipe(num, v.integer(), v.minValue(1)), laneWidth: pos, length: pos, from: v.literal('lastFinish') }),
  stands: v.object({ shop: v.object({ ...spot, standSec: nonNeg }), records: v.object(spot), daily: v.object(spot) }),
  bots: v.object({ count: v.pipe(num, v.integer(), v.minValue(0)), low: v.pipe(num, v.integer(), v.minValue(0)) }),
  transitSec: nonNeg,
  decor: v.object({ tents: v.array(xz), trees: v.array(xz), snowman: xz }),
});

const progressAll = (base: BaseJson, worlds: WorldsJson, summits: number): Parameters<typeof buildBase>[1] => ({
  mountains: worlds.worlds.map((w) => ({ index: w.index, id: w.id })),
  summits,
  ridge: null,
  treadMult: 1,
});

/** Points just outside the field W × L (a step of 1 unit round it) not inside a fence box at least a border high. */
export function fenceGaps(level: LevelData, W: number, L: number): string[] {
  const fence = [...level.boxes.filter((b) => b.solid && b.kind === 'border'), ...(level.bounds ?? [])];
  const covered = (x: number, z: number): boolean => fence.some((b) => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && b.max[1] >= BORDER_HEIGHT);
  const gaps: string[] = [];
  for (let z = -0.5; z <= L + 0.5; z += 1) for (const x of [-W / 2 - 0.5, W / 2 + 0.5]) if (!covered(x, z)) gaps.push(`(${x}, ${z})`);
  for (let x = -W / 2; x <= W / 2; x += 1) for (const z of [-0.5, L + 0.5]) if (!covered(x, z)) gaps.push(`(${x}, ${z})`);
  return gaps;
}

/** base.json of a pace (raw JSON): its schema, then validateBase; `i18n` — the dictionaries by language. */
export function validateBaseFile(raw: unknown, worlds: WorldsJson, tuning: TuningJson, balance: BalanceJson, i18n: Record<string, Record<string, string>>): string[] {
  const res = v.safeParse(baseSchema, raw);
  if (!res.success) return res.issues.map((issue) => `base.json: ${v.getDotPath(issue) || '(root)'} — ${issue.message}`);
  return validateBase(raw as BaseJson, worlds, tuning, balance, i18n);
}

export function validateBase(base: BaseJson, worlds: WorldsJson, tuning: TuningJson, balance: BalanceJson, i18n: Record<string, Record<string, string>>): string[] {
  const errors: string[] = [];
  const [W, L] = base.size;
  const n = worlds.worlds.length;
  if (n === 0) return ['base.json: portals — the pace has no mountains'];
  const portals = basePortals(base, progressAll(base, worlds, n));
  if (portals.length !== n) errors.push(`base.json: portals — ${portals.length} portals for ${n} mountains`);
  // Every arch inside the field.
  for (const p of portals) {
    const r = p.width / 2 + CLEAR;
    if (p.x - r < -W / 2 || p.x + r > W / 2 || p.z - r < 0 || p.z + r > L)
      errors.push(`base.json: portals — the portal of mountain ${p.world} at (${p.x}, ${p.z}) is outside the field ${W} × ${L}`);
  }
  // Points clear of the arches and of the treadmill.
  const t = base.treadmill;
  const beltHalf = { x: (t.lanes * t.laneWidth) / 2, z: t.length / 2 };
  const points: Array<[string, number, number]> = [
    ['spawn', base.spawn.x, base.spawn.z],
    ...Object.entries(base.stands).map(([k, s]) => [`stands.${k}`, s.x, s.z] as [string, number, number]),
    ...base.decor.tents.map(([x, z], i) => [`decor.tents[${i}]`, x, z] as [string, number, number]),
    ...base.decor.trees.map(([x, z], i) => [`decor.trees[${i}]`, x, z] as [string, number, number]),
    ['decor.snowman', base.decor.snowman[0], base.decor.snowman[1]],
  ];
  for (const [name, x, z] of points) {
    if (Math.abs(x) > W / 2 - CLEAR || z < CLEAR || z > L - CLEAR) errors.push(`base.json: ${name} — (${x}, ${z}) outside the field`);
    const hit = portals.find((p: BasePortal) => Math.hypot(x - p.x, z - p.z) < p.width / 2 + CLEAR);
    if (hit) errors.push(`base.json: ${name} — (${x}, ${z}) in the portal of mountain ${hit.world}`);
    if (Math.abs(x - t.x) < beltHalf.x + CLEAR && Math.abs(z - t.z) < beltHalf.z + CLEAR) errors.push(`base.json: ${name} — (${x}, ${z}) on the treadmill`);
  }
  for (const p of portals)
    if (Math.abs(p.x - t.x) < beltHalf.x + p.width / 2 && Math.abs(p.z - t.z) < beltHalf.z + p.width / 2) errors.push(`base.json: treadmill — under the portal of mountain ${p.world}`);
  // The base treadmill never beats section 1 of the next mountain (docs/01a-content.md 18.2): running pays more.
  for (let k = 0; k < n; k++) {
    const next = worlds.worlds[k]!;
    const first = next.zones.find((z) => typeof z.stepMult === 'number')?.stepMult ?? 1;
    const tread = baseTreadMult(worlds.worlds, k);
    if (tread > first) errors.push(`base.json: treadmill — ×${tread} after ${k} summits is more than section 1 of mountain ${next.index} (×${first})`);
  }
  // Texts.
  for (const [lang, dict] of Object.entries(i18n)) for (const k of BASE_KEYS) if (!(k in dict)) errors.push(`i18n/${lang}.json: ${k} — missing (the base shows it)`);
  if (errors.length) return errors;

  // The level: no gap in the fence.
  const built = buildBase(base, progressAll(base, worlds, n), tuning.bounds?.wallHeight);
  const level = built.level;
  const gaps = fenceGaps(level, W, L);
  if (gaps.length) errors.push(`base.json: size — gaps in the fence at ${gaps.slice(0, 4).join(', ')}${gaps.length > 4 ? ' …' : ''}`);

  // Every portal entered by the hero's physics from the spawn: up to a point in front of it, then through it.
  const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
  const sim = createSim(level, tuning, { balance, speedCurve: curve, stat: 0 });
  for (const p of built.portals) {
    sim.teleport(level.spawn[0], level.spawn[1] + 0.05, level.spawn[2]);
    const s = Math.sin(p.yaw);
    const c = Math.cos(p.yaw);
    const path: Array<[number, number]> = [
      [p.x - 4 * s, p.z - 4 * c],
      [p.x + 2 * s, p.z + 2 * c],
    ];
    let entered = false;
    for (let tick = 0; tick < REACH_SEC * 60 && !entered; tick++) {
      while (path.length > 1 && Math.hypot(path[0]![0] - sim.hero.pos.x, path[0]![1] - sim.hero.pos.z) < 0.8) path.shift();
      const [tx, tz] = path[0]!;
      const dx = tx - sim.hero.pos.x;
      const dz = tz - sim.hero.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const px = sim.hero.pos.x;
      const pz = sim.hero.pos.z;
      sim.step({ moveX: dx / d, moveZ: dz / d, jump: false, jumpHeld: false }, 1 / 60);
      entered = basePortalEntered([p], px, pz, sim.hero.pos.x, sim.hero.pos.z) === p.world;
    }
    if (!entered) errors.push(`base.json: portals — the hero does not get into the portal of mountain ${p.world} from the spawn in ${REACH_SEC} s`);
  }
  return errors;
}

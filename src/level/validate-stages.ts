// What: Level checks of the stages pace (layout stageSlope, docs/01-gdd.md 22): ridges ask for levels, 10–15 stages of one trial each in the order of 22.5, no strip without a trial, 2–3 width changes, mazes with one real exit and 2–3 false ones, one trophy button per finish, the trials passable at v(N).
// Called by: level/validate.ts (validatePack, when worlds-spec.json has layout stageSlope); tests/level/stages.test.ts.
// Keep: Pure; reads worlds.json, balance and tuning only; every message names the mountain and the stage; the physics numbers as stage-slope.ts builds them.

import type { Segment, TuningJson, World, WorldStage, WorldsJson } from '../content/types.ts';
import { levelThreshold, type Levels } from '../sim/levels.ts';
import { STAGE_WIDTH, jumpDistance, mazeDistances, padFlight } from './stage-slope.ts';
import type { LevelData } from './types.ts';

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
/** No strip of a trial body longer than this without its trial (docs/01-gdd.md 22.4). */
export const FREE_RUN_MAX = 24;
/** A bridge or ledge is 1–3 steps wide (22.6), a field at least this wide. */
export const BRIDGE_WIDTH: [number, number] = [4, 12];
export const FIELD_MIN = 60;
/** The speed a cut asks for over v(N) (22.4). */
export const CUT_SPEED = 1.3;

type Physics = Pick<TuningJson, 'controller' | 'fun'>;

/** Kinds that are the ground itself or hang by design (roofs on their walls, the beacon over the maze). */
const GROUND_KINDS = new Set(['floor', 'border', 'pitFloor', 'nicheFloor', 'beacon']);
/** SD-02: how far the bottom of an object may stand over the floor under it. */
export const FLOAT_MAX = 0.5;

/**
 * SD-02 (docs/01-gdd.md 23.2; producer 15.10: a big blue plate over the floor): no box of the built level hangs in the air —
 * its bottom stands on the floor under its middle and corners (within FLOAT_MAX); roofs (on their walls) and the ground
 * kinds aside, and off the track (grottos of the edges, floorAt −∞) nothing to check.
 */
export function floatingErrors(level: LevelData): string[] {
  const errors: string[] = [];
  for (const b of level.boxes) {
    if (GROUND_KINDS.has(b.kind) || b.kind.endsWith('Roof')) continue;
    const w = b.max[0] - b.min[0];
    const d = b.max[2] - b.min[2];
    let gap = Infinity;
    for (const [fx, fz] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.9], [0.1, 0.9], [0.9, 0.1]] as const) {
      const f = level.floorAt(b.min[0] + fx * w, b.min[2] + fz * d);
      // Off the track floorAt is a far-down sentinel: nothing under it to stand on, nothing to check.
      if (Number.isFinite(f) && f > level.killY - FLOAT_MAX) gap = Math.min(gap, b.min[1] - f);
    }
    if (Number.isFinite(gap) && gap > FLOAT_MAX) errors.push(`${b.kind} at x ${round3((b.min[0] + b.max[0]) / 2)} z ${round3((b.min[2] + b.max[2]) / 2)} hangs ${round3(gap)} over the floor`);
  }
  return errors;
}

/** Ridges of a mountain ask for a level (docs/01-gdd.md 22.2–22.3): requires = the threshold of `level`. */
export function validateStageLevels(w: World, levels: Levels): string[] {
  const errors: string[] = [];
  const at = `worlds.json: worlds[${w.index - 1}] (${w.id})`;
  for (const s of w.segments) {
    if (s.type !== 'gate' || s['kind'] !== 'ridge') continue;
    const level = s['level'];
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) errors.push(`${at}: ridge at z ${s.z} — no level`);
    else if (s['requires'] !== round3(levelThreshold(level, levels))) errors.push(`${at}: ridge at z ${s.z} — requires ${String(s['requires'])}, level ${level} starts at ${round3(levelThreshold(level, levels))}`);
  }
  return errors;
}

const num = (s: Segment, k: string): number => s[k] as number;
const narrow = (st: WorldStage): boolean => st.width !== 'field';

/** Changes of width between neighbour stages (field ↔ bridge or cave, docs/01-gdd.md 22.6). */
export function widthChanges(stages: readonly WorldStage[]): number {
  let n = 0;
  for (let k = 1; k < stages.length; k++) if (narrow(stages[k]!) !== narrow(stages[k - 1]!)) n++;
  return n;
}

/** Order of 22.5: a light one first (the first minute on mountain 1), the giant second, the avalanche in the middle third, the maze in the last. */
export function orderErrors(stages: readonly WorldStage[]): string[] {
  const K = stages.length;
  const errors: string[] = [];
  const first = stages[0]?.type;
  if (first !== 'intro' && first !== 'dips' && first !== 'cracks') errors.push(`stage 1 — ${String(first)}, a light one first (dips, cracks)`);
  if (stages[1]?.type !== 'giant') errors.push(`stage 2 — ${String(stages[1]?.type)}, the giant second`);
  for (const st of stages) {
    if (st.type === 'avalanche' && !(st.n > K / 3 && st.n <= Math.ceil((2 * K) / 3))) errors.push(`stage ${st.n} — the avalanche outside the middle third of ${K}`);
    if (st.type === 'maze' && !(st.n > (2 * K) / 3)) errors.push(`stage ${st.n} — the maze outside the last third of ${K}`);
  }
  if (!stages.some((s) => s.type === 'avalanche')) errors.push('no avalanche stage');
  if (!stages.some((s) => s.type === 'maze')) errors.push('no maze stage');
  return errors;
}

/** The maze (22.7): every exit reached from the way in, one real, 2–3 false, a dead end at least. */
export function mazeErrors(st: WorldStage): string[] {
  const m = st.maze;
  if (!m) return ['no maze'];
  const errors: string[] = [];
  const dist = mazeDistances(m.cols, m.rows, m.open, m.entrance);
  if (dist.some((d) => d < 0)) errors.push('a cell of the maze is walled off');
  const real = m.exits.filter((e) => e.real).length;
  const falseN = m.exits.length - real;
  if (real !== 1) errors.push(`${real} real exits, one expected`);
  if (falseN < 2 || falseN > 3) errors.push(`${falseN} false exits, 2–3 expected`);
  const links = new Map<number, number>();
  for (const [c, r, a, b] of m.open) for (const i of [r * m.cols + c, b * m.cols + a]) links.set(i, (links.get(i) ?? 0) + 1);
  const exitCells = new Set(m.exits.map((e) => e.row * m.cols + e.col));
  const deadEnds = [...links.entries()].filter(([i, n]) => n === 1 && i !== m.entrance && !exitCells.has(i)).length;
  if (deadEnds < 1) errors.push('no dead end');
  return errors;
}

/** Strips of the body [start, end] with no trial (22.4): z steps of 1 unit not covered by any element of the stage. */
export function freeRuns(w: World, st: WorldStage, tuning: Physics): Array<[number, number]> {
  const D = jumpDistance(tuning, st.speed);
  const cover: Array<[number, number]> = [];
  const seg = w.segments;
  for (const s of seg) {
    const z0 = s.z;
    const z1 = s.z + (typeof s['length'] === 'number' ? num(s, 'length') : 0);
    // A pit: the run-up of the jump before it and the landing past it belong to the trial.
    if (s.type === 'pit') cover.push([z0 - D, z1 + 0.5 * D]);
    else if (s.type === 'dip') cover.push([z0 - 4, z1 + 4]);
    // A catapult: the run onto it and its whole flight (the landing too).
    else if (s.type === 'jumpPad') cover.push([z0 - 10, z0 + padFlight(tuning, st.speed, typeof s['forward'] === 'number' ? num(s, 'forward') : tuning.fun.padForward)]);
    else if (s.type === 'slide') cover.push([z0 - num(s, 'length') / 2, z0 + num(s, 'length') / 2]);
    else if (s.type === 'floor' && s['maze'] !== undefined) cover.push([z0, z1]);
    else if (s.type === 'floor' && num(s, 'x1') - num(s, 'x0') <= BRIDGE_WIDTH[1] + 1e-6) cover.push([z0, z1]);
  }
  for (const b of w.bosses ?? []) cover.push([b.zone[0], b.zone[1]]);
  for (const zn of w.threat.zones ?? []) cover.push([zn[0], zn[1]]);
  const free: Array<[number, number]> = [];
  let from = -1;
  for (let z = st.start; z <= st.end; z += 1) {
    const covered = cover.some(([a, b]) => z >= a - 1e-6 && z <= b + 1e-6);
    if (!covered && from < 0) from = z;
    if ((covered || z + 1 > st.end) && from >= 0) {
      if (z - from > FREE_RUN_MAX) free.push([from, z]);
      from = -1;
    }
  }
  return free;
}

/** The trial passable at v(N) with a margin, its cut asking 1.3× (22.4). */
export function fairErrors(w: World, st: WorldStage, tuning: Physics, margin: number): string[] {
  const errors: string[] = [];
  const v = st.speed;
  const D = jumpDistance(tuning, v);
  const inBody = (s: Segment): boolean => s.z >= st.start - 1e-6 && s.z < st.end - 1e-6;
  // SD-04: with controller.levelJump the reach two levels below is g^−2 (at most) and a gap may take up to 0.9 of the jump.
  const lj = tuning.controller.levelJump;
  const below2 = lj ? Math.max(lj.min, lj.g ** -2) : 0;
  const reachK = lj ? 0.9 : 0.6;
  const pits = w.segments.filter((s) => s.type === 'pit' && inBody(s) && num(s, 'x0') <= 0 && num(s, 'x1') >= 0);
  if (st.type === 'cracks' || st.type === 'plates')
    for (const p of pits) {
      const gap = num(p, 'length');
      // A plate run over the whole pit: the gap is between plates, the plates take the landing.
      const plates = w.segments.filter((s) => s.type === 'floor' && s.z >= p.z && s.z < p.z + gap && num(s, 'x0') <= 0 && num(s, 'x1') >= 0 && s['material'] !== 'pit');
      if (plates.length === 0 && gap > reachK * D + 1e-6) errors.push(`stage ${st.n}: a gap ${gap} at z ${p.z} — more than ${reachK} of the jump ${round3(D)} at v(N) ${v}`);
      // SD-04 (docs/01-gdd.md 23.4): Speed decides — two levels below the stage the jump falls short (v(N−2) < v(N)).
      if (plates.length === 0 && below2 && gap <= below2 * D + 1e-6) errors.push(`stage ${st.n}: a gap ${gap} at z ${p.z} — within the jump two levels below (${round3(below2 * D)})`);
    }
  if (st.type === 'catapult')
    for (const pad of w.segments.filter((s) => s.type === 'jumpPad' && inBody(s))) {
      const pit = w.segments.find((s) => s.type === 'pit' && s.z >= pad.z && s.z <= pad.z + 6);
      const F = padFlight(tuning, v, num(pad, 'forward'));
      if (pit && num(pit, 'length') > Math.max(0.85, reachK) * F) errors.push(`stage ${st.n}: the catapult at z ${pad.z} falls short at v(N) ${v}`);
      if (pit && below2 && num(pit, 'length') <= below2 * F + 1e-6) errors.push(`stage ${st.n}: the catapult at z ${pad.z} — its pit within the flight two levels below`);
    }
  if (st.type === 'giant')
    for (const b of (w.bosses ?? []).filter((b) => b.zone[0] >= st.start - 1e-6 && b.zone[1] <= st.end + 1e-6))
      for (const g of b.giants) if (g.speed * (1 + margin) > v * (1 + 1e-6)) errors.push(`stage ${st.n}: the giant ${g.speed} is not ${margin * 100}% slower than v(N) ${v}`);
  if (st.type === 'avalanche') {
    const isl = w.segments.filter((s) => s.type === 'island' && inBody(s)).map((s) => s.z);
    let prev = st.start;
    for (const z of [...isl, st.end]) {
      if (z - prev > 2.6 * v) errors.push(`stage ${st.n}: ${round3(z - prev)} without a grotto at z ${prev} (more than 2.6 s at v(N) ${v})`);
      prev = z;
    }
  }
  if (st.cut && !(st.cut.gap > 1.05 * D && st.cut.gap <= 0.95 * jumpDistance(tuning, CUT_SPEED * v)))
    errors.push(`stage ${st.n}: the cut ${st.cut.gap} must be out of reach at v(N) (jump ${round3(D)}) and within 1.3× v`);
  return errors;
}

/** Widths (22.6): the floors of a bridge stage 4–12 wide, of a field stage at least 60. */
function widthErrors(w: World, st: WorldStage): string[] {
  if (st.type === 'intro' || st.type === 'maze') return [];
  const body = w.segments.filter((s) => s.type === 'floor' && s.z >= st.start - 1e-6 && s.z < st.end - 1e-6 && s['material'] !== 'pit' && num(s, 'length') > 12 && num(s, 'x0') <= 0 && num(s, 'x1') >= 0);
  const errors: string[] = [];
  for (const f of body) {
    const width = num(f, 'x1') - num(f, 'x0');
    if (st.width === 'bridge' && (width < BRIDGE_WIDTH[0] - 1e-6 || width > BRIDGE_WIDTH[1] + 1e-6)) errors.push(`stage ${st.n}: a bridge ${round3(width)} wide at z ${f.z}, 1–3 steps (4–12) expected`);
    if (st.width === 'field' && width < FIELD_MIN - 1e-6) errors.push(`stage ${st.n}: a field ${round3(width)} wide at z ${f.z}, ${FIELD_MIN}+ expected`);
  }
  return errors;
}

export function validateStageWorld(w: World, levels: Levels, tuning: Physics, margin: number): string[] {
  const at = `worlds.json: worlds[${w.index - 1}] (${w.id})`;
  const stages = w.stages ?? [];
  const errors = validateStageLevels(w, levels);
  if (stages.length < 10 || stages.length > 15) errors.push(`${at}: ${stages.length} stages, 10–15 expected (docs/01-gdd.md 22.4)`);
  for (const e of orderErrors(stages)) errors.push(`${at}: ${e}`);
  const changes = widthChanges(stages);
  if (changes < 2 || changes > 3) errors.push(`${at}: ${changes} changes of width, 2–3 expected (docs/01-gdd.md 22.6)`);
  const pads = w.segments.filter((s) => s.type === 'trophyPad');
  let snow = 0;
  for (const st of stages) {
    if (STAGE_WIDTH[st.type] !== st.width) errors.push(`${at}: stage ${st.n} (${st.type}) — width ${st.width}`);
    if (st.type === 'maze') for (const e of mazeErrors(st)) errors.push(`${at}: stage ${st.n} maze — ${e}`);
    if (st.type !== 'intro') {
      for (const [a, b] of freeRuns(w, st, tuning)) errors.push(`${at}: stage ${st.n} (${st.type}) — ${b - a} units without its trial from z ${a}`);
      const mine = pads.filter((p) => num(p, 'stage') === st.n);
      if (mine.length !== 1) errors.push(`${at}: stage ${st.n} — ${mine.length} trophy buttons, one expected`);
      const p = mine[0];
      if (p && !(p.z >= st.finish[0] && p.z <= st.finish[1] && w.safeZones.some(([a, b]) => p.z >= a && p.z <= b))) errors.push(`${at}: stage ${st.n} — the trophy button out of the safe finish`);
    }
    if (st.cut) snow++;
    for (const e of [...fairErrors(w, st, tuning, margin), ...widthErrors(w, st)]) errors.push(`${at}: ${e}`);
  }
  const paid = stages.filter((s) => s.trophies > 0);
  // SD-03 (docs/01-gdd.md 23.3): small numbers growing stage by stage, the first of mountain 1 is one trophy.
  for (let k = 1; k < paid.length; k++) if (!(paid[k]!.trophies > paid[k - 1]!.trophies)) errors.push(`${at}: stage ${paid[k]!.n} — ${paid[k]!.trophies} trophies, more than stage ${paid[k - 1]!.n} (${paid[k - 1]!.trophies}) expected (docs/01-gdd.md 23.3)`);
  if (w.index === 1 && paid[0] && paid[0].trophies !== 1) errors.push(`${at}: the first trophy button of the game gives ${paid[0].trophies}, 1 expected (docs/01-gdd.md 23.3)`);
  if (snow > 2) errors.push(`${at}: ${snow} golden snowflakes, 2 at most`);
  // One trial a stage: the avalanche only on its stages, the giant only on his.
  for (const zn of w.threat.zones ?? []) {
    const st = stages.find((s) => zn[0] >= s.z0 - 1e-6 && zn[1] <= s.end + 1e-6);
    if (!st || (st.type !== 'avalanche' && st.type !== 'intro')) errors.push(`${at}: an avalanche zone ${zn.join('–')} outside an avalanche stage`);
  }
  for (const b of w.bosses ?? []) {
    const st = stages.find((s) => b.zone[0] >= s.start - 1e-6 && b.zone[1] <= s.end + 1e-6);
    if (!st || st.type !== 'giant') errors.push(`${at}: a giant zone ${b.zone.join('–')} outside a giant stage`);
  }
  return errors;
}

export function validateStageWorlds(worlds: WorldsJson, levels: Levels | undefined, tuning: Physics, margin = 0.05): string[] {
  if (!levels) return ['balance.json: levels — required by the stages pace (docs/01-gdd.md 22.2)'];
  return worlds.worlds.flatMap((w) => validateStageWorld(w, levels, tuning, margin));
}

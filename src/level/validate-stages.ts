// What: Level checks of the stages pace (layout stageSlope, docs/01-gdd.md 22): ridges ask for levels, 10–15 stages of one trial each in the order of 22.5, no strip without a trial, 2–3 width changes, mazes with one real exit and 2–3 false ones, one trophy button per finish, the trials passable at v(N), the edge lines on the ground (MU-13).
// Called by: level/validate.ts (validatePack, when worlds-spec.json has layout stageSlope); tests/level/stages.test.ts.
// Keep: Pure; reads worlds.json, balance and tuning only; every message names the mountain and the stage; the physics numbers as stage-slope.ts builds them.

import type { Curve, Segment, TuningJson, World, WorldStage, WorldsJson } from '../content/types.ts';
import { moveSpeed } from '../sim/effects/moveSpeed.ts';
import { levelThreshold, type Levels } from '../sim/levels.ts';
import { STAGE_WIDTH, WAVE, jumpDistance, mazeDistances, padFlight } from './stage-slope.ts';
import type { Aabb, LevelData } from './types.ts';
import { EDGE_RISE, gateSlab, levelLips, ridgePartBox, ridgeParts, zoneLine } from './surface-lines.ts';

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
/** SD-05: a giant that slaps on touch is at least this much slower than v(N) (a dodge, then the hero runs away). */
const GIANT_TOUCH_MARGIN = 0.01;
/** SD-12: two levels below the stage the giant is at least this much faster than the hero (he catches up from behind). */
const GIANT_CATCH_MARGIN = 0.05;

/**
 * SD-12 (docs/01-gdd.md 23.9; producer 16.10: «passing him is easier than easy, after one pass he just stands arms up»):
 * the giant of a stage is a trial of every run — he meets every run (rearm), runs at where the hero was a moment ago
 * (lag: a straight run is caught, a dodge needs its moment) and two levels below the stage (by `level`) he is quicker
 * than the hero; without the speed curve the last rule is not checked.
 */
export function giantErrors(w: World, st: WorldStage, levels: Levels, curve?: Curve): string[] {
  const errors: string[] = [];
  if (st.type !== 'giant') return errors;
  for (const b of (w.bosses ?? []).filter((b) => b.zone[0] >= st.start - 1e-6 && b.zone[1] <= st.end + 1e-6)) {
    if (!b.rearm) errors.push(`stage ${st.n}: the giant meets one run only (rearm expected)`);
    const k2 = b.level ? Math.min(b.level.max, Math.max(b.level.min, b.level.g ** 2)) : 1;
    const v2 = curve ? moveSpeed(levelThreshold(st.level - 2, levels), curve) : 0;
    for (const g of b.giants) {
      if (!((g.lag ?? 0) > 0)) errors.push(`stage ${st.n}: the giant runs at where the hero is (lag expected) — a dodge needs no moment`);
      if (g.slipPast !== false) errors.push(`stage ${st.n}: a straight run slips past the giant (slipPast false expected)`);
      if (curve && g.speed * k2 < v2 * (1 + GIANT_CATCH_MARGIN)) errors.push(`stage ${st.n}: two levels below (v ${round3(v2)}) the giant ${round3(g.speed * k2)} does not catch up`);
    }
  }
  return errors;
}

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

/** MU-13: how far off the ground under it an edge line may lie (its own thickness and float noise). */
export const LINE_TOL = EDGE_RISE + 0.01;
/** The ends of a line are probed this far inside it: at the very end the next floor (a higher step) is the ground. */
const LINE_INSET = 0.01;

/**
 * MU-13 (producer: «on a ramp with a rise the blue edge line hangs in the air over the slope», a repeated bug): every
 * line the renderer lays on the ground lies on it. The lips of the floor edges (SD-07) — as level/surface-lines.ts gives
 * them to the renderer — have both ends and the middle on the ground under them (within LINE_TOL); a melted ridge leaves
 * nothing of its plugs and crest. `lines` — the lips to check (the level's own by default).
 */
export function surfaceLineErrors(level: LevelData, lines = levelLips(level)): string[] {
  const errors: string[] = [];
  for (const l of lines) {
    const alongX = l.max[0] - l.min[0] >= l.max[2] - l.min[2];
    const xm = (l.min[0] + l.max[0]) / 2;
    const zm = (l.min[2] + l.max[2]) / 2;
    const ends: Array<[number, number]> = alongX
      ? [[l.min[0] + LINE_INSET, zm], [xm, zm], [l.max[0] - LINE_INSET, zm]]
      : [[xm, l.min[2] + LINE_INSET], [xm, zm], [xm, l.max[2] - LINE_INSET]];
    for (const [x, z] of ends) {
      const f = level.floorAt(x, z);
      // Off the track (the slanted edge of a width change) floorAt is a far-down sentinel: nothing to check, as SD-02.
      if (!Number.isFinite(f) || Math.abs(l.min[1] - f) <= LINE_TOL) continue;
      errors.push(`edge line at x ${round3(x)} z ${round3(z)} lies ${round3(l.min[1] - f)} ${l.min[1] > f ? 'over' : 'under'} the ground (y ${round3(l.min[1])}, ground ${round3(f)})`);
      break;
    }
  }
  for (const p of ridgeParts(level)) if (ridgePartBox(p, 1)) errors.push(`ridge at z ${round3(level.gates[p.gate]!.z)}: its ${p.crest ? 'crest' : 'plug'} stays when melted`);
  errors.push(...unsupportedErrors(level));
  return errors;
}

/** MU round 3: a drawn box thinner than this is a sheet, not a thing — seen from the side, a line in the air. */
const SHEET = 0.01;

/**
 * MU round 3 (producer, the third time: «a thin light-blue line across the track over a rise»): no geometry without
 * support — the slab of every gate and the line of every giant's zone, as level/surface-lines.ts gives them to the
 * renderer, stand on the ground under them (their middle and both ends within LINE_TOL) and are not a sheet.
 */
export function unsupportedErrors(level: LevelData, boxes = drawnBoxes(level)): string[] {
  const errors: string[] = [];
  for (const { what, box } of boxes) {
    const xm = (box.min[0] + box.max[0]) / 2;
    const zm = (box.min[2] + box.max[2]) / 2;
    if (box.max[1] - box.min[1] < SHEET) {
      errors.push(`${what} at z ${round3(zm)} is a sheet ${round3(box.max[1] - box.min[1])} thick at y ${round3(box.min[1])}`);
      continue;
    }
    for (const [x, z] of [[xm, zm], [box.min[0] + LINE_INSET, zm], [box.max[0] - LINE_INSET, zm]] as const) {
      const f = level.floorAt(x, z);
      if (!Number.isFinite(f) || Math.abs(box.min[1] - f) <= LINE_TOL) continue;
      errors.push(`${what} at x ${round3(x)} z ${round3(z)} stands ${round3(box.min[1] - f)} ${box.min[1] > f ? 'over' : 'under'} the ground (y ${round3(box.min[1])}, ground ${round3(f)})`);
      break;
    }
  }
  return errors;
}

/** The boxes the renderer draws for the gates' slabs and the giants' zone lines. */
function drawnBoxes(level: LevelData): Array<{ what: string; box: Aabb }> {
  const out: Array<{ what: string; box: Aabb }> = [];
  level.gates.forEach((g, i) => {
    const box = gateSlab(g);
    if (box) out.push({ what: `gate ${i} slab`, box });
  });
  level.bosses.forEach((_, i) => {
    const box = zoneLine(level, i);
    if (box) out.push({ what: `giant zone ${i} line`, box });
  });
  return out;
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
  // ST-02: a mountain with a wave starts on its easy tier and meets the giant in its first half (the rest of 22.5 stays).
  const waved = stages.some((s) => s.tier !== undefined);
  if (waved) {
    errors.push(...waveErrors(stages));
    const g = stages.find((s) => s.type === 'giant');
    if (!g || g.n > K / 2) errors.push(`stage ${String(g?.n)} — the giant outside the first half of ${K}`);
  } else {
    if (first !== 'intro' && first !== 'dips' && first !== 'cracks') errors.push(`stage 1 — ${String(first)}, a light one first (dips, cracks)`);
    if (stages[1]?.type !== 'giant') errors.push(`stage 2 — ${String(stages[1]?.type)}, the giant second`);
  }
  for (const st of stages) {
    if (st.type === 'avalanche' && !(st.n > K / 3 && st.n <= Math.ceil((2 * K) / 3))) errors.push(`stage ${st.n} — the avalanche outside the middle third of ${K}`);
    if (st.type === 'maze' && !(st.n > (2 * K) / 3)) errors.push(`stage ${st.n} — the maze outside the last third of ${K}`);
  }
  if (!stages.some((s) => s.type === 'avalanche')) errors.push('no avalanche stage');
  if (!stages.some((s) => s.type === 'maze')) errors.push('no maze stage');
  return errors;
}

/**
 * ST-02 (producer 22.10): the wave of difficulty — every stage has a tier, and the tiers with the repeats folded read
 * easy — mid — hard — mid — easy — very hard — very easy (WAVE).
 */
export function waveErrors(stages: readonly WorldStage[]): string[] {
  const missing = stages.filter((s) => s.tier === undefined).map((s) => s.n);
  if (missing.length > 0) return [`stages ${missing.join(', ')} — no tier of the wave`];
  const fold = stages.map((s) => s.tier!).filter((t, k, a) => k === 0 || a[k - 1] !== t);
  return fold.join(' ') === WAVE.join(' ') ? [] : [`the wave reads ${fold.join(' — ')}, ${WAVE.join(' — ')} expected`];
}

/** ST-05: a step of the ground bigger than this from one sample to the next is a seam (a ramp climbs less per sample). */
export const SEAM_STEP = 0.3;
/** ST-05: ground missing for no longer than this between two grounds is a slit (a crack of a trial is 4 at least). */
export const SLIT_MAX = 2;
/** ST-05: drops past this are the walls of ridges and pits — the trials, their own rules. */
const SEAM_WALL = 3;

/**
 * ST-05 (producer 22.10: «the joins of stages without steps and slits»): along the whole mountain, on lines across the
 * field, the walked ground climbs and falls only by ramps — no step of SEAM_STEP…SEAM_WALL from one sample (0.25) to the
 * next and no slit of ground missing for up to SLIT_MAX between two grounds.
 */
export function seamErrors(level: LevelData, field: number, length: number): string[] {
  const errors: string[] = [];
  const dz = 0.25;
  for (const k of [-0.4, -0.2, 0, 0.2, 0.4]) {
    const x = round3(k * field);
    let prev = level.floorAt(x, 0);
    let lost = -1;
    for (let z = dz; z <= length; z += dz) {
      const f = level.floorAt(x, z);
      if (Number.isFinite(f) && Number.isFinite(prev)) {
        const d = f - prev;
        if (Math.abs(d) > SEAM_STEP && Math.abs(d) < SEAM_WALL) errors.push(`a step ${round3(d)} at x ${x} z ${round3(z)}`);
      }
      if (!Number.isFinite(f) && Number.isFinite(prev)) lost = z;
      if (Number.isFinite(f) && !Number.isFinite(prev) && lost >= 0 && z - lost <= SLIT_MAX) errors.push(`a slit ${round3(z - lost)} at x ${x} z ${round3(lost)}`);
      prev = f;
    }
  }
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
    else if (s.type === 'stairs' && s['stage'] === true) cover.push([z0, z1]);
    else if (s.type === 'slide') cover.push([z0 - num(s, 'length') / 2, z0 + num(s, 'length') / 2]);
    else if (s.type === 'floor' && s['maze'] !== undefined) cover.push([z0, z1]);
    else if (s.type === 'floor' && num(s, 'x1') - num(s, 'x0') <= BRIDGE_WIDTH[1] + 1e-6) cover.push([z0, z1]);
  }
  for (const b of w.bosses ?? []) cover.push([b.zone[0], b.zone[1]]);
  // The avalanche is the trial of its own stage only; on the others (SD-06, a zone of its own delay) it is a push to hurry.
  for (const zn of w.threat.zones ?? []) if (zn[2] === undefined) cover.push([zn[0], zn[1]]);
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
      // SD-05 (docs/01-gdd.md 23.5): a giant that slaps on touch (slipPast false) runs close to v(N) — 1% slower at least.
      for (const g of b.giants) {
        const m = g.slipPast === false ? GIANT_TOUCH_MARGIN : margin;
        if (g.speed * (1 + m) > v * (1 + 1e-6)) errors.push(`stage ${st.n}: the giant ${g.speed} is not ${m * 100}% slower than v(N) ${v}`);
      }
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

export function validateStageWorld(w: World, levels: Levels, tuning: Physics, margin: number, curve?: Curve): string[] {
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
    for (const e of [...fairErrors(w, st, tuning, margin), ...widthErrors(w, st), ...giantErrors(w, st, levels, curve)]) errors.push(`${at}: ${e}`);
  }
  const paid = stages.filter((s) => s.trophies > 0);
  // SD-03 (docs/01-gdd.md 23.3): the reward of a button grows stage by stage.
  for (let k = 1; k < paid.length; k++) if (!(paid[k]!.trophies > paid[k - 1]!.trophies)) errors.push(`${at}: stage ${paid[k]!.n} — ${paid[k]!.trophies} trophies, more than stage ${paid[k - 1]!.n} (${paid[k - 1]!.trophies}) expected (docs/01-gdd.md 23.3)`);
  if (snow > 2) errors.push(`${at}: ${snow} golden snowflakes, 2 at most`);
  // SD-06 (docs/01-gdd.md 23.6): the avalanche on every stage but the giant's (he is its trial), never on the first minute;
  // a zone with its own first delay has a grotto, and from any point of the body a grotto or the safe finish is within
  // the warning at v(N).
  const zones = w.threat.zones ?? [];
  for (const zn of zones) {
    const st = stages.find((s) => zn[0] >= s.z0 - 1e-6 && zn[1] <= s.end + 1e-6);
    if (!st || st.type === 'giant' || st.type === 'maze') errors.push(`${at}: an avalanche zone ${zn.join('–')} outside a stage of its own or on the giant's or the maze`);
  }
  const extra = zones.some((zn) => zn[2] !== undefined);
  for (const st of extra ? stages : []) {
    if (st.type === 'giant' || st.type === 'intro' || st.type === 'avalanche' || st.type === 'maze') continue;
    const zn = zones.find((x) => x[0] >= st.z0 - 1e-6 && x[1] <= st.end + 1e-6);
    const isl = w.segments.filter((s) => s.type === 'island' && s.z >= st.z0 - 1e-6 && s.z <= st.end + 1e-6).map((s) => s.z);
    if (!zn || isl.length === 0) {
      errors.push(`${at}: stage ${st.n} (${st.type}) — no avalanche or no grotto (docs/01-gdd.md 23.6)`);
      continue;
    }
    const marks = [...isl, st.end].sort((a, b) => a - b);
    let far = Math.max(0, marks[0]! - st.start);
    for (let k = 1; k < marks.length; k++) far = Math.max(far, (marks[k]! - marks[k - 1]!) / 2);
    if (far > (w.threat.zoneWarnSec ?? 0) * st.speed + 1e-6) errors.push(`${at}: stage ${st.n} (${st.type}) — ${round3(far)} to the nearest grotto or the finish, more than the warning at v(N)`);
  }
  for (const b of w.bosses ?? []) {
    const st = stages.find((s) => b.zone[0] >= s.start - 1e-6 && b.zone[1] <= s.end + 1e-6);
    if (!st || st.type !== 'giant') errors.push(`${at}: a giant zone ${b.zone.join('–')} outside a giant stage`);
  }
  return errors;
}

export function validateStageWorlds(worlds: WorldsJson, levels: Levels | undefined, tuning: Physics, margin = 0.05, curve?: Curve): string[] {
  if (!levels) return ['balance.json: levels — required by the stages pace (docs/01-gdd.md 22.2)'];
  return worlds.worlds.flatMap((w) => validateStageWorld(w, levels, tuning, margin, curve));
}

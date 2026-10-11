// What: Content checks of the open slope (layout openSlope): ridges and the giant, grottos per lane, fairness per lane, the ground along the passages.
// Called by: level/validate.ts (validatePack branches here for an openSlope pace); tests/content/open.test.ts.
// Keep: Pure like validate.ts: worlds and spec in, messages "worlds.json: … — what is wrong" out; the way to a grotto is sim/shelter.ts groundPath, as in the game.

/**
 * Open slope checks (docs/01-gdd.md 17.2–17.6; docs/01a-content.md 16.1, 16.3, 16.5; docs/02-tech.md 5.4):
 * - structure: ridges then one boss gate at the summit line, the grotto with the belt under every ridge and before the
 *   giant's zone, a flag past every ridge, the giant's zone and `threat.spawnMaxZ` at its start;
 * - the count against worlds-spec.json: sections, ridges, the giant, gifts on the path, threat numbers, portals;
 * - shelters on every lane no farther apart than the section's `shelterEvery`;
 * - fairness on every lane of every fork: from any point the nearest reachable grotto (through open ridges only, round
 *   the fork cliff) takes ≤ warnSec × 0.8 at the minimum speed of the section — the stat of the ridge below, without the
 *   newbie bonus; the camp and the giant's zone (above spawnMaxZ) are safe;
 * - the ground along every passage line runs from the camp to the summit without a hole or a step above stepUp.
 */
import type { OpenSpecJson, Segment, TuningJson, World, WorldsJson } from '../content/types.ts';
import type { LevelData } from './types.ts';
import { buildLevel } from './builder.ts';
import { forkRange, OPEN_SLOPE } from './open-slope.ts';
import { groundPath } from '../sim/shelter.ts';

const num = (s: Segment, key: string): number => (typeof s[key] === 'number' ? (s[key] as number) : NaN);
const sorted = (w: World, type: string): Segment[] => w.segments.filter((s) => s.type === type).sort((a, b) => a.z - b.z);

export function isOpenWorlds(worlds: WorldsJson): boolean {
  return worlds.worlds.length > 0 && worlds.worlds.every((w) => w.layout === 'openSlope');
}

/** Structure of one mountain of the open slope. */
export function validateOpenWorld(w: World, at: string): string[] {
  const errors: string[] = [];
  const gates = sorted(w, 'gate');
  const niches = sorted(w, 'niche');
  const flags = sorted(w, 'checkpoint');
  const S = gates.length - 1;
  const last = gates[S];
  if (!last || last['kind'] !== 'boss' || last['boss'] !== true) errors.push(`${at}: the last gate must be the giant's (kind "boss", boss: true)`);
  if (w.zones.length !== S + 1) errors.push(`${at}: zones — ${w.zones.length}, expected ${S + 1} (a zone a section and the finish straight)`);
  const camp = w.safeZones[0]?.[1] ?? 0;
  for (let i = 1; i <= S; i++) {
    const g = gates[i - 1] as Segment;
    if (g['kind'] !== 'ridge') errors.push(`${at}: gate ${i} — kind "${String(g['kind'])}", expected "ridge"`);
    if (!Array.isArray(g['passes']) || (g['passes'] as unknown[]).length < 2) errors.push(`${at}: ridge ${i} — needs 2–3 passages (docs/01-gdd.md 17.3)`);
    if (num(g, 'zone') !== i) errors.push(`${at}: ridge ${i} — zone ${num(g, 'zone')}, expected ${i}`);
    const z0 = i === 1 ? camp : (gates[i - 2] as Segment).z;
    const inSection = niches.filter((n) => n.z > z0 && n.z < g.z);
    const under = inSection[inSection.length - 1];
    const zone = w.zones.find((zz) => zz.k === i);
    if (!under || under['kind'] !== 'ridgeGrotto') errors.push(`${at}: section ${i} — the last shelter before ridge ${i} must be its grotto with the belt (kind "ridgeGrotto")`);
    else if (num(under, 'treadmill') !== zone?.stepMult) errors.push(`${at}: grotto of ridge ${i} — belt ×${num(under, 'treadmill')}, the section multiplier is ×${String(zone?.stepMult)} (docs/01-gdd.md 17.4)`);
    for (const n of inSection) {
      if (n['kind'] === 'grotto' && num(n, 'treadmill') > 0) errors.push(`${at}: grotto at z=${n.z} — a small grotto has no belt (docs/01-gdd.md 17.5)`);
      if (!(num(n, 'depth') >= 3) || !(num(n, 'length') >= 6)) errors.push(`${at}: niche at z=${n.z} — depth ≥ 3 and length ≥ 6 (docs/02-tech.md 8.2)`);
    }
    if (i >= 2 && !flags.some((c) => num(c, 'wall') === i - 1 && c.z > z0 && c.z < g.z)) errors.push(`${at}: section ${i} — no flag past ridge ${i - 1}`);
  }
  const prev = w.zones.map((zz) => zz.stepMult ?? NaN);
  prev.forEach((m, k) => {
    if (!(m >= 1)) errors.push(`${at}: zones[${k}].stepMult — ${m}, expected ≥ 1 (docs/01-gdd.md 17.4)`);
    if (k > 0 && m < (prev[k - 1] ?? 0)) errors.push(`${at}: zones[${k}].stepMult — ×${m} below the section before (×${prev[k - 1]})`);
  });

  const boss = w.bosses?.[0];
  const ridgeZ = (gates[S - 1] as Segment | undefined)?.z ?? camp;
  if (!boss) errors.push(`${at}: bosses — the open slope needs the giant's zone (docs/01-gdd.md 17.6)`);
  else {
    const [a, b] = boss.zone;
    if (!(a > ridgeZ && b > a && last && b <= last.z + 1e-9)) errors.push(`${at}: bosses[0].zone — ${a}–${b} must lie between the last ridge (z=${ridgeZ}) and the summit line`);
    if (boss.giants.length < 1 || boss.giants.some((g) => !(g.speed > 0))) errors.push(`${at}: bosses[0].giants — at least one giant with a speed > 0`);
    if (w.threat.spawnMaxZ !== a) errors.push(`${at}: threat.spawnMaxZ — ${String(w.threat.spawnMaxZ)}, the start of the giant's zone is ${a} (docs/01-gdd.md 17.5)`);
    const line = niches.find((n) => n['kind'] === 'bossLine');
    const finish = w.zones[w.zones.length - 1];
    if (!line || !(line.z > ridgeZ && line.z + num(line, 'length') / 2 <= a)) errors.push(`${at}: no grotto with the belt (kind "bossLine") between the last ridge and the giant's zone`);
    else if (num(line, 'treadmill') !== finish?.stepMult) errors.push(`${at}: grotto before the giant — belt ×${num(line, 'treadmill')}, the finish multiplier is ×${String(finish?.stepMult)}`);
  }
  if (!flags.some((c) => num(c, 'wall') === S + 1)) errors.push(`${at}: no flag on the summit (wall ${S + 1})`);
  return errors;
}

/** The count of docs/01a-content.md 16.1–16.2 against the generated mountains, shelters per lane by `shelterEvery`. */
export function validateOpenCount(worlds: WorldsJson, spec: OpenSpecJson): string[] {
  const errors: string[] = [];
  if (worlds.worlds.length !== spec.mountains.length) errors.push(`worlds.json: worlds — ${worlds.worlds.length} mountains, worlds-spec.json has ${spec.mountains.length} (npm run gen:worlds)`);
  for (const [mi, m] of spec.mountains.entries()) {
    const w = worlds.worlds[mi];
    if (!w) continue;
    const at = `worlds.json: worlds[${mi}] (${w.id})`;
    if (w.id !== m.id) errors.push(`${at}: id — worlds-spec.json has "${m.id}"`);
    const gates = sorted(w, 'gate');
    if (gates.length !== m.ridges.length + 1) errors.push(`${at}: gates — ${gates.length}, expected ${m.ridges.length} ridges and the giant`);
    m.ridges.forEach((r, i) => {
      const g = gates[i];
      if (g && num(g, 'requires') !== r.requires) errors.push(`${at}: ridge ${i + 1} — requires ${num(g, 'requires')}, worlds-spec.json has ${r.requires}`);
    });
    const bossGate = gates[gates.length - 1];
    if (bossGate && num(bossGate, 'requires') !== m.boss.requires) errors.push(`${at}: the giant — advice ${num(bossGate, 'requires')}, worlds-spec.json has ${m.boss.requires}`);
    if (w.bosses?.[0]?.giants[0]?.speed !== m.boss.speed) errors.push(`${at}: the giant — speed ${String(w.bosses?.[0]?.giants[0]?.speed)}, worlds-spec.json has ${m.boss.speed}`);
    m.sections.forEach((sec, i) => {
      const zone = w.zones[i];
      if (!zone) return;
      if (zone.zEnd - zone.zStart !== sec.length) errors.push(`${at}: section ${i + 1} — length ${zone.zEnd - zone.zStart}, worlds-spec.json has ${sec.length}`);
      if (zone.stepMult !== sec.stepMult || zone.gift !== sec.gift) errors.push(`${at}: section ${i + 1} — ×${String(zone.stepMult)} and gift ${zone.gift}, worlds-spec.json has ×${sec.stepMult} and ${sec.gift}`);
      const gifts = w.segments.filter((s) => s.type === 'gift' && s['path'] === true && num(s, 'zone') === i + 1);
      const places = new Set(gifts.map((s) => s.z)).size;
      if (places !== OPEN_SLOPE.pathGifts) errors.push(`${at}: section ${i + 1} — ${places} gift places on the path, expected ${OPEN_SLOPE.pathGifts} (docs/01a-content.md 16.2)`);
      for (const s of gifts) {
        const want = s['lane'] === 'bold' ? 2 * sec.gift : sec.gift;
        if (num(s, 'coins') !== want) errors.push(`${at}: gift at z=${s.z} — ${num(s, 'coins')} coins, expected ${want}`);
      }
      const forks = w.segments.filter((s) => s.type === 'fork' && num(s, 'section') === i + 1);
      if (sec.fork !== forks.length > 0) errors.push(`${at}: section ${i + 1} — fork ${forks.length > 0}, worlds-spec.json has ${sec.fork}`);
      for (const f of forks) {
        const [a, b] = forkRange(zone.zStart, sec.length);
        if (f.z !== a || f.z + num(f, 'length') !== b) errors.push(`${at}: fork of section ${i + 1} — z ${f.z}–${f.z + num(f, 'length')}, expected ${a}–${b} (5–40%, 60–120 units)`);
      }
      errors.push(...shelterSpacing(w, i + 1, sec.shelterEvery, at));
    });
    const finish = w.segments.filter((s) => s.type === 'gift' && s['path'] === true && num(s, 'zone') === m.sections.length + 1);
    if (finish.length !== OPEN_SLOPE.bossGifts) errors.push(`${at}: finish straight — ${finish.length} gifts on the path, expected ${OPEN_SLOPE.bossGifts}`);
    for (const key of ['intervalSec', 'warnSec', 'speed'] as const)
      if (w.threat[key] !== m[key]) errors.push(`${at}: threat.${key} — ${w.threat[key]}, worlds-spec.json has ${m[key]}`);
    const first = m.firstIntervalSec ?? spec.threat.firstIntervalSec;
    if (w.threat.firstIntervalSec !== first) errors.push(`${at}: threat.firstIntervalSec — ${w.threat.firstIntervalSec}, worlds-spec.json has ${first}`);
    const portal = w.segments.find((s) => s.type === 'portal');
    const next = mi + 1 < spec.mountains.length ? mi + 2 : null;
    if (portal && (portal['next'] ?? null) !== next) errors.push(`${at}: portal — leads to ${String(portal['next'])}, expected ${String(next)}`);
  }
  return errors;
}

/** Lines that stand for the lanes: the left and the right half of the slope (on a fork — the two lanes). */
const LANES = [
  { name: 'left', x: -OPEN_SLOPE.laneX },
  { name: 'right', x: OPEN_SLOPE.laneX },
] as const;

/** A grotto serves a lane line unless it sits on a fork on the other side of the cliff. */
function serves(n: Segment, lineX: number): boolean {
  if (n['lane'] === undefined) return true;
  return (n['side'] === 'left') === lineX < 0;
}

/** Shelters of section i on each lane no farther apart than `every` (from the grotto under the ridge below, or the camp). */
function shelterSpacing(w: World, i: number, every: number, at: string): string[] {
  const errors: string[] = [];
  const gates = sorted(w, 'gate');
  const camp = w.safeZones[0]?.[1] ?? 0;
  const z0 = i === 1 ? camp : (gates[i - 2] as Segment).z;
  const z1 = (gates[i - 1] as Segment).z;
  const niches = sorted(w, 'niche');
  for (const lane of LANES) {
    const below = i === 1 ? camp : (niches.filter((n) => n.z < z0).pop()?.z ?? z0);
    const list = [below, ...niches.filter((n) => n.z > z0 && n.z < z1 && serves(n, lane.x)).map((n) => n.z)];
    for (let k = 1; k < list.length; k++) {
      const gap = (list[k] as number) - (list[k - 1] as number);
      if (gap > every + 1e-6) errors.push(`${at}: section ${i}, ${lane.name} lane — shelters ${gap.toFixed(1)} units apart (z=${list[k - 1]}→${list[k]}), above shelterEvery ${every} (docs/01a-content.md 16.3)`);
    }
  }
  return errors;
}

/** Share of warnSec the run to shelter may take (docs/02-tech.md 5.4; docs/01-gdd.md 4.3). */
export const OPEN_FAIRNESS_SHARE = 0.8;

export interface OpenFairnessRow {
  world: string;
  worstSec: number;
  worstZ: number;
  worstX: number;
  limitSec: number;
}

/**
 * Fairness on every lane (docs/01a-content.md 16.3): points every unit along the lines x = ±laneX and x = 0 off the
 * fork cliffs, from the camp up to the start of the giant's zone. Reachable: grottos of the hero's section and of the
 * section below (its ridge is open), the camp from section 1, the safe line spawnMaxZ from the finish straight.
 * Speed: the stat of the ridge below (section 1 — the giant's advice of the mountain before, 0 on mountain 1).
 */
export function openFairnessReport(worlds: WorldsJson, speedAt: (stat: number) => number): OpenFairnessRow[] {
  let carried = 0;
  return worlds.worlds.map((w) => {
    const level = buildLevel(w);
    const gates = sorted(w, 'gate');
    const camp = w.safeZones[0]?.[1] ?? 0;
    const safeLine = w.threat.spawnMaxZ ?? w.length;
    const cliffs = level.boxes.filter((b) => b.kind === 'cliff');
    let worstSec = 0;
    let worstZ = 0;
    let worstX = 0;
    for (let i = 1; i <= gates.length; i++) {
      const zLo = i === 1 ? camp : (gates[i - 2] as Segment).z;
      const zHi = Math.min((gates[i - 1] as Segment).z, safeLine);
      const zBelow = i <= 2 ? -Infinity : (gates[i - 3] as Segment).z;
      const speed = speedAt(i === 1 ? carried : num(gates[i - 2] as Segment, 'requires'));
      const caves = level.niches.filter((n) => n.z > Math.max(zBelow, camp) && n.z < (gates[i - 1] as Segment).z);
      for (let z = zLo; z <= zHi; z += 1) {
        for (const x of [-OPEN_SLOPE.laneX, 0, OPEN_SLOPE.laneX]) {
          if (cliffs.some((c) => x >= c.min[0] && x <= c.max[0] && z >= c.min[2] && z <= c.max[2])) continue;
          let best = i === 1 ? Math.max(0, z - camp) : Infinity;
          if (z >= safeLine) best = 0;
          else if (i === gates.length) best = Math.min(best, safeLine - z);
          for (const n of caves) best = Math.min(best, distToMouth(level, n, x, z));
          const sec = best / speed;
          if (sec > worstSec) {
            worstSec = sec;
            worstZ = z;
            worstX = x;
          }
        }
      }
    }
    carried = num(gates[gates.length - 1] as Segment, 'requires');
    return { world: w.id, worstSec, worstZ, worstX, limitSec: w.threat.warnSec * OPEN_FAIRNESS_SHARE };
  });
}

function distToMouth(level: LevelData, n: LevelData['niches'][number], x: number, z: number): number {
  const ex = (n.side === 'left' ? -1 : 1) * (level.width / 2);
  const tz = Math.min(n.box.max[2], Math.max(n.box.min[2], z));
  return groundPath(level, x, z, ex, tz);
}

export function validateOpenFairness(worlds: WorldsJson, speedAt: (stat: number) => number): string[] {
  return openFairnessReport(worlds, speedAt)
    .map((r, wi) => ({ r, wi }))
    .filter(({ r }) => r.worstSec > r.limitSec)
    .map(
      ({ r, wi }) =>
        `worlds.json: worlds[${wi}] (${r.world}): grotto fairness — from x=${r.worstX}, z=${r.worstZ} the nearest shelter is ${r.worstSec.toFixed(2)} s away, above warnSec × ${OPEN_FAIRNESS_SHARE} = ${r.limitSec.toFixed(2)} s`,
    );
}

/**
 * The ground of the open slope (docs/02-tech.md 5.4): along every passage line from the camp to the summit no hole and
 * no step above stepUp (a ramp climbs the ridge in its passage); grotto floors at the height of the ground at their mouth;
 * every gap (a crevasse, 17.7) shorter than 60% of the jump at the minimum speed of its section (the stat of the ridge below).
 */
export function validateOpenGround(worlds: WorldsJson, tuning: TuningJson, speedAt: (stat: number) => number): string[] {
  const errors: string[] = [];
  const stepUp = tuning.controller.stepUp;
  let carried = 0;
  for (const [wi, w] of worlds.worlds.entries()) {
    const at = `worlds.json: worlds[${wi}] (${w.id})`;
    const level = buildLevel(w);
    const gates = sorted(w, 'gate');
    for (const gap of w.segments.filter((s) => s.type === 'gap')) {
      const below = gates.filter((g) => g.z <= gap.z).pop();
      const v = speedAt(below ? num(below, 'requires') : carried);
      const reach = (0.6 * v * 2 * tuning.controller.jumpSpeed) / tuning.controller.gravity;
      if (num(gap, 'length') > reach) errors.push(`${at}: gap at z=${gap.z} — ${num(gap, 'length')} units, above 60% of the jump at ${v.toFixed(1)} units/s (${reach.toFixed(1)})`);
    }
    carried = num(gates[gates.length - 1] as Segment, 'requires');
    for (const x of OPEN_SLOPE.passes) {
      let prev = level.floorAt(x, 0);
      for (let z = 0.5; z <= w.length; z += 0.5) {
        const y = level.floorAt(x, z);
        if (y === -Infinity) {
          errors.push(`${at}: hole in the ground at x=${x}, z=${z}`);
          break;
        }
        if (Math.abs(y - prev) > stepUp) {
          errors.push(`${at}: step of ${Math.abs(y - prev).toFixed(2)} at x=${x}, z=${z} above stepUp ${stepUp}`);
          break;
        }
        prev = y;
      }
    }
    for (const n of level.niches) {
      const ex = (n.side === 'left' ? -1 : 1) * (level.width / 2);
      const ground = level.floorAt(ex, n.z);
      if (Math.abs(ground - n.y) > 0.01) errors.push(`${at}: grotto at z=${n.z} — floor ${n.y}, the ground at its mouth is ${ground}`);
    }
  }
  return errors;
}

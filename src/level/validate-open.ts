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
import { buildLevel, GATE_THICKNESS } from './builder.ts';
import { PAD_SIZE, TICK, padArc } from './pad-arc.ts';
import { HERO_HEIGHT, HERO_RADIUS } from '../sim/controller.ts';
import { forkRange, OPEN_SLOPE } from './open-slope.ts';
import { humpArc, SLOTS } from './open-shapes.ts';
import { distToEntrance, entranceX, groundPath } from '../sim/shelter.ts';

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
      const shaped = (sec.shape ?? []).length > 0;
      const tunnelFork = (sec.shape ?? []).includes('tunnel');
      for (const s of gifts) {
        // The field past a throat ×fieldGifts, the open lane of a tunnel ×openGifts (docs/01a-content.md 17.2).
        const want =
          s['field'] === true
            ? Math.round((spec.shapes?.throat.fieldGifts ?? 1) * sec.gift)
            : s['lane'] === 'bold'
              ? (tunnelFork ? (spec.shapes?.tunnel.openGifts ?? 2) : 2) * sec.gift
              : sec.gift;
        if (num(s, 'coins') !== want) errors.push(`${at}: gift at z=${s.z} — ${num(s, 'coins')} coins, expected ${want}`);
      }
      const forks = w.segments.filter((s) => s.type === 'fork' && num(s, 'section') === i + 1);
      if (!!sec.fork !== forks.length > 0) errors.push(`${at}: section ${i + 1} — fork ${forks.length > 0}, worlds-spec.json has ${JSON.stringify(sec.fork)}`);
      const split = typeof sec.fork === 'object' && sec.fork.kind === 'split' && spec.forkSplit ? sec.fork : null;
      for (const f of forks) {
        if (split) {
          // SP-05 (docs/01-gdd.md 20.5): a split fork starts in its slot, is length[0]–length[1] long (a tunnel or a hump
          // takes what it needs), the lanes meet `converge` before the ridge and before the approach rise.
          const len = num(f, 'length');
          const lo = zone.zStart + (shaped ? SLOTS.fork[0] : OPEN_SLOPE.fork.start) * sec.length - 1e-6;
          const hi = zone.zStart + (shaped ? SLOTS.fork[1] : SLOTS.fork[1]) * sec.length + 1e-6;
          const plain = !(sec.shape ?? []).some((k) => k === 'tunnel' || k === 'hump');
          const zA = zone.zStart + OPEN_SLOPE.approach.start * sec.length;
          if (f.z < lo || f.z > hi) errors.push(`${at}: fork of section ${i + 1} — starts at z ${f.z}, outside its slot`);
          if (len < split.length[0] - 1e-6 || (plain && len > split.length[1] + 1e-6)) errors.push(`${at}: fork of section ${i + 1} — ${len} units long, not ${split.length[0]}–${split.length[1]} (docs/01a-content.md 19.3)`);
          if (f.z + len > Math.min(zA - 4, zone.zEnd - spec.forkSplit!.converge) + 1e-6) errors.push(`${at}: fork of section ${i + 1} — its lanes meet at z ${f.z + len}, not ${spec.forkSplit!.converge} before the ridge and before the approach rise`);
          if (w.segments.some((t) => t.type === 'taper' && f.z < t.z + num(t, 'length') && f.z + len > t.z)) errors.push(`${at}: fork of section ${i + 1} — its crevasse starts on a change of width (its floor is one slab)`);
          if (num(f, 'between') !== split.between) errors.push(`${at}: fork of section ${i + 1} — crevasse ${num(f, 'between')} wide, worlds-spec.json has ${split.between}`);
          continue;
        }
        if (shaped) {
          // With elements the fork stands in its slot 40–75% (docs/01-gdd.md 18.6); a tunnel or a hump makes it longer.
          const lo = zone.zStart + SLOTS.fork[0] * sec.length - 1e-6;
          const hi = zone.zStart + SLOTS.fork[1] * sec.length + 1e-6;
          const plain = !(sec.shape ?? []).some((k) => k === 'tunnel' || k === 'hump');
          if (f.z < lo || f.z > hi || (plain && f.z + num(f, 'length') > hi)) errors.push(`${at}: fork of section ${i + 1} — z ${f.z}–${f.z + num(f, 'length')}, outside its slot 40–75% (docs/01-gdd.md 18.6)`);
          continue;
        }
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

/**
 * Elements of the slope (docs/01-gdd.md 18.1–18.3, 18.6; docs/01a-content.md 17.1): an element no earlier than its
 * mountain (`shapeFrom`); in worlds.json each section has the elements of its spec in their slots — a throat starting in
 * 5–25%, a chasm in 25–40% past it, a tunnel or a hump inside the fork, its landing grotto by 80%; the field grotto past a
 * throat no farther than `fieldGrotto`.
 */
export function validateOpenShapes(worlds: WorldsJson, spec: OpenSpecJson): string[] {
  const errors: string[] = [];
  const from = spec.shapeFrom;
  for (const [mi, m] of spec.mountains.entries()) {
    m.sections.forEach((sec, si) => {
      for (const k of sec.shape ?? []) {
        if (!from || !spec.shapes) errors.push(`worlds-spec.json: mountains[${mi}] (${m.id}), section ${si + 1} — ${k} needs shapeFrom and shapes in the root`);
        else if (mi + 1 < from[k]) errors.push(`worlds-spec.json: mountains[${mi}] (${m.id}), section ${si + 1} — ${k} on mountain ${mi + 1}, allowed from mountain ${from[k]} (shapeFrom, docs/01-gdd.md 18.2)`);
      }
      if ((sec.shape ?? []).some((k) => k === 'tunnel' || k === 'hump') && !sec.fork) errors.push(`worlds-spec.json: mountains[${mi}] (${m.id}), section ${si + 1} — a tunnel or a hump stands on a fork: fork must be true`);
    });
    const w = worlds.worlds[mi];
    if (!w) continue;
    const at = `worlds.json: worlds[${mi}] (${w.id})`;
    const niches = sorted(w, 'niche');
    // Grottos `shapes.grotto.width` long from its mountain (docs/01-gdd.md 18.8 item 3: the camera has room).
    const gw = spec.shapes?.grotto;
    if (gw && mi + 1 >= gw.fromWorld)
      for (const n of niches) if (n['kind'] === 'grotto' && num(n, 'length') !== gw.width) errors.push(`${at}: grotto at z=${n.z} — ${num(n, 'length')} long, shapes.grotto.width is ${gw.width}`);
    m.sections.forEach((sec, si) => {
      const j = si + 1;
      const zone = w.zones[si];
      if (!zone) return;
      const L = sec.length;
      const share = (z: number): number => (z - zone.zStart) / L;
      const marks = w.segments.filter((s) => (s.type === 'chasm' || s.type === 'throat' || s.type === 'tunnel' || s.type === 'hump') && num(s, 'section') === j);
      const want = [...(sec.shape ?? [])].sort().join('+') || '—';
      const have = marks.map((s) => s.type).sort().join('+') || '—';
      if (want !== have) errors.push(`${at}: section ${j} — elements ${have}, worlds-spec.json has ${want} (npm run gen:worlds)`);
      const one = (t: string): Segment | undefined => marks.find((s) => s.type === t);
      const th = one('throat');
      const ch = one('chasm');
      const fork = w.segments.find((s) => s.type === 'fork' && num(s, 'section') === j);
      const eps = 1e-6;
      if (th) {
        const end = th.z + num(th, 'length');
        if (share(th.z) < SLOTS.throat[0] - eps || share(th.z) > SLOTS.throat[1] + eps) errors.push(`${at}: section ${j} — the throat starts at ${(share(th.z) * 100).toFixed(0)}%, its slot is 5–25% (docs/01-gdd.md 18.6)`);
        const field = niches.filter((n) => n.z > end && n.z - num(n, 'length') / 2 - end <= (spec.shapes?.throat.fieldGrotto ?? 20) + eps);
        if (field.length === 0) errors.push(`${at}: section ${j} — no field grotto within ${spec.shapes?.throat.fieldGrotto ?? 20} units past the throat exit z=${end}`);
      }
      if (ch) {
        if (share(ch.z) < SLOTS.chasm[0] - eps || share(ch.z) > SLOTS.chasm[1] + eps) errors.push(`${at}: section ${j} — the chasm at ${(share(ch.z) * 100).toFixed(0)}%, its slot is 25–40% (docs/01-gdd.md 18.6)`);
        if (th && ch.z < th.z + num(th, 'length')) errors.push(`${at}: section ${j} — the chasm at z=${ch.z} overlaps the throat`);
        const pads = w.segments.filter((s) => s.type === 'jumpPad' && s['shape'] === 'chasm' && s.z < ch.z && s.z > ch.z - 20);
        if (pads.length < OPEN_SLOPE.passes.length) errors.push(`${at}: section ${j} — the chasm at z=${ch.z} has ${pads.length} trampolines, one on every lane is needed (docs/01-gdd.md 18.3)`);
      }
      for (const t of ['tunnel', 'hump'] as const) {
        const e = one(t);
        if (!e) continue;
        if (!fork || e.z < fork.z || e.z + num(e, 'length') > fork.z + num(fork, 'length') + eps) errors.push(`${at}: section ${j} — the ${t} at z=${e.z} is not inside its fork`);
        if (fork && (e['side'] === fork['bold']) !== (t === 'hump')) errors.push(`${at}: section ${j} — the ${t} is on the ${t === 'hump' ? 'calm' : 'bold'} lane (a tunnel is the calm lane, a hump the bold one)`);
        if ((ch && e.z < ch.z + num(ch, 'length')) || (th && e.z < th.z + num(th, 'length'))) errors.push(`${at}: section ${j} — the ${t} at z=${e.z} overlaps an element below it`);
      }
      // A tunnel opens at both ends (docs/01-gdd.md 18.3): ground in front of each mouth at its floor, nothing solid there.
      const tu = one('tunnel');
      if (tu) {
        const level = buildLevel(w);
        const n = level.niches.find((x) => x.kind === 'tunnel' && Math.abs(x.box.min[2] - tu.z) < 1e-6);
        if (n) {
          const mx = (n.box.min[0] + n.box.max[0]) / 2;
          for (const [name, zm] of [['entry', n.box.min[2] - 2], ['exit', n.box.max[2] + 2]] as const) {
            const blocked = level.boxes.some((b) => b.solid && b.kind !== 'floor' && mx > b.min[0] && mx < b.max[0] && zm > b.min[2] && zm < b.max[2] && n.y + 1 > b.min[1] && n.y + 1 < b.max[1]);
            if (blocked || Math.abs(level.floorAt(mx, zm) - n.y) > 0.01) errors.push(`${at}: section ${j} — the tunnel has no open ${name} at z=${zm} on its lane`);
          }
        }
      }
      const hu = one('hump');
      if (hu) {
        const landEnd = num(hu, 'landEnd');
        const grotto = niches.find((n) => n['side'] === hu['side'] && n.z > landEnd && n.z - num(n, 'length') / 2 - landEnd <= 2 + eps);
        if (!grotto) errors.push(`${at}: section ${j} — no landing grotto right past the hump's landing (z=${landEnd})`);
        else if (share(grotto.z) > SLOTS.landing + eps) errors.push(`${at}: section ${j} — the landing grotto at ${(share(grotto.z) * 100).toFixed(0)}%, by 80% (docs/01-gdd.md 18.6)`);
      }
    });
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

/**
 * Shelters of section i on each lane no farther apart than `every` (from the grotto under the ridge below, or the camp).
 * Elements (docs/01-gdd.md 18.3): a tunnel shelters its lane along its whole length; a throat, a chasm and (on its bold
 * lane) a hump hold no grotto, so a gap across one may be longer by its length — its fairness is checked by seconds.
 */
function shelterSpacing(w: World, i: number, every: number, at: string): string[] {
  const errors: string[] = [];
  const gates = sorted(w, 'gate');
  const camp = w.safeZones[0]?.[1] ?? 0;
  const z0 = i === 1 ? camp : (gates[i - 2] as Segment).z;
  const z1 = (gates[i - 1] as Segment).z;
  // Grottos in rocks (SP-04) shelter too: a rock on a fork serves its lane (its side by x).
  const rocks = sorted(w, 'island').map((r) => ({ ...r, side: num(r, 'x') < 0 ? 'left' : 'right' }));
  const niches = [...sorted(w, 'niche'), ...rocks].sort((a, b) => a.z - b.z);
  const inSection = (s: Segment): boolean => num(s, 'section') === i;
  const tunnels = w.segments.filter((s) => s.type === 'tunnel' && inSection(s));
  const g = num(sorted(w, 'niche').find((n) => n['kind'] === 'grotto') ?? ({ length: OPEN_SLOPE.grotto.length } as unknown as Segment), 'length') / 2 + 1;
  const holes = w.segments
    .filter((s) => (s.type === 'throat' || s.type === 'chasm' || s.type === 'hump') && inSection(s))
    .map((s) => ({ a: s.z - g, b: s.z + num(s, 'length') + g, side: s.type === 'hump' ? (s['side'] as string) : null }));
  for (const lane of LANES) {
    const below = i === 1 ? camp : (niches.filter((n) => n.z < z0).pop()?.z ?? z0);
    const list = [below, ...niches.filter((n) => n.z > z0 && n.z < z1 && serves(n, lane.x)).map((n) => n.z)];
    const inside: Array<[number, number]> = [];
    for (const t of tunnels)
      if ((t['side'] === 'left') === lane.x < 0) {
        list.push(t.z, t.z + num(t, 'length'));
        inside.push([t.z, t.z + num(t, 'length')]);
      }
    list.sort((a, b) => a - b);
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1] as number;
      const b = list[k] as number;
      if (inside.some(([p, q]) => a >= p && b <= q)) continue;
      const allow = holes.filter((h) => (h.side === null || (h.side === 'left') === lane.x < 0) && h.b > a && h.a < b).reduce((sum, h) => sum + (h.b - h.a), 0);
      const gap = b - a;
      if (gap > every + allow + 1e-6) errors.push(`${at}: section ${i}, ${lane.name} lane — shelters ${gap.toFixed(1)} units apart (z=${a}→${b}), above shelterEvery ${every} (docs/01a-content.md 16.3)`);
    }
  }
  return errors;
}

/**
 * The giant's advice is honest (docs/01-gdd.md 17.6): the run speed of the advice number beats every giant of the zone ×
 * (1 + margin) — with that Speed the zone is passed; the giant is no faster than the ceiling of the run allows.
 */
export function validateOpenBoss(worlds: WorldsJson, speedAt: (stat: number) => number, margin: number): string[] {
  const errors: string[] = [];
  for (const [wi, w] of worlds.worlds.entries()) {
    for (const [zi, b] of (w.bosses ?? []).entries()) {
      // With helpers (docs/01-gdd.md 18.5, F12): the advice passes even slowed by a snowball at the meeting.
      const slow = Math.min(1, ...(b.helpers ?? []).map((h) => h.slow));
      const v = speedAt(b.requires) * slow;
      for (const g of b.giants)
        if (!(v > g.speed * (1 + margin)))
          errors.push(`worlds.json: worlds[${wi}] (${w.id}): bosses[${zi}] — the advice ${b.requires}${slow < 1 ? ` slowed × ${slow}` : ''} runs ${v.toFixed(2)} units/s, not above the giant ${g.speed} × ${1 + margin} = ${(g.speed * (1 + margin)).toFixed(2)}`);
    }
  }
  return errors;
}

/**
 * Fun of the open slope (docs/01-gdd.md 17.7; docs/02-tech.md 5.4): a trampoline's arc at the minimum speed of its section
 * and at the ceiling of the run stays on the track, lands before the next ridge and never meets a grotto; an ice slide
 * lies flat inside its section on the track.
 */
export function validateOpenFun(worlds: WorldsJson, tuning: TuningJson, speedAt: (stat: number) => number): string[] {
  const errors: string[] = [];
  let carried = 0;
  for (const [wi, w] of worlds.worlds.entries()) {
    const at = `worlds.json: worlds[${wi}] (${w.id})`;
    const level = buildLevel(w);
    const gates = sorted(w, 'gate');
    const caveBoxes = level.boxes.filter((b) => b.kind.startsWith('niche'));
    // Nothing tall in a flight (docs/01-gdd.md 18.3: «not into a cliff»): fork cliffs, ledges, throat and tunnel walls.
    const tall = level.boxes.filter((b) => b.solid && ['cliff', 'ledgeCliff', 'throatWall', 'tunnelWall', 'tunnelRoof'].includes(b.kind));
    // The edge where it lies (SP-04: every section its own width).
    const half = (z: number): number => level.halfAt(z);
    for (const p of w.segments.filter((s) => s.type === 'jumpPad')) {
      const below = gates.filter((g) => g.z <= p.z);
      const next = gates[below.length];
      const x = num(p, 'x');
      const where = `${at}: trampoline at z=${p.z}`;
      if (Math.abs(x) + PAD_SIZE / 2 > half(p.z)) errors.push(`${where} — off the track`);
      if (!next) {
        errors.push(`${where} — no ridge above it`);
        continue;
      }
      const vmin = speedAt(below.length ? num(below[below.length - 1] as Segment, 'requires') : carried);
      // The hump's pad (docs/01-gdd.md 18.3) throws off the slide boost with its own forward push.
      const hump = p['slide'] === true;
      const fly = (v: number): ReturnType<typeof padArc> => {
        const rear = p.z - num(p, 'length') / 2 + (v * TICK) / 2;
        return hump ? humpArc(rear, num(p, 'y'), v, num(p, 'forward'), tuning, (z) => level.floorAt(x, z)) : padArc(rear, num(p, 'y'), v, tuning, (z) => level.floorAt(x, z), w.length);
      };
      if (p['shape'] === 'chasm') {
        // Over the chasm at the minimum speed of the section, 2 units past its far edge (docs/01a-content.md 17.2).
        const ch = (level.shapes ?? []).find((c) => c.kind === 'chasm' && c.z0 > p.z && c.z0 - p.z < 20);
        const land = fly(vmin).landZ;
        if (!ch) errors.push(`${where} — a chasm trampoline without its chasm`);
        else if (land - HERO_RADIUS < ch.z1 + 2) errors.push(`${where} — at ${vmin.toFixed(1)} units/s it lands at z=${land.toFixed(1)}, not 2 units past the chasm edge z=${ch.z1}`);
      }
      if (hump) {
        // Into the landing at the minimum and the top speed of the section; flight plus the run to the landing grotto ≤
        // warnSec × 0.8 (docs/01-gdd.md 18.3).
        const h = (level.shapes ?? []).find((c) => c.kind === 'hump' && p.z >= c.z0 && p.z <= c.z1);
        const vtop = speedAt(num(next, 'requires'));
        const grotto = h && level.niches.filter((n) => n.side === h.side && n.kind === 'grotto' && n.z > (h.land?.[1] ?? 0)).sort((a, b) => a.z - b.z)[0];
        if (!h || !grotto) errors.push(`${where} — a hump trampoline without its hump and landing grotto`);
        else
          for (const v of [vmin, vtop]) {
            const arc = fly(v);
            const [l0, l1] = h.land!;
            if (arc.landZ < l0 - 1 || arc.landZ > Math.max(l1, grotto.box.min[2]) + 1) errors.push(`${where} — at ${v.toFixed(1)} units/s it lands at z=${arc.landZ.toFixed(1)}, off its landing ${l0}–${l1}`);
            const t = arc.points[arc.points.length - 1]!.t + distToEntrance(level, grotto, x, arc.landZ).dist / v;
            if (t > w.threat.warnSec * OPEN_FAIRNESS_SHARE) errors.push(`${where} — flight and the run to the landing grotto take ${t.toFixed(2)} s at ${v.toFixed(1)} units/s, above warnSec × ${OPEN_FAIRNESS_SHARE}`);
          }
      }
      for (const v of [vmin, tuning.controller.maxSpeed]) {
        const arc = fly(v);
        if (arc.landZ + HERO_RADIUS > next.z - GATE_THICKNESS / 2) errors.push(`${where} — at ${v.toFixed(1)} units/s it lands at z=${arc.landZ.toFixed(1)}, past the ridge at z=${next.z}`);
        const meets = (list: typeof caveBoxes): boolean =>
          arc.points.some((q) => list.some((b) => x + HERO_RADIUS > b.min[0] && x - HERO_RADIUS < b.max[0] && q.y + HERO_HEIGHT > b.min[1] && q.y < b.max[1] && q.z + HERO_RADIUS > b.min[2] && q.z - HERO_RADIUS < b.max[2]));
        if (meets(caveBoxes)) errors.push(`${where} — its arc at ${v.toFixed(1)} units/s meets a grotto`);
        if (meets(tall)) errors.push(`${where} — its arc at ${v.toFixed(1)} units/s meets a cliff or a wall`);
      }
    }
    // A throat (docs/01a-content.md 17.2): from its entry along its slide and on to the field grotto at the minimum speed
    // of its section ≤ warnSec × 0.8.
    for (const t of w.segments.filter((x) => x.type === 'throat')) {
      const below = gates.filter((g) => g.z <= t.z);
      const v = speedAt(below.length ? num(below[below.length - 1] as Segment, 'requires') : carried);
      const exit = t.z + num(t, 'length');
      const slide = w.segments.find((x) => x.type === 'slide' && x['shape'] === 'throat' && Math.abs(x.z - (t.z + exit) / 2) < 1);
      const mult = slide && typeof slide['mult'] === 'number' ? (slide['mult'] as number) : 1;
      const field = level.niches.filter((n) => n.z > exit && n.kind === 'grotto').sort((a, b) => a.z - b.z)[0];
      if (!field) continue;
      const sec = num(t, 'length') / (mult * v) + distToEntrance(level, field, 0, exit).dist / v;
      if (sec > w.threat.warnSec * OPEN_FAIRNESS_SHARE) errors.push(`${at}: throat at z=${t.z} — its entry to the field grotto takes ${sec.toFixed(2)} s at ${v.toFixed(1)} units/s, above warnSec × ${OPEN_FAIRNESS_SHARE}`);
    }
    for (const s of w.segments.filter((x) => x.type === 'slide')) {
      const x = num(s, 'x');
      const z0 = s.z - num(s, 'length') / 2;
      const z1 = s.z + num(s, 'length') / 2;
      const where = `${at}: ice slide at z=${s.z}`;
      if (Math.abs(x) + num(s, 'width') / 2 > half(s.z)) errors.push(`${where} — off the track`);
      if (gates.some((g) => g.z > z0 && g.z < z1)) errors.push(`${where} — crosses a ridge`);
      // Flat, or up a hump at its `rise` (docs/01-gdd.md 18.3).
      const rise = typeof s['rise'] === 'number' ? (s['rise'] as number) : 0;
      if (Math.abs(level.floorAt(x, z0) - num(s, 'y')) > 0.01 || Math.abs(level.floorAt(x, z1) - num(s, 'y') - rise) > 0.01) errors.push(`${where} — not on ${rise ? 'its hump' : 'flat ground'}`);
    }
    carried = num(gates[gates.length - 1] as Segment, 'requires');
  }
  return errors;
}

/** Share of warnSec the run to shelter may take (docs/02-tech.md 5.4; docs/01-gdd.md 4.3). */
export const OPEN_FAIRNESS_SHARE = 0.8;
/** The edge line of the fairness check stands this far in from the border (a hero's width). */
const FAIR_EDGE = 1.5;

export interface OpenFairnessRow {
  world: string;
  worstSec: number;
  worstZ: number;
  worstX: number;
  limitSec: number;
}

/**
 * Fairness on every lane (docs/01a-content.md 16.3, 19.2): points every unit along the middle, both edges and the lines
 * halfway between of the slope as wide as it is there (SP-04) off the fork cliffs and the rocks, from the camp up to the
 * start of the giant's zone; `lines: 'lanes'` — the old lines x = ±laneX and 0 only (the 2× margin of 16.3 is theirs). Reachable: grottos of the hero's section and of the
 * section below (its ridge is open), the camp from section 1, the safe line spawnMaxZ from the finish straight.
 * Speed: the stat of the ridge below (section 1 — the giant's advice of the mountain before, 0 on mountain 1).
 */
export function openFairnessReport(worlds: WorldsJson, speedAt: (stat: number) => number, lines: 'width' | 'lanes' = 'width'): OpenFairnessRow[] {
  let carried = 0;
  return worlds.worlds.map((w) => {
    const level = buildLevel(w);
    const gates = sorted(w, 'gate');
    const camp = w.safeZones[0]?.[1] ?? 0;
    const safeLine = w.threat.spawnMaxZ ?? w.length;
    // Fork cliffs and the walls of throats and tunnels (docs/01-gdd.md 18.3): no one stands inside them.
    const cliffs = level.boxes.filter((b) => b.kind === 'cliff' || b.kind === 'throatWall' || b.kind === 'tunnelWall' || b.kind === 'islandWall');
    const throats = (level.shapes ?? []).filter((t) => t.kind === 'throat');
    const slideMult = (z: number): number => {
      const p = level.points.find((q) => q.type === 'slide' && q['shape'] === 'throat' && Math.abs(q.z - z) <= (q['length'] as number) / 2);
      return p && typeof p['mult'] === 'number' ? (p['mult'] as number) : 1;
    };
    let worstSec = 0;
    let worstZ = 0;
    let worstX = 0;
    for (let i = 1; i <= gates.length; i++) {
      const zLo = i === 1 ? camp : (gates[i - 2] as Segment).z;
      const zHi = Math.min((gates[i - 1] as Segment).z, safeLine);
      const zBelow = i <= 2 ? -Infinity : (gates[i - 3] as Segment).z;
      const speed = speedAt(i === 1 ? carried : num(gates[i - 2] as Segment, 'requires'));
      const caves = level.niches.filter((n) => n.kind !== 'ledge' && n.z > Math.max(zBelow, camp) && n.z < (gates[i - 1] as Segment).z);
      for (let z = zLo; z <= zHi; z += 1) {
        const e = level.halfAt(z) - FAIR_EDGE;
        // A split fork (SP-05): its lanes' middles; its crevasse is no place to stand in (its bottom is not a way, 20.5).
        const split = level.forks.find((f) => f.x1 !== undefined && z >= f.z0 && z <= f.z1);
        const lane = split ? split.x1! + split.track! / 2 : OPEN_SLOPE.laneX;
        for (const x of lines === 'lanes' ? [-lane, 0, lane] : [-e, -e / 2, 0, e / 2, e]) {
          if (cliffs.some((c) => x >= c.min[0] && x <= c.max[0] && z >= c.min[2] && z <= c.max[2])) continue;
          if (split && x > split.x0! && x < split.x1!) continue;
          let best = i === 1 ? Math.max(0, z - camp) : Infinity;
          if (z >= safeLine) best = 0;
          else if (i === gates.length) best = Math.min(best, safeLine - z);
          // In a throat the ice slide carries the hero ×its mult (docs/01a-content.md 17.2): the way inside it is faster.
          const th = throats.find((t) => z >= t.z0 && z <= t.z1 && x >= t.x0 && x <= t.x1);
          let sec = best / speed;
          for (const n of caves) {
            const d = distToMouth(level, n, x, z);
            const inThroat = th ? Math.min(d, Math.abs(Math.min(th.z1, Math.max(th.z0, n.z)) - z)) : 0;
            sec = Math.min(sec, (d - inThroat) / speed + inThroat / (speed * (th ? slideMult(z) : 1)));
          }
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
  if (n.kind === 'tunnel' || n.kind === 'island') return distToEntrance(level, n, x, z).dist;
  const ex = entranceX(level, n);
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
    // SP-04: every ridge has its own passages; a line runs through each from the ridge below (past a change of width, which
    // begins at the top of the passages — a line wider than the section below starts where its ground does), the finish
    // lines up the axis and halfway to the funnel mouth.
    const lines: Array<[number, number, number]> = [];
    let from = 0;
    for (const g of level.gates.filter((x) => x.kind === 'ridge')) {
      for (const x of g.passes ?? []) lines.push([x, from, g.z + (g.passLength ?? 0) + 1]);
      from = g.z + (g.passLength ?? 0) + 0.5;
    }
    const mouth = (level.funnel?.x1 ?? 0) / 2;
    for (const x of [-mouth, 0, mouth]) lines.push([x, from, w.length]);
    // A change of width is at most this long (01a 19.2: 40).
    const lead = 60;
    for (const [x, z0, z1] of lines) {
      let z = z0;
      while (level.floorAt(x, z) === -Infinity && z < z0 + lead) z += 0.5;
      let prev = level.floorAt(x, z);
      for (z += 0.5; z <= z1; z += 0.5) {
        const y = level.floorAt(x, z);
        if (y === -Infinity) {
          errors.push(`${at}: hole in the ground at x=${x}, z=${z}`);
          break;
        }
        // Down is fine (into a crevasse, off a cliff); up only by stepUp or a ramp.
        if (y - prev > stepUp) {
          errors.push(`${at}: step of ${(y - prev).toFixed(2)} at x=${x}, z=${z} above stepUp ${stepUp}`);
          break;
        }
        prev = y;
      }
    }
    for (const n of level.niches) {
      if (n.kind === 'ledge') continue;
      const ex = (n.side === 'left' ? -1 : 1) * level.halfAt(n.z);
      const ground = level.floorAt(ex, n.z);
      if (Math.abs(ground - n.y) > 0.01) errors.push(`${at}: grotto at z=${n.z} — floor ${n.y}, the ground at its mouth is ${ground}`);
    }
  }
  return errors;
}

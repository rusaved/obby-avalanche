// What: Generator of the open slope (layout openSlope): camp, terrace sections with ridges, grottos by shelterEvery, forks, the giant's zone and the summit.
// Called by: level/generate.ts (generateWorlds dispatches on spec.layout); level/validate.ts and tests read OPEN_SLOPE for the same numbers.
// Keep: Pure and deterministic like generate.ts (same spec → same JSON byte for byte); every gameplay number comes from worlds-spec.json and balance.json.

/**
 * Open slope (docs/01-gdd.md 17.2–17.7; docs/01a-content.md 16.1, 16.5): a mountain is the camp → sections (terraces
 * 8 units apart: an approach rise of 4 at 75–85% and the ridge step of 4) → the finish straight with the giant's zone →
 * the summit. A ridge is a gate of kind «ridge» with three passages; the giant's check is a gate of kind «boss» at the
 * summit line, never a collider. Grottos (side niches without a belt) are spread evenly so that no lane goes longer than
 * `shelterEvery` without one; the grotto under the ridge and the one before the giant's zone carry the belt of their
 * section's multiplier. A fork splits the slope by a cliff into a calm and a bold lane; each lane has its grottos.
 */
import type { Segment, World, WorldBoss, WorldCover, WorldZone, WorldsSpecJson, OpenSpecJson, OpenSpecMountain, TuningJson } from '../content/types.ts';
import { PAD_SIZE, SLIDE_LENGTH, SLIDE_WIDTH, flightBand, padArc } from './pad-arc.ts';
import { blockedFor, chasmFloorY, dipFloorY, planSection, pushChasmFloor, pushDipFloor, pushShapes, type SectionPlan } from './open-shapes.ts';
import { moveSpeed } from '../sim/effects/moveSpeed.ts';
import { FLOOR_THICKNESS, PORTAL_WIDTH } from './builder.ts';

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

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Layout of a section (docs/01a-content.md 16.5), units and fractions: the flag past the passage ramps, the approach
 * rise, the ridge with three passages (ramps of `passLength` up the step, ice `gateHeight` over the lower floor, out of
 * a jump's reach), grottos, the fork of 5–40%, gifts on the path.
 */
/** Snow between the rock of the first avalanche on the axis and the start of the crevasse past it (nearRun.axis), units. */
const AXIS_ROCK_GAP = 6;
/** Free snow below a trampoline before a chasm (the run-up onto it) and past the chasm (the landing), units. */
const PAD_RUNUP = 12;
/** A split fork's bridge from a pit's slope to the next pit, units along the run (both lanes meet on it). */
const SPLIT_BRIDGE = 4;

export const OPEN_SLOPE = {
  flag: 12,
  /** The approach rise (16.5: 75–95% of the section) starts at 80% and is 20 long: shorter than any shelterEvery. */
  approach: { start: 0.8, length: 20 },
  approachRise: 4,
  ridgeRise: 4,
  passes: [-18, 0, 18] as const,
  passWidth: 11,
  passLength: 8,
  gateHeight: 10,
  /** The number plaque stands over the carniz (its glyphs 6 units, docs/01-gdd.md 17.3): centre this high over the floor. */
  signHeight: 7.5,
  grotto: { length: 8, depth: 4 },
  /** The grotto under the ridge and the one before the giant's zone: 16 long, 6 deep, its exit 2 units below the line. */
  bigGrotto: { length: 16, depth: 6, exit: 2 },
  /** A grotto stays this far off the approach rise and the passage ramps (it stands on flat floor). */
  grottoClear: 1,
  fork: { start: 0.08, share: 0.32, min: 60, max: 120, width: 8, height: 10 },
  /** x of a lane's middle on a fork: halfway between the cliff and the edge. */
  laneX: 16,
  pathGifts: 12,
  bossGifts: 4,
  giftSpan: [0.05, 0.95] as const,
  eggStandSection: 3,
  eggStandX: 12,
  /**
   * The bold lane of a fork (docs/01-gdd.md 17.7), units from the fork start: the ice slide at `slideAt`; a crevasse 5
   * wide and 2 deep across the lane from `from` on (where no grotto of that side is near), its bottom flat for `bottom`,
   * then a slope out; the trampoline `padBefore` below it throws over it.
   */
  crevasse: { slideAt: 2, from: 26, width: 5, depth: 2, bottom: 2.5, padBefore: 5 },
  /** From mountain 2 (17.5): an ice cliff on the bold lane (|x| 18–26), a winding way up, the ledge shelter on top. */
  cliff: { x0: 18, x1: 26, ramp: 14, top: 8, height: 9, gap: 8 },
  /** One grotto with a chest a mountain, past the bold lane of the first fork of sections 2–4 with room for it (RG: the
   * elements take sections 2–3 on some mountains): 10 × the gift of its section. */
  chest: { sections: [2, 3, 4], length: 8, depth: 4, gifts: 10, after: 6 },
} as const;

type Spec = OpenSpecJson;
type Mountain = OpenSpecMountain;

export interface OpenInput {
  spec: Spec;
  balance: { coins: { gatePass: number; chest: number }; speedCurve?: { k: number } };
  /** Needed by the elements of 18.3 (trampoline arcs, the hump's flight); absent — a spec without them. */
  tuning?: Pick<TuningJson, 'controller' | 'fun'> | undefined;
}

export function isOpenSpec(spec: WorldsSpecJson | OpenSpecJson): spec is OpenSpecJson {
  return (spec as { layout?: string }).layout === 'openSlope';
}

export function generateOpenWorlds({ spec, balance, tuning }: OpenInput): World[] {
  return spec.mountains.map((m, mi) => generateOpenWorld(spec, balance, mi + 1, m, tuning, mi > 0 ? (spec.mountains[mi - 1] as Mountain).boss.requires : 0));
}

/** Run speed at a stat for the elements (docs/02-tech.md 6.1): the curve of balance.json with the tuning base and ceiling. */
function speedOf(balance: OpenInput['balance'], tuning: OpenInput['tuning'], stat: number): number {
  if (!tuning || !balance.speedCurve) return 0;
  return moveSpeed(stat, { base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed, k: balance.speedCurve.k });
}

/** Rarity of zone k of K (docs/01a-content.md 16.2): ⌈6k / K⌉ of the six rarities. */
export function openRarity(spec: Spec, k: number, count: number): string {
  const r = spec.rarities[Math.ceil((spec.rarities.length * k) / count) - 1];
  if (r === undefined) throw new Error(`openSlope: no rarity for zone ${k} of ${count}`);
  return r;
}

/**
 * RL-05 (docs/01-gdd.md 21.5): the rise of a section — its calm half (and the axis) the ramp as before, its bold half a
 * pit with a stair of plates up to the top floor on the passage line nearest the middle of that half; a fall from a plate
 * rolls the hero back to the flag (the `pit`). Bold is the side of the section's fork (right on even sections).
 */
function pushStairs(seg: Segment[], ST: NonNullable<NonNullable<OpenSpecJson['relief']>['stairs']>, j: number, zA: number, zB: number, y: number, rise: number, half: number, passes: readonly number[]): void {
  const sb = j % 2 === 0 ? 1 : -1;
  const span = round3(zB - zA);
  let n = Math.max(ST.count[0], Math.min(ST.count[1], Math.round(rise / ST.step) - 1));
  let P = ST.plate;
  let g = (span - n * P) / (n + 1);
  while (g < ST.gapMin && n > ST.count[0]) g = (span - --n * P) / (n + 1);
  if (g > ST.gapMax) {
    g = ST.gapMax;
    P = (span - (n + 1) * g) / n;
  }
  const r = rise / (n + 1);
  // On the passage line of the bold half nearest its middle, the plate whole inside it.
  const mid = sb * (ST.inner + half) / 2;
  const line = passes.filter((x) => Math.sign(x) === sb).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0] ?? mid;
  const px = round3(sb * Math.max(ST.inner + ST.plate / 2 + 1, Math.min(half - ST.plate / 2 - 1, Math.abs(line))));
  const calm: [number, number] = sb > 0 ? [-half, ST.inner] : [-ST.inner, half];
  const bold: [number, number] = sb > 0 ? [ST.inner, half] : [-half, -ST.inner];
  seg.push({ type: 'ramp', z: zA, length: span, y, rise, x0: calm[0], x1: calm[1], approach: true });
  seg.push({ type: 'stairs', z: zA, length: span, y, x: px, count: n, plate: round3(P), gap: round3(g), rise: round3(r), side: sb > 0 ? 'right' : 'left', section: j });
  seg.push({ type: 'pit', z: zA, length: span, y: round3(y - ST.fall), x0: bold[0], x1: bold[1], side: sb > 0 ? 'right' : 'left', section: j });
  seg.push({ type: 'floor', z: zA, length: span, y: round3(y - ST.deep), x0: bold[0], x1: bold[1], material: 'ice', solid: false, shape: 'stairs' });
  for (let k = 0; k < n; k++)
    seg.push({ type: 'floor', z: round3(zA + g + k * (P + g)), length: round3(P), y: round3(y + r * (k + 1)), x0: round3(px - ST.plate / 2), x1: round3(px + ST.plate / 2), thickness: 1, material: 'ice', shape: 'stairs' });
}

/** The fork of section of length L starting at z0: [start, end) or null (docs/01a-content.md 16.5: 5–40%). */
export function forkRange(z0: number, L: number): [number, number] {
  const F = OPEN_SLOPE.fork;
  const a = round3(z0 + F.start * L);
  return [a, round3(a + Math.min(F.max, Math.max(F.min, F.share * L)))];
}

function generateOpenWorld(spec: Spec, balance: OpenInput['balance'], index: number, m: Mountain, tuning: OpenInput['tuning'], carried: number): World {
  const O = OPEN_SLOPE;
  const S = m.sections.length;
  // SP-07 (docs/01-gdd.md 20.7; docs/01a-content.md 19.5): the rise of a terrace and of its ridge's carniz by mountain; the
  // approach rise takes the rest of the terrace at the slope `relief.approachSlope`, the passages climb at `passSlope`, the
  // ice cliff of the bold lane at its old slope; absent — the terraces of 16.5 (4 + 4).
  const ridgeRise = m.ridgeRise ?? O.ridgeRise;
  const approachRise = (m.terraceRise ?? O.ridgeRise + O.approachRise) - ridgeRise;
  const approachLength = spec.relief ? round3(approachRise / spec.relief.approachSlope) : O.approach.length;
  const passLength = spec.relief ? round3(ridgeRise / spec.relief.passSlope) : O.passLength;
  const cliffHeight = m.cliffHeight ?? O.cliff.height;
  const cliffRamp = round3((cliffHeight * O.cliff.ramp) / O.cliff.height);
  if (m.ridges.length !== S) throw new Error(`${m.id}: ${S} sections need ${S} ridges, found ${m.ridges.length}`);
  const camp = spec.campLength;
  // SP-04 (docs/01-gdd.md 20.4): every section its own width, the finish straight the width of the giant's zone; the
  // change past a ridge goes over widthTaper units (a `taper`), the world is as wide as its widest part.
  const halves = m.sections.map((s) => (s.width ?? spec.width) / 2);
  const finishHalf = (m.boss.width ?? m.sections[S - 1]?.width ?? spec.width) / 2;
  const maxHalf = Math.max(...halves, finishHalf);
  const T = spec.widthTaper ?? 0;
  const profile: Array<[number, number]> = [[0, halves[0] ?? spec.width / 2]];
  let half = halves[0] ?? spec.width / 2;
  /** Floors and ramps of a part as wide as that part (the builder's default is the widest part of the world). */
  const fit = (from: number): void => {
    if (half === maxHalf) return;
    for (let k = from; k < seg.length; k++) {
      const p = seg[k] as Segment;
      if ((p.type === 'floor' || p.type === 'ramp') && p['x0'] === undefined) {
        p['x0'] = -half;
        p['x1'] = half;
      }
    }
  };
  const K = S + 1;
  const zones: WorldZone[] = [];
  let z = camp;
  m.sections.forEach((sec, i) => {
    zones.push({ k: i + 1, rarity: openRarity(spec, i + 1, K), gift: sec.gift, stepMult: sec.stepMult, zStart: z, zEnd: z + sec.length });
    z += sec.length;
  });
  const zLast = z;
  const zSummit = zLast + m.boss.stretch;
  zones.push({ k: K, rarity: openRarity(spec, K, K), gift: m.boss.gift, stepMult: m.boss.stepMult, zStart: zLast, zEnd: zSummit });

  const seg: Segment[] = [];
  pushOpenCamp(seg, spec, m);
  fit(0);

  // Grottos 10 long from mountain 2 (docs/01-gdd.md 18.8 item 3: the camera has room; mountain 1 stays as built).
  const G = spec.shapes?.grotto && index >= spec.shapes.grotto.fromWorld ? spec.shapes.grotto.width : O.grotto.length;
  let y = 0;
  let chestDone = false;
  m.sections.forEach((sec, i) => {
    const j = i + 1;
    const zone = zones[i] as WorldZone;
    const z0 = zone.zStart;
    const L = sec.length;
    const z1 = zone.zEnd;
    const below = half;
    half = halves[i] ?? half;
    const from = seg.length;
    // SP-07: the approach rise at its slope ends with room on the top floor for a grotto before the grotto under the ridge
    // (a short section starts it before 80%).
    const topRoom = O.bigGrotto.length + O.bigGrotto.exit + G + 2 * O.grottoClear + 4;
    // Grottos either side of it stay within shelterEvery (a short shelterEvery: a steeper rise).
    const rampLen = Math.min(approachLength, sec.shelterEvery - G - 2 * O.grottoClear - 2);
    const zA = round3(Math.min(z0 + O.approach.start * L, z1 - topRoom - rampLen));
    const zB = round3(zA + rampLen);
    const yTop = y + approachRise;
    // Floors: the carniz top with the passage ramps (from section 2), the slope, the approach rise, the top before the ridge.
    let zFlat = z0;
    if (j >= 2) {
      zFlat = z0 + passLength;
      pushPassages(seg, z0, y - ridgeRise, y, below, passesOf(spec, below), passLength);
    }
    // The change of width (SP-04): from the top of the passages over widthTaper; no grotto stands on it.
    const taper: [number, number] | null = j >= 2 && T > 0 && below !== half ? [zFlat, round3(zFlat + T)] : null;
    if (taper) {
      seg.push({ type: 'taper', z: taper[0], length: T, y, from: below, to: half });
      profile.push([taper[0], below], [taper[1], half]);
    } else if (below !== half) profile.push([zFlat, below], [zFlat, half]);
    const ST = spec.relief?.stairs;
    if (ST && index >= ST.fromWorld) pushStairs(seg, ST, j, zA, zB, y, approachRise, half, passesOf(spec, half));
    else seg.push({ type: 'ramp', z: zA, length: round3(zB - zA), y, rise: approachRise, approach: true });
    seg.push({ type: 'floor', z: zB, length: round3(z1 - zB), y: yTop });

    if (j >= 2) seg.push({ type: 'checkpoint', z: z0 + O.flag, y, x: 0, zone: j, rarity: zone.rarity, wall: j - 1 });
    if (j === O.eggStandSection) seg.push({ type: 'eggStand', z: z0 + O.flag + 4, x: O.eggStandX, y, egg: m.egg });

    // Elements of the section (docs/01-gdd.md 18.3, 18.6): none — the section of 16.5 exactly as before.
    const shape = sec.shape ?? [];
    let plan: SectionPlan | null = null;
    if (shape.length > 0) {
      if (!spec.shapes || !tuning) throw new Error(`${m.id}: section ${j} has elements, worlds-spec.json shapes and tuning are needed`);
      const stat = (k: number): number => (k >= 1 ? (m.ridges[k - 1] as { requires: number }).requires : carried);
      plan = planSection({
        shapes: spec.shapes,
        index,
        shape,
        fork: !!sec.fork,
        split: typeof sec.fork === 'object' && sec.fork.kind === 'split',
        z0,
        L,
        y,
        flag: O.flag,
        forkCfg: O.fork,
        grotto: G,
        vmin: speedOf(balance, tuning, stat(j - 1)),
        vmax: speedOf(balance, tuning, stat(j)),
        tuning,
        zA,
        ...(taper ? { taperEnd: taper[1] } : {}),
      });
    }
    const plainFork = !plan?.tunnel && !plan?.hump;

    // Fork (docs/01-gdd.md 17.7): a cliff down the middle; the bold lane alternates sides by section. Over a tunnel the
    // cliff is as tall as the tunnel's roof (its inner wall). Split (SP-05, 20.5): two lanes `track` wide either side of a
    // crevasse `between` wide, `length` long up to `converge` before the ridge and the approach rise.
    const fs = typeof sec.fork === 'object' && sec.fork.kind === 'split' && spec.forkSplit ? sec.fork : null;
    /** The inner edge of a lane (the cliff's face, the crevasse's edge) and the middle of a lane, units off the axis. */
    const innerX = fs ? fs.between / 2 : O.fork.width / 2;
    const laneX = fs ? fs.between / 2 + fs.track / 2 : O.laneX;
    let fork = plan ? plan.fork : sec.fork ? forkRange(z0, L) : null;
    if (fork && fs) {
      // Past a change of width (its floor is one slab across): the crevasse is open from its start.
      if (taper && fork[0] < taper[1] + 2) fork = [round3(taper[1] + 2), fork[1]];
      const lim = Math.min(zA - 4, z1 - spec.forkSplit!.converge);
      const end = plan && (plan.tunnel || plan.hump) ? Math.max(fork[1], fork[0] + fs.length[0]) : fork[0] + fs.length[1];
      fork = [fork[0], round3(Math.min(end, lim))];
    }
    const bold: 'left' | 'right' = j % 2 === 0 ? 'right' : 'left';
    const forkHeight = plan?.tunnel ? plan.tunnel.height + 2 : O.fork.height;
    if (fork && fs)
      seg.push({ type: 'fork', z: fork[0], length: round3(fork[1] - fork[0]), x: 0, y, kind: 'split', between: fs.between, track: fs.track, depth: spec.forkSplit!.depth, bold, section: j });
    else if (fork) seg.push({ type: 'fork', z: fork[0], length: round3(fork[1] - fork[0]), x: 0, y, width: O.fork.width, height: forkHeight, bold, section: j });

    // The grotto under the ridge closes the section; grottos between it and the flag below are spread evenly.
    const big = O.bigGrotto;
    const zRidgeGrotto = round3(z1 - big.exit - big.length / 2);
    const side = (n: number): 'left' | 'right' => (n % 2 === 1 ? 'left' : 'right');
    const base = j === 1 ? z0 : z0 - big.exit - big.length / 2;
    const flatLo = (taper ? taper[1] : j === 1 ? z0 : zFlat) + G / 2 + O.grottoClear;
    const flatHi = zA - G / 2 - O.grottoClear;
    const topLo = zB + G / 2 + O.grottoClear;
    const topHi = zRidgeGrotto - big.length / 2 - G / 2 - O.grottoClear;
    let nth = 0;
    const grottoAt = (zg: number, s: 'left' | 'right'): Segment => ({
      type: 'niche',
      z: zg,
      y: zg >= zB ? yTop : y,
      side: s,
      kind: 'grotto',
      length: G,
      depth: O.grotto.depth,
      treadmill: 0,
      zone: j,
      stretch: j,
      edge: half,
    });
    // Evenly from the shelter below to the ridge grotto, never more than shelterEvery apart; a grotto never stands on the
    // rise: it moves down to the flat before it, or up onto the top floor when there is room and the gap allows.
    if (!plan)
      for (let cursor = base; zRidgeGrotto - cursor > sec.shelterEvery; ) {
        const rest = zRidgeGrotto - cursor;
        let zg = cursor + rest / Math.ceil(rest / sec.shelterEvery);
        const topRoom = topLo <= topHi;
        if (zg > flatHi && zg < topLo) zg = topRoom && topLo - cursor <= sec.shelterEvery && zg - flatHi > topLo - zg ? topLo : flatHi;
        else if (zg > topHi) zg = topRoom ? topHi : flatHi;
        zg = round3(Math.max(zg, flatLo));
        if (zg <= cursor) throw new Error(`${m.id}: section ${j} has no room for a grotto after z=${cursor} (shelterEvery ${sec.shelterEvery})`);
        cursor = zg;
        const fw = spec.nearRun;
        if (fork && zg >= fork[0] && zg <= fork[1] && fw && spec.island && fw.mountain === index && fw.section === j && !seg.some((x) => x.type === 'island' && x['first'] === true)) {
          // The first avalanche of the game (docs/01-gdd.md 20.4): its grottos by the lanes, not at the edges of the field —
          // a rock on each lane `gap` off its line, open towards the camp.
          const a = spec.island.size;
          for (const s of ['left', 'right'] as const) {
            const sx = s === 'left' ? -1 : 1;
            seg.push({ type: 'island', z: round3(zg), x: round3(sx * (laneX + fw.gap + a / 2)), y, size: a, zone: j, stretch: j, lane: s === bold ? 'bold' : 'calm', first: true });
          }
          // And one on the axis, open towards the camp (`axis`, producer 14.10): running straight on at the siren leads into
          // a shelter, not into the crevasse (it starts past this rock).
          if (fw.axis) seg.push({ type: 'island', z: round3(zg), x: 0, y, size: a, zone: j, stretch: j, first: true, axis: true });
        } else if (fork && zg >= fork[0] && zg <= fork[1]) {
          // On a fork each lane needs its own grotto at its edge.
          seg.push({ ...grottoAt(zg, 'left'), lane: bold === 'left' ? 'bold' : 'calm' });
          seg.push({ ...grottoAt(zg, 'right'), lane: bold === 'right' ? 'bold' : 'calm' });
        } else seg.push(grottoAt(zg, side(++nth)));
      }
    else {
      // With elements (docs/01-gdd.md 18.3): the field grottos past a throat and the landing grotto of a hump are fixed;
      // between them as evenly; never in a throat, a chasm, the calm side of a tunnel or the bold side of a hump crest.
      const all = blockedFor(plan, null, bold, G);
      const per = { left: blockedFor(plan, 'left', bold, G), right: blockedFor(plan, 'right', bold, G) };
      const fixed: Array<{ z: number; sides: Array<'left' | 'right'> }> = [];
      if (plan.field !== null) fixed.push({ z: plan.field, sides: ['left', 'right'] });
      if (plan.hump) fixed.push({ z: plan.hump.grotto, sides: [bold] });
      for (const f of fixed)
        if (f.z > flatHi && f.z < topLo) throw new Error(`${m.id}: section ${j} — the grotto at z=${f.z} falls on the approach rise (the elements need a longer section)`);
      const ridgeRoom = zRidgeGrotto - big.length / 2 - G / 2 - O.grottoClear;
      /** The last grotto of each side so far (a taken side moves its grotto to the edge of the stretch, not before it). */
      const last = { left: base, right: base };
      for (let cursor = base; ; ) {
        const anchor = fixed.find((f) => f.z > cursor + 1e-9);
        const rest = (anchor ? anchor.z : zRidgeGrotto) - cursor;
        let zg: number;
        let sides: Array<'left' | 'right'> | null = null;
        if (rest <= sec.shelterEvery + 1e-9) {
          if (!anchor) break;
          zg = anchor.z;
          sides = anchor.sides;
        } else {
          zg = cursor + rest / Math.ceil(rest / sec.shelterEvery);
          const topRoom = topLo <= topHi;
          if (zg > flatHi && zg < topLo) zg = topRoom && topLo - cursor <= sec.shelterEvery && zg - flatHi > topLo - zg ? topLo : flatHi;
          else if (zg > topHi) zg = topRoom ? topHi : flatHi;
          zg = Math.max(zg, flatLo);
          const hit = all.find(([a, b]) => zg > a && zg < b);
          if (hit) zg = hit[0] >= Math.max(cursor + 1, flatLo) ? hit[0] : hit[1];
          zg = round3(zg);
          if (anchor && zg >= anchor.z - 1e-9) {
            zg = anchor.z;
            sides = anchor.sides;
          } else if (!anchor && zg >= ridgeRoom) break;
        }
        if (zg <= cursor) throw new Error(`${m.id}: section ${j} has no room for a grotto after z=${cursor} (shelterEvery ${sec.shelterEvery})`);
        cursor = zg;
        const free = (s: 'left' | 'right'): boolean => !per[s].some(([a, b]) => zg > a && zg < b);
        const lane = (s: 'left' | 'right'): 'bold' | 'calm' => (s === bold ? 'bold' : 'calm');
        const onFork = fork !== null && zg >= fork[0] && zg <= fork[1];
        if (sides) for (const s of sides) seg.push(onFork ? { ...grottoAt(zg, s), lane: lane(s) } : grottoAt(zg, s));
        else if (onFork) {
          for (const s of ['left', 'right'] as const) {
            if (free(s)) {
              seg.push({ ...grottoAt(zg, s), lane: lane(s) });
              continue;
            }
            // SP-03 (docs/01-gdd.md 20.3): a side taken here (a hump crest) gets its grotto at the near edge of that stretch,
            // so its lane keeps its spacing on the longer sections.
            const [p, q] = per[s].find(([a, b]) => zg > a && zg < b)!;
            const at = round3(p > last[s] + 1 && p >= flatLo ? p : q);
            if (at < zRidgeGrotto - big.length / 2 - G) {
              seg.push({ ...grottoAt(at, s), lane: lane(s) });
              last[s] = at;
            }
          }
        } else seg.push(grottoAt(zg, side(++nth)));
        for (const s of ['left', 'right'] as const) if (sides?.includes(s) || (onFork && free(s)) || (!sides && !onFork)) last[s] = zg;
      }
    }
    // By the run (nearRun): in a rock under the carniz between the two passages nearest the axis.
    const near = spec.nearRun && spec.island && spec.nearRun.mountain === index && j >= spec.nearRun.section;
    const ps = passesOf(spec, half);
    const mid = ps.findIndex((x) => x >= 0);
    const rockX = ps[mid] === 0 ? round3((ps[mid]! + (ps[mid + 1] ?? ps[mid]!)) / 2) : 0;
    const ridgeRock = near ? { rock: rockX, width: spec.island!.size } : {};
    seg.push({
      type: 'niche',
      z: zRidgeGrotto,
      y: yTop,
      side: near ? (rockX < 0 ? 'left' : 'right') : side(j),
      ...ridgeRock,
      kind: 'ridgeGrotto',
      length: big.length,
      depth: big.depth,
      treadmill: sec.stepMult,
      zone: j,
      stretch: j,
      edge: half,
    });

    // The bold lane of the fork (docs/01-gdd.md 17.7; docs/01a-content.md 16.5): the ice slide, the trampoline over the
    // crevasse (a gift at its bottom, a slope out), from mountain 2 the ice cliff with the ledge shelter on top (gift ×2),
    // the grotto with the chest past the fork (one a mountain). Each where no grotto of the bold side is near.
    const overHole: Array<[number, number]> = [];
    let crevasse: [number, number] | null = null;
    const sb = bold === 'left' ? -1 : 1;
    const boldNiches = seg.filter((x) => x.type === 'niche' && x['side'] === bold && x.z > z0 - 20 && x.z < z1 + 20);
    const free = (a: number, b: number): boolean =>
      boldNiches.every((n) => (n.z as number) + (n['length'] as number) / 2 + 2 < a || (n.z as number) - (n['length'] as number) / 2 - 2 > b);
    const gift = (z: number, x: number, yy: number, coins: number, extra: Record<string, unknown>): Segment => ({
      type: 'gift',
      z: round3(z),
      x,
      y: yy,
      height: 0,
      zone: j,
      rarity: zone.rarity,
      coins,
      n: 0,
      ...extra,
    });
    // The bold lane of a fork with a tunnel or a hump is that element alone (docs/01-gdd.md 18.3): no slide, crevasse, cliff.
    if (fork && plainFork) {
      const C = O.crevasse;
      const xb = sb * laneX;
      seg.push({ type: 'slide', z: round3(fork[0] + C.slideAt + SLIDE_LENGTH / 2), x: xb, y, width: SLIDE_WIDTH, length: SLIDE_LENGTH, stretch: j });
      for (let c0 = fork[0] + C.from; c0 + C.width <= fork[1] - 4; c0 += 1) {
        if (!free(c0, c0 + C.width)) continue;
        crevasse = [round3(c0), round3(c0 + C.width)];
        break;
      }
      if (crevasse) {
        const [c0, c1] = crevasse;
        const inner = innerX * sb;
        seg.push({ type: 'gap', z: c0, length: C.width, x0: Math.min(inner, sb * half), x1: Math.max(inner, sb * half), y, depth: C.depth, lane: 'bold' });
        // SP-07 (docs/01-gdd.md 20.7): no trampoline before mountain relief.padFrom — the crevasse is a dip to run through.
        if (index >= (spec.relief?.padFrom ?? 1)) {
          const pz = round3(c0 - C.padBefore);
          seg.push({ type: 'jumpPad', z: pz, x: xb, y, width: PAD_SIZE, length: PAD_SIZE, stretch: j });
          // Its gift on the arc over the crevasse, taken in the column of all the flights up to the top speed (Q-068: on
          // the bottom the hero flew high over it).
          const vmin = speedOf(balance, tuning, j >= 2 ? (m.ridges[j - 2] as { requires: number }).requires : carried);
          const fly = (v: number): ReturnType<typeof padArc> => padArc(pz - PAD_SIZE / 2 + (v / 60) / 2, y, v, tuning!, () => y);
          const zg = fly(vmin).points.find((q) => q.z >= c0 + C.width / 2)!.z;
          const col = flightBand(fly, zg, vmin, tuning!.controller.maxSpeed);
          seg.push(gift(zg, xb, round3((col[0] + col[1]) / 2 - 0.3), sec.gift, { air: true, col }));
        } else seg.push(gift(c0 + C.bottom / 2, xb, y - C.depth, sec.gift, { detour: true }));
        overHole.push([c0 - C.padBefore - PAD_SIZE / 2 - 1, c1 + 1]);
      }
      const K = O.cliff;
      const span = cliffRamp + K.top;
      if (index >= 2) {
        for (let k0 = (crevasse ? crevasse[1] : fork[0] + C.from) + K.gap; k0 + span <= zA - 2; k0 += 1) {
          if (!free(k0, k0 + span)) continue;
          // As far off the middle of its lane as before SP (split, SP-05): beside the run, not on it.
          const kx0 = K.x0 + laneX - O.laneX;
          const kx1 = K.x1 + laneX - O.laneX;
          seg.push({ type: 'cliff', z: round3(k0), length: cliffRamp, top: K.top, height: cliffHeight, x0: Math.min(sb * kx0, sb * kx1), x1: Math.max(sb * kx0, sb * kx1), y, side: bold, zone: j, stretch: j });
          seg.push(gift(k0 + cliffRamp + K.top / 2, (sb * (kx0 + kx1)) / 2, y + cliffHeight, 2 * sec.gift, { detour: true }));
          break;
        }
      }
    }
    if (fork) {
      const H = O.chest;
      if (!chestDone && (H.sections as readonly number[]).includes(j)) {
        // On a split fork (SP-05) the grotto stands at the edge past the bold lane inside the fork: past its end there is no room.
        const zFrom = fs ? (crevasse ? crevasse[1] : fork[0] + O.crevasse.from) + H.after + H.length / 2 : fork[1] + H.after + H.length / 2;
        // Never on a hump's side between its slope and its landing (the ground there is its ice).
        const hu = plan?.hump;
        for (let zc = zFrom; zc + H.length / 2 <= flatHi; zc += 1) {
          if (!free(zc - H.length / 2, zc + H.length / 2)) continue;
          if (hu && zc + H.length / 2 > hu.z0 - 2 && zc - H.length / 2 < hu.landEnd + 2) continue;
          seg.push({ type: 'chestGrotto', z: round3(zc), y, side: bold, length: H.length, depth: H.depth, coins: H.gifts * sec.gift, zone: j, rarity: zone.rarity, stretch: j, edge: half });
          chestDone = true;
          break;
        }
      }
    }
    // The floor of the section: whole, or round the crevasse — the calm half at the slope, the bold half down to its
    // bottom and up its slope; with a chasm (docs/01-gdd.md 18.3) round it too — steps down, its bottom, a ramp up.
    const crevasseFloor = (c0: number, c1: number): void => {
      const C = O.crevasse;
      const inner = innerX * sb;
      const calm: [number, number] = [Math.min(-sb * half, inner), Math.max(-sb * half, inner)];
      const boldX: [number, number] = [Math.min(inner, sb * half), Math.max(inner, sb * half)];
      seg.push({ type: 'floor', z: c0, length: C.width, y, x0: calm[0], x1: calm[1] });
      seg.push({ type: 'floor', z: c0, length: C.bottom, y: y - C.depth, x0: boldX[0], x1: boldX[1] });
      seg.push({ type: 'ramp', z: round3(c0 + C.bottom), length: round3(C.width - C.bottom), y: y - C.depth, rise: C.depth, x0: boldX[0], x1: boldX[1] });
    };
    if (plan) {
      const holes: Array<[number, number, 'chasm' | 'crevasse' | 'dip']> = [];
      if (plan.chasm) holes.push([plan.chasm.z0, plan.chasm.z1, 'chasm']);
      if (plan.dip) holes.push([plan.dip.z0, plan.dip.z1, 'dip']);
      if (crevasse) holes.push([crevasse[0], crevasse[1], 'crevasse']);
      let cur = zFlat;
      for (const [a, b, kind] of holes.sort((p, q) => p[0] - q[0])) {
        seg.push({ type: 'floor', z: round3(cur), length: round3(a - cur), y });
        if (kind === 'chasm' && plan.chasm) pushChasmFloor(seg, plan.chasm, y, spec.shapes!, half, fs ? laneX : laneX + 2);
        else if (kind === 'dip' && plan.dip) pushDipFloor(seg, plan.dip, y, spec.shapes!);
        else crevasseFloor(a, b);
        cur = b;
      }
      seg.push({ type: 'floor', z: round3(cur), length: round3(zA - cur), y });
      pushShapes(seg, { plan, section: j, index, y, half, bold, laneX, ...(fs ? { padX: laneX } : {}), forkWidth: 2 * innerX, gift: sec.gift, rarity: zone.rarity, vmin: speedOf(balance, tuning, j >= 2 ? (m.ridges[j - 2] as { requires: number }).requires : carried), shapes: spec.shapes!, tuning: tuning! });
      // RL-06 (docs/01-gdd.md 21.6): the ice chute on the axis of a section without a fork, in its longest free stretch.
      const CH = spec.relief?.chute;
      if (CH && j >= CH.fromSection && !fork) {
        const pad = spec.shapes!.chasm.padBefore + PAD_SIZE + PAD_RUNUP;
        const busy: Array<[number, number]> = [[z0, z0 + O.flag + 4], [zA - 4, z1]];
        if (plan.throat) busy.push([plan.throat.z0, (plan.field ?? plan.throat.z1) + G]);
        if (plan.chasm) busy.push([plan.chasm.z0 - pad, plan.chasm.z1 + PAD_RUNUP]);
        if (plan.dip) busy.push([plan.dip.z0 - 4, plan.dip.z1 + 6]);
        busy.sort((p, q) => p[0] - q[0]);
        let best: [number, number] = [0, 0];
        let cur = z0;
        for (const [a, b] of busy) {
          if (a - cur > best[1] - best[0]) best = [cur, a];
          cur = Math.max(cur, b);
        }
        const len = round3(Math.min(best[1] - best[0], CH.share[1] * L));
        if (len >= CH.share[0] * L) seg.push({ type: 'slide', z: round3((best[0] + best[1]) / 2), x: 0, y, width: CH.width, length: len, mult: CH.mult, stretch: j, shape: 'chute' });
      }
    } else if (crevasse) {
      const [c0, c1] = crevasse;
      seg.push({ type: 'floor', z: zFlat, length: round3(c0 - zFlat), y });
      crevasseFloor(c0, c1);
      seg.push({ type: 'floor', z: c1, length: round3(zA - c1), y });
    } else seg.push({ type: 'floor', z: zFlat, length: round3(zA - zFlat), y });
    if (fork && fs) {
      // The rock of the first avalanche on the axis stands on the snow: the crevasse opens past it (nearRun.axis).
      const axisRock = seg.find((x) => x.type === 'island' && x['axis'] === true && x['stretch'] === j);
      const cut: [number, number] = axisRock ? [round3(Math.max(fork[0], axisRock.z + (axisRock['size'] as number) / 2 + AXIS_ROCK_GAP)), fork[1]] : fork;
      pushSplit(seg, from, cut, innerX, y, half, spec.forkSplit!, (zg, gx, gy) => gift(zg, gx, gy, sec.gift, { bottom: true, detour: true }));
    }

    // Gifts on the path (docs/01a-content.md 16.2): 12 a section, taken on the run; on a fork one on each lane, the bold one ×2.
    // With elements (docs/01-gdd.md 18.3): on the bottom of a chasm, ×fieldGifts on the field past a throat, none inside
    // a tunnel (its open lane ×openGifts), up the hump on its ramp.
    const fieldEnd = plan?.throat ? Math.min(plan.chasm?.z0 ?? Infinity, fork?.[0] ?? Infinity, zA) : -Infinity;
    for (let g = 0; g < O.pathGifts; g++) {
      const zg = round3(z0 + L * (O.giftSpan[0] + ((O.giftSpan[1] - O.giftSpan[0]) * g) / (O.pathGifts - 1)));
      let yg = zg < zA ? y : zg < zB ? round3(y + (approachRise * (zg - zA)) / (zB - zA)) : yTop;
      if (plan?.chasm && zg >= plan.chasm.z0 && zg <= plan.chasm.z1) yg = round3(chasmFloorY(plan.chasm, zg, y, spec.shapes!));
      if (plan?.dip && zg >= plan.dip.z0 && zg <= plan.dip.z1) yg = round3(dipFloorY(plan.dip, zg, y, spec.shapes!));
      const field = plan?.throat && zg > plan.throat.z1 && zg < fieldEnd;
      const pathGift = (x: number, coins: number, extra: Record<string, unknown> = {}, gy = yg): Segment => ({
        type: 'gift',
        z: zg,
        x,
        y: gy,
        height: 0,
        zone: j,
        rarity: zone.rarity,
        coins,
        n: g + 1,
        path: true,
        ...extra,
      });
      if (fork && zg >= fork[0] && zg <= fork[1]) {
        const inTunnel = plan?.tunnel && zg >= plan.tunnel.z0 && zg <= plan.tunnel.z1;
        if (!inTunnel) seg.push(pathGift(-sb * laneX, sec.gift, { lane: 'calm' }));
        const hu = plan?.hump;
        const boldY = hu && zg >= hu.z0 && zg <= hu.topEnd ? round3(y + hu.rise * Math.min(1, (zg - hu.z0) / (hu.crest - hu.z0))) : yg;
        const boldCoins = plan?.tunnel ? spec.shapes!.tunnel.openGifts * sec.gift : 2 * sec.gift;
        // Not over the crevasse and its trampoline: there the hero flies.
        if (!overHole.some(([a, b]) => zg >= a && zg <= b)) seg.push(pathGift(sb * laneX, boldCoins, { lane: 'bold' }, boldY));
      } else if (field) seg.push(pathGift(0, Math.round(spec.shapes!.throat.fieldGifts * sec.gift), { field: true }));
      // Not in the rock of the belt under the ridge (nearRun): on the line of the passage nearest the axis.
      // Not over the pit of a chasm (RL-03): its middle trampoline's gifts are there.
      else if (!(plan?.chasm && spec.shapes!.chasm.pit && zg >= plan.chasm.z0 - 1 && zg <= plan.chasm.z1 + 1))
        seg.push(pathGift(near && Math.abs(zg - zRidgeGrotto) < big.length / 2 + 2 && Math.abs(rockX) < spec.island!.size / 2 + 1 ? (ps[mid - 1] ?? ps[mid]!) : 0, sec.gift));
    }

    const ridge = m.ridges[i] as { requires: number };
    seg.push({
      type: 'gate',
      z: z1,
      y: yTop,
      kind: 'ridge',
      requires: ridge.requires,
      reward: { coins: balance.coins.gatePass * sec.gift },
      height: O.gateHeight,
      signHeight: O.signHeight,
      rise: ridgeRise,
      passes: passesOf(spec, half),
      ...(spec.ridgeDigits ? { digits: j === fieldOf(m) ? spec.ridgeDigits.field : spec.ridgeDigits.other } : {}),
      passWidth: O.passWidth,
      passLength,
      wall: j,
      zone: j,
      rarity: zone.rarity,
    });
    // Grottos in rocks (SP-04, docs/01a-content.md 19.2): on a section wider than island.minWidth, in the middle of each
    // half by turns, every `every` × shelterEvery — off the elements, the bold lane of a fork, the change of width and the
    // rise: a rock that falls on one goes to the nearest free place of its half or of the other, at least one a section.
    const isl = spec.island;
    if (isl && 2 * half > isl.minWidth) {
      const step = isl.every * sec.shelterEvery;
      const lo = (taper ? taper[1] : zFlat) + isl.size;
      const hi = zA - isl.size;
      // Nor on the trampolines before a chasm with their run-up, nor on the landing past it (Q-068: a rock stood on the
      // side one of mountains 4 and 7).
      const pads: Array<[number, number]> = plan?.chasm ? [[plan.chasm.z0 - spec.shapes!.chasm.padBefore - PAD_SIZE / 2 - PAD_RUNUP - isl.size / 2, plan.chasm.z1 + PAD_RUNUP + isl.size / 2]] : [];
      // Nor in a dip (RL-04).
      if (plan?.dip) pads.push([plan.dip.z0 - isl.size / 2 - 2, plan.dip.z1 + isl.size / 2 + 2]);
      const busyOn = (side: 'left' | 'right'): Array<[number, number]> => [
        ...pads,
        ...(plan ? blockedFor(plan, side, bold, isl.size) : []),
        ...(fork && plainFork && side === bold ? [[fork[0] - isl.size, fork[1] + isl.size] as [number, number]] : []),
      ];
      const placed: number[] = [];
      // No room past a split fork's lane: not on the fork.
      const room = !fs || innerX + fs.track + 2 + isl.size + 2 <= half;
      const freeAt = (zi: number, side: 'left' | 'right'): boolean =>
        zi >= lo &&
        zi <= hi &&
        !busyOn(side).some(([a, b]) => zi > a && zi < b) &&
        (room || !fork || zi + isl.size / 2 < fork[0] || zi - isl.size / 2 > fork[1]) &&
        placed.every((q) => Math.abs(q - zi) >= step / 2);
      for (let zc = z0 + step / 2, k = 0; zc <= hi + step / 2; zc += step) {
        const pref: 'left' | 'right' = k % 2 === 0 ? 'left' : 'right';
        let at: [number, 'left' | 'right'] | null = null;
        for (let d = 0; d <= step / 2 && !at; d += 1)
          for (const zi of d === 0 ? [zc] : [zc - d, zc + d])
            for (const side of [pref, pref === 'left' ? 'right' : 'left'] as const) if (!at && freeAt(zi, side)) at = [zi, side];
        if (!at) continue;
        k++;
        placed.push(at[0]);
        const sx = at[1] === 'left' ? -1 : 1;
        const onFork = fork && at[0] + isl.size / 2 > fork[0] && at[0] - isl.size / 2 < fork[1];
        // On a split fork (SP-05) the rock stands on the free snow past its lane, not on it.
        const ax = onFork && fs ? innerX + fs.track + 2 + isl.size / 2 : half / 2 + isl.size / 2;
        seg.push({ type: 'island', z: round3(at[0]), x: round3(sx * ax), y, size: isl.size, zone: j, stretch: j, ...(onFork ? { lane: at[1] === bold ? 'bold' : 'calm' } : {}) });
      }
    }
    fit(from);
    y = yTop + ridgeRise;
  });

  // The finish straight (docs/01-gdd.md 17.6): passage ramps up the last ridge, the grotto with the belt before the line,
  // the giant's zone from the line to the summit, 4 gifts on the path; the boss «gate» at the summit line is its check.
  const finish = zones[S] as WorldZone;
  const big = O.bigGrotto;
  const zZone = round3(zLast + spec.boss.zoneGap);
  const fromFinish = seg.length;
  pushPassages(seg, zLast, y - ridgeRise, y, half, passesOf(spec, half), passLength);
  // SP-04: the grotto with the belt before the line stands at the last section's width; the giant's zone changes it.
  seg.push({ type: 'floor', z: zLast + passLength, length: round3(zZone - zLast - passLength), y });
  fit(fromFinish);
  const lastHalf = half;
  half = finishHalf;
  if (T > 0 && lastHalf !== finishHalf) {
    seg.push({ type: 'taper', z: zZone, length: T, y, from: lastHalf, to: finishHalf });
    profile.push([zZone, lastHalf], [round3(zZone + T), finishHalf]);
  } else if (lastHalf !== finishHalf) profile.push([zZone, lastHalf], [zZone, finishHalf]);
  const fromZone = seg.length;
  seg.push({ type: 'floor', z: zZone, length: round3(zSummit - zZone), y });
  seg.push({ type: 'checkpoint', z: zLast + O.flag, y, x: 0, zone: K, rarity: finish.rarity, wall: S });
  const nearBoss = spec.nearRun && spec.island && (spec.nearRun.mountain === index || spec.boss.cover);
  const bossSide: 'left' | 'right' = S % 2 === 0 ? 'left' : 'right';
  // SP-06 (docs/01a-content.md 19.4): by the axis on every mountain, at both edges too from mountain edgeGrottos.
  const lineSides: Array<'left' | 'right'> = [bossSide];
  if (spec.boss.edgeGrottos !== undefined && index >= spec.boss.edgeGrottos) lineSides.push('left', 'right');
  lineSides.forEach((side, k) =>
    seg.push({
      type: 'niche',
      z: round3(zZone - big.exit - big.length / 2),
      y,
      side,
      // By the run (nearRun): a rock beside the axis, `gap` off it.
      ...(nearBoss && k === 0 ? { rock: (side === 'left' ? -1 : 1) * (spec.island!.size / 2 + spec.nearRun!.gap), width: spec.island!.size } : {}),
      kind: 'bossLine',
      length: big.length,
      depth: big.depth,
      treadmill: m.boss.stepMult,
      zone: K,
      stretch: K,
      edge: lastHalf,
    }),
  );
  for (let g = 0; g < O.bossGifts; g++) {
    const zg = round3(zZone + ((zSummit - zZone) * (g + 0.5)) / O.bossGifts);
    seg.push({ type: 'gift', z: zg, x: 0, y, height: 0, zone: K, rarity: finish.rarity, coins: m.boss.gift, n: g + 1, path: true });
  }
  // Rocks to hide behind (SP-06, docs/01a-content.md 19.4): by the count of 19.2 at shares `at` of the zone, x = ±width × `x`
  // by turns (off the portal's axis); a box 2r × 2r × h.
  const cv = spec.boss.cover;
  const covers: WorldCover[] = [];
  if (cv)
    for (let k = 0; k < Math.min(m.boss.covers ?? 0, cv.at.length); k++) {
      const c = { x: round3((k % 2 === 0 ? 1 : -1) * cv.x * 2 * finishHalf), z: round3(zZone + cv.at[k]! * (zSummit - zZone)), r: cv.r, h: cv.h };
      covers.push(c);
      seg.push({ type: 'cover', z: c.z, x: c.x, y, r: c.r, h: c.h, zone: K });
    }
  seg.push({
    type: 'gate',
    z: zSummit,
    y,
    kind: 'boss',
    boss: true,
    requires: m.boss.requires,
    reward: { coins: balance.coins.gatePass * m.boss.gift },
    speed: m.boss.speed,
    margin: m.boss.margin,
    height: 0,
    signHeight: O.signHeight,
    wall: K,
    zone: K,
    rarity: finish.rarity,
  });

  // Summit (docs/01-gdd.md 5.2): chest, portal, treadmill ×1.5 of the finish straight rounded up along the series.
  seg.push({ type: 'floor', z: zSummit, length: spec.summitLength, y });
  seg.push({ type: 'summit', z: zSummit, y, wall: K });
  seg.push({ type: 'checkpoint', z: zSummit + 3, y, x: 0, zone: K, rarity: finish.rarity, wall: K });
  seg.push({ type: 'treadmill', z: zSummit + 12, x: -8, y, length: 10, width: 6, mult: ceilToSeries(1.5 * m.boss.stepMult) });
  seg.push({ type: 'chest', z: zSummit + 30, x: 0, y, coins: balance.coins.chest * m.boss.gift });
  // The portal arch as wide as the spec says (docs/01-gdd.md 19.8): running up near the middle never misses it.
  const portal: Segment = { type: 'portal', z: zSummit + 50, x: 0, y, next: index + 1 <= spec.mountains.length ? index + 1 : null };
  if (spec.portalWidth) portal['width'] = spec.portalWidth;
  seg.push(portal);
  // The funnel (docs/01-gdd.md 20.2): snow walls from the edges of the slope to the portal pillars over funnelLength.
  const fl = spec.summit?.funnel ? spec.summit.funnelLength : 0;
  if (fl > 0) seg.push({ type: 'funnel', z: round3(portal.z - fl), length: fl, y, from: half, to: (spec.portalWidth ?? PORTAL_WIDTH) / 2, end: zSummit + spec.summitLength });
  fit(fromZone);

  const b = spec.boss;
  const boss: WorldBoss = {
    zone: [zZone, zSummit],
    requires: m.boss.requires,
    returnMult: m.boss.returnMult ?? b.returnMult,
    giants: [{ speed: m.boss.speed, patrol: b.patrol ?? 'alongZ', seeDist: m.boss.seeDist ?? b.seeDist, turnSec: m.boss.turnSec ?? b.turnSec }],
  };
  if (cv) {
    boss.width = round3(2 * finishHalf);
    boss.covers = covers;
  }
  // Two giants (docs/01-gdd.md 18.5): the same giant at each phase of its patrol.
  if (m.boss.giants) boss.giants = m.boss.giants.map((g) => ({ ...boss.giants[0]!, phase: g.phase }));
  // Helpers with snowballs on the borders of the zone (docs/01-gdd.md 18.5; docs/01a-content.md 17.4).
  const hp = b.helper;
  // At the edge of the zone as wide as it is (SP-04: hp.x is that inset on the spec's width).
  if (m.boss.helpers?.length && hp) boss.helpers = m.boss.helpers.map((h) => ({ side: h.side, x: (h.side === 'left' ? -1 : 1) * round3(finishHalf - (spec.width / 2 - hp.x)), throwEverySec: hp.throwEverySec, flightSec: hp.flightSec, slow: hp.slow, slowSec: hp.slowSec, hitRadius: hp.hitRadius }));
  const length = zSummit + spec.summitLength;
  const world: World = {
    id: m.id,
    index,
    length,
    width: round3(2 * maxHalf),
    spawnZ: spec.spawnZ,
    egg: m.egg,
    stretch: Math.max(...m.sections.map((s) => s.length)),
    wallCount: K,
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
      spawnMaxZ: zZone,
    },
    zones,
    segments: seg,
    treadmillMult: 1,
    layout: 'openSlope',
    bosses: [boss],
  };
  if (m.look !== undefined) world.look = m.look;
  // The width along the slope (SP-04): written only when it changes, so a spec of one width keeps its worlds.json.
  if (profile.some(([, h]) => h !== maxHalf)) world.profile = profile;
  return world;
}

/**
 * The step of a ridge at z0 (docs/01-gdd.md 17.3): the carniz top of the upper terrace (a block from the lower floor up,
 * so nothing passes under it) with three passages where a ramp climbs `ridgeRise` over `passLength`.
 */
function pushPassages(seg: Segment[], z0: number, yLow: number, yHigh: number, half: number, passes: readonly number[], len: number): void {
  const O = OPEN_SLOPE;
  const w = O.passWidth / 2;
  let x = -half;
  for (const px of passes) {
    if (px - w > x) seg.push({ type: 'floor', z: z0, length: len, y: yHigh, x0: round3(x), x1: round3(px - w), thickness: round3(yHigh - yLow + 2) });
    seg.push({ type: 'ramp', z: z0, length: len, y: yLow, rise: round3(yHigh - yLow), x0: round3(px - w), x1: round3(px + w) });
    x = px + w;
  }
  if (x < half) seg.push({ type: 'floor', z: z0, length: len, y: yHigh, x0: round3(x), x1: half, thickness: round3(yHigh - yLow + 2) });
}

/**
 * The crevasse of a split fork (SP-05, docs/01-gdd.md 20.5): the floors of the section across its middle are cut on
 * [f0, f1] — each lane's floor thick down to the crevasse bottom; in it pits at most `rampEvery` long, each a flat bottom
 * `depth` down, a slope up along the run and a bridge at the top level to both lanes; `bottomGifts` on the bottoms.
 */
function pushSplit(seg: Segment[], from: number, fork: [number, number], inner: number, y: number, half: number, cfg: NonNullable<Spec['forkSplit']>, gift: (z: number, x: number, y: number) => Segment): void {
  const [f0, f1] = fork;
  const thick = round3(cfg.depth + FLOOR_THICKNESS);
  const out: Segment[] = [];
  const n0 = (p: Segment, key: string, def: number): number => (typeof p[key] === 'number' ? (p[key] as number) : def);
  for (let k = from; k < seg.length; k++) {
    const p = seg[k] as Segment;
    const a = p.z;
    const b = p.z + n0(p, 'length', 0);
    const x0 = n0(p, 'x0', -half);
    const x1 = n0(p, 'x1', half);
    if (p.type !== 'floor' || p['y'] !== y || b <= f0 || a >= f1 || x0 > -inner || x1 < inner) continue;
    seg.splice(k--, 1);
    if (a < f0) out.push({ ...p, z: a, length: round3(f0 - a), thickness: thick });
    const lo = Math.max(a, f0);
    const hi = Math.min(b, f1);
    out.push({ ...p, z: round3(lo), length: round3(hi - lo), x0, x1: -inner, thickness: thick });
    out.push({ ...p, z: round3(lo), length: round3(hi - lo), x0: inner, x1, thickness: thick });
    if (b > f1) out.push({ ...p, z: f1, length: round3(b - f1), thickness: thick });
  }
  seg.push(...out);
  const n = Math.ceil((f1 - f0) / cfg.rampEvery - 1e-9);
  const P = (f1 - f0) / n;
  const R = 2 * cfg.depth;
  const bottom = P - R - SPLIT_BRIDGE;
  for (let k = 0; k < n; k++) {
    const za = f0 + k * P;
    seg.push({ type: 'floor', z: round3(za), length: round3(bottom), y: round3(y - cfg.depth), x0: -inner, x1: inner, material: 'ice', split: true });
    seg.push({ type: 'ramp', z: round3(za + bottom), length: R, y: round3(y - cfg.depth), rise: cfg.depth, x0: -inner, x1: inner, material: 'ice', split: true });
    seg.push({ type: 'floor', z: round3(za + bottom + R), length: SPLIT_BRIDGE, y, x0: -inner, x1: inner, thickness: thick, split: true });
  }
  for (let g = 0; g < cfg.bottomGifts; g++) {
    const k = Math.min(n - 1, Math.floor(((g + 0.5) * n) / cfg.bottomGifts));
    seg.push(gift(f0 + k * P + bottom / 2 + ((g % 2) - 0.5) * Math.min(8, bottom / 3), 0, round3(y - cfg.depth)));
  }
}

/** The field of a mountain (SP-04, docs/01a-content.md 19.2): its widest section, the first of equals; 1-based. */
export function fieldOf(m: Pick<Mountain, 'sections'>): number {
  let best = 0;
  m.sections.forEach((s, k) => {
    if ((s.width ?? 0) > (m.sections[best]?.width ?? 0)) best = k;
  });
  return best + 1;
}

/**
 * The passages of a ridge as wide as 2 × half (SP-04, docs/01a-content.md 19.2): one every `passEvery` units of width,
 * the nearest whole number from 3 to 7, evenly (an even number leaves the axis to the carniz; `passAxis` — the nearest odd
 * one); without passEvery — 16.5.
 */
export function passesOf(spec: Pick<Spec, 'passEvery' | 'passAxis'>, half: number): number[] {
  if (!spec.passEvery) return [...OPEN_SLOPE.passes];
  const f = (2 * half) / spec.passEvery;
  let n = Math.min(7, Math.max(3, Math.round(f)));
  // Q-064: with passAxis the nearest odd number — a passage on the axis, where the run goes straight up.
  if (spec.passAxis && n % 2 === 0) n = f >= n ? Math.min(7, n + 1) : n - 1;
  const step = (2 * half) / n;
  return Array.from({ length: n }, (_, k) => round3((k - (n - 1) / 2) * step));
}

/** Camp of the open slope: as 5.2 — spawn, treadmill of section 1, egg stand, tents, a snowman, arrows up the slope. */
function pushOpenCamp(seg: Segment[], spec: Spec, m: Mountain): void {
  const camp = spec.campLength;
  seg.push({ type: 'floor', z: 0, length: camp, y: 0 });
  seg.push({ type: 'treadmill', z: spec.spawnZ - 10, x: -8, y: 0, length: 10, width: 6, mult: m.sections[0]?.stepMult ?? 1 });
  seg.push({ type: 'eggStand', z: 30, x: 8, y: 0, egg: m.egg });
  seg.push({ type: 'decor', z: 6, x: -11, y: 0, kind: 'tent' });
  seg.push({ type: 'decor', z: 12, x: 11, y: 0, kind: 'tent' });
  seg.push({ type: 'decor', z: 34, x: -24, y: 0, kind: 'tree' });
  seg.push({ type: 'decor', z: 36, x: 24, y: 0, kind: 'tree' });
  seg.push({ type: 'decor', z: 8, x: 4, y: 0, kind: 'snowman' });
  for (let a = 0; a < 3; a++) seg.push({ type: 'decor', z: 26 + a * 4, x: 0, y: 0, kind: 'arrow' });
}

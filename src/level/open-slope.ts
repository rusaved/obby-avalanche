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
import type { Segment, World, WorldBoss, WorldZone, WorldsSpecJson, OpenSpecJson, OpenSpecMountain, TuningJson } from '../content/types.ts';
import { PAD_SIZE, SLIDE_LENGTH, SLIDE_WIDTH } from './pad-arc.ts';
import { blockedFor, chasmFloorY, planSection, pushChasmFloor, pushShapes, type SectionPlan } from './open-shapes.ts';
import { moveSpeed } from '../sim/effects/moveSpeed.ts';

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

/** The fork of section of length L starting at z0: [start, end) or null (docs/01a-content.md 16.5: 5–40%). */
export function forkRange(z0: number, L: number): [number, number] {
  const F = OPEN_SLOPE.fork;
  const a = round3(z0 + F.start * L);
  return [a, round3(a + Math.min(F.max, Math.max(F.min, F.share * L)))];
}

function generateOpenWorld(spec: Spec, balance: OpenInput['balance'], index: number, m: Mountain, tuning: OpenInput['tuning'], carried: number): World {
  const O = OPEN_SLOPE;
  const S = m.sections.length;
  if (m.ridges.length !== S) throw new Error(`${m.id}: ${S} sections need ${S} ridges, found ${m.ridges.length}`);
  const camp = spec.campLength;
  const half = spec.width / 2;
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
    const zA = round3(z0 + O.approach.start * L);
    const zB = round3(zA + O.approach.length);
    const yTop = y + O.approachRise;
    // Floors: the carniz top with the passage ramps (from section 2), the slope, the approach rise, the top before the ridge.
    let zFlat = z0;
    if (j >= 2) {
      zFlat = z0 + O.passLength;
      pushPassages(seg, z0, y - O.ridgeRise, y, half);
    }
    seg.push({ type: 'ramp', z: zA, length: round3(zB - zA), y, rise: O.approachRise });
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
        fork: sec.fork,
        z0,
        L,
        y,
        flag: O.flag,
        forkCfg: O.fork,
        grotto: G,
        vmin: speedOf(balance, tuning, stat(j - 1)),
        vmax: speedOf(balance, tuning, stat(j)),
        tuning,
      });
    }
    const plainFork = !plan?.tunnel && !plan?.hump;

    // Fork (docs/01-gdd.md 17.7): a cliff down the middle; the bold lane alternates sides by section. Over a tunnel the
    // cliff is as tall as the tunnel's roof (its inner wall).
    const fork = plan ? plan.fork : sec.fork ? forkRange(z0, L) : null;
    const bold: 'left' | 'right' = j % 2 === 0 ? 'right' : 'left';
    const forkHeight = plan?.tunnel ? plan.tunnel.height + 2 : O.fork.height;
    if (fork) seg.push({ type: 'fork', z: fork[0], length: round3(fork[1] - fork[0]), x: 0, y, width: O.fork.width, height: forkHeight, bold, section: j });

    // The grotto under the ridge closes the section; grottos between it and the flag below are spread evenly.
    const big = O.bigGrotto;
    const zRidgeGrotto = round3(z1 - big.exit - big.length / 2);
    const side = (n: number): 'left' | 'right' => (n % 2 === 1 ? 'left' : 'right');
    const base = j === 1 ? z0 : z0 - big.exit - big.length / 2;
    const flatLo = (j === 1 ? z0 : zFlat) + G / 2 + O.grottoClear;
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
        if (fork && zg >= fork[0] && zg <= fork[1]) {
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
          for (const s of ['left', 'right'] as const) if (free(s)) seg.push({ ...grottoAt(zg, s), lane: lane(s) });
        } else seg.push(grottoAt(zg, side(++nth)));
      }
    }
    seg.push({
      type: 'niche',
      z: zRidgeGrotto,
      y: yTop,
      side: side(j),
      kind: 'ridgeGrotto',
      length: big.length,
      depth: big.depth,
      treadmill: sec.stepMult,
      zone: j,
      stretch: j,
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
      const xb = sb * O.laneX;
      seg.push({ type: 'slide', z: round3(fork[0] + C.slideAt + SLIDE_LENGTH / 2), x: xb, y, width: SLIDE_WIDTH, length: SLIDE_LENGTH, stretch: j });
      for (let c0 = fork[0] + C.from; c0 + C.width <= fork[1] - 4; c0 += 1) {
        if (!free(c0, c0 + C.width)) continue;
        crevasse = [round3(c0), round3(c0 + C.width)];
        break;
      }
      if (crevasse) {
        const [c0, c1] = crevasse;
        const inner = (O.fork.width / 2) * sb;
        seg.push({ type: 'gap', z: c0, length: C.width, x0: Math.min(inner, sb * half), x1: Math.max(inner, sb * half), y, depth: C.depth, lane: 'bold' });
        seg.push({ type: 'jumpPad', z: round3(c0 - C.padBefore), x: xb, y, width: PAD_SIZE, length: PAD_SIZE, stretch: j });
        seg.push(gift(c0 + C.bottom / 2, xb, y - C.depth, sec.gift, { detour: true }));
        overHole.push([c0 - C.padBefore - PAD_SIZE / 2 - 1, c1 + 1]);
      }
      const K = O.cliff;
      const span = K.ramp + K.top;
      if (index >= 2) {
        for (let k0 = (crevasse ? crevasse[1] : fork[0] + C.from) + K.gap; k0 + span <= zA - 2; k0 += 1) {
          if (!free(k0, k0 + span)) continue;
          seg.push({ type: 'cliff', z: round3(k0), length: K.ramp, top: K.top, height: K.height, x0: Math.min(sb * K.x0, sb * K.x1), x1: Math.max(sb * K.x0, sb * K.x1), y, side: bold, zone: j, stretch: j });
          seg.push(gift(k0 + K.ramp + K.top / 2, (sb * (K.x0 + K.x1)) / 2, y + K.height, 2 * sec.gift, { detour: true }));
          break;
        }
      }
    }
    if (fork) {
      const H = O.chest;
      if (!chestDone && (H.sections as readonly number[]).includes(j)) {
        for (let zc = fork[1] + H.after + H.length / 2; zc + H.length / 2 <= flatHi; zc += 1) {
          if (!free(zc - H.length / 2, zc + H.length / 2)) continue;
          seg.push({ type: 'chestGrotto', z: round3(zc), y, side: bold, length: H.length, depth: H.depth, coins: H.gifts * sec.gift, zone: j, rarity: zone.rarity, stretch: j });
          chestDone = true;
          break;
        }
      }
    }
    // The floor of the section: whole, or round the crevasse — the calm half at the slope, the bold half down to its
    // bottom and up its slope; with a chasm (docs/01-gdd.md 18.3) round it too — steps down, its bottom, a ramp up.
    const crevasseFloor = (c0: number, c1: number): void => {
      const C = O.crevasse;
      const inner = (O.fork.width / 2) * sb;
      const calm: [number, number] = [Math.min(-sb * half, inner), Math.max(-sb * half, inner)];
      const boldX: [number, number] = [Math.min(inner, sb * half), Math.max(inner, sb * half)];
      seg.push({ type: 'floor', z: c0, length: C.width, y, x0: calm[0], x1: calm[1] });
      seg.push({ type: 'floor', z: c0, length: C.bottom, y: y - C.depth, x0: boldX[0], x1: boldX[1] });
      seg.push({ type: 'ramp', z: round3(c0 + C.bottom), length: round3(C.width - C.bottom), y: y - C.depth, rise: C.depth, x0: boldX[0], x1: boldX[1] });
    };
    if (plan) {
      const holes: Array<[number, number, 'chasm' | 'crevasse']> = [];
      if (plan.chasm) holes.push([plan.chasm.z0, plan.chasm.z1, 'chasm']);
      if (crevasse) holes.push([crevasse[0], crevasse[1], 'crevasse']);
      let cur = zFlat;
      for (const [a, b, kind] of holes.sort((p, q) => p[0] - q[0])) {
        seg.push({ type: 'floor', z: round3(cur), length: round3(a - cur), y });
        if (kind === 'chasm' && plan.chasm) pushChasmFloor(seg, plan.chasm, y, spec.shapes!);
        else crevasseFloor(a, b);
        cur = b;
      }
      seg.push({ type: 'floor', z: round3(cur), length: round3(zA - cur), y });
      pushShapes(seg, { plan, section: j, index, y, half, bold, laneX: O.laneX, forkWidth: O.fork.width, gift: sec.gift, rarity: zone.rarity, vmin: speedOf(balance, tuning, j >= 2 ? (m.ridges[j - 2] as { requires: number }).requires : carried), shapes: spec.shapes!, tuning: tuning! });
    } else if (crevasse) {
      const [c0, c1] = crevasse;
      seg.push({ type: 'floor', z: zFlat, length: round3(c0 - zFlat), y });
      crevasseFloor(c0, c1);
      seg.push({ type: 'floor', z: c1, length: round3(zA - c1), y });
    } else seg.push({ type: 'floor', z: zFlat, length: round3(zA - zFlat), y });

    // Gifts on the path (docs/01a-content.md 16.2): 12 a section, taken on the run; on a fork one on each lane, the bold one ×2.
    // With elements (docs/01-gdd.md 18.3): on the bottom of a chasm, ×fieldGifts on the field past a throat, none inside
    // a tunnel (its open lane ×openGifts), up the hump on its ramp.
    const fieldEnd = plan?.throat ? Math.min(plan.chasm?.z0 ?? Infinity, fork?.[0] ?? Infinity, zA) : -Infinity;
    for (let g = 0; g < O.pathGifts; g++) {
      const zg = round3(z0 + L * (O.giftSpan[0] + ((O.giftSpan[1] - O.giftSpan[0]) * g) / (O.pathGifts - 1)));
      let yg = zg < zA ? y : zg < zB ? round3(y + (O.approachRise * (zg - zA)) / (zB - zA)) : yTop;
      if (plan?.chasm && zg >= plan.chasm.z0 && zg <= plan.chasm.z1) yg = round3(chasmFloorY(plan.chasm, zg, y, spec.shapes!));
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
        if (!inTunnel) seg.push(pathGift(-sb * O.laneX, sec.gift, { lane: 'calm' }));
        const hu = plan?.hump;
        const boldY = hu && zg >= hu.z0 && zg <= hu.topEnd ? round3(y + hu.rise * Math.min(1, (zg - hu.z0) / (hu.crest - hu.z0))) : yg;
        const boldCoins = plan?.tunnel ? spec.shapes!.tunnel.openGifts * sec.gift : 2 * sec.gift;
        // Not over the crevasse and its trampoline: there the hero flies.
        if (!overHole.some(([a, b]) => zg >= a && zg <= b)) seg.push(pathGift(sb * O.laneX, boldCoins, { lane: 'bold' }, boldY));
      } else if (field) seg.push(pathGift(0, Math.round(spec.shapes!.throat.fieldGifts * sec.gift), { field: true }));
      else seg.push(pathGift(0, sec.gift));
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
      rise: O.ridgeRise,
      passes: [...O.passes],
      passWidth: O.passWidth,
      passLength: O.passLength,
      wall: j,
      zone: j,
      rarity: zone.rarity,
    });
    y = yTop + O.ridgeRise;
  });

  // The finish straight (docs/01-gdd.md 17.6): passage ramps up the last ridge, the grotto with the belt before the line,
  // the giant's zone from the line to the summit, 4 gifts on the path; the boss «gate» at the summit line is its check.
  const finish = zones[S] as WorldZone;
  const big = O.bigGrotto;
  const zZone = round3(zLast + spec.boss.zoneGap);
  pushPassages(seg, zLast, y - O.ridgeRise, y, half);
  seg.push({ type: 'floor', z: zLast + O.passLength, length: round3(zSummit - zLast - O.passLength), y });
  seg.push({ type: 'checkpoint', z: zLast + O.flag, y, x: 0, zone: K, rarity: finish.rarity, wall: S });
  seg.push({
    type: 'niche',
    z: round3(zZone - big.exit - big.length / 2),
    y,
    side: S % 2 === 0 ? 'left' : 'right',
    kind: 'bossLine',
    length: big.length,
    depth: big.depth,
    treadmill: m.boss.stepMult,
    zone: K,
    stretch: K,
  });
  for (let g = 0; g < O.bossGifts; g++) {
    const zg = round3(zZone + ((zSummit - zZone) * (g + 0.5)) / O.bossGifts);
    seg.push({ type: 'gift', z: zg, x: 0, y, height: 0, zone: K, rarity: finish.rarity, coins: m.boss.gift, n: g + 1, path: true });
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
  seg.push({ type: 'portal', z: zSummit + 50, x: 0, y, next: index + 1 <= spec.mountains.length ? index + 1 : null });

  const b = spec.boss;
  const boss: WorldBoss = {
    zone: [zZone, zSummit],
    requires: m.boss.requires,
    returnMult: m.boss.returnMult ?? b.returnMult,
    giants: [{ speed: m.boss.speed, patrol: 'alongZ', seeDist: m.boss.seeDist ?? b.seeDist, turnSec: m.boss.turnSec ?? b.turnSec }],
  };
  // Helpers with snowballs on the borders of the zone (docs/01-gdd.md 18.5; docs/01a-content.md 17.4).
  const hp = b.helper;
  if (m.boss.helpers?.length && hp) boss.helpers = m.boss.helpers.map((h) => ({ side: h.side, x: (h.side === 'left' ? -1 : 1) * hp.x, throwEverySec: hp.throwEverySec, flightSec: hp.flightSec, slow: hp.slow, slowSec: hp.slowSec, hitRadius: hp.hitRadius }));
  const length = zSummit + spec.summitLength;
  const world: World = {
    id: m.id,
    index,
    length,
    width: spec.width,
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
  return world;
}

/**
 * The step of a ridge at z0 (docs/01-gdd.md 17.3): the carniz top of the upper terrace (a block from the lower floor up,
 * so nothing passes under it) with three passages where a ramp climbs `ridgeRise` over `passLength`.
 */
function pushPassages(seg: Segment[], z0: number, yLow: number, yHigh: number, half: number): void {
  const O = OPEN_SLOPE;
  const w = O.passWidth / 2;
  let x = -half;
  for (const px of O.passes) {
    if (px - w > x) seg.push({ type: 'floor', z: z0, length: O.passLength, y: yHigh, x0: round3(x), x1: round3(px - w), thickness: round3(yHigh - yLow + 2) });
    seg.push({ type: 'ramp', z: z0, length: O.passLength, y: yLow, rise: round3(yHigh - yLow), x0: round3(px - w), x1: round3(px + w) });
    x = px + w;
  }
  if (x < half) seg.push({ type: 'floor', z: z0, length: O.passLength, y: yHigh, x0: round3(x), x1: half, thickness: round3(yHigh - yLow + 2) });
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

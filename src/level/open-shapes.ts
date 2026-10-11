// What: Elements of a section of the open slope (docs/01-gdd.md 18.3, 18.6): their slots and z ranges, where grottos may stand round them, their segments — chasm, throat, tunnel, hump.
// Called by: level/open-slope.ts (planSection, blockedFor, pushShapes); level/validate-open.ts and tests read SLOTS, sizeOf and the plan.
// Keep: Pure and deterministic like open-slope.ts; every size comes from worlds-spec.json shapes; an empty shape plans nothing (mountain 1 stays byte for byte).

/**
 * Elements of a section (docs/01-gdd.md 18.3, 18.6; docs/01a-content.md 17.1–17.2). Slots of the section length L:
 * the throat at its start (5–25%), the chasm across (25–40%), the fork with the tunnel on its calm lane or the hump on
 * its bold lane (40–75%), the landing grotto of the hump not past 80%. Each element is a marker segment (its type) plus
 * the parts the engine already has: floors, ramps, trampolines, slides; the builder adds the walls of a throat and a
 * tunnel. Every part of an element carries `shape` (its kind), so the bold lane of a plain fork stays countable.
 */
import type { OpenShapes, Segment, ShapeKind, TuningJson } from '../content/types.ts';
import { PAD_SIZE, padArc } from './pad-arc.ts';

/** Slots of an element as shares of the section (docs/01-gdd.md 18.6). */
export const SLOTS = {
  throat: [0.05, 0.25],
  chasm: [0.25, 0.4],
  fork: [0.4, 0.75],
  landing: 0.8,
} as const;

/** Units: the throat starts past the flag; steps down into a chasm; room before and after a tunnel on its fork. */
const THROAT_PAST_FLAG = 4;
export const CHASM_STEP = 1;
const CHASM_STEPS = 3;
const CHASM_BOTTOM_MIN = 3;
const FORK_TUNNEL_MARGIN = 10;
const FORK_HUMP_BEFORE = 6;
const FORK_HUMP_AFTER = 10;
/** The fork past a chasm starts this far beyond where its middle trampoline lands at the ceiling of the run. */
const CHASM_LAND_CLEAR = 6;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** The size of an element on mountain `index`: its `…ByWorld` value there or the default. */
export function sizeOf(base: number, byWorld: Record<string, number> | undefined, index: number): number {
  return byWorld?.[String(index)] ?? base;
}

export interface SectionPlan {
  throat: { z0: number; z1: number; width: number; funnel: number; height: number } | null;
  /** Grottos of the field just past the throat exit (a pair). */
  field: number | null;
  chasm: { z0: number; z1: number; depth: number } | null;
  /** The fork of a shaped section: in the slot 40–75%, long enough for its tunnel or hump. */
  fork: [number, number] | null;
  tunnel: { z0: number; z1: number; width: number; height: number } | null;
  hump: { z0: number; crest: number; topEnd: number; padZ: number; forward: number; rise: number; land: [number, number]; landEnd: number; grotto: number } | null;
}

export interface PlanInput {
  shapes: OpenShapes;
  index: number;
  shape: readonly ShapeKind[];
  fork: boolean;
  z0: number;
  L: number;
  y: number;
  /** The flag past the ridge below, units from the section start. */
  flag: number;
  /** Fork share, min and max length (open-slope.ts OPEN_SLOPE.fork). */
  forkCfg: { share: number; min: number; max: number };
  grotto: number;
  /** Run speed at the stat of the ridge below (minimum of the section) and of its own ridge. */
  vmin: number;
  vmax: number;
  tuning: Pick<TuningJson, 'controller' | 'fun'>;
}

/** z ranges of the elements of one section (docs/01-gdd.md 18.6); null fields for the elements it has not. */
export function planSection(p: PlanInput): SectionPlan {
  const S = p.shapes;
  const has = (k: ShapeKind): boolean => p.shape.includes(k);
  const plan: SectionPlan = { throat: null, field: null, chasm: null, fork: null, tunnel: null, hump: null };
  let after = p.z0;
  if (has('throat')) {
    const z0 = round3(p.z0 + Math.max(SLOTS.throat[0] * p.L, p.flag + THROAT_PAST_FLAG));
    const z1 = round3(z0 + sizeOf(S.throat.length, S.throat.lengthByWorld, p.index));
    plan.throat = { z0, z1, width: S.throat.width, funnel: S.throat.funnel, height: S.throat.height };
    plan.field = round3(z1 + 1 + p.grotto / 2);
    after = plan.field + p.grotto / 2 + 1;
  }
  if (has('chasm')) {
    const W = sizeOf(S.chasm.width, S.chasm.widthByWorld, p.index);
    const z0 = round3(Math.max(p.z0 + SLOTS.chasm[0] * p.L, after, plan.throat ? plan.throat.z1 + S.chasm.padBefore + PAD_SIZE : -Infinity));
    plan.chasm = { z0, z1: round3(z0 + W), depth: S.chasm.depth };
    // Nothing tall right past it: the middle trampoline at the ceiling of the run lands before the fork cliff.
    const rear = z0 - S.chasm.padBefore - PAD_SIZE / 2;
    const landMax = padArc(rear, p.y, p.tuning.controller.maxSpeed, p.tuning, () => p.y).landZ;
    after = Math.max(plan.chasm.z1 + p.grotto / 2 + 1, landMax + CHASM_LAND_CLEAR);
  }
  const tunnel = has('tunnel');
  const hump = has('hump');
  if (p.fork || tunnel || hump) {
    const a = round3(Math.max(p.z0 + SLOTS.fork[0] * p.L, after + 4));
    let end = a + Math.min(p.forkCfg.max, Math.max(p.forkCfg.min, p.forkCfg.share * p.L));
    if (tunnel) {
      const t0 = round3(a + FORK_TUNNEL_MARGIN);
      const t1 = round3(t0 + sizeOf(S.tunnel.length, S.tunnel.lengthByWorld, p.index));
      plan.tunnel = { z0: t0, z1: t1, width: S.tunnel.width, height: S.tunnel.height };
      end = Math.max(end, t1 + FORK_TUNNEL_MARGIN);
    }
    if (hump) {
      const H = S.hump;
      const h0 = round3(a + FORK_HUMP_BEFORE);
      const crest = round3(h0 + H.slideLength);
      const topEnd = round3(crest + H.top);
      const padZ = round3(crest + H.top / 2);
      const yTop = p.y + H.rise;
      const flat = (): number => p.y;
      // The hero leaves the crest on the slide boost (fun.slideMult) plus the pad's own forward push: at the minimum speed
      // of the section the flight is `flight` long (docs/01a-content.md 17.2); faster heroes fly farther.
      const rear = padZ - PAD_SIZE / 2;
      const t = padArc(rear, yTop, 0, { ...p.tuning, fun: { ...p.tuning.fun, padForward: 0 } }, flat).points.at(-1)!.t;
      const want = sizeOf(H.flight, H.flightByWorld, p.index);
      const forward = round3(Math.max(0, want / t - p.tuning.fun.slideMult * p.vmin));
      const land = (v: number): number => humpArc(rear, yTop, v, forward, p.tuning, flat).landZ;
      const l0 = round3(land(p.vmin));
      const l1 = round3(Math.max(l0, land(p.vmax)));
      const landEnd = round3(Math.max(l1, l0 + H.landing));
      plan.hump = { z0: h0, crest, topEnd, padZ, forward, rise: H.rise, land: [l0, l1], landEnd, grotto: round3(landEnd + 1 + p.grotto / 2) };
      end = Math.max(end, topEnd + FORK_HUMP_AFTER);
    }
    // A plain fork stays inside its slot; a tunnel or a hump takes the length it needs (the validator checks the slots).
    plan.fork = [a, round3(tunnel || hump ? end : Math.min(end, p.z0 + SLOTS.fork[1] * p.L))];
  }
  return plan;
}

/** The flight off a hump crest: the slide boost (fun.slideMult) and the pad's own `forward` push along +Z. */
export function humpArc(rear: number, y: number, v: number, forward: number, tuning: Pick<TuningJson, 'controller' | 'fun'>, floorYAt: (z: number) => number): ReturnType<typeof padArc> {
  return padArc(rear, y, tuning.fun.slideMult * v, { ...tuning, fun: { ...tuning.fun, padForward: forward } }, floorYAt);
}

/**
 * Where a grotto centre may not stand (docs/01-gdd.md 18.3): walls of a throat and the bottom of a chasm on both sides
 * (`side` null — only these); the tunnel on its calm side (the tunnel itself shelters); the hump ramp and crest on its bold side.
 */
export function blockedFor(plan: SectionPlan, side: 'left' | 'right' | null, bold: 'left' | 'right', grotto: number): Array<[number, number]> {
  const g = grotto / 2 + 1;
  const out: Array<[number, number]> = [];
  if (plan.throat) out.push([plan.throat.z0 - g, plan.throat.z1 + g]);
  if (plan.chasm) out.push([plan.chasm.z0 - g, plan.chasm.z1 + g]);
  if (plan.tunnel && side !== null && side !== bold) out.push([plan.tunnel.z0 - g, plan.tunnel.z1 + g]);
  if (plan.hump && side === bold) out.push([plan.hump.z0 - g, plan.hump.topEnd + g]);
  return out;
}

export interface ShapeContext {
  plan: SectionPlan;
  section: number;
  index: number;
  y: number;
  half: number;
  bold: 'left' | 'right';
  laneX: number;
  forkWidth: number;
  gift: number;
  rarity: string;
  vmin: number;
  shapes: OpenShapes;
  tuning: Pick<TuningJson, 'controller' | 'fun'>;
}

/**
 * The ground of a chasm (docs/01-gdd.md 18.3): steps down its near wall — low enough to walk back up them (stepUp), so a
 * hero on the bottom reaches a grotto behind it — a flat bottom, a ramp up the far wall (`ramp` long at most, 45° at most).
 */
export function chasmLayout(ch: NonNullable<SectionPlan['chasm']>, shapes: OpenShapes): { steps: number; rise: number; bottom: number; ramp: number } {
  const W = ch.z1 - ch.z0;
  const rise = ch.depth / (CHASM_STEPS + 1);
  const ramp = round3(Math.max(ch.depth, Math.min(shapes.chasm.ramp, W - CHASM_STEPS * CHASM_STEP - CHASM_BOTTOM_MIN)));
  return { steps: CHASM_STEPS, rise, bottom: round3(W - CHASM_STEPS * CHASM_STEP - ramp), ramp };
}

export function pushChasmFloor(seg: Segment[], ch: NonNullable<SectionPlan['chasm']>, y: number, shapes: OpenShapes): void {
  const { steps, rise, ramp } = chasmLayout(ch, shapes);
  // Ice, not snow: the crack reads from afar (docs/01-gdd.md 5.3 colour language).
  for (let k = 0; k < steps; k++) seg.push({ type: 'floor', z: round3(ch.z0 + k * CHASM_STEP), length: CHASM_STEP, y: round3(y - (k + 1) * rise), material: 'ice', shape: 'chasm' });
  const b0 = round3(ch.z0 + steps * CHASM_STEP);
  seg.push({ type: 'floor', z: b0, length: round3(ch.z1 - ramp - b0), y: round3(y - ch.depth), material: 'ice', shape: 'chasm' });
  seg.push({ type: 'ramp', z: round3(ch.z1 - ramp), length: ramp, y: round3(y - ch.depth), rise: ch.depth, material: 'ice', shape: 'chasm' });
}

/** Height of the ground at z inside a chasm (the centre of the slope), as pushChasmFloor lays it. */
export function chasmFloorY(ch: NonNullable<SectionPlan['chasm']>, z: number, y: number, shapes: OpenShapes): number {
  const { steps, rise, ramp } = chasmLayout(ch, shapes);
  if (z < ch.z0 + steps * CHASM_STEP) return y - (Math.floor((z - ch.z0) / CHASM_STEP) + 1) * rise;
  if (z < ch.z1 - ramp) return y - ch.depth;
  return y - ch.depth + (ch.depth * (z - (ch.z1 - ramp))) / ramp;
}

/** The marker and the parts of every element of the section (the floor and the grottos are pushed by the caller). */
export function pushShapes(seg: Segment[], c: ShapeContext): void {
  const { plan, y, section: j } = c;
  const gift = (z: number, x: number, yy: number, extra: Record<string, unknown>): Segment => ({
    type: 'gift',
    z: round3(z),
    x,
    y: round3(yy),
    height: 0,
    zone: j,
    rarity: c.rarity,
    coins: c.gift,
    n: 0,
    detour: true,
    ...extra,
  });
  const th = plan.throat;
  if (th) {
    seg.push({ type: 'throat', z: th.z0, length: round3(th.z1 - th.z0), y, width: th.width, funnel: th.funnel, height: th.height, section: j });
    // The ice slide the whole width of the throat (docs/01-gdd.md 18.3): ×slideMult of the throat.
    const len = round3(th.z1 - th.z0);
    seg.push({ type: 'slide', z: round3(th.z0 + len / 2), x: 0, y, width: th.width, length: len, mult: c.shapes.throat.slideMult, hold: c.shapes.throat.holdSec ?? 0, stretch: j, shape: 'throat' });
  }
  const ch = plan.chasm;
  if (ch) {
    const W = round3(ch.z1 - ch.z0);
    seg.push({ type: 'chasm', z: ch.z0, length: W, y, depth: ch.depth, section: j });
    const pz = round3(ch.z0 - c.shapes.chasm.padBefore);
    for (const x of [-c.laneX - 2, 0, c.laneX + 2]) seg.push({ type: 'jumpPad', z: pz, x, y, width: PAD_SIZE, length: PAD_SIZE, stretch: j, shape: 'chasm' });
    // Gifts in the air over the middle trampoline at the minimum speed, and on the bottom (docs/01a-content.md 17.2).
    const rear = pz - PAD_SIZE / 2 + (c.vmin / 60) / 2;
    const arc = padArc(rear, y, c.vmin, c.tuning, () => y);
    const air = c.shapes.chasm.giftsAir;
    for (let k = 0; k < air; k++) {
      const zg = ch.z0 + (W * (k + 1)) / (air + 1);
      const p = arc.points.find((q) => q.z >= zg) ?? arc.points[arc.points.length - 1]!;
      seg.push(gift(p.z, 0, p.y - 0.3, { air: true }));
    }
    const sb = c.bold === 'left' ? -1 : 1;
    const bottomX = [-9, 9, sb * 24];
    // On the bottom by the foot of the ramp: where a hero running off the edge comes down (and takes the one in his lane).
    const lay = chasmLayout(ch, c.shapes);
    const zb = ch.z1 - lay.ramp - 1;
    for (let k = 0; k < c.shapes.chasm.giftsBottom; k++) seg.push(gift(zb, bottomX[k % bottomX.length]!, y - ch.depth, { bottom: true }));
  }
  const sb = c.bold === 'left' ? -1 : 1;
  const tu = plan.tunnel;
  if (tu) {
    const calm = c.bold === 'left' ? 'right' : 'left';
    seg.push({ type: 'tunnel', z: tu.z0, length: round3(tu.z1 - tu.z0), y, side: calm, width: tu.width, height: tu.height, inner: c.forkWidth / 2, zone: j, stretch: j, section: j });
  }
  const hu = plan.hump;
  if (hu) {
    const inner = (c.forkWidth / 2) * sb;
    const x0 = Math.min(inner, sb * c.half);
    const x1 = Math.max(inner, sb * c.half);
    const xm = round3((x0 + x1) / 2);
    const w = round3(x1 - x0);
    const yTop = round3(y + hu.rise);
    const H = c.shapes.hump;
    seg.push({ type: 'hump', z: hu.z0, length: round3(hu.topEnd - hu.z0), y, rise: hu.rise, side: c.bold, x0, x1, land: hu.land, landEnd: hu.landEnd, section: j });
    seg.push({ type: 'ramp', z: hu.z0, length: H.slideLength, y, rise: hu.rise, x0, x1, material: 'ice', shape: 'hump' });
    seg.push({ type: 'floor', z: hu.crest, length: H.top, y: yTop, x0, x1, thickness: round3(hu.rise + 2), material: 'ice', shape: 'hump' });
    seg.push({ type: 'slide', z: round3(hu.z0 + H.slideLength / 2), x: xm, y, width: w, length: H.slideLength, rise: hu.rise, stretch: j, shape: 'hump' });
    seg.push({ type: 'jumpPad', z: hu.padZ, x: xm, y: yTop, width: w, length: PAD_SIZE, forward: hu.forward, slide: true, stretch: j, shape: 'hump' });
    // Six gifts along the flight at the minimum speed of the section (docs/01a-content.md 17.2).
    const arc = humpArc(hu.padZ - PAD_SIZE / 2, yTop, c.vmin, hu.forward, c.tuning, () => y);
    const T = arc.points[arc.points.length - 1]!.t;
    for (let k = 0; k < H.giftsAir; k++) {
      const t = T * (0.15 + (0.7 * k) / Math.max(1, H.giftsAir - 1));
      const p = arc.points.find((q) => q.t >= t) ?? arc.points[arc.points.length - 1]!;
      seg.push(gift(p.z, sb * c.laneX, p.y - 0.3, { air: true }));
    }
  }
}

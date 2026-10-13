// What: Bots on the track: a deterministic kinematic state machine (camp, climb, treadmill, hide in caves, snowball roll, return) that keeps the mountain alive.
// Called by: sim/world.ts (createBots, stepped every tick); tests/sim/bots.test.ts
// Keep: Deterministic by the seed (createRng, no Math.random); bots never take gifts nor pass a wall closed for the hero; no collisions; numbers from bots.json, balance.

/**
 * Bots on the track (docs/01-gdd.md 4.7, 7.12; docs/01a-content.md 12): characters of the game, not players — a
 * state machine in the simulation, deterministic by the seed. Up to the first wall closed for the hero, a treadmill
 * in the cave 10–30 s, up again; on warn most of them run to the nearest cave with a free place (two per cave), the
 * rest dawdle and roll into the cave below as a snowball. Bots never take gifts and never pass a wall closed for the
 * hero. A bot left far below the hero goes to the camp and comes back at his flag with a new name.
 * Kinematic: no collisions, feet on the track floor, lanes clear of obstacles. A trampoline on his way throws him up
 * along the arc of tuning fun.padSpeed, an ice slide speeds him × fun.slideMult (docs/01-gdd.md 16.4). Pure TS, no DOM.
 */
import type { BalanceJson, BotsJson, TuningJson } from '../content/types.ts';
import type { Aabb, LevelData, LevelNiche, LevelPoint, Vec3 } from '../level/types.ts';
import { NICHE_BELT_WIDTH } from '../level/builder.ts';
import { createRng, type Rng } from '../core/rng.ts';
import { caughtPosition, caughtTotalSec, createCaught, type CaughtState } from './caught.ts';
import { distToEntrance, entranceX, inSafeZone, nicheSign, shelterIndex } from './shelter.ts';
import { sheltersByRunTime, type ThreatState } from './threat.ts';

export type BotMode = 'off' | 'camp' | 'up' | 'wait' | 'treadmill' | 'hide' | 'ball' | 'away' | 'zone';

export interface BotLook {
  head: string;
  jacket: string;
  pants: string;
  hat: string;
  face: string;
}

export interface Bot {
  readonly index: number;
  /** i18n key of the name (bot.n01…), unique on the mountain while the bot is out. */
  name: string;
  look: BotLook;
  x: number;
  y: number;
  z: number;
  /** Facing (same convention as the hero: atan2(dx, dz)); `moving` drives the run pose. */
  yaw: number;
  moving: boolean;
  mode: BotMode;
  /** Seconds left in camp, wait, treadmill or away. */
  timer: number;
  speedFactor: number;
  /** Its lane: a share 0…1 across the free width of the slope where it runs (SP-04: every section its own width). */
  lane: number;
  /** Cave the bot sits in or runs to (−1 none) and its place there (0 or 1). */
  cave: number;
  spot: number;
  path: Array<[number, number]>;
  ball: CaughtState | null;
  /** Number of the last wave the front already went over this bot. */
  wave: number;
  /** Seconds since a trampoline threw him up (−1 on the floor) and of the slide boost left. */
  hop: number;
  slide: number;
  /** Feet height where the trampoline threw him (the flight is counted from it, over a chasm too). */
  hopY: number;
  /** The boost of the last slide (its own `mult`, a throat). */
  slideK: number;
  /** z of the last tunnel fork he chose a lane for (docs/01-gdd.md 18.3), −∞ none yet. */
  tunnelFork: number;
  /** The giant's zone (docs/01-gdd.md 18.5): seconds left to wait before it, then his run speed through it (0 — not running). */
  zoneWait: number;
  zoneSpeed: number;
  /** A rolling snowball hit him (docs/01-gdd.md 18.4): seconds of the tumble left, then × slowK for slowLeft s. */
  tumble: number;
  slowK: number;
  slowLeft: number;
}

export interface BotContext {
  hero: { x: number; z: number };
  /** z of the hero's flag (last checkpoint), the camp spawn before the first one. */
  flagZ: number;
  gatesOpen: readonly boolean[];
  threat: Pick<ThreatState, 'phase' | 'frontZ' | 'spawnZ'> | null;
  /** Run speed of the hero on the stretch below z: speed of the stat that opened the wall under it. */
  speedAt(z: number): number;
  /** Zones of giants (docs/01-gdd.md 18.5): active until the hero has passed it, the giant's speed; absent — none. */
  giants?: ReadonlyArray<{ zone: readonly [number, number]; active: boolean; speed: number }>;
  /** The blizzard (docs/01-gdd.md 18.4): run speed × this at z; absent — 1. */
  slowAt?(z: number): number;
}

export interface BotsOptions {
  cfg: BotsJson;
  /** How many bots are out (bots.json count for the quality level). */
  count: number;
  seed: number;
  caught?: BalanceJson['caught'] | undefined;
  avalanche?: Pick<TuningJson['avalanche'], 'caughtFormSec' | 'caughtPopSec' | 'ballBounce'>;
  graceDist: number;
  /** Trampolines and slides on the way (docs/01-gdd.md 16.4); absent — the bots walk over them. */
  fun?: { cfg: Pick<TuningJson['fun'], 'padSpeed' | 'slideMult' | 'slideSec'>; gravity: number } | undefined;
  /** The base (docs/01-gdd.md 19.2): every bot runs in place on one of these belt spots for good. */
  belts?: ReadonlyArray<{ x: number; z: number }> | undefined;
}

export interface BotCrowd {
  readonly list: Bot[];
  /** Bots out on the mountain now (quality low lowers it); the others are `off`. */
  limit: number;
  /** Decisions on warn since the start: bots on the slope that ran to a cave or dawdled, and snowballs. */
  readonly stats: { hid: number; dawdled: number; caught: number };
  step(dt: number, ctx: BotContext): void;
  /** Bots running a giant's zone now (docs/01-gdd.md 18.5), for the giants to go at. */
  runners(): Array<{ bot: number; x: number; z: number; speed: number }>;
  /** The giant slapped bot `index`: it rolls back as a snowball to `toZ` (below the start of the zone) and tries again. */
  giantSlap(index: number, toZ: number): void;
  /** A rolling snowball hit bot `index` (docs/01-gdd.md 18.4): it stands for `sec`, then runs × slow for slowSec. */
  tumble(index: number, sec: number, slow: number, slowSec: number): void;
}

/** Places in a cave beside the belt (docs/01-gdd.md 4.3: the hero and two bots). */
export const CAVE_SPOTS = 2;
/** A bot stops this far below the plane of a closed wall. */
const GATE_STOP = 2.5;
/** A bot moves over to its lane of the next band (section, SP-04) within this many units past its start. */
const LANE_SHIFT = 16;
/** ...through a change of width (SP-04, at most a passage and widthTaper 40 long) in steps this long. */
const LANE_STEP = 4;
const LANE_SHIFT_MAX = 64;
/** Waypoint reached within this distance. */
const REACH = 0.4;
/** Half the width of a bot plus a margin: lanes keep this far from obstacles and the side borders. */
const LANE_MARGIN = 2;
/** The bot walks out of a cave to this far inside the track edge (the mouth). */
const MOUTH_INSET = 2;
/** Boxes that are not obstacles on the slope (the walls of throats and tunnels squeeze the lanes only along them). */
const NOT_OBSTACLE = new Set(['floor', 'border', 'nicheFloor', 'nicheWall', 'nicheRoof', 'throatWall', 'tunnelWall', 'tunnelRoof']);
/** Camp places keep this far from the middle of the track and from props (tent, tree, egg stand, belt). */
const CAMP_CLEAR_MID = 4;
const CAMP_CLEAR_PROP = 3.5;
/** A bot picks the tunnel or the open lane this far before the fork of a tunnel (docs/01-gdd.md 18.3). */
const TUNNEL_PICK = 30;
/** A bot stops this far below the start of a giant's zone, by the grotto there (docs/01-gdd.md 18.5). */
const ZONE_STOP = 3;
/** Wait at a closed wall before the cave again, seconds. */
const WAIT_SEC: [number, number] = [1, 4];

/** Free x intervals across the track: the track minus every obstacle standing on it, with a margin; with [z0, z1] — the
 * track as wide as it is there and the obstacles there only (SP-04), `inset` in from each border. */
export function laneIntervals(level: LevelData, z0 = -Infinity, z1 = Infinity, inset = LANE_MARGIN): Array<[number, number]> {
  const e = Number.isFinite(z1) ? level.halfAt(z1 - 1) : level.width / 2;
  const m = Math.max(LANE_MARGIN, inset);
  let free: Array<[number, number]> = [[-e + m, e - m]];
  // The crevasse of a split fork (SP-05) in this stretch: no lane down it.
  const holes: Aabb[] = level.forks.flatMap((f) => (f.x0 !== undefined && f.x1 !== undefined && f.z1 >= z0 && f.z0 <= z1 ? [{ min: [f.x0, 0, f.z0] as Vec3, max: [f.x1, 0, f.z1] as Vec3 }] : []));
  for (const b of [...level.boxes.filter((x) => x.solid && !NOT_OBSTACLE.has(x.kind)), ...holes]) {
    if (b.max[2] < z0 || b.min[2] > z1) continue;
    const lo = b.min[0] - LANE_MARGIN;
    const hi = b.max[0] + LANE_MARGIN;
    free = free.flatMap(([a, c]): Array<[number, number]> => {
      if (hi <= a || lo >= c) return [[a, c]];
      const out: Array<[number, number]> = [];
      if (lo > a) out.push([a, lo]);
      if (hi < c) out.push([hi, c]);
      return out;
    });
  }
  return free.length ? free : [[0, 0]];
}

/** Where place `spot` of cave `n` is: on the belt at the back wall, towards its ends, clear of the side walls
 * (playtest M2: the belt runs the whole cave; the egg stands off it on the mouth side). */
export function caveSpot(n: LevelNiche, spot: number): { x: number; z: number } {
  const half = (n.box.max[2] - n.box.min[2]) / 2;
  // A grotto in a rock (SP-04): its belt runs along its middle.
  const x = n.kind === 'island' ? (n.box.min[0] + n.box.max[0]) / 2 : n.side === 'left' ? n.box.min[0] + NICHE_BELT_WIDTH / 2 : n.box.max[0] - NICHE_BELT_WIDTH / 2;
  return { x, z: n.z + (spot === 0 ? -1 : 1) * (half - 1.8) };
}

export function createBots(level: LevelData, opts: BotsOptions): BotCrowd {
  const { cfg } = opts;
  const rng: Rng = createRng(opts.seed);
  const campTop = level.safeZones[0]?.[1] ?? 0;
  const summit = level.safeZones[level.safeZones.length - 1] ?? [level.length, level.length];
  // Bands of the slope (SP-04): the camp, every section, the summit — each its width and its free lanes; a bot keeps its
  // share of the free width and moves over to it in the first LANE_SHIFT units of the next band.
  const breaks = [...new Set([0, ...level.sections.map((s) => s.z0), ...level.sections.map((s) => s.z1), level.length])].sort((a, b) => a - b);
  const bands = breaks.slice(0, -1).map((z0, k) => {
    const lanes = laneIntervals(level, z0, breaks[k + 1]!, (cfg.laneSpread ?? 0) / 2);
    return { z0, z1: breaks[k + 1]!, lanes, width: lanes.reduce((sum, [a, b]) => sum + (b - a), 0) };
  });
  /** x of the lane share u at z: inside the edge there (a band starts with its change of width, SP-04). */
  const laneAt = (u: number, z: number): number => {
    const band = bands.find((b) => z < b.z1) ?? bands[bands.length - 1]!;
    const e = Math.max(0, level.halfAt(z) - LANE_MARGIN);
    let t = u * band.width;
    for (const [a, b] of band.lanes) {
      if (t <= b - a) return Math.max(-e, Math.min(e, a + t));
      t -= b - a;
    }
    return Math.max(-e, Math.min(e, band.lanes[0]![0]));
  };
  /** The lane share u moved onto side `side` (−1 left, +1 right) of the band at z, keeping its place within the side
   * (the lanes of a band are not symmetric: rocks cut them, SP-04). */
  const toSide = (u: number, z: number, side: number): number => {
    const band = bands.find((b) => z < b.z1) ?? bands[bands.length - 1]!;
    const left = band.lanes.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, -LANE_MARGIN) - a), 0);
    const f = band.width > 0 ? left / band.width : 0.5;
    return side < 0 ? u * f * 0.98 : f + (1 - f) * (0.02 + 0.98 * u);
  };
  /** Up lane u from z0 to z1: its x at z0, over to the next band's x past every band start — inside the edge of a
   * change of width (it widens past the ridge's passages) — its x at z1. */
  const laneWay = (u: number, z0: number, z1: number): Array<[number, number]> => {
    // Down the slope: the same way back.
    if (z1 < z0) return laneWay(u, z1, z0).reverse();
    const pts: Array<[number, number]> = [[laneAt(u, z0), z0]];
    for (const b of bands) {
      if (b.z0 <= z0 || b.z0 >= z1) continue;
      const xa = laneAt(u, b.z0 - 0.01);
      const xb = laneAt(u, b.z0 + 0.01);
      pts.push([xa, b.z0]);
      const inEdge = (x: number, z: number): number => Math.sign(x) * Math.min(Math.abs(x), level.halfAt(z) - LANE_MARGIN);
      for (let z = b.z0 + LANE_STEP; z < Math.min(z1, b.z0 + LANE_SHIFT_MAX); z += LANE_STEP) {
        const want = xa + (xb - xa) * Math.min(1, (z - b.z0) / LANE_SHIFT);
        const x = inEdge(want, z);
        pts.push([x, z]);
        if (x === want && z >= b.z0 + LANE_SHIFT) break;
      }
    }
    pts.push([laneAt(u, z1), z1]);
    return pts;
  };
  const halfAt = (z: number): number => level.halfAt(z);
  const range = (r: readonly [number, number]): number => rng.range(r[0], r[1] + 1e-9);
  const pickLane = (): number => rng.next();
  const look = (): BotLook => ({
    head: rng.pick(cfg.palette.heads),
    jacket: rng.pick(cfg.palette.jackets),
    pants: rng.pick(cfg.palette.pants),
    hat: rng.pick(cfg.palette.hats),
    face: rng.pick(cfg.palette.faces),
  });
  // Names: a shuffled pool; a bot that comes back takes a name nobody on the mountain wears.
  const pool = [...cfg.names];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const takeName = (): string => pool.shift() ?? '';
  const giveName = (name: string): void => {
    if (name) pool.push(name);
  };

  const stats = { hid: 0, dawdled: 0, caught: 0 };
  /** Zones of giants still guarded (the hero has not passed them), from the last context (docs/01-gdd.md 18.5). */
  let guarded: ReadonlyArray<{ zone: readonly [number, number]; active: boolean; speed: number }> = [];
  let weather: (z: number) => number = () => 1;
  let dawdleDebt = 0;
  let waveNo = 0;
  let lastPhase: string = 'idle';

  // Camp places: out of the hero's way up the middle, clear of tents, trees, the egg stand and the belt.
  const props = level.points.filter((p) => p.type === 'decor' || p.type === 'eggStand' || p.type === 'treadmill');
  const campSpot = (): { x: number; z: number } => {
    const halfW = halfAt(campTop / 2);
    let best = { x: halfW - LANE_MARGIN, z: campTop - 4 };
    for (let k = 0; k < 30; k++) {
      const x = (rng.chance(0.5) ? -1 : 1) * rng.range(CAMP_CLEAR_MID, halfW - LANE_MARGIN);
      const z = rng.range(campTop / 2, campTop - 2);
      const clear = props.every((p) => {
        const hw = (typeof p['width'] === 'number' ? (p['width'] as number) / 2 : 0) + CAMP_CLEAR_PROP;
        const hl = (typeof p['length'] === 'number' ? (p['length'] as number) / 2 : 0) + CAMP_CLEAR_PROP;
        return Math.abs(p.x - x) > hw || Math.abs(p.z - z) > hl;
      });
      if (clear && Math.abs(z - level.spawn[2]) > CAMP_CLEAR_PROP) return { x, z };
      if (clear) best = { x, z };
    }
    return best;
  };
  const list: Bot[] = [];
  const campCount = Math.min(cfg.spawnCampMax, opts.count);
  for (let i = 0; i < opts.count; i++) {
    const inCamp = i < campCount;
    const spot = inCamp ? campSpot() : null;
    const z = spot ? spot.z : rng.range(campTop + 10, Math.max(campTop + 12, firstStop(campTop) - 10));
    const bot: Bot = {
      index: i,
      name: takeName(),
      look: look(),
      x: spot ? spot.x : 0,
      y: 0,
      z,
      yaw: 0,
      moving: false,
      mode: inCamp ? 'camp' : 'up',
      timer: inCamp ? range(cfg.campReleaseSec) : 0,
      speedFactor: range(cfg.speedFactor),
      lane: pickLane(),
      cave: -1,
      spot: 0,
      path: [],
      ball: null,
      wave: 0,
      hop: -1,
      slide: 0,
      hopY: 0,
      slideK: 1,
      tunnelFork: -Infinity,
      zoneWait: 0,
      zoneSpeed: 0,
      tumble: 0,
      slowK: 1,
      slowLeft: 0,
    };
    if (!inCamp) bot.x = laneAt(bot.lane, bot.z);
    const belt = opts.belts?.[i % opts.belts.length];
    if (belt) {
      bot.x = belt.x;
      bot.z = belt.z;
      bot.mode = 'treadmill';
      bot.moving = true;
    }
    bot.y = level.floorYAt(bot.z);
    list.push(bot);
  }

  /** The first wall above z that is closed for the hero, as a stop point; the summit when all are open. A guarded
   * giant's zone ahead stops the bot by its start (it waits there and runs the zone). */
  function firstStop(z: number, gatesOpen?: readonly boolean[]): number {
    let stop = (summit[0] + summit[1]) / 2;
    level.gates.forEach((g, i) => {
      if (gatesOpen?.[i]) return;
      const at = g.box.min[2] - GATE_STOP;
      if (g.z > z && at < stop) stop = at;
    });
    if (cfg.boss) for (const gz of guarded) if (gz.active && gz.zone[0] - ZONE_STOP > z - REACH && gz.zone[0] - ZONE_STOP < stop) stop = gz.zone[0] - ZONE_STOP;
    return stop;
  }
  const stretchOf = (z: number): number => level.gates.filter((g) => g.z <= z).length;
  const inCave = (b: Bot): boolean => Math.abs(b.x) > halfAt(b.z);
  const rocks = level.niches.filter((n) => n.kind === 'island');
  /** Out of where he stands: a cave of the edge — to its mouth; a grotto in a rock (SP-04) — out of its mouth below. */
  const exitPts = (b: Bot): Array<[number, number]> => {
    if (inCave(b)) return [[Math.sign(b.x) * (halfAt(b.z) - MOUTH_INSET), b.z]];
    const r = rocks.find((n) => b.x >= n.box.min[0] && b.x <= n.box.max[0] && b.z >= n.box.min[2] && b.z <= n.box.max[2]);
    return r ? [[entranceX(level, r), r.box.min[2] - MOUTH_INSET]] : [];
  };
  const occupied = (cave: number, except: Bot): number[] =>
    list.filter((o) => o !== except && o.cave === cave && (o.mode === 'treadmill' || o.mode === 'hide')).map((o) => o.spot);

  /** Route: out of a cave to its mouth, sideways to the lane, along the lane, then to the target (into a cave). */
  const routeTo = (b: Bot, z: number, cave: number, spot: number): void => {
    const n = level.niches[cave];
    b.cave = cave;
    b.spot = spot;
    if (n?.kind === 'tunnel') {
      // A tunnel (docs/01-gdd.md 18.3) shelters along its whole hall: in it — stay; else to its nearer point along the lane.
      const mx = (n.box.min[0] + n.box.max[0]) / 2;
      const tz = Math.min(n.box.max[2] - 1, Math.max(n.box.min[2] + 1, b.z));
      const inside = b.x >= n.box.min[0] && b.x <= n.box.max[0] && b.z >= n.box.min[2] && b.z <= n.box.max[2];
      b.path = inside ? [] : [...exitPts(b), [mx, b.z < tz ? b.z : tz], [mx, tz]];
      return;
    }
    if (n?.kind === 'island' && b.x >= n.box.min[0] && b.x <= n.box.max[0] && b.z >= n.box.min[2] && b.z <= n.box.max[2]) {
      // Already in this rock (SP-04): stay in its middle.
      b.path = [[entranceX(level, n), n.z]];
      return;
    }
    if (n && inCave(b) && Math.abs(b.z - n.z) <= (n.box.max[2] - n.box.min[2]) / 2 && Math.sign(b.x) === nicheSign(n)) {
      // Already inside this cave: straight to the place.
      const s = caveSpot(n, spot);
      b.path = [[s.x, s.z]];
      return;
    }
    const pts: Array<[number, number]> = [...exitPts(b)];
    // On along the lane from where he is out (a rock's mouth is below him, SP-04).
    const from = pts.length > 0 ? pts[pts.length - 1]![1] : b.z;
    // A grotto in a rock (SP-04): along the lane up to the level of its mouth, not past the rock.
    if (n?.kind === 'island') z = n.box.min[2] - MOUTH_INSET;
    const f = level.funnel;
    if (f && z > f.z0 && b.z < z) {
      // The summit funnel (docs/01-gdd.md 20.2): up the lane to its mouth, then on inside its walls.
      const lim = Math.max(0, f.x0 + (f.x1 - f.x0) * Math.min(1, (z - f.z0) / (f.z1 - f.z0)) - LANE_MARGIN);
      if (b.z < f.z0) pts.push(...laneWay(b.lane, from, f.z0));
      pts.push([Math.max(-lim, Math.min(lim, laneAt(b.lane, z))), z]);
    } else pts.push(...laneWay(b.lane, from, z));
    if (n) {
      const s = caveSpot(n, spot);
      // A grotto in a rock (SP-04) opens towards the camp: in through its mouth, never through a side wall.
      if (n.kind === 'island') pts.push([entranceX(level, n), n.box.min[2] - MOUTH_INSET], [entranceX(level, n), n.z]);
      else pts.push([entranceX(level, n) - nicheSign(n) * MOUTH_INSET, n.z], [s.x, s.z]);
    }
    b.path = pts;
  };
  // A tunnel ahead (docs/01-gdd.md 18.3): before its fork a bot picks the tunnel with bots.tunnelShare, else the open
  // lane — over to that side while the slope is still open.
  const tunnelForks = (level.shapes ?? []).flatMap((t) => {
    const f = t.kind === 'tunnel' ? level.forks.find((x) => t.z0 >= x.z0 && t.z0 <= x.z1) : undefined;
    return f && t.side ? [{ z0: f.z0, calm: t.side === 'left' ? -1 : 1 }] : [];
  });
  // A split fork without a tunnel (SP-05): its bold lane with bots.boldShare, else the calm one.
  const splitForks = level.forks.flatMap((f) => (f.x0 !== undefined && f.bold && !tunnelForks.some((t) => t.z0 === f.z0) ? [{ z0: f.z0, calm: f.bold === 'left' ? 1 : -1 }] : []));
  const pickSide = (b: Bot): void => {
    const f = splitForks.find((x) => b.z > x.z0 - TUNNEL_PICK && b.z < x.z0 - 2);
    if (!f || b.tunnelFork === f.z0 || cfg.boldShare === undefined) return;
    b.tunnelFork = f.z0;
    const want = rng.chance(cfg.boldShare) ? -f.calm : f.calm;
    if (Math.sign(laneAt(b.lane, f.z0 + 1)) === want) return;
    b.lane = toSide(b.lane, f.z0 + 1, want);
    const end = b.path[b.path.length - 1];
    if (end) b.path = laneWay(b.lane, Math.min(end[1], f.z0 - 1), end[1]);
  };
  const pickTunnel = (b: Bot): void => {
    const f = tunnelForks.find((x) => b.z > x.z0 - TUNNEL_PICK && b.z < x.z0 - 2);
    if (!f || b.tunnelFork === f.z0 || cfg.tunnelShare === undefined) return;
    b.tunnelFork = f.z0;
    const want = rng.chance(cfg.tunnelShare) ? f.calm : -f.calm;
    if (Math.sign(laneAt(b.lane, f.z0 + 1)) === want) return;
    b.lane = toSide(b.lane, f.z0 + 1, want);
    const end = b.path[b.path.length - 1];
    if (end) b.path = laneWay(b.lane, Math.min(end[1], f.z0 - 1), end[1]);
  };
  const goUp = (b: Bot, gatesOpen: readonly boolean[]): void => {
    b.mode = 'up';
    routeTo(b, firstStop(b.z, gatesOpen), -1, 0);
  };
  /** The cave in front of the wall the bot stands at (its stretch), with a free place, or −1. */
  const treadmillCave = (b: Bot): { cave: number; spot: number } | null => {
    const stretch = stretchOf(b.z) + 1;
    // A grotto of the open slope has no belt (docs/01-gdd.md 17.5): the one with the belt is under the ridge.
    const cave = level.niches.findIndex((n) => n.stretch === stretch && n.treadmill > 0);
    if (cave < 0) return null;
    const taken = occupied(cave, b);
    for (let s = 0; s < CAVE_SPOTS; s++) if (!taken.includes(s)) return { cave, spot: s };
    return null;
  };
  for (const b of list) if (b.mode === 'up') goUp(b, []);
  const toAway = (b: Bot): void => {
    giveName(b.name);
    b.name = '';
    b.mode = 'away';
    b.timer = range(cfg.awaySec);
    b.path = [];
    b.cave = -1;
    b.ball = null;
    b.moving = false;
  };

  /** Warn (docs/01-gdd.md 4.7): bots on the slope run to the nearest cave with a free place; every tenth dawdles. */
  const onWarn = (ctx: BotContext): void => {
    waveNo++;
    const order = list.filter((b) => b.mode === 'up' || b.mode === 'wait');
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const b of order) {
      if (inSafeZone(level, b.z)) continue;
      dawdleDebt += 1 - cfg.hideChance;
      if (dawdleDebt >= 1 - 1e-9) {
        dawdleDebt -= 1;
        stats.dawdled++;
        continue;
      }
      stats.hid++;
      const caves = sheltersByRunTime(level, ctx.gatesOpen, b.x, b.z);
      let target: { cave: number; spot: number } | null = null;
      for (const cave of caves) {
        // A tunnel has room for all (docs/01-gdd.md 18.3).
        if (level.niches[cave]!.kind === 'tunnel') {
          target = { cave, spot: 0 };
          break;
        }
        const taken = occupied(cave, b);
        const spot = [0, 1].find((s) => !taken.includes(s));
        if (spot !== undefined) {
          target = { cave, spot };
          break;
        }
      }
      if (!target && caves[0] !== undefined) target = { cave: caves[0], spot: 0 };
      if (!target) continue;
      b.mode = 'hide';
      routeTo(b, level.niches[target.cave]!.z, target.cave, target.spot);
    }
    // Bots already on a treadmill sit in their cave: they are hidden too.
    for (const b of list) if (b.mode === 'treadmill') b.mode = 'hide';
  };

  const ballPos = { x: 0, y: 0, z: 0 };
  const fun = opts.fun;
  const pads = fun ? level.points.filter((p) => p.type === 'jumpPad') : [];
  const slides = fun ? level.points.filter((p) => p.type === 'slide') : [];
  const on = (p: LevelPoint, x: number, z: number): boolean => Math.abs(x - p.x) <= (p['width'] as number) / 2 && Math.abs(z - p.z) <= (p['length'] as number) / 2;
  // Narrow places (docs/01-gdd.md 18.3): in a throat bots keep between its walls (closing in over its funnel); on the
  // side of a tunnel they keep inside its hall. Out on the track only, not in a cave.
  const narrows = (level.shapes ?? []).filter((n) => n.kind === 'throat' || n.kind === 'tunnel');
  /** Keeps the bot between the walls of a narrow place; true when it had to (it stood in a wall). */
  const squeeze = (b: Bot): boolean => {
    if (inCave(b)) return false;
    const x0 = b.x;
    for (const n of narrows) {
      if (b.z < n.z0 || b.z > n.z1) continue;
      if (n.kind === 'throat') {
        const f = n.funnel ?? 0;
        const k = f > 0 ? Math.min(1, (b.z - n.z0) / f, (n.z1 - b.z) / f) : 1;
        const e = halfAt(b.z);
        const lim = e - (e - n.x1) * k - LANE_MARGIN;
        b.x = Math.max(-lim, Math.min(lim, b.x));
      } else if ((n.side === 'left') === b.x < 0) b.x = Math.max(n.x0 + LANE_MARGIN, Math.min(n.x1 - LANE_MARGIN, b.x));
    }
    return b.x !== x0;
  };
  const move = (b: Bot, dt: number, speed: number): void => {
    const sl = slides.find((p) => on(p, b.x, b.z));
    if (sl) b.slideK = typeof sl['mult'] === 'number' ? (sl['mult'] as number) : (fun?.cfg.slideMult ?? 1);
    b.slide = sl ? Math.max(dt, typeof sl['hold'] === 'number' ? (sl['hold'] as number) : (fun?.cfg.slideSec ?? 0)) : Math.max(0, b.slide - dt);
    let left = speed * dt * (b.slide > 0 ? b.slideK : 1) * (b.slowLeft > 0 ? b.slowK : 1) * weather(b.z);
    b.moving = false;
    while (left > 0 && b.path.length > 0) {
      const [tx, tz] = b.path[0]!;
      const dx = tx - b.x;
      const dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      if (d <= REACH) {
        b.x = tx;
        b.z = tz;
        b.path.shift();
        continue;
      }
      const k = Math.min(1, left / d);
      b.x += dx * k;
      b.z += dz * k;
      b.yaw = Math.atan2(dx, dz);
      b.moving = true;
      if (k < 1) break;
      left -= d;
    }
    // A step sideways into a wall of a narrow place never ends: past it. Only when a wall stopped him (SP-02: out of a
    // cave anywhere on a mountain with a narrow place the step to the mouth was dropped, and the bot cut through the
    // cave wall and out past the fence).
    if (narrows.length && squeeze(b)) {
      const wp = b.path[0];
      if (wp && Math.abs(wp[1] - b.z) <= REACH && Math.abs(wp[0] - b.x) > REACH) b.path.shift();
    }
    // Feet on the ground where he is (open slope: down into a chasm, up a hump, docs/01-gdd.md 18.3); off the track
    // (in a cave) — the floor of the track centre at that z.
    const ground = level.floorAt(b.x, b.z);
    const floor = Number.isFinite(ground) ? ground : level.floorYAt(b.z);
    b.y = floor;
    if (!fun) return;
    if (b.hop >= 0) {
      b.hop += dt;
      const h = b.hopY + fun.cfg.padSpeed * b.hop - 0.5 * fun.gravity * b.hop * b.hop;
      if (h > floor) b.y = h;
      else b.hop = -1;
    } else if (b.moving && Math.cos(b.yaw) > 0 && pads.some((p) => on(p, b.x, b.z) && Math.abs(p.y - floor) < 1)) {
      b.hop = 0;
      b.hopY = floor;
    }
  };

  // The giant's zone (docs/01-gdd.md 18.5): at its start a bot waits in the grotto there, then runs it at the giant's
  // speed × speedK[1] (passShare of them: past him) or × speedK[0] (caught, rolled back, tries again).
  const zoneAhead = (b: Bot): (typeof guarded)[number] | undefined =>
    cfg.boss ? guarded.find((gz) => gz.active && Math.abs(b.z - (gz.zone[0] - ZONE_STOP)) <= 1.5) : undefined;
  const startZone = (b: Bot): void => {
    b.mode = 'zone';
    b.zoneWait = range(cfg.boss!.waitSec);
    b.zoneSpeed = 0;
    const place = treadmillCave(b);
    if (place) routeTo(b, level.niches[place.cave]!.z, place.cave, place.spot);
    else b.path = [];
  };
  const runZone = (b: Bot, gz: (typeof guarded)[number]): void => {
    const k = cfg.boss!.speedK;
    b.zoneSpeed = gz.speed * (rng.chance(cfg.boss!.passShare) ? k[1] : k[0]);
    b.cave = -1;
    const pts: Array<[number, number]> = [...exitPts(b)];
    // Over to the lane where he is out (below a rock's mouth, SP-04), then up it through the zone.
    const from = pts.length > 0 ? Math.min(pts[pts.length - 1]![1], gz.zone[0] - 1) : gz.zone[0] - 1;
    pts.push(...laneWay(b.lane, from, gz.zone[1] + 8));
    b.path = pts;
  };

  const crowd: BotCrowd = {
    list,
    limit: opts.count,
    stats,
    runners() {
      const out: Array<{ bot: number; x: number; z: number; speed: number }> = [];
      for (const b of list) if (b.mode === 'zone' && b.zoneSpeed > 0 && b.index < crowd.limit) out.push({ bot: b.index, x: b.x, z: b.z, speed: b.zoneSpeed });
      return out;
    },
    tumble(index, sec, slow, slowSec) {
      const b = list[index];
      if (!b) return;
      b.tumble = sec;
      b.slowK = slow;
      b.slowLeft = slowSec;
    },
    giantSlap(index, toZ) {
      const b = list[index];
      if (!b || b.mode !== 'zone' || !opts.caught || !opts.avalanche) return;
      b.mode = 'ball';
      b.zoneSpeed = 0;
      b.ball = createCaught(level, { x: b.x, y: b.y, z: b.z }, opts.caught, opts.avalanche, { x: b.x, y: level.floorYAt(toZ), z: toZ });
      b.path = [];
      b.cave = -1;
    },
    step(dt, ctx) {
      // On the base the bots only run on its belt.
      if (opts.belts?.length) return;
      guarded = ctx.giants ?? [];
      weather = ctx.slowAt ?? (() => 1);
      const phase = ctx.threat?.phase ?? 'idle';
      if (phase === 'warn' && lastPhase !== 'warn') onWarn(ctx);
      const heroStretch = stretchOf(ctx.hero.z);
      for (const b of list) {
        if (b.index >= crowd.limit) {
          if (b.mode !== 'off') {
            toAway(b);
            b.mode = 'off';
          }
          continue;
        }
        if (b.mode === 'off') {
          b.mode = 'away';
          b.timer = range(cfg.campReleaseSec);
        }
        // The front goes over the bot (docs/01-gdd.md 4.7): in a cave or a safe zone nothing happens, outside — a snowball.
        if (phase === 'run' && ctx.threat && b.wave !== waveNo && b.mode !== 'away' && ctx.threat.frontZ <= b.z && b.z <= ctx.threat.spawnZ) {
          b.wave = waveNo;
          const sheltered =
            inSafeZone(level, b.z) ||
            shelterIndex(level, opts.graceDist, b.x, b.y, b.z) >= 0 ||
            (b.mode === 'hide' && b.cave >= 0 && distToEntrance(level, level.niches[b.cave]!, b.x, b.z).dist < opts.graceDist);
          if (!sheltered && opts.caught && opts.avalanche && b.mode !== 'ball') {
            b.mode = 'ball';
            b.ball = createCaught(level, { x: b.x, y: b.y, z: b.z }, opts.caught, opts.avalanche);
            b.path = [];
            b.cave = -1;
            stats.caught++;
          }
        }
        // Hit by a rolling snowball: the tumble on the spot, then slowed (docs/01-gdd.md 18.4).
        if (b.tumble > 0 && b.mode !== 'ball') {
          b.tumble -= dt;
          b.moving = false;
          continue;
        }
        if (b.slowLeft > 0) b.slowLeft -= dt;
        // Left far below the hero: off to the camp, back later at his flag (docs/01-gdd.md 7.12).
        if (b.mode !== 'away' && b.mode !== 'ball' && b.mode !== 'hide' && heroStretch - stretchOf(b.z) > cfg.leashWalls) toAway(b);
        switch (b.mode) {
          case 'away': {
            b.timer -= dt;
            if (b.timer <= 0) {
              b.name = takeName();
              b.lane = pickLane();
              b.x = laneAt(b.lane, b.z);
              b.z = Math.min(ctx.flagZ, firstStop(ctx.flagZ, ctx.gatesOpen) - 1);
              b.y = level.floorYAt(b.z);
              b.hop = -1;
              b.wave = waveNo;
              goUp(b, ctx.gatesOpen);
            }
            break;
          }
          case 'camp': {
            b.timer -= dt;
            b.moving = false;
            if (b.timer <= 0 && phase !== 'warn' && phase !== 'run') goUp(b, ctx.gatesOpen);
            break;
          }
          case 'up': {
            if (tunnelForks.length) pickTunnel(b);
            if (splitForks.length) pickSide(b);
            const stop = firstStop(b.z, ctx.gatesOpen);
            // A wall opened on the way: the stop point moves up with it.
            const end = b.path[b.path.length - 1];
            if (end && Math.abs(end[1] - stop) > REACH) end[1] = stop;
            move(b, dt, b.speedFactor * ctx.speedAt(b.z));
            if (b.path.length === 0) {
              if (inSafeZone(level, b.z) && b.z >= summit[0]) {
                // On the summit: stay a little, then through the portal (away) and back at the flag.
                b.mode = 'wait';
                b.timer = range(cfg.treadmillSec);
              } else {
                b.mode = 'wait';
                b.timer = rng.range(WAIT_SEC[0], WAIT_SEC[1]);
              }
            }
            break;
          }
          case 'wait': {
            b.moving = false;
            if (zoneAhead(b)) {
              startZone(b);
              break;
            }
            b.timer -= dt;
            if (firstStop(b.z, ctx.gatesOpen) > b.z + GATE_STOP * 2 && b.z < summit[0]) {
              goUp(b, ctx.gatesOpen);
              break;
            }
            if (b.timer > 0) break;
            if (b.z >= summit[0]) {
              toAway(b);
              break;
            }
            const place = treadmillCave(b);
            if (place) {
              b.mode = 'treadmill';
              b.timer = range(cfg.treadmillSec);
              routeTo(b, level.niches[place.cave]!.z, place.cave, place.spot);
            } else b.timer = rng.range(WAIT_SEC[0], WAIT_SEC[1]);
            break;
          }
          case 'treadmill': {
            move(b, dt, b.speedFactor * ctx.speedAt(b.z));
            if (b.path.length === 0) {
              // On the belt: running in place, facing up the slope.
              b.moving = true;
              b.yaw = 0;
              b.timer -= dt;
              if (b.timer <= 0) goUp(b, ctx.gatesOpen);
            }
            break;
          }
          case 'zone': {
            const gz = guarded.find((x) => b.z < x.zone[1] + 8 && b.z > x.zone[0] - ZONE_STOP - 20);
            if (b.zoneSpeed === 0) {
              // Waiting in the grotto before the zone (on its belt).
              move(b, dt, b.speedFactor * ctx.speedAt(b.z));
              if (b.path.length === 0) {
                b.moving = b.cave >= 0;
                b.yaw = 0;
              }
              b.zoneWait -= dt;
              if (b.zoneWait <= 0 && gz) runZone(b, gz);
              else if (b.zoneWait <= 0) goUp(b, ctx.gatesOpen);
              break;
            }
            move(b, dt, b.zoneSpeed);
            if (b.path.length === 0) {
              // Past the giant: he sits on the summit a while, then off through the portal.
              b.zoneSpeed = 0;
              b.mode = 'wait';
              b.timer = range(cfg.treadmillSec);
            }
            break;
          }
          case 'hide': {
            move(b, dt, b.speedFactor * ctx.speedAt(b.z));
            if (b.path.length === 0) b.yaw = 0;
            if (phase === 'gone' || phase === 'idle') {
              // Out of a tunnel straight on up (no belt there); from a cave onto its belt.
              if (level.niches[b.cave]?.kind === 'tunnel') goUp(b, ctx.gatesOpen);
              else {
                b.mode = 'treadmill';
                b.timer = range(cfg.treadmillSec);
              }
            }
            break;
          }
          case 'ball': {
            const c = b.ball!;
            c.t += dt;
            caughtPosition(c, level, opts.avalanche?.ballBounce ?? 0, ballPos);
            b.x = ballPos.x;
            b.y = ballPos.y;
            b.z = ballPos.z;
            b.moving = false;
            if (c.t >= caughtTotalSec(c) - 1e-9) {
              b.ball = null;
              b.hop = -1;
              b.x = c.to.x;
              b.y = c.to.y;
              b.z = c.to.z;
              if (c.niche < 0) {
                b.mode = 'camp';
                b.timer = range(cfg.campReleaseSec);
              } else {
                const taken = occupied(c.niche, b);
                b.mode = 'treadmill';
                b.timer = range(cfg.treadmillSec);
                routeTo(b, b.z, c.niche, taken.includes(0) ? 1 : 0);
              }
            }
            break;
          }
        }
      }
      lastPhase = phase;
    },
  };
  return crowd;
}

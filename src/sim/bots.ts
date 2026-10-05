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
import type { LevelData, LevelNiche, LevelPoint } from '../level/types.ts';
import { NICHE_BELT_WIDTH } from '../level/builder.ts';
import { createRng, type Rng } from '../core/rng.ts';
import { caughtPosition, caughtTotalSec, createCaught, type CaughtState } from './caught.ts';
import { distToEntrance, entranceX, inSafeZone, nicheSign, shelterIndex } from './shelter.ts';
import { sheltersByRunTime, type ThreatState } from './threat.ts';

export type BotMode = 'off' | 'camp' | 'up' | 'wait' | 'treadmill' | 'hide' | 'ball' | 'away';

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
}

export interface BotContext {
  hero: { x: number; z: number };
  /** z of the hero's flag (last checkpoint), the camp spawn before the first one. */
  flagZ: number;
  gatesOpen: readonly boolean[];
  threat: Pick<ThreatState, 'phase' | 'frontZ' | 'spawnZ'> | null;
  /** Run speed of the hero on the stretch below z: speed of the stat that opened the wall under it. */
  speedAt(z: number): number;
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
}

export interface BotCrowd {
  readonly list: Bot[];
  /** Bots out on the mountain now (quality low lowers it); the others are `off`. */
  limit: number;
  /** Decisions on warn since the start: bots on the slope that ran to a cave or dawdled, and snowballs. */
  readonly stats: { hid: number; dawdled: number; caught: number };
  step(dt: number, ctx: BotContext): void;
}

/** Places in a cave beside the belt (docs/01-gdd.md 4.3: the hero and two bots). */
export const CAVE_SPOTS = 2;
/** A bot stops this far below the plane of a closed wall. */
const GATE_STOP = 2.5;
/** Waypoint reached within this distance. */
const REACH = 0.4;
/** Half the width of a bot plus a margin: lanes keep this far from obstacles and the side borders. */
const LANE_MARGIN = 2;
/** The bot walks out of a cave to this far inside the track edge (the mouth). */
const MOUTH_INSET = 2;
/** Boxes that are not obstacles on the slope. */
const NOT_OBSTACLE = new Set(['floor', 'border', 'nicheFloor', 'nicheWall', 'nicheRoof']);
/** Camp places keep this far from the middle of the track and from props (tent, tree, egg stand, belt). */
const CAMP_CLEAR_MID = 4;
const CAMP_CLEAR_PROP = 3.5;
/** Wait at a closed wall before the cave again, seconds. */
const WAIT_SEC: [number, number] = [1, 4];

/** Free x intervals across the track: the track minus every obstacle standing on it, with a margin. */
export function laneIntervals(level: LevelData): Array<[number, number]> {
  let free: Array<[number, number]> = [[-level.width / 2 + LANE_MARGIN, level.width / 2 - LANE_MARGIN]];
  for (const b of level.boxes) {
    if (!b.solid || NOT_OBSTACLE.has(b.kind)) continue;
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
  const x = n.side === 'left' ? n.box.min[0] + NICHE_BELT_WIDTH / 2 : n.box.max[0] - NICHE_BELT_WIDTH / 2;
  return { x, z: n.z + (spot === 0 ? -1 : 1) * (half - 1.8) };
}

export function createBots(level: LevelData, opts: BotsOptions): BotCrowd {
  const { cfg } = opts;
  const rng: Rng = createRng(opts.seed);
  const lanes = laneIntervals(level);
  const laneWidth = lanes.reduce((s, [a, b]) => s + (b - a), 0);
  const campTop = level.safeZones[0]?.[1] ?? 0;
  const summit = level.safeZones[level.safeZones.length - 1] ?? [level.length, level.length];
  const halfW = level.width / 2;
  const range = (r: readonly [number, number]): number => rng.range(r[0], r[1] + 1e-9);
  const pickLane = (): number => {
    let u = rng.next() * laneWidth;
    for (const [a, b] of lanes) {
      if (u <= b - a) return a + u;
      u -= b - a;
    }
    return lanes[0]![0];
  };
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
  let dawdleDebt = 0;
  let waveNo = 0;
  let lastPhase: string = 'idle';

  // Camp places: out of the hero's way up the middle, clear of tents, trees, the egg stand and the belt.
  const props = level.points.filter((p) => p.type === 'decor' || p.type === 'eggStand' || p.type === 'treadmill');
  const campSpot = (): { x: number; z: number } => {
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
    };
    if (!inCamp) bot.x = bot.lane;
    bot.y = level.floorYAt(bot.z);
    list.push(bot);
  }

  /** The first wall above z that is closed for the hero, as a stop point; the summit when all are open. */
  function firstStop(z: number, gatesOpen?: readonly boolean[]): number {
    let stop = (summit[0] + summit[1]) / 2;
    level.gates.forEach((g, i) => {
      if (gatesOpen?.[i]) return;
      const at = g.box.min[2] - GATE_STOP;
      if (g.z > z && at < stop) stop = at;
    });
    return stop;
  }
  const stretchOf = (z: number): number => level.gates.filter((g) => g.z <= z).length;
  const inCave = (b: Bot): boolean => Math.abs(b.x) > halfW;
  const occupied = (cave: number, except: Bot): number[] =>
    list.filter((o) => o !== except && o.cave === cave && (o.mode === 'treadmill' || o.mode === 'hide')).map((o) => o.spot);

  /** Route: out of a cave to its mouth, sideways to the lane, along the lane, then to the target (into a cave). */
  const routeTo = (b: Bot, z: number, cave: number, spot: number): void => {
    const n = level.niches[cave];
    b.cave = cave;
    b.spot = spot;
    if (n && inCave(b) && Math.abs(b.z - n.z) <= (n.box.max[2] - n.box.min[2]) / 2 && Math.sign(b.x) === nicheSign(n)) {
      // Already inside this cave: straight to the place.
      const s = caveSpot(n, spot);
      b.path = [[s.x, s.z]];
      return;
    }
    const pts: Array<[number, number]> = [];
    if (inCave(b)) pts.push([Math.sign(b.x) * (halfW - MOUTH_INSET), b.z]);
    pts.push([b.lane, b.z], [b.lane, z]);
    if (n) {
      const s = caveSpot(n, spot);
      pts.push([entranceX(level, n) - nicheSign(n) * MOUTH_INSET, n.z], [s.x, s.z]);
    }
    b.path = pts;
  };
  const goUp = (b: Bot, gatesOpen: readonly boolean[]): void => {
    b.mode = 'up';
    routeTo(b, firstStop(b.z, gatesOpen), -1, 0);
  };
  /** The cave in front of the wall the bot stands at (its stretch), with a free place, or −1. */
  const treadmillCave = (b: Bot): { cave: number; spot: number } | null => {
    const stretch = stretchOf(b.z) + 1;
    const cave = level.niches.findIndex((n) => n.stretch === stretch);
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
  const move = (b: Bot, dt: number, speed: number): void => {
    b.slide = slides.some((p) => on(p, b.x, b.z)) ? (fun?.cfg.slideSec ?? 0) : Math.max(0, b.slide - dt);
    let left = speed * dt * (b.slide > 0 ? (fun?.cfg.slideMult ?? 1) : 1);
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
    b.y = level.floorYAt(b.z);
    if (!fun) return;
    if (b.hop >= 0) {
      b.hop += dt;
      const h = fun.cfg.padSpeed * b.hop - 0.5 * fun.gravity * b.hop * b.hop;
      if (h > 0) b.y += h;
      else b.hop = -1;
    } else if (b.moving && pads.some((p) => on(p, b.x, b.z))) b.hop = 0;
  };

  const crowd: BotCrowd = {
    list,
    limit: opts.count,
    stats,
    step(dt, ctx) {
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
        // Left far below the hero: off to the camp, back later at his flag (docs/01-gdd.md 7.12).
        if (b.mode !== 'away' && b.mode !== 'ball' && b.mode !== 'hide' && heroStretch - stretchOf(b.z) > cfg.leashWalls) toAway(b);
        switch (b.mode) {
          case 'away': {
            b.timer -= dt;
            if (b.timer <= 0) {
              b.name = takeName();
              b.lane = pickLane();
              b.x = b.lane;
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
          case 'hide': {
            move(b, dt, b.speedFactor * ctx.speedAt(b.z));
            if (b.path.length === 0) b.yaw = 0;
            if (phase === 'gone' || phase === 'idle') {
              b.mode = 'treadmill';
              b.timer = range(cfg.treadmillSec);
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

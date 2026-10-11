// What: Rare random events of the open slope (docs/01-gdd.md 18.4): the roll on entering a section, the rolling snowball — its trail on the hero's lane, the hit of the hero or a bot.
// Called by: sim/world.ts (createEvents, step every tick; its events go out through the sim bus); app/events-view.ts reads the state; tests/sim/rg-events.test.ts.
// Keep: Pure TS, no DOM, deterministic by its seed; every number from game.json events (docs/01a-content.md 17.3); up to 150 lines.

/* An event is no check (docs/01-gdd.md 18.4): no failure, its price is seconds. Rolled on entering a section of
 * `sections` with `chance`, not before `minGapSec` after the last one, from its `fromWorld`; never on warn or run, in the
 * camp, on the summit, in a giant's zone or a throat; the siren ends it. The snowball tells of itself for aheadSec (the
 * trail lies on the hero's lane all the time: a step aside or a shelter is enough); it starts delaySec after the entry
 * at the earliest (the section's own toast first), once the lane ahead is free for aheadSec (no closed gate, throat or
 * fork cliff) while the hero is still in the section it was rolled in. */
import type { GameEvents } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { createRng } from '../core/rng.ts';
import { inSafeZone } from './shelter.ts';

export type EventId = 'snowball';

/** The trail on lane `x` from z0 (the top, where the ball starts) down to z1; the ball at `z`; `dz` — ball minus hero on
 * the last tick (a hit is the ball crossing him), the same of each bot in `bots` (Infinity — hit). */
export interface SnowballState { x: number; z0: number; z1: number; z: number; speed: number; dz: number; bots: Map<number, number>; hit: boolean }

export interface EventsState { snowball: SnowballState | null }

export interface EventEvents {
  eventStart: { tick: number; id: EventId; section: number };
  eventEnd: { tick: number; id: EventId; why: 'past' | 'warn' | 'blocked' };
  snowballHit: { tick: number; tumbleSec: number; slow: number; slowSec: number };
  snowballBotHit: { tick: number; bot: number; tumbleSec: number; slow: number; slowSec: number };
}

/** `sheltered` — in a cave, a grotto or a tunnel; `run` — v(S) of the Speed now, no status; `bots` — those out of shelters. */
export interface EventsContext {
  tick: number;
  hero: { x: number; y: number; z: number; sheltered: boolean };
  run: number;
  phase: string;
  bots: ReadonlyArray<{ bot: number; x: number; z: number }>;
}

export interface Events {
  readonly state: EventsState;
  readonly cfg: GameEvents;
  step(dt: number, ctx: EventsContext): void;
}

/** Half the hero across; the trail this far inside the borders, on this far below the hero; the free lane ends this far
 * below a closed gate, a throat or a cliff. */
const HERO_HALF = 0.5;
const TRAIL_INSET = 1;
const PAST = 20;
const GATE_GAP = 2;

/** `force` (?mock_event=, tests): that event starts on every section entry its rules allow, no chance, no gap. */
export function createEvents(
  level: LevelData,
  cfg: GameEvents,
  seed: number,
  gatesOpen: readonly boolean[],
  emit: <K extends keyof EventEvents>(name: K, payload: EventEvents[K]) => void,
  force?: EventId,
): Events {
  const rng = createRng(seed);
  const state: EventsState = { snowball: null };
  const sectionAt = (z: number): number => level.sections.findIndex((s) => z >= s.z0 && z < s.z1) + 1;
  const throatAt = (z: number): boolean => (level.shapes ?? []).some((t) => t.kind === 'throat' && z >= t.z0 && z <= t.z1);
  const cliffAt = (x: number, z: number): boolean => level.boxes.some((b) => b.kind === 'cliff' && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]);
  const inZone = (z: number): boolean => level.bosses.some((b) => z >= b.zone[0] && z <= b.zone[1]);
  let [time, last, section, armed, armedAt] = [0, -Infinity, sectionAt(level.spawn[2]), false, 0];

  // Free run along the lane `x` ahead of z: to the nearest closed gate, throat or fork cliff on it.
  const room = (x: number, z: number, lane: number): number => {
    let top = Infinity;
    level.gates.forEach((g, i) => {
      if (!gatesOpen[i] && g.z > z) top = Math.min(top, g.z);
    });
    for (const t of level.shapes ?? []) if (t.kind === 'throat' && t.z0 > z) top = Math.min(top, t.z0);
    for (const b of level.boxes) if (b.kind === 'cliff' && b.min[2] > z && b.max[0] >= x - lane && b.min[0] <= x + lane) top = Math.min(top, b.min[2]);
    return top - GATE_GAP - z;
  };

  const loud = (phase: string): boolean => phase === 'warn' || phase === 'run';
  const quiet = (ctx: EventsContext): boolean => !loud(ctx.phase) && !inSafeZone(level, ctx.hero.z) && !inZone(ctx.hero.z) && !throatAt(ctx.hero.z);

  const startSnowball = (ctx: EventsContext): boolean => {
    const sb = cfg.snowball!;
    const half = level.width / 2 - sb.trailWidth / 2 - TRAIL_INSET;
    const speed = sb.speedMult * ctx.run;
    const x = Math.max(-half, Math.min(half, ctx.hero.x));
    const ahead = (ctx.run + speed) * sb.aheadSec;
    if (room(x, ctx.hero.z, sb.trailWidth / 2) < ahead) return false;
    state.snowball = { x, z0: ctx.hero.z + ahead, z1: ctx.hero.z - PAST, z: ctx.hero.z + ahead, speed, dz: ahead, bots: new Map(), hit: false };
    return true;
  };

  const end = (id: EventId, why: EventEvents['eventEnd']['why'], tick: number): void => {
    state.snowball = null;
    emit('eventEnd', { tick, id, why });
  };

  // The ball crossed him this tick (or touches him now): the gap went from one side of ±reach to the other.
  const crossed = (was: number, now: number, reach: number): boolean => Math.min(was, now) <= reach && Math.max(was, now) >= -reach;

  const stepSnowball = (dt: number, ctx: EventsContext, s: SnowballState): void => {
    const sb = cfg.snowball!;
    if (loud(ctx.phase)) return end('snowball', 'warn', ctx.tick);
    s.z -= s.speed * dt;
    if (throatAt(s.z) || cliffAt(s.x, s.z)) return end('snowball', 'blocked', ctx.tick);
    const reach = sb.size / 2 + HERO_HALF;
    const lane = sb.trailWidth / 2;
    const h = ctx.hero;
    const dz = s.z - h.z;
    // Over the ball in a jump, or in a shelter: it goes by.
    if (!s.hit && !h.sheltered && h.y - level.floorAt(h.x, h.z) < sb.size && Math.abs(h.x - s.x) <= lane && crossed(s.dz, dz, reach)) {
      s.hit = true;
      emit('snowballHit', { tick: ctx.tick, tumbleSec: sb.tumbleSec, slow: sb.slow, slowSec: sb.slowSec });
    }
    s.dz = dz;
    for (const b of ctx.bots) {
      const bz = s.z - b.z;
      const was = s.bots.get(b.bot) ?? bz;
      if (was !== Infinity && Math.abs(b.x - s.x) <= lane && crossed(was, bz, reach)) {
        s.bots.set(b.bot, Infinity);
        emit('snowballBotHit', { tick: ctx.tick, bot: b.bot, tumbleSec: sb.tumbleSec, slow: sb.slow, slowSec: sb.slowSec });
      } else if (was !== Infinity) s.bots.set(b.bot, bz);
    }
    if (s.z < s.z1) end('snowball', 'past', ctx.tick);
  };

  return {
    state,
    cfg,
    step(dt, ctx) {
      time += dt;
      if (state.snowball) stepSnowball(dt, ctx, state.snowball);
      const k = sectionAt(ctx.hero.z);
      if (k !== section) {
        section = k;
        const sb = cfg.snowball;
        armed =
          k >= cfg.sections[0] && k <= cfg.sections[1] && !state.snowball && quiet(ctx) && !!sb && level.worldIndex >= sb.fromWorld &&
          (force === 'snowball' || (time - last >= cfg.minGapSec && rng.chance(sb.chance)));
        armedAt = time;
      }
      if (!armed || state.snowball || time - armedAt < cfg.delaySec - 1e-9 || !quiet(ctx) || !startSnowball(ctx)) return;
      armed = false;
      last = time;
      emit('eventStart', { tick: ctx.tick, id: 'snowball', section: k });
    },
  };
}

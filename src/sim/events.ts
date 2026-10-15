// What: Rare random events of the open slope (docs/01-gdd.md 18.4): the roll on entering a section, the rolling snowball (its trail on the hero's lane, the hit of the hero or a bot) and the blizzard over a section.
// Called by: sim/world.ts (createEvents, step every tick; its events go out through the sim bus); app/events-view.ts and app/hud-view.ts read it; tests/sim/rg-events.test.ts.
// Keep: Pure TS, no DOM, deterministic by its seed; every number from game.json events (docs/01a-content.md 17.3); up to 150 lines.

/* An event is no check (docs/01-gdd.md 18.4): no failure, its price is seconds. One roll on entering a section of
 * `sections` (one draw: snowball below its chance, blizzard in the next chance), not before `minGapSec` after the last
 * event, each from its `fromWorld`; never on warn or run, in the camp, a giant's zone or a throat; the siren ends it; it
 * starts delaySec after the entry at the earliest (the section's own toast first), while the hero is in that section.
 * The snowball waits for the lane ahead free for aheadSec (no closed gate, throat or fork cliff): its trail lies on the
 * hero's lane all the time, a step aside or a shelter is enough. The blizzard: everyone in its section × speedMult and
 * the hero's steps × stepMult for durationSec. RL-07: one blizzard owed on a `guaranteed` section (seed), armed past it till it starts. */
import type { GameEvents } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { createRng } from '../core/rng.ts';
import { inSafeZone } from './shelter.ts';

export type EventId = 'snowball' | 'blizzard';

/** The trail on lane `x` from z0 (the top, where the ball starts) down to z1; the ball at `z`; `dz` — ball minus hero on
 * the last tick (a hit is the ball crossing him), the same of each bot in `bots` (Infinity — hit). */
export interface SnowballState { x: number; z0: number; z1: number; z: number; speed: number; dz: number; bots: Map<number, number>; hit: boolean }
/** The blizzard over the section [z0, z1) for `left` more seconds. */
export interface BlizzardState { z0: number; z1: number; left: number }
export interface EventsState { snowball: SnowballState | null; blizzard: BlizzardState | null }

export interface EventEvents {
  eventStart: { tick: number; id: EventId; section: number };
  eventEnd: { tick: number; id: EventId; why: 'past' | 'warn' | 'blocked' | 'over' };
  snowballHit: { tick: number; tumbleSec: number; slow: number; slowSec: number };
  snowballBotHit: { tick: number; bot: number; tumbleSec: number; slow: number; slowSec: number };
}

/** `sheltered` — in a cave, a grotto or a tunnel; `run` — v(S) of the Speed now, no status; `bots` — those out of shelters. */
export interface EventsContext { tick: number; hero: { x: number; y: number; z: number; sheltered: boolean }; run: number; phase: string; bots: ReadonlyArray<{ bot: number; x: number; z: number }> }

export interface Events {
  readonly state: EventsState;
  readonly cfg: GameEvents;
  /** The blizzard at z: run speed × this (1 — none) and the hero's steps × stepMultAt. */
  speedMultAt(z: number): number;
  stepMultAt(z: number): number;
  step(dt: number, ctx: EventsContext): void;
}

/** Half the hero across; the trail this far inside the borders, on this far below the hero; the free lane ends this far
 * below a closed gate, a throat or a cliff. */
const [HERO_HALF, TRAIL_INSET, PAST, GATE_GAP] = [0.5, 1, 20, 2];

/** `force` (?mock_event=, tests): that event starts on every section entry its rules allow, no chance, no gap. */
type Emit = <K extends keyof EventEvents>(name: K, payload: EventEvents[K]) => void;
export function createEvents(level: LevelData, cfg: GameEvents, seed: number, gatesOpen: readonly boolean[], emit: Emit, force?: EventId): Events {
  const rng = createRng(seed);
  const state: EventsState = { snowball: null, blizzard: null };
  const sectionAt = (z: number): number => level.sections.findIndex((s) => z >= s.z0 && z < s.z1) + 1;
  const throatAt = (z: number): boolean => (level.shapes ?? []).some((t) => t.kind === 'throat' && z >= t.z0 && z <= t.z1);
  const inZone = (z: number): boolean => level.bosses.some((b) => z >= b.zone[0] && z <= b.zone[1]);
  let [time, last, section, armedAt] = [0, -Infinity, sectionAt(level.spawn[2]), 0];
  let armed: EventId | null = null;
  let owed = ((g: number[]): number => (g.length ? g[(seed + level.worldIndex) % g.length]! : 0))(cfg.blizzard?.guaranteed && level.worldIndex >= cfg.blizzard.fromWorld ? cfg.blizzard.guaranteed : []);

  // Free run along the lane `x` ahead of z: to the nearest closed gate, throat or fork cliff on it.
  const room = (x: number, z: number, lane: number): number => {
    let top = Infinity;
    level.gates.forEach((g, i) => (top = !gatesOpen[i] && g.z > z ? Math.min(top, g.z) : top));
    for (const t of level.shapes ?? []) if (t.kind === 'throat' && t.z0 > z) top = Math.min(top, t.z0);
    for (const b of level.boxes) if (b.kind === 'cliff' && b.min[2] > z && b.max[0] >= x - lane && b.min[0] <= x + lane) top = Math.min(top, b.min[2]);
    return top - GATE_GAP - z;
  };
  const loud = (phase: string): boolean => phase === 'warn' || phase === 'run';
  const quiet = (ctx: EventsContext): boolean => !loud(ctx.phase) && !inSafeZone(level, ctx.hero.z) && !inZone(ctx.hero.z) && !throatAt(ctx.hero.z);
  const busy = (): boolean => state.snowball !== null || state.blizzard !== null;

  // One draw on the entry: the events of this mountain one after another on [0, 1), each as wide as its chance.
  const roll = (): EventId | null => {
    const ids = (['snowball', 'blizzard'] as const).filter((id) => level.worldIndex >= (cfg[id]?.fromWorld ?? Infinity));
    if (force) return ids.find((id) => id === force) ?? null;
    if (time - last < cfg.minGapSec || ids.length === 0) return null;
    let r = rng.next();
    for (const id of ids) if ((r -= cfg[id]!.chance) < 0) return id;
    return null;
  };

  const start = (id: EventId, ctx: EventsContext, k: number): boolean => {
    if (id === 'blizzard') {
      const s = level.sections[k - 1]!;
      state.blizzard = { z0: s.z0, z1: s.z1, left: cfg.blizzard!.durationSec };
      return true;
    }
    const sb = cfg.snowball!;
    const half = level.halfAt(ctx.hero.z) - sb.trailWidth / 2 - TRAIL_INSET;
    const speed = sb.speedMult * ctx.run;
    const x = Math.max(-half, Math.min(half, ctx.hero.x));
    const ahead = (ctx.run + speed) * sb.aheadSec;
    if (room(x, ctx.hero.z, sb.trailWidth / 2) < ahead) return false;
    state.snowball = { x, z0: ctx.hero.z + ahead, z1: ctx.hero.z - PAST, z: ctx.hero.z + ahead, speed, dz: ahead, bots: new Map(), hit: false };
    return true;
  };

  const end = (id: EventId, why: EventEvents['eventEnd']['why'], tick: number): void => {
    state[id] = null;
    emit('eventEnd', { tick, id, why });
  };

  // The ball crossed him this tick (or touches him now): the gap went from one side of ±reach to the other.
  const crossed = (was: number, now: number, reach: number): boolean => Math.min(was, now) <= reach && Math.max(was, now) >= -reach;

  const stepSnowball = (dt: number, ctx: EventsContext, s: SnowballState): void => {
    const sb = cfg.snowball!;
    s.z -= s.speed * dt;
    if (throatAt(s.z)) return end('snowball', 'blocked', ctx.tick);
    const [reach, lane, h] = [sb.size / 2 + HERO_HALF, sb.trailWidth / 2, ctx.hero];
    const hit = { tumbleSec: sb.tumbleSec, slow: sb.slow, slowSec: sb.slowSec };
    // Over the ball in a jump, or in a shelter: it goes by.
    if (!s.hit && !h.sheltered && h.y - level.floorAt(h.x, h.z) < sb.size && Math.abs(h.x - s.x) <= lane && crossed(s.dz, s.z - h.z, reach)) {
      s.hit = true;
      emit('snowballHit', { tick: ctx.tick, ...hit });
    }
    s.dz = s.z - h.z;
    for (const b of ctx.bots) {
      const [bz, was] = [s.z - b.z, s.bots.get(b.bot) ?? s.z - b.z];
      if (was === Infinity) continue;
      const on = Math.abs(b.x - s.x) <= lane && crossed(was, bz, reach);
      s.bots.set(b.bot, on ? Infinity : bz);
      if (on) emit('snowballBotHit', { tick: ctx.tick, bot: b.bot, ...hit });
    }
    if (s.z < s.z1) end('snowball', 'past', ctx.tick);
  };

  const inBlizzard = (z: number): boolean => !!state.blizzard && z >= state.blizzard.z0 && z < state.blizzard.z1;
  return {
    state,
    cfg,
    speedMultAt: (z) => (inBlizzard(z) ? cfg.blizzard!.speedMult : 1),
    stepMultAt: (z) => (inBlizzard(z) ? cfg.blizzard!.stepMult : 1),
    step(dt, ctx) {
      time += dt;
      for (const id of ['snowball', 'blizzard'] as const) if (state[id] && loud(ctx.phase)) end(id, 'warn', ctx.tick);
      if (state.snowball) stepSnowball(dt, ctx, state.snowball);
      if (state.blizzard && (state.blizzard.left -= dt) <= 1e-9) end('blizzard', 'over', ctx.tick);
      const k = sectionAt(ctx.hero.z);
      if (k !== section) { // stages pace (docs/01-gdd.md 22.5): the blizzard is its stage's trial, no random events
        [section, armedAt] = [k, time];
        armed = level.stages ? (level.stages[k - 1]?.type === 'blizzard' ? 'blizzard' : null) : !force && owed && k >= owed && !busy() ? 'blizzard' : k >= cfg.sections[0] && k <= cfg.sections[1] && !busy() && quiet(ctx) ? roll() : null;
      }
      if (!armed || busy() || time - armedAt < cfg.delaySec - 1e-9 || !quiet(ctx) || !start(armed, ctx, k)) return;
      emit('eventStart', { tick: ctx.tick, id: armed, section: k });
      [armed, last, owed] = [null, time, armed === 'blizzard' ? 0 : owed];
    },
  };
}

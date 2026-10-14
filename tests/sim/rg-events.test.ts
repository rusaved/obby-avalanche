import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createEvents, type EventEvents, type EventsContext } from '../../src/sim/events.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, BotsJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { LevelData } from '../../src/level/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-05: the rare event «Snowball!», RG-07: the blizzard (docs/01-gdd.md 18.4; docs/01a-content.md 17.3).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const game = read<GameJson>('game.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const botsCfg = read<BotsJson>('bots.json');
const cfg = game.events!;
const sb = cfg.snowball!;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const level5 = buildLevel(worlds.worlds[4]!);
const [, , s3, s4] = level5.sections;
const closed = level5.gates.map(() => false);
const RUN_SPEED = 30;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };

const ctx = (z: number, o: Partial<EventsContext> = {}): EventsContext => ({ tick: 0, hero: { x: 0, y: level5.floorAt(0, z), z, sheltered: false }, run: RUN_SPEED, phase: 'idle', bots: [], ...o });

function events(level: LevelData, seed: number, force?: 'snowball' | 'blizzard', c = cfg): { ev: ReturnType<typeof createEvents>; log: Array<{ name: keyof EventEvents; p: unknown }> } {
  const log: Array<{ name: keyof EventEvents; p: unknown }> = [];
  const ev = createEvents(level, c, seed, closed, (name, p) => log.push({ name, p }), force);
  return { ev, log };
}

/** 400 entries into section 3 of mountain 5, each minGapSec + 1 after the last (a step in section 1 between). */
function entries(seed: number): number[] {
  const { ev, log } = events(level5, seed);
  const starts: number[] = [];
  for (let i = 0; i < 400; i++) {
    ev.step(cfg.minGapSec + 1, ctx(100, { hero: { x: 0, y: 0, z: 100, sheltered: true } }));
    const n = log.length;
    ev.step(DT, ctx(s3!.z0 + 5));
    ev.step(cfg.delaySec, ctx(s3!.z0 + 5));
    if (log.slice(n).some((e) => e.name === 'eventStart')) starts.push(i);
  }
  return starts;
}

function sim5(): Sim {
  return createSim(level5, tuning, { balance, speedCurve: curve, stat: 1000, record: null, events: { cfg, seed: 3, force: 'snowball' } });
}

describe('«Snowball!» (RG-05)', () => {
  it('the roll is deterministic by the seed; the share of starts ≈ chance ± 0.05 on 400 entries', () => {
    const a = entries(7);
    expect(entries(7)).toEqual(a);
    expect(entries(8)).not.toEqual(a);
    expect(Math.abs(a.length / 400 - sb.chance)).toBeLessThanOrEqual(0.05);
  });

  it('never on warn or run, in a giant zone, in the camp, in a throat, before minGapSec, before mountain 5', () => {
    const starts = (level: LevelData, z: number, o: Partial<EventsContext> = {}): number => {
      const { ev, log } = events(level, 1, 'snowball');
      ev.step(DT, ctx(z, o));
      ev.step(cfg.delaySec, ctx(z, o));
      return log.filter((e) => e.name === 'eventStart').length;
    };
    expect(starts(level5, s3!.z0 + 5)).toBe(1);
    expect(starts(level5, s3!.z0 + 5, { phase: 'warn' })).toBe(0);
    expect(starts(level5, s3!.z0 + 5, { phase: 'run' })).toBe(0);
    const b = level5.bosses[0]!;
    expect(starts({ ...level5, bosses: [{ ...b, zone: [s3!.z0, s3!.z0 + 60] }] }, s3!.z0 + 5)).toBe(0);
    expect(starts({ ...level5, safeZones: [...level5.safeZones, [s3!.z0, s3!.z0 + 60]] }, s3!.z0 + 5)).toBe(0);
    const throat = level5.shapes!.find((t) => t.kind === 'throat' && t.z0 > s4!.z0)!;
    expect(starts(level5, throat.z0 + 5)).toBe(0);
    expect(starts(buildLevel(worlds.worlds[3]!), s3!.z0 + 5)).toBe(0);
    // minGapSec: with chance 1 the second entry within the gap starts nothing, the one after it does.
    const { ev, log } = events(level5, 1, undefined, { ...cfg, snowball: { ...sb, chance: 1 } });
    const n = (): number => log.filter((e) => e.name === 'eventStart').length;
    ev.step(DT, ctx(s3!.z0 + 5));
    ev.step(cfg.delaySec, ctx(s3!.z0 + 5));
    ev.step(cfg.minGapSec - 10, ctx(100, { phase: 'warn' }));
    ev.step(DT, ctx(s3!.z0 + 5));
    ev.step(cfg.delaySec, ctx(s3!.z0 + 5));
    expect(n()).toBe(1);
    ev.step(10, ctx(100));
    ev.step(DT, ctx(s3!.z0 + 5));
    // Not before delaySec in the section (its own toast first).
    ev.step(cfg.delaySec - 0.1, ctx(s3!.z0 + 5));
    expect(n()).toBe(1);
    ev.step(0.1, ctx(s3!.z0 + 5));
    expect(n()).toBe(2);
  });

  it('it waits for a free lane: entering section 4 below its throat, the ball starts once the hero is past it', () => {
    const throat = level5.shapes!.find((t) => t.kind === 'throat' && t.z0 > s4!.z0)!;
    const { ev, log } = events(level5, 1, 'snowball');
    ev.step(DT, ctx(s4!.z0 + 2));
    ev.step(cfg.delaySec, ctx(throat.z0 + 2));
    expect(ev.state.snowball).toBeNull();
    ev.step(DT, ctx(throat.z1 + 3));
    expect(ev.state.snowball).not.toBeNull();
    expect(log.map((e) => e.name)).toEqual(['eventStart']);
    // The meeting in aheadSec at the run speed: the ball starts (v + speedMult × v) × aheadSec above the hero.
    const s = ev.state.snowball!;
    expect(s.z0 - (throat.z1 + 3)).toBeCloseTo(RUN_SPEED * (1 + sb.speedMult) * sb.aheadSec, 6);
  });

  it('the hero off the trail is missed; on it — the tumble, then ×0.6 for 2 s; Speed, coins and the record flag stay', () => {
    const run = (side: boolean): { s: Sim; ev: string[]; stat: number; coins: number; record: unknown } => {
      const s = sim5();
      const ev: string[] = [];
      for (const n of ['eventStart', 'eventEnd', 'snowballHit'] as const) s.events.on(n, () => ev.push(n));
      s.teleport(0, s.level.floorYAt(s3!.z0 + 5), s3!.z0 + 5);
      for (let i = 0; i < 60 * (cfg.delaySec + 0.5); i++) s.step(STAND, DT);
      const before = { stat: s.progress.stat, coins: s.coins, record: { ...s.record! } };
      expect(ev).toEqual(['eventStart']);
      const ball = s.rare!.state.snowball!;
      expect(ball.x).toBe(0);
      // A step aside off the 4-unit trail.
      if (side) for (let i = 0; i < 30; i++) s.step({ ...STAND, moveX: 1 }, DT);
      for (let i = 0; i < 60 * 10 && s.rare!.state.snowball; i++) {
        s.step(STAND, DT);
        if (s.tumble) expect(s.hero.speed).toBeLessThan(1);
      }
      return { s, ev, ...before };
    };
    const off = run(true);
    expect(off.ev).toEqual(['eventStart', 'eventEnd']);
    expect(off.s.slow).toBeNull();
    const on = run(false);
    expect(on.ev).toEqual(['eventStart', 'snowballHit', 'eventEnd']);
    for (let i = 0; i < 60 && on.s.tumble; i++) on.s.step(STAND, DT);
    expect(on.s.tumble).toBeNull();
    expect(on.s.slow!.mult).toBe(sb.slow);
    expect(on.s.slow!.left).toBeGreaterThan(sb.slowSec - 0.1);
    expect(on.s.progress.stat).toBe(on.stat);
    expect(on.s.coins).toBe(on.coins);
    expect(on.s.record).toEqual(on.record);
  });

  it('the siren dissolves the ball within a tick; a bot on the trail is hit, one off it is not', () => {
    const { ev, log } = events(level5, 1, 'snowball');
    ev.step(DT, ctx(s3!.z0 + 5));
    ev.step(cfg.delaySec, ctx(s3!.z0 + 5));
    expect(ev.state.snowball).not.toBeNull();
    ev.step(DT, ctx(s3!.z0 + 5, { phase: 'warn' }));
    expect(ev.state.snowball).toBeNull();
    expect(log.at(-1)).toMatchObject({ name: 'eventEnd', p: { why: 'warn' } });

    const b = events(level5, 1, 'snowball');
    b.ev.step(DT, ctx(s3!.z0 + 5, { hero: { x: 0, y: 0, z: s3!.z0 + 5, sheltered: true } }));
    b.ev.step(cfg.delaySec, ctx(s3!.z0 + 5, { hero: { x: 0, y: 0, z: s3!.z0 + 5, sheltered: true } }));
    const bots = [
      { bot: 0, x: 1, z: s3!.z0 + 40 },
      { bot: 1, x: 8, z: s3!.z0 + 40 },
    ];
    for (let i = 0; i < 60 * 10 && b.ev.state.snowball; i++) b.ev.step(DT, ctx(s3!.z0 + 5, { hero: { x: 0, y: 0, z: s3!.z0 + 5, sheltered: true }, bots }));
    const hits = b.log.filter((e) => e.name === 'snowballBotHit').map((e) => (e.p as EventEvents['snowballBotHit']).bot);
    expect(hits).toEqual([0]);
    expect(b.log.some((e) => e.name === 'snowballHit')).toBe(false);
  });
});

// RG-07: the blizzard (docs/01-gdd.md 18.4; docs/01a-content.md 17.3; Q-041).
describe('the blizzard (RG-07)', () => {
  const bl = cfg.blizzard!;
  const level7 = buildLevel(worlds.worlds[6]!);
  const t2 = level7.sections[1]!;
  const at = t2.z0 + 10;
  const v = (stat: number): number => moveSpeed(stat, curve);
  const sim7 = (force?: 'blizzard', bots?: boolean): Sim =>
    createSim(level7, tuning, {
      balance,
      speedCurve: curve,
      stat: 1000,
      ...(force ? { events: { cfg, seed: 3, force } } : {}),
      ...(bots ? { bots: { cfg: botsCfg, count: 1, seed: 5 } } : {}),
    });
  const intoBlizzard = (s: Sim): void => {
    s.teleport(0, s.level.floorYAt(at), at);
    for (let i = 0; i < 60 * cfg.delaySec + 2 && !s.rare?.state.blizzard; i++) s.step(STAND, DT);
    expect(s.rare?.state.blizzard).not.toBeNull();
  };

  it('on its section the hero runs × speedMult and steps × stepMult for exactly durationSec; off it — as before', () => {
    const s = sim7('blizzard');
    intoBlizzard(s);
    let ticks = 0;
    for (let i = 0; i < 60 * (bl.durationSec + 2); i++) {
      s.step(STAND, DT);
      if (Math.abs(s.params.speed - v(1000) * bl.speedMult) < 1e-6) ticks++;
    }
    expect(Math.abs(ticks - 60 * bl.durationSec)).toBeLessThanOrEqual(1);
    expect(s.params.speed).toBeCloseTo(v(1000), 6);
    // Off its section during it: nothing.
    const o = sim7('blizzard');
    intoBlizzard(o);
    o.teleport(0, o.level.floorYAt(t2.z1 + 20), t2.z1 + 20);
    o.step(STAND, DT);
    expect(o.rare!.state.blizzard).not.toBeNull();
    expect(o.params.speed).toBeCloseTo(v(1000), 6);
    expect(o.rare!.stepMultAt(o.hero.pos.z)).toBe(1);
    // Steps × 2 at × 0.7 the speed: a run gives about 1.4 of the plain one (2.5 s: whole steps of the faster run of SP-03
    // round off less; RL-01 — the plain run stops short of the trampoline of the chasm of this section).
    const gain = (s2: Sim): number => {
      const before = s2.progress.stat;
      for (let i = 0; i < 150; i++) s2.step(RUN, DT);
      return s2.progress.stat - before;
    };
    const plain = sim7();
    plain.teleport(0, plain.level.floorYAt(at), at);
    const g0 = gain(plain);
    const b = sim7('blizzard');
    intoBlizzard(b);
    b.teleport(0, b.level.floorYAt(at), at);
    expect(gain(b) / g0).toBeCloseTo(bl.speedMult * bl.stepMult, 1);
  });

  it('bots on its section run × speedMult too', () => {
    const run = (force?: 'blizzard'): number => {
      const s = sim7(force, true);
      if (force) intoBlizzard(s);
      const bot = s.bots!.list[0]!;
      Object.assign(bot, { mode: 'up', x: bot.lane, z: at + 5, path: [[bot.lane, at + 200]] });
      const z0 = bot.z;
      for (let i = 0; i < 30; i++) s.step(STAND, DT);
      return bot.z - z0;
    };
    expect(run('blizzard') / run()).toBeCloseTo(bl.speedMult, 1);
  });

  it('the siren ends it within a tick; never on warn or run, in a giant zone, before minGapSec; one draw on the entry', () => {
    const { ev, log } = events(level7, 1, 'blizzard');
    ev.step(DT, ctx(at));
    ev.step(cfg.delaySec, ctx(at));
    expect(ev.state.blizzard).not.toBeNull();
    ev.step(DT, ctx(at, { phase: 'warn' }));
    expect(ev.state.blizzard).toBeNull();
    expect(log.at(-1)).toMatchObject({ name: 'eventEnd', p: { id: 'blizzard', why: 'warn' } });
    const starts = (level: LevelData, o: Partial<EventsContext> = {}): number => {
      const e = events(level, 1, 'blizzard');
      e.ev.step(DT, ctx(at, o));
      e.ev.step(cfg.delaySec, ctx(at, o));
      return e.log.filter((x) => x.name === 'eventStart').length;
    };
    expect(starts(level7)).toBe(1);
    expect(starts(level7, { phase: 'warn' })).toBe(0);
    expect(starts(level7, { phase: 'run' })).toBe(0);
    expect(starts({ ...level7, bosses: [{ ...level7.bosses[0]!, zone: [t2.z0, t2.z0 + 60] }] })).toBe(0);
    expect(starts(level5)).toBe(0);
    const only = { ...cfg, snowball: { ...sb, chance: 0 }, blizzard: { ...bl, chance: 1 } };
    const g = events(level7, 1, undefined, only);
    const n = (): number => g.log.filter((e) => e.name === 'eventStart').length;
    g.ev.step(DT, ctx(at));
    g.ev.step(cfg.delaySec, ctx(at));
    g.ev.step(cfg.minGapSec - 10, ctx(100));
    g.ev.step(DT, ctx(at));
    g.ev.step(cfg.delaySec, ctx(at));
    expect(n()).toBe(1);
    g.ev.step(10, ctx(100));
    g.ev.step(DT, ctx(at));
    g.ev.step(cfg.delaySec, ctx(at));
    expect(n()).toBe(2);
    // One draw: on 400 entries of mountain 7 the blizzard takes about its chance.
    const e7 = events(level7, 9);
    let blizzards = 0;
    for (let i = 0; i < 400; i++) {
      e7.ev.step(cfg.minGapSec + 1, ctx(100));
      const k = e7.log.length;
      e7.ev.step(DT, ctx(at));
      e7.ev.step(cfg.delaySec, ctx(at));
      blizzards += e7.log.slice(k).filter((e) => e.name === 'eventStart' && (e.p as EventEvents['eventStart']).id === 'blizzard').length;
    }
    expect(Math.abs(blizzards / 400 - bl.chance)).toBeLessThanOrEqual(0.05);
  });

  it('stepMult 1 (Q-041): a plain slowdown', () => {
    const plain = { ...cfg, blizzard: { ...bl, stepMult: 1 } };
    const { ev } = events(level7, 1, 'blizzard', plain);
    ev.step(DT, ctx(at));
    ev.step(cfg.delaySec, ctx(at));
    expect(ev.speedMultAt(at)).toBe(bl.speedMult);
    expect(ev.stepMultAt(at)).toBe(1);
  });
});

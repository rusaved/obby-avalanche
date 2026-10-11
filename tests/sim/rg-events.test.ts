import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createEvents, type EventEvents, type EventsContext } from '../../src/sim/events.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { LevelData } from '../../src/level/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-05: the rare event «Snowball!» (docs/01-gdd.md 18.4; docs/01a-content.md 17.3).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const game = read<GameJson>('game.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const cfg = game.events!;
const sb = cfg.snowball!;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const level5 = buildLevel(worlds.worlds[4]!);
const [, , s3, s4] = level5.sections;
const closed = level5.gates.map(() => false);
const RUN = 30;

const ctx = (z: number, o: Partial<EventsContext> = {}): EventsContext => ({ tick: 0, hero: { x: 0, y: level5.floorAt(0, z), z, sheltered: false }, run: RUN, phase: 'idle', bots: [], ...o });

function events(level: LevelData, seed: number, force?: 'snowball', c = cfg): { ev: ReturnType<typeof createEvents>; log: Array<{ name: keyof EventEvents; p: unknown }> } {
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
    expect(s.z0 - (throat.z1 + 3)).toBeCloseTo(RUN * (1 + sb.speedMult) * sb.aheadSec, 6);
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

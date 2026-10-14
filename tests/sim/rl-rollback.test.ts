import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// RL-02: a fall, «Snowed in!» and the giant's slap roll the hero to the flag of the ridge below (docs/01-gdd.md 21.2).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/open/balance.json'));
const tuning = mergePatch(read('tuning.json') as TuningJson, read('pace/open/tuning.json'));
const game = read('game.json') as GameJson;
const w1 = (read('pace/open/worlds.json') as WorldsJson).worlds[0]!;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const level = buildLevel(w1);
const flag2 = level.checkpoints[1]!;

function sim(b: BalanceJson = balance, stat = 5000): Sim {
  return createSim(level, tuning, {
    balance: b,
    speedCurve: curve,
    stat,
    coins: 77,
    record: null,
    boss: game.threat.boss,
    threat: { threat: { ...w1.threat }, balance: b, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 10 },
  });
}

/** On section 3 past the flag of ridge 2, `dz` up the slope on the axis. */
function onSection3(s: Sim, dz: number): void {
  s.teleport(0, level.floorAt(0, flag2.z + 1), flag2.z + 1);
  for (let i = 0; i < 5; i++) s.step(STAND, DT);
  expect(s.checkpoint).toBe(1);
  s.teleport(0, level.floorAt(0, flag2.z + dz), flag2.z + dz);
  s.step(STAND, DT);
}

/** Steps until the ball is home; returns the seconds of the clip. */
function rollHome(s: Sim): number {
  expect(s.caught).not.toBeNull();
  let n = 0;
  while (s.caught && n < 600) {
    s.step(STAND, DT);
    n++;
  }
  return n * DT;
}

describe('rollback to the flag of the ridge (RL-02)', () => {
  it('the open pace sets caught.to «flag»; classic and fast keep the cave below', () => {
    expect(balance.caught.to).toBe('flag');
    expect((read('balance.json') as BalanceJson).caught.to).toBeUndefined();
  });

  it('a fall: the ball rolls to the flag of ridge 2 within 2 s; Speed, coins, ridges stay; the avalanche pause starts again', () => {
    const s = sim();
    onSection3(s, 60);
    s.threat!.state.timer = 3;
    const stat = s.progress.stat;
    const passed = s.gatesPassed.map(Boolean);
    const falls: number[] = [];
    s.events.on('fall', () => void falls.push(s.tick));
    s.teleport(0, level.killY - 1, flag2.z + 60);
    s.step(STAND, DT);
    expect(falls.length).toBe(1);
    expect(rollHome(s)).toBeLessThanOrEqual(balance.caught.maxSec + 2 * DT);
    expect(Math.abs(s.hero.pos.z - flag2.z)).toBeLessThan(0.5);
    expect(Math.abs(s.hero.pos.x - flag2.x)).toBeLessThan(0.5);
    expect(s.hero.yaw).toBe(0);
    expect(s.progress.stat).toBeGreaterThanOrEqual(stat);
    expect(s.coins).toBe(77);
    expect(s.gatesPassed.map(Boolean)).toEqual(passed);
    expect(s.threat!.state.phase).toBe('idle');
    expect(s.threat!.state.timer).toBeGreaterThan(w1.threat.intervalSec - 3);
  });

  it('a fall into a pit (a `pit` shape) counts at once, well above killY', () => {
    const pit = { kind: 'pit' as const, z0: flag2.z + 50, z1: flag2.z + 70, y: level.floorAt(0, flag2.z + 60) - 4, x0: -10, x1: 10, section: 3 };
    const lv = { ...level, shapes: [...(level.shapes ?? []), pit] };
    const s = createSim(lv, tuning, { balance, speedCurve: curve, stat: 5000, record: null });
    s.teleport(0, level.floorAt(0, flag2.z + 1), flag2.z + 1);
    for (let i = 0; i < 5; i++) s.step(STAND, DT);
    s.teleport(0, pit.y - 0.5, flag2.z + 60);
    s.step(STAND, DT);
    expect(s.caught).not.toBeNull();
    rollHome(s);
    expect(Math.abs(s.hero.pos.z - flag2.z)).toBeLessThan(0.5);
  });

  it('«Snowed in!»: to the flag, the front melts at once — no second catch; the next warning a full intervalSec later', () => {
    const s = sim();
    onSection3(s, 140);
    const log: string[] = [];
    for (const n of ['waveWarn', 'waveCaught', 'waveGone', 'waveEnd'] as const) s.events.on(n, () => log.push(n));
    let coins = -1;
    s.events.on('waveCaught', () => void (coins = s.coins));
    s.threat!.trigger();
    for (let i = 0; i < 40 * 60 && !s.caught; i++) s.step(STAND, DT);
    expect(log).toContain('waveCaught');
    expect(rollHome(s)).toBeLessThanOrEqual(balance.caught.maxSec + 2 * DT);
    expect(Math.abs(s.hero.pos.z - flag2.z)).toBeLessThan(0.5);
    expect(s.coins).toBe(coins);
    expect(['gone', 'idle']).toContain(s.threat!.state.phase);
    let warnAt = -1;
    const from = s.tick;
    s.events.on('waveWarn', () => void (warnAt = s.tick));
    for (let i = 0; i < (w1.threat.intervalSec + 5) * 60 && warnAt < 0; i++) s.step(STAND, DT);
    expect(log.filter((e) => e === 'waveCaught').length).toBe(1);
    expect((warnAt - from) * DT).toBeGreaterThan(w1.threat.intervalSec - balance.caught.maxSec - 1);
  });

  it('the giant’s slap: to the flag past the last ridge (the start of the finish straight)', () => {
    const zone = w1.bosses![0]!.zone;
    const flag = level.checkpoints[2]!;
    const s = sim(balance, 10);
    s.teleport(0, level.floorAt(0, flag.z + 1), flag.z + 1);
    for (let i = 0; i < 5; i++) s.step(STAND, DT);
    s.teleport(0, level.floorAt(0, zone[0] + 5), zone[0] + 5);
    let caught = false;
    s.events.on('bossCaught', () => void (caught = true));
    for (let i = 0; i < 30 * 60 && !caught; i++) s.step(STAND, DT);
    expect(caught).toBe(true);
    rollHome(s);
    expect(Math.abs(s.hero.pos.z - flag.z)).toBeLessThan(0.5);
  });

  it('caught.to «caveBelow»: «Snowed in!» rolls to the cave below as before RL', () => {
    const old = { ...balance, caught: { ...balance.caught, to: 'caveBelow' as const } };
    const s = sim(old);
    onSection3(s, 140);
    s.threat!.trigger();
    for (let i = 0; i < 40 * 60 && !s.caught; i++) s.step(STAND, DT);
    expect(s.caught).not.toBeNull();
    expect(s.caught!.niche).toBeGreaterThanOrEqual(0);
  });
});

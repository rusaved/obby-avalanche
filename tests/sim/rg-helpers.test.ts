import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createBoss, type BossEvents } from '../../src/sim/boss.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, GameJson, TuningJson, WorldBoss, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-04: the giant's helpers with snowballs and the «slowed» status (docs/01-gdd.md 18.5; docs/01a-content.md 17.4).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const game = read<GameJson>('game.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const w4 = worlds.worlds[3]!;
const level4 = buildLevel(w4);
const zone4 = level4.bosses[0]!;

function sim4(stat: number): Sim {
  return createSim(level4, tuning, { balance, speedCurve: curve, stat, boss: game.threat.boss! });
}

describe('helpers of the giant and «slowed» (RG-04)', () => {
  it('data: one helper on mountains 4–6, two on 7–10, none before; V_b = v(advice) × 0.85 / 1.05 (rounded down)', () => {
    expect(worlds.worlds.map((w) => w.bosses![0]!.helpers?.length ?? 0)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 2]);
    for (const w of worlds.worlds.slice(3)) {
      const b = w.bosses![0]!;
      const v = moveSpeed(b.requires, curve);
      expect(b.giants[0]!.speed).toBeCloseTo(Math.floor(((v * 0.85) / 1.05) * 10) / 10, 6);
      for (const h of b.helpers!) expect(h).toMatchObject({ throwEverySec: 2.5, flightSec: 1, slow: 0.85, slowSec: 1, hitRadius: 1.5 });
    }
  });

  it('a snowball flies flightSec to where the running hero will be; a hit within hitRadius — «helperHit»', () => {
    const data: WorldBoss = { ...zone4, giants: zone4.giants.map((g) => ({ ...g })) };
    const ev: Array<{ name: string; p: unknown }> = [];
    const b = createBoss([data], game.threat.boss!, () => 1, () => false, (name, p) => ev.push({ name, p }));
    const hero = { x: 0, y: 0, z: data.zone[0] + 2, speed: 40, vx: 0, vz: 40 };
    let thrownAt = -1;
    for (let i = 0; i < 300 && !ev.some((e) => e.name === 'helperHit'); i++) {
      b.step(DT, hero, true, i);
      if (thrownAt < 0 && ev.some((e) => e.name === 'helperThrow')) {
        thrownAt = i;
        const ball = b.zones[0]!.helpers[0]!.ball!;
        expect(ball.to[2]).toBeCloseTo(Math.min(data.zone[1], hero.z + 40 * data.helpers![0]!.flightSec), 6);
        expect(ball.flight).toBe(1);
      }
      hero.z += 40 * DT;
    }
    expect(thrownAt).toBeGreaterThanOrEqual(0);
    // The first throw within 3 s of the zone.
    expect(thrownAt * DT).toBeLessThanOrEqual(3);
    const hit = ev.find((e) => e.name === 'helperHit')!.p as BossEvents['helperHit'];
    expect(hit).toMatchObject({ slow: 0.85, slowSec: 1 });
    // A hero who stepped aside is missed.
    const ev2: Array<{ name: string }> = [];
    const b2 = createBoss([data], game.threat.boss!, () => 1, () => false, (name) => ev2.push({ name }));
    const h2 = { x: 0, y: 0, z: data.zone[0] + 2, speed: 40, vx: 0, vz: 40 };
    let side = false;
    for (let i = 0; i < 200; i++) {
      b2.step(DT, h2, true, i);
      if (ev2.some((e) => e.name === 'helperThrow')) side = true;
      h2.z += 40 * DT;
      if (side) h2.x += 20 * DT;
    }
    expect(ev2.some((e) => e.name === 'helperThrow')).toBe(true);
    expect(ev2.some((e) => e.name === 'helperHit')).toBe(false);
  });

  it('«slowed»: × mult for slowSec of simulation; hits in a row do not stack; no sim steps — it does not tick', () => {
    const s = sim4(zone4.requires);
    const v = moveSpeed(zone4.requires, curve);
    s.slowDown(0.85, 1);
    s.slowDown(0.85, 0.5);
    expect(s.slow).toEqual({ mult: 0.85, left: 1 });
    // A pause or a window steps no sim: nothing passes.
    expect(s.slow!.left).toBe(1);
    s.step(STAND, DT);
    expect(s.params.speed).toBeCloseTo(v * 0.85, 6);
    for (let i = 0; i < 30; i++) s.step(STAND, DT);
    expect(s.slow!.left).toBeCloseTo(1 - 31 * DT, 6);
    for (let i = 0; i < 40; i++) s.step(STAND, DT);
    expect(s.slow).toBeNull();
    expect(s.params.speed).toBeCloseTo(v, 6);
  });

  it('F12: the hero with the advice passes the zone of mountain 4 even slowed at the meeting; standing — caught as before', () => {
    const run = (input: HeroInput, slowAtMeet: boolean): string[] => {
      const s = sim4(zone4.requires);
      const ev: string[] = [];
      s.events.on('bossCaught', () => ev.push('caught'));
      s.events.on('bossPassed', () => ev.push('passed'));
      s.teleport(0, s.level.floorYAt(zone4.zone[0] - 10), zone4.zone[0] - 10);
      for (let i = 0; i < 60 * 30 && ev.length === 0; i++) {
        const g = s.boss!.zones[0]!.giants[0]!;
        // A snowball right when the giant is near.
        if (slowAtMeet && Math.abs(g.z - s.hero.pos.z) < 12) s.slowDown(0.85, 1);
        s.step(input, DT);
      }
      return ev;
    };
    expect(run(RUN, true)).toEqual(['passed']);
    expect(run(STAND, false)).toEqual([]);
    const s = sim4(zone4.requires);
    const ev: string[] = [];
    s.events.on('bossCaught', () => ev.push('caught'));
    s.teleport(0, s.level.floorYAt(zone4.zone[0] + 20), zone4.zone[0] + 20);
    for (let i = 0; i < 60 * 30 && ev.length === 0; i++) s.step(STAND, DT);
    expect(ev).toEqual(['caught']);
  });
});

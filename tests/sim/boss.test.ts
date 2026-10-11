import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, GameJson, TuningJson, World, WorldsJson } from '../../src/content/types.ts';

// PS-07: the giant of the open slope (docs/01-gdd.md 17.6; docs/01a-content.md 16.4; producer's decision 10.10: patrol).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/open/balance.json'));
const tuning = mergePatch(read('tuning.json') as TuningJson, read('pace/open/tuning.json'));
const game = read('game.json') as GameJson;
const worlds = (read('pace/open/worlds.json') as WorldsJson).worlds;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const cfg = game.threat.boss!;
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w1 = worlds[0]!;
const zone = w1.bosses![0]!.zone;
const giant = w1.bosses![0]!.giants[0]!;
/** The stat whose run speed is exactly k × the giant's speed × (1 + margin). */
const statFor = (k: number): number => {
  const v = k * giant.speed * (1 + cfg.margin);
  return Math.pow(10, (v / curve.base - 1) / curve.k) - 1;
};

function climb(world: World, stat: number, frontier = 0): { s: Sim; events: string[] } {
  const level = buildLevel(world);
  const s = createSim(level, tuning, { balance, speedCurve: curve, stat, boss: cfg, resume: frontier ? { frontierWall: frontier } : undefined });
  const events: string[] = [];
  for (const n of ['bossEnter', 'bossPassed', 'bossCaught', 'gateOpen', 'gatePass', 'caughtEnd'] as const) s.events.on(n, () => events.push(n));
  return { s, events };
}
const runUntil = (s: Sim, done: () => boolean, sec = 30): void => {
  for (let i = 0; i < sec * 60 && !done(); i++) s.step(RUN, DT);
};

describe('giant (PS-07)', () => {
  it('the advice of every mountain runs faster than its giant × (1 + margin)', () => {
    for (const w of worlds) for (const b of w.bosses!) for (const g of b.giants) expect(moveSpeed(b.requires, curve)).toBeGreaterThan(g.speed * (1 + cfg.margin));
  });

  it('faster than speed × (1 + margin): through the zone to the summit, never caught; the giant’s check opens', () => {
    for (const stat of [w1.bosses![0]!.requires, statFor(1.02)]) {
      const { s, events } = climb(w1, stat);
      s.teleport(0, s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
      runUntil(s, () => s.hero.pos.z > zone[1] + 5);
      expect(events, `stat ${stat}`).toContain('bossEnter');
      expect(events).not.toContain('bossCaught');
      expect(events).toContain('bossPassed');
      expect(s.gatesOpen[s.gatesOpen.length - 1]).toBe(true);
      expect(s.gatesPassed[s.gatesPassed.length - 1]).toBe(true);
    }
  });

  it('slower: the giant catches him, he is back at the start of the zone within caught.maxSec; Speed, coins and frontier stay', () => {
    const { s, events } = climb(w1, statFor(0.97), 3);
    s.teleport(0, s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
    const frontier = s.gatesPassed.map(Boolean);
    let caughtAt = -1;
    s.events.on('bossCaught', () => void (caughtAt = s.tick));
    runUntil(s, () => caughtAt >= 0);
    expect(caughtAt).toBeGreaterThan(0);
    const stat = s.progress.stat;
    const coins = s.coins;
    for (let i = 0; i < balance.caught.maxSec * 60 + 2; i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(events).toContain('caughtEnd');
    expect(s.caught).toBeNull();
    expect(s.hero.pos.z).toBeLessThan(zone[0]);
    expect(s.hero.pos.z).toBeGreaterThan(zone[0] - 10);
    // Steps while rolling back count nothing; the catch takes nothing away.
    expect(s.progress.stat).toBeGreaterThanOrEqual(stat);
    expect(s.coins).toBe(coins);
    expect(s.gatesPassed.map(Boolean)).toEqual(frontier);
    expect(events).not.toContain('bossPassed');
    // Straight back in: the chase starts again.
    const enters = events.filter((e) => e === 'bossEnter').length;
    runUntil(s, () => events.filter((e) => e === 'bossEnter').length > enters, 5);
    expect(events.filter((e) => e === 'bossEnter').length).toBe(enters + 1);
    runUntil(s, () => s.boss!.zones[0]!.giants[0]!.mode === 'chase', 3);
    expect(s.boss!.zones[0]!.giants[0]!.mode).toBe('chase');
  });

  it('on the run he meets the giant at his run speed: half-pushed stick and zigzags with the advice — past him; a slow walk — caught (playtest PS)', () => {
    const level = buildLevel(w1);
    const advice = w1.bosses![0]!.requires;
    for (const [input, passes] of [
      [{ moveX: 0, moveZ: 0.6, jump: false, jumpHeld: false }, true],
      [{ moveX: 0.5, moveZ: 0.85, jump: false, jumpHeld: false }, true],
      [{ moveX: 0, moveZ: 0.3, jump: false, jumpHeld: false }, false],
    ] as Array<[HeroInput, boolean]>) {
      // From a standstill at the start of the zone, where a catch puts him; the giant at the foot of his patrol.
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: advice, boss: cfg });
      s.boss!.zones[0]!.giants[0]!.z = zone[0] + 20;
      s.teleport(0, level.floorYAt(zone[0] - 3), zone[0] - 3);
      const events: string[] = [];
      s.events.on('bossCaught', () => events.push('caught'));
      s.events.on('bossPassed', () => events.push('passed'));
      let zig = 1;
      for (let i = 0; i < 40 * 60 && events.length === 0; i++) {
        if (i % 30 === 0) zig = -zig;
        s.step({ ...input, moveX: input.moveX * zig }, DT);
      }
      expect(events, JSON.stringify(input)).toEqual([passes ? 'passed' : 'caught']);
    }
  });

  it('standing still in the zone the hero is caught at any Speed', () => {
    const { s, events } = climb(w1, 1e12);
    s.teleport(0, s.level.floorAt(0, zone[0] + 5), zone[0] + 5);
    for (let i = 0; i < 30 * 60 && !events.includes('bossCaught'); i++) s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(events).toContain('bossCaught');
  });

  it('a second zone and a second giant in a zone work from the data alone', () => {
    const w = JSON.parse(JSON.stringify(w1)) as World;
    const mid = (zone[0] + zone[1]) / 2;
    w.bosses = [
      { ...w.bosses![0]!, zone: [zone[0], mid], giants: [{ ...giant }] },
      { ...w.bosses![0]!, zone: [mid + 1, zone[1]], giants: [{ ...giant }, { ...giant, speed: giant.speed * 0.9 }] },
    ];
    const fast = climb(w, statFor(1.05));
    fast.s.teleport(0, fast.s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
    runUntil(fast.s, () => fast.s.hero.pos.z > zone[1] + 5);
    expect(fast.events.filter((e) => e === 'bossEnter')).toHaveLength(2);
    expect(fast.events.filter((e) => e === 'bossPassed')).toHaveLength(2);
    expect(fast.events).not.toContain('bossCaught');
    expect(fast.s.boss!.zones[1]!.giants).toHaveLength(2);
    expect(fast.s.gatesOpen[fast.s.gatesOpen.length - 1]).toBe(true);
    // Slower than the giants of the second zone, but faster than the first's? Still caught in the first one.
    const slow = climb(w, statFor(0.95));
    slow.s.teleport(0, slow.s.level.floorAt(0, zone[0] - 10), zone[0] - 10);
    runUntil(slow.s, () => slow.events.includes('bossCaught'));
    expect(slow.events).toContain('bossCaught');
    expect(slow.s.hero.pos.z).toBeLessThan(mid);
  });

  it('the avalanche never starts above the start of the first zone (threat.spawnMaxZ)', () => {
    for (const w of worlds) expect(w.threat.spawnMaxZ).toBe(w.bosses![0]!.zone[0]);
  });
});

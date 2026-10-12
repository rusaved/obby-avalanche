import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createBoss, type BossEvents } from '../../src/sim/boss.ts';
import { createSim } from '../../src/sim/world.ts';
import type { BalanceJson, BotsJson, GameJson, TuningJson, WorldBoss, WorldsJson } from '../../src/content/types.ts';

// RG-10: the giant goes at bots too, at the hero first (docs/01-gdd.md 18.5; docs/01a-content.md 17.4; Q-047).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const game = read<GameJson>('game.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const bots = read<BotsJson>('bots.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const STAND = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const ZONE: WorldBoss = { zone: [100, 200], requires: 1000, returnMult: 1.5, giants: [{ speed: 30, patrol: 'alongZ', seeDist: 0, turnSec: 0.5 }] };
const CFG = { margin: 0.05, reach: 3 };
const OUT = { x: 0, y: 0, z: 0, speed: 0 };

function boss(): { b: ReturnType<typeof createBoss>; ev: Array<{ name: string; p: unknown }> } {
  const ev: Array<{ name: string; p: unknown }> = [];
  const b = createBoss([ZONE], CFG, () => 1, () => false, (name, p) => ev.push({ name, p }));
  return { b, ev };
}

describe('the giant goes at bots too (RG-10)', () => {
  it('a bot running the zone turns the giant to it; slower than V_b × 1.05 — slapped; faster — past him', () => {
    const { b, ev } = boss();
    const slow = { bot: 0, z: 105, speed: 25 };
    for (let i = 0; i < 600 && !ev.some((e) => e.name === 'bossBotCaught'); i++) {
      b.step(DT, OUT, true, i, [slow]);
      slow.z += slow.speed * DT;
    }
    expect(ev.map((e) => e.name)).toContain('bossBotCaught');
    expect((ev.find((e) => e.name === 'bossBotCaught')!.p as BossEvents['bossBotCaught']).bot).toBe(0);
    // Rolled away (the bots take it off the zone): no one left to run at — back on patrol.
    b.step(DT, OUT, true, 999, []);
    expect(b.zones[0]!.giants[0]!.mode).toBe('back');

    const { b: b2, ev: ev2 } = boss();
    const fast = { bot: 1, z: 105, speed: 35 };
    for (let i = 0; i < 600 && fast.z <= 200; i++) {
      b2.step(DT, OUT, true, i, [fast]);
      fast.z += fast.speed * DT;
    }
    expect(fast.z).toBeGreaterThan(200);
    expect(ev2.filter((e) => e.name === 'bossBotCaught')).toEqual([]);
  });

  it('with the hero and a bot in the zone the giant goes at the hero, even past a nearer bot (Q-047)', () => {
    const { b } = boss();
    const g = b.zones[0]!.giants[0]!;
    g.z = 150;
    const hero = { x: 0, y: 0, z: 190, speed: 0 };
    const bot = { bot: 0, z: 125, speed: 0 };
    for (let i = 0; i < 40; i++) b.step(DT, hero, true, i, [bot]);
    expect(g.mode).toBe('chase');
    expect(g.dir).toBe(1);
    expect(g.z).toBeGreaterThan(150);
  });

  it('mountain 1: bots wait by the zone, run it; some slapped and rolled back to its start, about passShare past him', () => {
    const w1 = worlds.worlds[0]!;
    const level = buildLevel(w1);
    const zone = level.bosses[0]!.zone;
    const s = createSim(level, tuning, {
      balance,
      speedCurve: curve,
      stat: level.bosses[0]!.requires,
      boss: game.threat.boss!,
      bots: { cfg: bots, count: 6, seed: 11 },
    });
    const caught: number[] = [];
    s.events.on('bossBotCaught', ({ bot }) => caught.push(bot));
    // Bots start right below the zone; the hero stays in the camp.
    for (const b of s.bots!.list) {
      b.mode = 'up';
      b.z = zone[0] - 40 - b.index * 4;
      b.x = b.lane;
      b.path = [[b.lane, zone[1]]];
    }
    let waited = 0;
    const passed = new Set<number>();
    const back: number[] = [];
    for (let i = 0; i < 60 * 120; i++) {
      s.step(STAND, DT);
      for (const b of s.bots!.list) {
        if (b.mode === 'zone' && b.zoneSpeed === 0) waited++;
        if (b.z > zone[1] + 2 && !passed.has(b.index)) passed.add(b.index);
        if (b.mode === 'ball' && b.ball && b.ball.t < DT * 1.5) back.push(b.ball.to.z);
      }
    }
    expect(waited).toBeGreaterThan(0);
    expect(caught.length).toBeGreaterThan(0);
    for (const z of back) expect(z).toBeLessThan(zone[0]);
    expect(passed.size).toBeGreaterThan(0);
    // A bot runs at the giant's speed × speedK[1] with passShare, else × speedK[0]: the first-try pass share ≈ passShare.
    let pass = 0;
    let runs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { b, ev } = boss();
      const k = bots.boss!.speedK;
      const rand = ((seed * 9301 + 49297) % 233280) / 233280;
      const r = { bot: 0, z: 101, speed: 30 * (rand < bots.boss!.passShare ? k[1] : k[0]) };
      for (let i = 0; i < 900 && r.z <= 200 && !ev.length; i++) {
        b.step(DT, OUT, true, i, [r]);
        r.z += r.speed * DT;
      }
      runs++;
      if (r.z > 200 && !ev.some((e) => e.name === 'bossBotCaught')) pass++;
    }
    expect(pass / runs).toBeGreaterThan(bots.boss!.passShare - 0.2);
    expect(pass / runs).toBeLessThan(bots.boss!.passShare + 0.2);
  });
});

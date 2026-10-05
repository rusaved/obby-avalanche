import { describe, expect, it } from 'vitest';
import { buildLevel } from '../../src/level/builder.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { giftEggSpot } from '../../src/sim/gift-egg.ts';
import { gainMult, nextShoes, shoesPrice } from '../../src/meta/shoes.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, PetsJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const DT = 1 / 60;
const bal = balance as BalanceJson;
const tun = tuning as TuningJson;
const pets = petsJson as PetsJson;
const world1 = (worldsJson as unknown as WorldsJson).worlds[0]!;
const level = buildLevel(world1);
const curve = { ...bal.speedCurve, base: tun.controller.baseSpeed, max: tun.controller.maxSpeed };

function freshSim(): Sim {
  return createSim(level, tun, {
    balance: bal,
    speedCurve: curve,
    threat: { threat: { ...world1.threat }, balance: bal, avalanche: tun.avalanche, scriptedPending: true, normalWavesDone: 0 },
    giftEgg: { wall: bal.ftue.scriptedWaveWall, pet: bal.ftue.freeEggPet, hatchSec: bal.ftue.eggHatchSec },
  });
}

/** One tick towards the first point of `path` (world space, the way the e2e bot walks); drops reached points. */
function walk(sim: Sim, path: Array<[number, number]>): void {
  while (path.length > 0 && Math.hypot(path[0]![0] - sim.hero.pos.x, path[0]![1] - sim.hero.pos.z) < 0.6) path.shift();
  const p = path[0];
  if (!p) return sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
  const dx = p[0] - sim.hero.pos.x;
  const dz = p[1] - sim.hero.pos.z;
  const len = Math.hypot(dx, dz);
  sim.step({ moveX: dx / len, moveZ: dz / len, jump: false, jumpHeld: false }, DT);
}

// M2-08, GDD-01: the first minute (docs/01-gdd.md 6.2) on a fresh save, game time.
describe('first 60 seconds (M2-08)', () => {
  it('bot: walls 1–3 on the approach, scripted wave in cave 4, belt ×7, free egg, wall 4 — within the GDD-01 limits', () => {
    const sim = freshSim();
    const at: Record<string, number> = {};
    const mark = (name: string): void => void (at[name] ??= sim.tick * DT);
    sim.events.on('gateOpen', ({ wall }) => mark(`gate_${wall}`));
    sim.events.on('waveEnd', ({ scripted, outcome }) => {
      if (scripted) mark(`first_wave_${outcome}`);
    });
    sim.events.on('waveCaught', () => mark('caught'));
    sim.events.on('gain', ({ belt }) => {
      if (belt) mark('treadmill_first');
    });
    let shoeLevel = 0;
    const owned: string[] = [];
    sim.events.on('eggHatch', ({ pet }) => {
      owned.push(pet);
      mark('egg_1');
    });
    const cave = level.niches[bal.ftue.scriptedWaveWall - 1]!;
    const belt = level.points.find((p) => p.type === 'treadmill' && p['niche'] === cave.stretch - 1)!;
    const egg = giftEggSpot(level, bal.ftue.scriptedWaveWall)!;
    expect(cave.treadmill).toBe(7);
    // Straight up the track, one step aside for the first green gift (docs/01-gdd.md 6.2, 22–32 s: 30 coins → shoes).
    const path: Array<[number, number]> = [[-4, 229], [0, 300], [0, 345]];
    let stage = 'up';
    let standAtGate = 0;
    let standMax = 0;
    for (let i = 0; i < 90 * 60 && at['gate_4'] === undefined; i++) {
      if (stage === 'up' && sim.threat!.state.phase === 'warn') {
        stage = 'cave';
        path.splice(0, path.length, [cave.box.min[0] - 1, cave.z - 3], [belt.x, belt.z]);
      }
      if (stage === 'cave' && at['first_wave_survived'] !== undefined) {
        stage = 'egg';
        path.splice(0, path.length, [egg.x, egg.z]);
      }
      if (stage === 'egg' && at['egg_1'] !== undefined) {
        stage = 'belt';
        path.splice(0, path.length, [belt.x, belt.z]);
      }
      walk(sim, path);
      // Buy the next pair when the coins are there (the HUD button, one tap).
      const next = nextShoes(bal.upgrade.tiers, shoeLevel);
      if (next && sim.coins >= shoesPrice(next, 0, bal.rebirth)) {
        sim.coins -= shoesPrice(next, 0, bal.rebirth);
        shoeLevel++;
      }
      sim.progress.gainMult = gainMult(bal, pets, { shoeLevel, pets: owned });
      const h = sim.hero;
      const blocked = level.gates.some((g, gi) => !sim.gatesOpen[gi] && g.z - h.pos.z > 0 && g.z - h.pos.z < 2.5);
      standAtGate = blocked && h.speed < 1 && stage === 'up' ? standAtGate + DT : 0;
      standMax = Math.max(standMax, standAtGate);
    }
    expect(at['gate_1']).toBeLessThanOrEqual(15);
    expect(at['gate_3']).toBeLessThanOrEqual(40);
    expect(at['first_wave_survived']).toBeLessThanOrEqual(55);
    expect(at['treadmill_first']).toBeLessThanOrEqual(70);
    expect(at['egg_1']).toBeLessThanOrEqual(70);
    expect(at['gate_4']).toBeLessThanOrEqual(90);
    expect(at['caught']).toBeUndefined();
    expect(standMax).toBeLessThanOrEqual(0.5);
    expect(owned).toEqual([bal.ftue.freeEggPet]);
    expect(sim.giftEgg?.phase).toBe('done');
  });

  it('the scripted wave never catches: the hero stays on the open slope under it → dusted, no ball, nothing lost', () => {
    const sim = freshSim();
    const names: string[] = [];
    for (const n of ['waveCaught', 'waveDusted', 'waveSurvived'] as const) sim.events.on(n, () => names.push(n));
    sim.teleport(0, level.floorYAt(350) + 0.05, 350);
    const stat = sim.progress.stat;
    for (let i = 0; i < 30 * 60 && sim.threat!.state.scriptedPending; i++) sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(names).toEqual(['waveDusted']);
    expect(sim.caught).toBeNull();
    expect(sim.progress.stat).toBe(stat);
  });

  it('gate pass pays its coins once; the free egg hatches after eggHatchSec and only once', () => {
    const sim = freshSim();
    const passes: number[] = [];
    sim.events.on('gatePass', ({ wall, coins }) => passes.push(wall * 1000 + coins));
    sim.progress.stat = 50;
    sim.teleport(0, level.floorYAt(120) + 0.05, 120);
    for (let i = 0; i < 60; i++) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    expect(passes).toEqual([1000 + level.gates[0]!.rewardCoins]);
    expect(sim.coins).toBe(level.gates[0]!.rewardCoins);
    // Back and forth through the open gate: no second payment.
    for (let i = 0; i < 60; i++) sim.step({ moveX: 0, moveZ: -1, jump: false, jumpHeld: false }, DT);
    for (let i = 0; i < 60; i++) sim.step({ moveX: 0, moveZ: 1, jump: false, jumpHeld: false }, DT);
    expect(passes).toHaveLength(1);

    const egg = sim.giftEgg!;
    const hatch: number[] = [];
    sim.events.on('eggTouch', () => hatch.push(-sim.tick));
    sim.events.on('eggHatch', () => hatch.push(sim.tick));
    sim.teleport(egg.x, egg.y + 0.05, egg.z - 1);
    for (let i = 0; i < 3 * 60; i++) sim.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
    expect(hatch).toHaveLength(2);
    expect((hatch[1]! + hatch[0]!) * DT).toBeCloseTo(bal.ftue.eggHatchSec, 1);
    expect(egg.phase).toBe('done');
  });
});

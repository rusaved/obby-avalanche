import { describe, expect, it } from 'vitest';
import { buildLevel } from '../../src/level/builder.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { BONUS_HALF, type BonusConfig } from '../../src/sim/bonus.ts';
import { inSafeZone } from '../../src/sim/shelter.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import game from '../../content/avalanche/game.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, GameJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const DT = 1 / 60;
const bal = balance as BalanceJson;
const tun = tuning as TuningJson;
const cfg = (game as unknown as GameJson).threat.bonus as BonusConfig;
const world1 = (worldsJson as unknown as WorldsJson).worlds[0]!;
const level = buildLevel(world1);
const curve = { ...bal.speedCurve, base: tun.controller.baseSpeed, max: tun.controller.maxSpeed };
const zoneGift = (zone: number): number => world1.zones.find((z) => z.k === zone)!.gift;

type Ev = { name: string; p: Record<string, unknown> };
function goldSim(o: { bonus?: boolean; seed?: number; wavesBefore?: number; scripted?: boolean } = {}): { sim: Sim; log: Ev[] } {
  const sim = createSim(level, tun, {
    balance: bal,
    speedCurve: curve,
    threat: { threat: { ...world1.threat }, balance: bal, avalanche: tun.avalanche, scriptedPending: o.scripted ?? false, normalWavesDone: 99 },
    bonus: (o.bonus ?? true) ? { cfg, seed: o.seed ?? 7, wavesBefore: o.wavesBefore ?? 1 } : undefined,
  });
  const log: Ev[] = [];
  for (const name of ['waveWarn', 'waveSurvived', 'waveCaught', 'waveGone', 'bonusSpawn', 'bonusTake', 'bonusSaved', 'bonusLost', 'portal'])
    sim.events.on(name, (p) => void log.push({ name, p: p as Record<string, unknown> }));
  return { sim, log };
}
/** Opens every wall below z (the stat a playing hero would have) and stands the hero on the floor there. */
function standAt(sim: Sim, x: number, z: number, y = level.floorYAt(z)): void {
  const below = level.gates.filter((g) => g.z < z).length;
  if (below > 0) sim.progress.stat = sim.gateRequirement(below - 1);
  sim.step(NO_INPUT, DT);
  sim.teleport(x, y + 0.05, z);
  sim.step(NO_INPUT, DT);
}
const caveCentre = (i: number): { x: number; y: number; z: number } => {
  const n = level.niches[i]!;
  return { x: (n.box.min[0] + n.box.max[0]) / 2, y: n.y, z: n.z };
};
/** Forces the next wave and steps to the start of its warning. */
function warn(sim: Sim): void {
  sim.threat!.trigger();
  for (let i = 0; i < 10 && sim.threat!.state.phase !== 'warn'; i++) sim.step(NO_INPUT, DT);
}
function until(sim: Sim, done: () => boolean, sec = 60, keep?: () => void): void {
  for (let i = 0; i < sec * 60 && !done(); i++) {
    keep?.();
    sim.step(NO_INPUT, DT);
  }
}
const take = (sim: Sim): void => {
  const b = sim.bonus!;
  sim.teleport(b.x, b.y + 0.05, b.z);
  sim.step(NO_INPUT, DT);
};
const summitZ = level.safeZones[level.safeZones.length - 1]![0];

// M2-12: the golden gift of the warning (docs/01-gdd.md 4.9; docs/02-tech.md 8.1).
describe('golden gift (M2-12)', () => {
  it('no gift on the scripted and the 1st normal wave; from the 2nd — one per wave', () => {
    const { sim, log } = goldSim({ wavesBefore: 0, scripted: true });
    const c = caveCentre(3);
    standAt(sim, c.x, c.z, c.y);
    for (let w = 0; w < 4; w++) {
      warn(sim);
      expect(sim.threat!.state.scripted).toBe(w === 0);
      if (w < 2) expect(sim.bonus, `wave ${w}`).toBeNull();
      else expect(sim.bonus, `wave ${w}`).not.toBeNull();
      until(sim, () => sim.threat!.state.phase === 'gone');
      expect(sim.bonus).toBeNull();
    }
    expect(log.filter((e) => e.name === 'bonusSpawn')).toHaveLength(2);
  });

  it('where: on the ground of the open part, distMin–distMax from the cave lit on warn; none in the camp or on the summit', () => {
    let placed = 0;
    // One sim per lane, the hero going up: walls open behind him as in play; each point gets a fresh warning.
    for (const x of [-9, 0, 9]) {
      const { sim, log } = goldSim({ seed: 100 + x });
      for (let z = 12; z < 1180; z += 11) {
        standAt(sim, x, z);
        log.length = 0;
        warn(sim);
        const b = sim.bonus;
        const spawns = log.filter((e) => e.name === 'bonusSpawn').length;
        const next = (): void => {
          sim.threat!.state.phase = 'gone';
          sim.bonus = null;
        };
        if (inSafeZone(level, sim.hero.pos.z)) {
          expect(b, `safe zone z=${z}`).toBeNull();
          next();
          continue;
        }
        expect(spawns).toBe(b ? 1 : 0);
        if (!b) {
          next();
          continue;
        }
        placed++;
        const cave = level.niches[sim.threat!.state.shelter]!;
        const d = Math.abs(b.z - cave.z);
        expect(d, `z=${z}`).toBeGreaterThanOrEqual(cfg.distMin - 1e-6);
        expect(d, `z=${z}`).toBeLessThanOrEqual(cfg.distMax + 1e-6);
        // Not behind a wall closed for the hero, not in a cave, not on the summit, on a floor or a ramp (no gap).
        const lo = Math.min(b.z, sim.hero.pos.z, cave.z);
        const hi = Math.max(b.z, sim.hero.pos.z, cave.z);
        expect(level.gates.some((g, i) => !sim.gatesOpen[i] && g.z > lo && g.z < hi)).toBe(false);
        expect(Math.abs(b.x) + BONUS_HALF).toBeLessThan(level.width / 2);
        expect(b.z + BONUS_HALF).toBeLessThan(summitZ);
        const under =
          level.boxes.some((f) => f.kind === 'floor' && f.min[2] <= b.z - BONUS_HALF && f.max[2] >= b.z + BONUS_HALF) ||
          level.ramps.some((r) => r.z0 <= b.z - BONUS_HALF && r.z1 >= b.z + BONUS_HALF);
        expect(under).toBe(true);
        expect(b.y).toBeCloseTo(level.floorYAt(b.z), 6);
        // Not inside an obstacle (ledges) and not on a belt.
        for (const box of level.boxes.filter((x) => x.kind === 'ledge'))
          expect(box.max[0] < b.x - BONUS_HALF || box.min[0] > b.x + BONUS_HALF || box.max[2] < b.z - BONUS_HALF || box.min[2] > b.z + BONUS_HALF).toBe(true);
        next();
      }
    }
    expect(placed).toBeGreaterThan(200);
    // Same seed — same point.
    const a = goldSim({ seed: 5 });
    const b = goldSim({ seed: 5 });
    for (const s of [a.sim, b.sim]) {
      standAt(s, 0, 300);
      warn(s);
    }
    expect(a.sim.bonus).toEqual(b.sim.bonus);
  });

  it('taken and brought into the cave: «Phew, made it!» + mult × the gift of its zone, one toast, then gold_saved', () => {
    const { sim, log } = goldSim();
    const c = caveCentre(2);
    standAt(sim, c.x, c.z, c.y);
    warn(sim);
    const b = { ...sim.bonus! };
    take(sim);
    expect(sim.bonus!.carried).toBe(true);
    const coins0 = sim.coins;
    sim.teleport(c.x, c.y + 0.05, c.z);
    until(sim, () => log.some((e) => e.name === 'waveSurvived'));
    const surv = log.find((e) => e.name === 'waveSurvived')!.p;
    const normal = bal.coins.waveSurvived * zoneGift(level.niches[2]!.zone!);
    expect(surv['gold']).toBe(cfg.mult * zoneGift(b.zone));
    expect(sim.coins - coins0).toBe(normal + cfg.mult * zoneGift(b.zone));
    expect(log.filter((e) => e.name.startsWith('bonus')).map((e) => e.name)).toEqual(['bonusSpawn', 'bonusTake', 'bonusSaved']);
    expect(log.find((e) => e.name === 'bonusSaved')!.p['where']).toBe('cave');
    expect(sim.bonus).toBeNull();
  });

  it('into the portal with the gift: saved at once; in the camp or on the summit — on gone', () => {
    const p = goldSim();
    const c = caveCentre(11);
    standAt(p.sim, c.x, c.z, c.y);
    warn(p.sim);
    take(p.sim);
    const portal = level.points.find((x) => x.type === 'portal')!;
    p.sim.teleport(portal.x, portal.y + 0.05, portal.z - 1);
    for (let i = 0; i < 60 && !p.sim.portalEntered; i++) p.sim.step({ ...NO_INPUT, moveZ: 1 }, DT);
    expect(p.sim.portalEntered).toBe(true);
    const saved = p.log.find((e) => e.name === 'bonusSaved')!.p;
    expect(saved['where']).toBe('portal');
    expect(p.sim.threat!.state.phase).toBe('warn');

    const g = goldSim();
    const c2 = caveCentre(1);
    standAt(g.sim, c2.x, c2.z, c2.y);
    warn(g.sim);
    const zone = g.sim.bonus!.zone;
    take(g.sim);
    g.sim.teleport(0, 0.05, 20);
    const coins0 = g.sim.coins;
    until(g.sim, () => g.sim.threat!.state.phase === 'run');
    expect(g.log.some((e) => e.name === 'bonusSaved')).toBe(false);
    until(g.sim, () => g.sim.threat!.state.phase === 'gone');
    const s = g.log.find((e) => e.name === 'bonusSaved')!.p;
    expect(s['where']).toBe('gone');
    expect(g.sim.coins - coins0).toBe(cfg.mult * zoneGift(zone));

    // On the summit (not through the portal): counted on gone as well.
    const m = goldSim();
    standAt(m.sim, c.x, c.z, c.y);
    warn(m.sim);
    take(m.sim);
    m.sim.teleport(0, level.floorYAt(summitZ + 15) + 0.05, summitZ + 15);
    until(m.sim, () => m.sim.threat!.state.phase === 'gone');
    expect(m.log.filter((e) => e.name === 'bonusSaved').map((e) => e.p['where'])).toEqual(['gone']);
    expect(m.sim.portalEntered).toBe(false);
  });

  it('snowed in with the gift: it pops (gold_lost); Speed, coins and walls stay as they were', () => {
    const { sim, log } = goldSim();
    standAt(sim, 0, 160);
    warn(sim);
    take(sim);
    // Back on the slope between the caves, away from shelter.
    sim.teleport(0, level.floorYAt(160) + 0.05, 160);
    const before = { stat: sim.progress.stat, coins: sim.coins, gates: [...sim.gatesOpen] };
    until(sim, () => log.some((e) => e.name === 'waveCaught'));
    expect(log.some((e) => e.name === 'bonusLost')).toBe(true);
    expect(sim.bonus).toBeNull();
    until(sim, () => sim.threat!.state.phase === 'gone');
    expect({ stat: sim.progress.stat, coins: sim.coins, gates: [...sim.gatesOpen] }).toEqual(before);
    expect(log.some((e) => e.name === 'bonusSaved')).toBe(false);
  });

  it('not taken: it melts when the front reaches its point, and cannot be taken after', () => {
    const { sim, log } = goldSim();
    const c = caveCentre(4);
    standAt(sim, c.x, c.z, c.y);
    warn(sim);
    const b = { ...sim.bonus! };
    until(sim, () => sim.threat!.state.phase === 'run' && sim.threat!.state.frontZ <= b.z + 1);
    expect(sim.bonus).not.toBeNull();
    until(sim, () => sim.bonus === null, 2);
    expect(sim.threat!.state.frontZ).toBeLessThanOrEqual(b.z);
    expect(sim.threat!.state.frontZ).toBeGreaterThan(b.z - 1);
    sim.teleport(b.x, b.y + 0.05, b.z);
    sim.step(NO_INPUT, DT);
    expect(sim.bonus).toBeNull();
    expect(log.filter((e) => e.name.startsWith('bonus')).map((e) => e.name)).toEqual(['bonusSpawn']);
  });

  it('without threat.bonus in the data there is never a gift; giveBonus does nothing', () => {
    const { sim, log } = goldSim({ bonus: false, wavesBefore: 5 });
    standAt(sim, 0, 160);
    for (let w = 0; w < 3; w++) {
      warn(sim);
      expect(sim.giveBonus()).toBe(false);
      until(sim, () => sim.threat!.state.phase === 'gone');
    }
    expect(log.some((e) => e.name.startsWith('bonus'))).toBe(false);
    expect(sim.bonus).toBeNull();
  });
});

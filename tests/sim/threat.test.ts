import { describe, expect, it } from 'vitest';
import { buildLevel } from '../../src/level/builder.ts';
import { createThreat, nearestShelter, type ThreatEvents, type ThreatHero } from '../../src/sim/threat.ts';
import { entranceX } from '../../src/sim/shelter.ts';
import { createSim } from '../../src/sim/world.ts';
import { NO_INPUT } from '../../src/sim/controller.ts';
import { createLoop } from '../../src/core/loop.ts';
import { PAUSE_REASONS, PauseManager } from '../../src/core/pause.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const DT = 1 / 60;
const bal = balance as BalanceJson;
const tun = tuning as TuningJson;
const worlds = worldsJson as unknown as WorldsJson;
const world1 = worlds.worlds[0]!;
const level = buildLevel(world1);
const allOpen = level.gates.map(() => true);

type Rec = { name: keyof ThreatEvents; tick: number; payload: unknown };
function threat(opts: { normalWavesDone?: number; scriptedPending?: boolean } = {}) {
  const log: Rec[] = [];
  const t = createThreat(
    level,
    {
      threat: { ...world1.threat },
      balance: bal,
      avalanche: tun.avalanche,
      scriptedPending: opts.scriptedPending ?? false,
      normalWavesDone: opts.normalWavesDone ?? 99,
    },
    (name, payload) => log.push({ name, tick: (payload as { tick: number }).tick, payload }),
  );
  return { t, log };
}
/** Runs one forced wave to its end with the hero fixed at `hero` (moved by `move` each tick, if given). */
function runWave(t: ReturnType<typeof threat>['t'], hero: ThreatHero, tick0 = 0, move?: (h: ThreatHero, tick: number) => void): number {
  t.trigger();
  let tick = tick0;
  for (let i = 0; i < 60 * 120 && !(t.state.phase === 'gone'); i++) {
    tick++;
    move?.(hero, tick);
    t.step(DT, hero, allOpen, tick);
  }
  for (let i = 0; i < 60 * 2 && t.state.phase === 'gone'; i++) t.step(DT, hero, allOpen, ++tick);
  return tick;
}
const names = (log: Rec[]): string[] => log.map((r) => r.name);

// M2-06: the avalanche (docs/01-gdd.md 4; docs/02-tech.md 8.1–8.2).
describe('avalanche phases (M2-06)', () => {
  const cave = level.niches[2]!;
  const sign = cave.side === 'left' ? -1 : 1;
  const ex = entranceX(level, cave);
  const inCave: ThreatHero = { x: (cave.box.min[0] + cave.box.max[0]) / 2, y: cave.y, z: cave.z, vx: 0, vz: 0 };

  it('idle → warn → run → gone → idle; first wave after firstIntervalSec 30 on mountain 1, numbers from worlds.json', () => {
    const { t, log } = threat();
    expect(world1.threat.firstIntervalSec).toBe(30);
    const hero: ThreatHero = { x: 0, y: 0, z: 500, vx: 0, vz: 0 };
    const phases: string[] = [t.state.phase];
    let tick = 0;
    while (tick < 60 * 30 + 1) {
      t.step(DT, hero, allOpen, ++tick);
      if (phases[phases.length - 1] !== t.state.phase) phases.push(t.state.phase);
    }
    expect(phases).toEqual(['idle', 'warn']);
    expect(log[0]!.name).toBe('waveWarn');
    expect(log[0]!.tick).toBeGreaterThanOrEqual(60 * 30 - 1);
    expect(log[0]!.tick).toBeLessThanOrEqual(60 * 30 + 1);
    expect(t.state.warnSec).toBe(world1.threat.warnSec);
    // from: aboveHero — the front starts spawnAhead (160) above the hero.
    expect(t.state.spawnZ).toBe(500 + world1.threat.spawnAhead);
    hero.x = inCave.x;
    hero.y = inCave.y;
    hero.z = inCave.z;
    while (t.state.phase !== 'idle') {
      t.step(DT, hero, allOpen, ++tick);
      if (phases[phases.length - 1] !== t.state.phase) phases.push(t.state.phase);
    }
    expect(phases).toEqual(['idle', 'warn', 'run', 'gone', 'idle']);
    expect(names(log)).toEqual(['waveWarn', 'waveStart', 'waveSurvived', 'waveGone', 'waveEnd']);
    // Next pause counts from gone: intervalSec in total.
    expect(t.state.timer + tun.avalanche.fadeSec).toBeCloseTo(world1.threat.intervalSec, 5);
  });

  it('outside a cave the wave catches; in a cave, in the camp and on the summit it does not', () => {
    const cases: Array<[string, ThreatHero, string]> = [
      ['slope', { x: 0, y: 0, z: 500, vx: 0, vz: 0 }, 'caught'],
      ['cave', { ...inCave }, 'survived'],
      ['camp', { x: 0, y: 0, z: 20, vx: 0, vz: 0 }, 'safe'],
      ['summit', { x: 0, y: 72, z: 1150, vx: 0, vz: 0 }, 'safe'],
    ];
    for (const [label, hero, outcome] of cases) {
      const { t, log } = threat();
      runWave(t, hero);
      const end = log.find((r) => r.name === 'waveEnd')!.payload as ThreatEvents['waveEnd'];
      expect(end.outcome, label).toBe(outcome);
      expect(names(log).includes('waveCaught'), label).toBe(outcome === 'caught');
      expect(names(log).filter((n) => n === 'waveGone'), label).toHaveLength(1);
    }
  });

  it('from the end of the countdown to the front over the hero: 3–4 s on mountain 1', () => {
    const { t, log } = threat();
    runWave(t, { x: 0, y: 0, z: 500, vx: 0, vz: 0 });
    const start = log.find((r) => r.name === 'waveStart')!.tick;
    const caught = log.find((r) => r.name === 'waveCaught')!.tick;
    const sec = (caught - start) / 60;
    expect(sec).toBeGreaterThanOrEqual(3);
    expect(sec).toBeLessThanOrEqual(4);
  });

  it('5 units from the entrance running to it → waveSurvived, 7 units → waveCaught (niche.graceDist, niche.graceMoving)', () => {
    expect(bal.niche).toEqual({ graceDist: 3, graceMoving: 6 });
    for (const [dist, want] of [
      [5, 'waveSurvived'],
      [7, 'waveCaught'],
    ] as const) {
      const { t, log } = threat();
      // Running straight at the entrance at 12 u/s; held at `dist` until the front comes (a treadmill-like probe).
      const hero: ThreatHero = { x: ex - sign * dist, y: level.floorYAt(cave.z), z: cave.z, vx: sign * 12, vz: 0 };
      runWave(t, hero);
      expect(names(log), `${dist} units`).toContain(want);
      if (want === 'waveSurvived') expect((log.find((r) => r.name === want)!.payload as { grace: boolean }).grace).toBe(true);
    }
    // Standing still 5 units out is not «running into the cave».
    const { t, log } = threat();
    runWave(t, { x: ex - sign * 5, y: 0, z: cave.z, vx: 0, vz: 0 });
    expect(names(log)).toContain('waveCaught');
  });

  it('the first 3 normal waves of a new player get warnSec + 3 s (threat.newbieWaves), the 4th does not', () => {
    const { t, log } = threat({ normalWavesDone: 0 });
    const hero = { ...inCave };
    let tick = 0;
    for (let w = 0; w < 4; w++) tick = runWave(t, hero, tick);
    const warns = log.filter((r) => r.name === 'waveWarn').map((r) => (r.payload as ThreatEvents['waveWarn']).warnSec);
    const base = world1.threat.warnSec;
    const bonus = bal.threat.newbieWaves.warnBonusSec;
    expect(bal.threat.newbieWaves.count).toBe(3);
    expect(warns).toEqual([base + bonus, base + bonus, base + bonus, base]);
    expect(t.state.normalWavesDone).toBe(4);
  });

  it('phases stand while any pause reason is set (the loop does not step the simulation)', () => {
    const { t } = threat();
    const hero: ThreatHero = { x: 0, y: 0, z: 500, vx: 0, vz: 0 };
    let tick = 0;
    const loop = createLoop({ update: (dt) => t.step(dt, hero, allOpen, ++tick), render: () => {} });
    const pause = new PauseManager();
    pause.onChange((p) => {
      loop.paused = p;
      if (!p) loop.resetAccumulator();
    });
    let now = 0;
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) loop.tick((now += 1000 / 60));
    };
    frames(1);
    for (const reason of PAUSE_REASONS) {
      for (const phase of ['idle', 'warn', 'run'] as const) {
        // Bring the wave to the phase, then pause.
        if (phase === 'warn' && t.state.phase === 'idle') t.trigger();
        while (t.state.phase !== phase) frames(1);
        const before = { ...t.state };
        pause.add(reason);
        frames(180);
        expect(t.state.phase, `${reason} ${phase}`).toBe(before.phase);
        expect(t.state.timer, `${reason} ${phase}`).toBe(before.timer);
        expect(t.state.frontZ, `${reason} ${phase}`).toBe(before.frontZ);
        pause.remove(reason);
        frames(3);
        const moved = t.state.timer !== before.timer || t.state.frontZ !== before.frontZ || t.state.phase !== before.phase;
        expect(moved, `${reason} ${phase} resumes`).toBe(true);
      }
      while (t.state.phase !== 'idle') frames(10);
    }
  });

  it('the scripted first wave: at cave 4 on mountain 1, warn ftue.warnSec, never catches — in a cave or outside', () => {
    const cave4 = level.niches[bal.ftue.scriptedWaveWall - 1]!;
    for (const inside of [true, false]) {
      const { t, log } = threat({ scriptedPending: true, normalWavesDone: 0 });
      const hero: ThreatHero = { x: 0, y: 0, z: 200, vx: 0, vz: 0 };
      let tick = 0;
      for (; tick < 60 * 60; tick++) t.step(DT, hero, allOpen, tick); // no wave far below the trigger, firstIntervalSec ignored
      expect(log).toHaveLength(0);
      hero.z = cave4.z - bal.ftue.triggerDist + 1;
      t.step(DT, hero, allOpen, ++tick);
      expect(t.state.phase).toBe('warn');
      expect(t.state.scripted).toBe(true);
      expect(t.state.warnSec).toBe(bal.ftue.warnSec);
      expect(t.state.spawnZ).toBe(cave4.z + bal.ftue.spawnAhead);
      Object.assign(hero, inside ? { x: (cave4.box.min[0] + cave4.box.max[0]) / 2, y: cave4.y, z: cave4.z } : { x: 0, z: cave4.z });
      while (t.state.phase !== 'idle') t.step(DT, hero, allOpen, ++tick);
      expect(names(log)).not.toContain('waveCaught');
      expect(names(log)).toContain(inside ? 'waveSurvived' : 'waveDusted');
      expect((log.find((r) => r.name === 'waveEnd')!.payload as ThreatEvents['waveEnd']).scripted).toBe(true);
      expect(t.state.scriptedPending).toBe(false);
      // The scripted wave does not count as a normal one; the next is through intervalSec (50 s).
      expect(t.state.normalWavesDone).toBe(0);
      expect(t.state.timer + tun.avalanche.fadeSec).toBeCloseTo(world1.threat.intervalSec, 5);
    }
  });

  it('the cave to run to: nearest by path, never behind a closed wall', () => {
    const closed = level.gates.map(() => false);
    // Just below wall 1 (z 130): cave 1 at z 103 is the one; cave 2 above the closed wall is not offered.
    expect(nearestShelter(level, closed, 0, 128)).toBe(0);
    const open1 = closed.map((_, i) => i === 0);
    expect(nearestShelter(level, open1, 0, 160)).toBe(1);
    expect(nearestShelter(level, closed, 0, 20)).toBe(-1); // camp
  });
});

describe('avalanche in the simulation (M2-06)', () => {
  it('«Phew, made it!» pays coins.waveSurvived × gift of the zone; after a real avalanche every gift is back', () => {
    const sim = createSim(level, tun, {
      balance: bal,
      speedCurve: bal.speedCurve,
      threat: { threat: { ...world1.threat }, balance: bal, avalanche: tun.avalanche, scriptedPending: false, normalWavesDone: 99 },
    });
    // Take a gift of zone 1, then sit in cave 1 (zone 1, gift 5) through a wave.
    const gift = sim.gifts[0]!;
    sim.teleport(gift.x, gift.y + 0.05, gift.z);
    for (let i = 0; i < 5; i++) sim.step(NO_INPUT, DT);
    expect(gift.taken).toBe(true);
    const coinsAfterGift = sim.coins;
    const cave = level.niches[0]!;
    sim.teleport((cave.box.min[0] + cave.box.max[0]) / 2 + 1, cave.y + 0.05, cave.z + 3);
    const seen: string[] = [];
    for (const n of ['waveWarn', 'waveStart', 'waveSurvived', 'waveCaught', 'waveGone', 'giftsRespawn'] as const) sim.events.on(n, () => seen.push(n));
    let survived: { coins: number } | null = null;
    sim.events.on('waveSurvived', (p) => (survived = p));
    sim.threat!.trigger();
    sim.step(NO_INPUT, DT);
    for (let i = 0; i < 60 * 40 && sim.threat!.state.phase !== 'idle'; i++) sim.step(NO_INPUT, DT);
    // The sim respawns the gifts from its own waveGone listener, registered first.
    expect(seen).toEqual(['waveWarn', 'waveStart', 'waveSurvived', 'giftsRespawn', 'waveGone']);
    expect(survived!.coins).toBe(bal.coins.waveSurvived * world1.zones[0]!.gift);
    expect(sim.coins).toBe(coinsAfterGift + survived!.coins);
    expect(sim.gifts.every((g) => !g.taken)).toBe(true);
  });
});

// M3-12: first avalanche of mountains 2–5 after 10–12 s (Q-022; docs/01-gdd.md 4.1), mountain 1 after 30 s.
describe('first avalanche per mountain (M3-12)', () => {
  const RUN = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
  const curve = { ...bal.speedCurve, base: tun.controller.baseSpeed, max: tun.controller.maxSpeed };
  /** A mountain as main.ts loads it (after a load or through the portal); ticks until the warning starts. */
  const ticksToWarn = (index: number): { ticks: number; expected: number } => {
    const w = worlds.worlds[index - 1]!;
    const sim = createSim(buildLevel(w), tun, {
      balance: bal,
      speedCurve: curve,
      stat: 0,
      threat: { threat: { ...w.threat }, balance: bal, avalanche: tun.avalanche, scriptedPending: false, normalWavesDone: 99 },
    });
    let ticks = 0;
    while (sim.threat!.state.phase === 'idle' && ticks < 60 * 120) {
      sim.step(NO_INPUT, DT);
      ticks++;
    }
    return { ticks, expected: w.threat.firstIntervalSec / DT };
  };

  it('worlds.json: mountain 1 — 30 s, mountains 2–5 — 12 / 11.5 / 11 / 10.5 s, each its own', () => {
    expect(worlds.worlds.map((w) => w.threat.firstIntervalSec)).toEqual([30, 12, 11.5, 11, 10.5]);
  });

  it('after the load on mountain 1 the warning starts after 30 s; after the portal on mountains 2–5 — after their firstIntervalSec (±1 tick)', () => {
    const one = ticksToWarn(1);
    expect(one.expected).toBeCloseTo(30 * 60, 6);
    expect(Math.abs(one.ticks - one.expected)).toBeLessThanOrEqual(1);
    // The portal of mountain 1 leads to mountain 2; the new mountain's sim starts its clock at the camp.
    const level1 = buildLevel(worlds.worlds[0]!);
    const portal = level1.points.find((p) => p.type === 'portal')!;
    const s1 = createSim(level1, tun, { balance: bal, speedCurve: curve, stat: 200_000 });
    let next: number | null = null;
    s1.events.on('portal', (e) => void (next = e.next));
    s1.teleport(0, level1.floorYAt(portal.z - 15) + 0.05, portal.z - 15);
    for (let i = 0; i < 240 && next === null; i++) s1.step(RUN, DT);
    expect(next).toBe(2);
    for (let index = 2; index <= 5; index++) {
      const r = ticksToWarn(index);
      expect(Math.abs(r.ticks - r.expected), `mountain ${index}`).toBeLessThanOrEqual(1);
    }
  });
});

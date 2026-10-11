import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeroInput } from '../../src/sim/controller.ts';
import { createSim, RECORD_RETURN } from '../../src/sim/world.ts';
import { createThreat, nearestShelter, type ThreatEvents } from '../../src/sim/threat.ts';
import { createCaught } from '../../src/sim/caught.ts';
import { distToEntrance } from '../../src/sim/shelter.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { parseSave } from '../../src/meta/save.ts';
import { eggSpotIn, giftEggSpot } from '../../src/sim/gift-egg.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// PS-06: the avalanche on the open slope (docs/01-gdd.md 17.5, 17.7).
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const balance = mergePatch(read('balance.json') as BalanceJson, read('pace/open/balance.json'));
const tuning = mergePatch(read('tuning.json') as TuningJson, read('pace/open/tuning.json'));
const worlds = (read('pace/open/worlds.json') as WorldsJson).worlds;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w1 = worlds[0]!;
const level = buildLevel(w1);

/** A normal wave (the scripted one is over) run to its end with the hero standing at (x, z). */
function waveAt(x: number, z: number): { spawnZ: number; events: string[] } {
  const events: string[] = [];
  const threat = createThreat(level, { threat: { ...w1.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 10 }, (name) =>
    events.push(name),
  );
  const hero = { x, y: level.floorAt(x, z), z, vx: 0, vz: 0 };
  const open = level.gates.map(() => true);
  threat.trigger();
  let spawnZ = 0;
  for (let i = 0; i < 60 * 120 && !events.includes('waveEnd'); i++) {
    threat.step(DT, hero, open, i);
    if (threat.state.phase === 'warn') spawnZ = threat.state.spawnZ;
  }
  return { spawnZ, events };
}

describe('avalanche on the open slope (PS-06)', () => {
  it('the front never starts above spawnMaxZ, and the hero above the line is never caught', () => {
    const line = w1.threat.spawnMaxZ!;
    for (const z of [line + 5, line + 100, w1.bosses![0]!.zone[1] - 5]) {
      const r = waveAt(0, z);
      expect(r.spawnZ).toBeLessThanOrEqual(line);
      expect(r.events).not.toContain('waveCaught');
    }
    // Below the line, out in the open, the same wave catches.
    const below = waveAt(0, line - 100);
    expect(below.spawnZ).toBeLessThanOrEqual(line);
    expect(below.events).toContain('waveCaught');
  });

  it('the nearest shelter by run time on a fork is on the hero’s lane, whatever his speed', () => {
    const fork = level.boxes.find((b) => b.kind === 'cliff')!;
    const z = (fork.min[2] + fork.max[2]) / 2;
    for (const x of [-16, 16]) {
      const i = nearestShelter(level, level.gates.map(() => true), x, z);
      const n = level.niches[i]!;
      // Not through the cliff: a grotto of this side of it.
      expect(n.side, `x ${x}`).toBe(x < 0 ? 'left' : 'right');
      const d = distToEntrance(level, n, x, z).dist;
      // The run time is the way over the speed: the choice stays, the seconds shrink as the hero gets faster.
      for (const v of [16, 32, 64]) expect(d / v).toBeLessThan((w1.threat.warnSec * 0.8 * 16) / v);
    }
  });

  it('snowed in on lane B of a fork the ball rolls into a grotto of lane B, never through the cliff', () => {
    const fork = level.boxes.find((b) => b.kind === 'cliff')!;
    const bold = level.niches.filter((n) => n.lane !== undefined && n.z < fork.max[2]);
    expect(bold.length).toBeGreaterThan(0);
    for (const x of [-16, 16]) {
      const c = createCaught(level, { x, y: 0, z: fork.max[2] - 2 }, balance.caught, tuning.avalanche);
      const n = level.niches[c.niche]!;
      expect(n.side, `x ${x}`).toBe(x < 0 ? 'left' : 'right');
      expect(n.z).toBeLessThan(fork.max[2] - 2);
    }
  });

  it('the record flag only goes up, says «New height!» when passed again from below, and survives a reload', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, record: null });
    const ups: number[] = [];
    s.events.on('recordUp', ({ z }) => ups.push(z));
    s.teleport(0, 0, 50);
    for (let i = 0; i < 120; i++) s.step(RUN, DT);
    const top = s.record!.z;
    expect(top).toBeGreaterThan(60);
    // Sent below (as the ball does): the flag stays where it was.
    s.teleport(0, 0, top - RECORD_RETURN - 10);
    for (let i = 0; i < 30; i++) s.step(STAND, DT);
    expect(s.record!.z).toBe(top);
    expect(ups).toHaveLength(0);
    for (let i = 0; i < 240 && s.hero.pos.z <= top + 1; i++) s.step(RUN, DT);
    expect(ups).toHaveLength(1);
    expect(s.record!.z).toBeGreaterThan(top);
    // The save keeps it (parseSave), a new sim of the same mountain starts with it.
    const saved = parseSave({ v: 2, rev: 1, savedAt: 1, record: { world: 1, ...s.record! } })!;
    expect(saved.record!.z).toBe(s.record!.z);
    const again = createSim(level, tuning, { balance, speedCurve: curve, record: { x: saved.record!.x, y: saved.record!.y, z: saved.record!.z } });
    expect(again.record!.z).toBe(s.record!.z);
    // No record flag outside the open slope: the option absent, the field stays null.
    const plain = createSim(level, tuning, { balance, speedCurve: curve });
    plain.teleport(0, 0, 60);
    for (let i = 0; i < 30; i++) plain.step(RUN, DT);
    expect(plain.record).toBeNull();
  });

  it('the scripted wave comes at the first grotto of section 2 (ftue.scriptedWaveWall), not at the second niche of the mountain', () => {
    const events: Array<{ name: string; payload: unknown }> = [];
    const threat = createThreat(level, { threat: { ...w1.threat }, balance, avalanche: tuning.avalanche, scriptedPending: true, normalWavesDone: 0 }, (name, payload) =>
      events.push({ name, payload }),
    );
    const first2 = level.niches.find((n) => n.stretch === 2)!;
    const open = level.gates.map(() => true);
    // Up section 1: nothing; at the entry of section 2 — the warning, the shelter is that grotto.
    for (const z of [80, 150, 200]) threat.step(DT, { x: 0, y: 0, z, vx: 0, vz: 0 }, open, 1);
    expect(events.some((e) => e.name === 'waveWarn')).toBe(false);
    threat.step(DT, { x: 0, y: 0, z: first2.z - balance.ftue.triggerDist + 1, vx: 0, vz: 0 }, open, 2);
    const warn = events.find((e) => e.name === 'waveWarn')!.payload as ThreatEvents['waveWarn'];
    expect(warn.scripted).toBe(true);
    expect(level.niches[warn.shelter]!.stretch).toBe(2);
  });

  it('the free egg of that wave stands in its grotto with no belt, by the back wall; in the other lane’s grotto too (PS-10)', () => {
    const spot = giftEggSpot(level, balance.ftue.scriptedWaveWall)!;
    const n = level.niches[spot.niche]!;
    expect(n.stretch).toBe(2);
    expect(n.treadmill).toBe(0);
    for (const k of [spot.niche, level.niches.findIndex((m, i) => i !== spot.niche && m.stretch === 2 && m.z === n.z)]) {
      const at = eggSpotIn(level, k)!;
      const g = level.niches[k]!;
      expect(at.x).toBeGreaterThan(g.box.min[0]);
      expect(at.x).toBeLessThan(g.box.max[0]);
      expect(at.z).toBeGreaterThan(g.box.min[2]);
      expect(at.z).toBeLessThan(g.box.max[2]);
      expect(at.y).toBe(g.y);
    }
  });
});

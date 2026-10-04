import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_INPUT, type HeroInput } from '../../src/sim/controller.ts';
import { createSim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { fairnessReport, validateFairness, validatePack, PACK_FILES, type PackFiles } from '../../src/level/validate.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const worlds = read('worlds.json') as WorldsJson;
const tuning = read('tuning.json') as TuningJson;
const balance = read('balance.json') as BalanceJson;
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const speedAt = (stat: number): number => moveSpeed(stat, curve);
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };

// M2-03: mountain 1 in full (docs/01-gdd.md 5.2, docs/01a-content.md 2–4).
describe('mountain 1 (M2-03)', () => {
  const slope = worlds.worlds[0]!;
  const segs = (type: string) => slope.segments.filter((s) => s.type === type);

  it('camp, 12 walls, 6 rarity zones, 12 caves with treadmills, summit with chest and portal; new segment types present', () => {
    expect(segs('gate')).toHaveLength(12);
    expect(slope.zones.map((z) => z.rarity)).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
    expect(segs('zoneArch').map((s) => s.z)).toEqual(slope.zones.map((z) => z.zStart));
    expect(segs('niche')).toHaveLength(12);
    expect(segs('gift')).toHaveLength(36);
    // Egg stands: in the camp and by the flag behind wall 6 (docs/01-gdd.md 5.2).
    const stands = segs('eggStand');
    expect(stands).toHaveLength(2);
    expect(stands[0]!.z).toBeLessThan(40);
    const wall6 = segs('gate').find((g) => g['wall'] === 6)!.z;
    expect(stands[1]!.z).toBeGreaterThan(wall6);
    expect(stands[1]!.z).toBeLessThan(wall6 + 20);
    expect(segs('summit')).toHaveLength(1);
    expect(segs('chest')).toHaveLength(1);
    expect(segs('portal')[0]!['next']).toBe(2);
  });

  it('every wall 1–11 has a cave with a treadmill in front of it, after the previous wall', () => {
    const gates = segs('gate').sort((a, b) => a.z - b.z);
    const niches = segs('niche');
    for (let i = 0; i < 11; i++) {
      const from = i === 0 ? 40 : gates[i - 1]!.z;
      const cave = niches.filter((n) => n.z > from && n.z < gates[i]!.z);
      expect(cave, `wall ${i + 1}`).toHaveLength(1);
      expect(cave[0]!['treadmill'] as number).toBeGreaterThan(1);
    }
  });

  it('cave fairness: from any point a cave or the camp is within warnSec × 0.8 at the minimum stretch speed', () => {
    const rows = fairnessReport(worlds, speedAt);
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.worstSec, r.world).toBeLessThanOrEqual(r.limitSec);
    // docs/01-gdd.md 4.3: worst case on mountain 1 is a few seconds against 6.4 s.
    expect(rows[0]!.limitSec).toBeCloseTo(6.4, 5);
    expect(rows[0]!.worstSec).toBeLessThan(3);
    expect(validateFairness(worlds, speedAt)).toEqual([]);
  });

  it('a cave too far from its wall fails validate:content with the mountain and the seconds named', () => {
    const files = {} as Partial<PackFiles>;
    for (const f of PACK_FILES) files[f] = JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
    const broken = files as PackFiles;
    const w = (broken['worlds.json'] as WorldsJson).worlds[0]!;
    w.threat.warnSec = 2;
    const errors = validatePack(broken).errors;
    expect(errors.some((e) => e.startsWith('worlds.json: worlds[0] (slope): cave fairness'))).toBe(true);
  });

  it('walking through the summit portal emits portal → mountain 2 once', () => {
    const level = buildLevel(slope);
    const portal = level.points.find((p) => p.type === 'portal')!;
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 200_000 });
    const got: Array<{ from: number; next: number | null }> = [];
    s.events.on('portal', (e) => got.push({ from: e.from, next: e.next }));
    s.teleport(0, level.floorYAt(portal.z - 15) + 0.05, portal.z - 15);
    for (let i = 0; i < 30; i++) s.step(NO_INPUT, DT);
    expect(got).toEqual([]);
    for (let i = 0; i < 120 && !s.portalEntered; i++) s.step(RUN, DT);
    expect(got).toEqual([{ from: 1, next: 2 }]);
    for (let i = 0; i < 30; i++) s.step(RUN, DT);
    expect(got).toHaveLength(1);
  });

  it('passing beside the arch (outside its opening) is not entering the portal', () => {
    const level = buildLevel(slope);
    const portal = level.points.find((p) => p.type === 'portal')!;
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 200_000 });
    s.teleport(9, level.floorYAt(portal.z - 10) + 0.05, portal.z - 10);
    for (let i = 0; i < 60; i++) s.step(RUN, DT);
    expect(s.hero.pos.z).toBeGreaterThan(portal.z);
    expect(s.portalEntered).toBe(false);
  });
});

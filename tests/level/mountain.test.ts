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

// M3-05: mountains 2–5 by data (docs/01-gdd.md 5.4, GDD-14; docs/01a-content.md 2–4).
describe('mountains 1–5 (M3-05)', () => {
  const doc = readFileSync(resolve(root, 'docs/01a-content.md'), 'utf8');
  const SUFFIX: Record<string, number> = { '': 1, K: 1e3, M: 1e6, B: 1e9 };
  const parseNum = (s: string): number => {
    const m = /^×?([\d.]+)([KMB]?)$/.exec(s.trim().replace(/\s/g, ''));
    if (!m) throw new Error(`not a number: ${s}`);
    return Number(m[1]) * SUFFIX[m[2]!]!;
  };
  // docs/01a-content.md section 3: «| p | mountain | wall | requires | ×treadmill | zone | gift | gate coins | bot s |».
  const section3 = doc.slice(doc.indexOf('## 3.'), doc.indexOf('## 4.'));
  const rows = section3
    .split('\n')
    .filter((l) => /^\| \d+ \| \d \|/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .map((c) => ({ mountain: Number(c[1]), wall: Number(c[2]), requires: parseNum(c[3]!), treadmill: parseNum(c[4]!), gift: parseNum(c[6]!), gateCoins: parseNum(c[7]!) }));
  const of = (w: (typeof worlds.worlds)[number], type: string) => w.segments.filter((s) => s.type === type).sort((a, b) => a.z - b.z);

  it('release count of 01-gdd 5.4: 5 mountains, 60 walls, 60 caves, 30 zones, 180 gift places, 5 camps with a treadmill, 5 summits with a chest and a portal', () => {
    const all = (type: string): number => worlds.worlds.reduce((n, w) => n + of(w, type).length, 0);
    expect(worlds.worlds).toHaveLength(5);
    expect(all('gate')).toBe(60);
    expect(all('niche')).toBe(60);
    expect(worlds.worlds.reduce((n, w) => n + w.zones.length, 0)).toBe(30);
    expect(all('gift')).toBe(180);
    expect(all('chest')).toBe(5);
    expect(all('portal')).toBe(5);
    for (const w of worlds.worlds) expect(of(w, 'treadmill').filter((s) => s.z < 40), w.id).toHaveLength(1);
    expect(worlds.worlds.map((w) => of(w, 'portal')[0]!['next'] ?? null)).toEqual([2, 3, 4, 5, null]);
  });

  it('every wall, cave treadmill, zone gift and gate coins match the table of 01a section 3 (60 rows); lengths and threat of section 2', () => {
    expect(rows).toHaveLength(60);
    for (const r of rows) {
      const w = worlds.worlds[r.mountain - 1]!;
      const gate = of(w, 'gate')[r.wall - 1]!;
      const cave = of(w, 'niche')[r.wall - 1]!;
      const at = `mountain ${r.mountain}, wall ${r.wall}`;
      expect(gate['requires'], at).toBe(r.requires);
      expect(cave['treadmill'], at).toBe(r.treadmill);
      expect(cave['stretch'], at).toBe(r.wall);
      expect(w.zones.find((z) => z.k === gate['zone'])!.gift, at).toBe(r.gift);
      expect((gate['reward'] as { coins: number }).coins, at).toBe(r.gateCoins);
    }
    expect(worlds.worlds.map((w) => w.length)).toEqual([1180, 1300, 1420, 1540, 1660]);
    expect(worlds.worlds.map((w) => w.threat.intervalSec)).toEqual([50, 48, 45, 42, 40]);
    expect(worlds.worlds.map((w) => w.threat.warnSec)).toEqual([8, 8, 7, 7, 6]);
    expect(worlds.worlds.map((w) => w.threat.speed)).toEqual([45, 48, 52, 56, 60]);
    expect(worlds.worlds.map((w) => w.egg)).toEqual(['snow', 'frost', 'ice', 'blizzard', 'aurora']);
    // Camp treadmill = cave 1; summit = ×1.5 of cave 12 up the series (01a section 2).
    expect(worlds.worlds.map((w) => of(w, 'treadmill')[0]!['mult'])).toEqual([5, 15, 50, 150, 800]);
    expect(worlds.worlds.map((w) => of(w, 'treadmill')[1]!['mult'])).toEqual([25, 60, 250, 1000, 4000]);
  });

  it('GDD-14 on all 5 mountains: a cave before every wall 1–11, validate:content green (reachability, gaps, cave fairness, golden gift fairness)', () => {
    for (const w of worlds.worlds) {
      const gates = of(w, 'gate');
      const niches = of(w, 'niche');
      for (let i = 0; i < 11; i++) {
        const from = i === 0 ? 40 : gates[i - 1]!.z;
        expect(niches.filter((n) => n.z > from && n.z < gates[i]!.z), `${w.id} wall ${i + 1}`).toHaveLength(1);
      }
    }
    const files = {} as Partial<PackFiles>;
    for (const f of PACK_FILES) files[f] = read(f);
    expect(validatePack(files as PackFiles).errors).toEqual([]);
  });

  it('a mountain short of a gift place or with a wall number off the spec fails validate:content', () => {
    const files = {} as Partial<PackFiles>;
    for (const f of PACK_FILES) files[f] = JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
    const w3 = (files['worlds.json'] as WorldsJson).worlds[2]!;
    w3.segments.splice(w3.segments.findIndex((s) => s.type === 'gift'), 1);
    (w3.segments.find((s) => s.type === 'gate' && s['wall'] === 5) as Record<string, unknown>)['requires'] = 6_500_000;
    const errors = validatePack(files as PackFiles).errors;
    expect(errors).toContain('worlds.json: worlds[2] (canyon): zone 1 — 5 gift places, expected 6 (balance.json gifts.perZone 6)');
    expect(errors).toContain('worlds.json: worlds[2] (canyon): wall 5 — requires 6500000, worlds-spec.json has 6000000');
  });
});

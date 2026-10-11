import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { choosePace, CLASSIC_PACE, mergePatch } from '../../src/content/pace.ts';
import { generateWorlds, stringifyWorlds } from '../../src/level/generate.ts';
import { forkRange, OPEN_SLOPE } from '../../src/level/open-slope.ts';
import { PACK_FILES, validatePack, type PackFiles } from '../../src/level/validate.ts';
import { openFairnessReport } from '../../src/level/validate-open.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, OpenSpecJson, Segment, TuningJson, WorldsJson } from '../../src/content/types.ts';

// PS-02, PS-03: the pace open (docs/01-gdd.md 17.1–17.5; docs/01a-content.md 16.1–16.7).
const root = resolve(__dirname, '../..');
const json = <T>(...p: string[]): T => JSON.parse(readFileSync(resolve(root, 'content', ...p), 'utf8')) as T;
const PACES = ['fast', 'open'];
function openPack(): PackFiles {
  const files: Partial<PackFiles> = {};
  for (const f of PACK_FILES) files[f] = json('avalanche', f);
  files['balance.json'] = mergePatch(files['balance.json'], json('avalanche', 'pace', 'open', 'balance.json'));
  files['tuning.json'] = mergePatch(files['tuning.json'], json('avalanche', 'pace', 'open', 'tuning.json'));
  files['worlds.json'] = json('avalanche', 'pace', 'open', 'worlds.json');
  files['worlds-spec.json'] = json('avalanche', 'pace', 'open', 'worlds-spec.json');
  return files as PackFiles;
}
const files = openPack();
const worlds = (files['worlds.json'] as WorldsJson).worlds;
const spec = files['worlds-spec.json'] as OpenSpecJson;
const num = (s: Segment, k: string): number => s[k] as number;
const byType = (i: number, type: string): Segment[] => worlds[i]!.segments.filter((s) => s.type === type).sort((a, b) => a.z - b.z);

describe('pace open by default (PS-02)', () => {
  it('the tuning.json patch of a pace merges deep like balance.json: the camera of the open slope, the rest shared', () => {
    const shared = json<TuningJson>('avalanche', 'tuning.json');
    const open = files['tuning.json'] as TuningJson;
    expect(open.camera).toEqual({ ...shared.camera, distance: 13, height: 4.5, pitchDeg: 24, fov: 76, zoomMax: 26, mobileFovAdd: 4 });
    expect(open.controller).toEqual(shared.controller);
    expect(open.ridgeShot).toEqual({ rise: 6, back: 4, sec: 1.5 });
    expect(open.far).toEqual({ pc: 600, mobile: 450 });
    expect(shared.camera.distance).toBe(10);
  });

  it('choosePace: open by default, fast and classic by ?pace=', () => {
    const def = json<{ pace: string }>('avalanche', 'game.json').pace;
    expect(def).toBe('open');
    expect(choosePace(def, PACES, null)).toBe('open');
    expect(choosePace(def, PACES, 'fast')).toBe('fast');
    expect(choosePace(def, PACES, 'classic')).toBe(CLASSIC_PACE);
    expect(choosePace(def, PACES, 'turbo')).toBe('open');
  });

  it('the remote flag pace (docs/06 8.1 row 6) passes the validator by its values; a bad default or no values fails', () => {
    const game = files['game.json'] as { flags: Record<string, { path: string; values?: string[] }> };
    expect(game.flags['pace']).toEqual({ path: 'game.pace', values: ['open', 'fast'] });
    expect(validatePack(files, { paces: PACES }).errors).toEqual([]);
    const bad = JSON.parse(JSON.stringify(files)) as PackFiles;
    (bad['game.json'] as { flags: Record<string, { values?: string[] }> }).flags['pace']!.values = ['fast'];
    expect(validatePack(bad, { paces: PACES }).errors.some((e) => e.includes('flags.pace') && e.includes('not in values'))).toBe(true);
    delete (bad['game.json'] as { flags: Record<string, { values?: string[] }> }).flags['pace']!.values;
    expect(validatePack(bad, { paces: PACES }).errors.some((e) => e.includes('flags.pace') && e.includes('needs values'))).toBe(true);
  });

  it('the open patch of balance.json: ridge coins ×5, the scripted wave at section 2, no «open the wall» ad (01a 16.6)', () => {
    const b = files['balance.json'] as BalanceJson;
    expect(b.coins.gatePass).toBe(5);
    expect(b.ftue.scriptedWaveWall).toBe(2);
    expect(b.ads.skipGate.enabled).toBe(false);
    expect(b.ads.continueCooldownSec).toBe(120);
    expect(b.rebirth.unlock).toBe('summitWorld10');
  });
});

describe('generator openSlope and its validator (PS-03)', () => {
  it('gen:worlds is deterministic and matches the committed pace/open/worlds.json; validate:content passes it', () => {
    const input = { spec, balance: files['balance.json'] as BalanceJson };
    const text = stringifyWorlds(generateWorlds(input));
    expect(stringifyWorlds(generateWorlds(input))).toBe(text);
    expect(readFileSync(resolve(root, 'content/avalanche/pace/open/worlds.json'), 'utf8')).toBe(text);
    expect(validatePack(files, { paces: PACES }).errors).toEqual([]);
  });

  it('10 mountains by 01a 16.1: 3 sections on mountain 1, 4 on the others; the lengths; ridges and the giant', () => {
    expect(worlds).toHaveLength(10);
    expect(worlds.map((w) => w.length)).toEqual([1030, 1470, 1620, 1770, 1920, 2070, 2220, 2370, 2520, 2670]);
    worlds.forEach((w, i) => {
      const sections = i === 0 ? 3 : 4;
      expect(w.width).toBe(56);
      expect(w.zones).toHaveLength(sections + 1);
      const gates = byType(i, 'gate');
      expect(gates.map((g) => g['kind'])).toEqual([...Array<string>(sections).fill('ridge'), 'boss']);
      expect(w.wallCount).toBe(sections + 1);
      expect(w.bosses).toHaveLength(1);
      expect(w.threat.spawnMaxZ).toBe(w.bosses![0]!.zone[0]);
    });
    expect(num(byType(0, 'gate')[0]!, 'requires')).toBe(50);
    expect(worlds.reduce((a, w) => a + w.wallCount, 0)).toBe(49);
  });

  it('the layout of a section by the fractions of 01a 16.5', () => {
    const O = OPEN_SLOPE;
    worlds.forEach((w, wi) => {
      const gates = byType(wi, 'gate');
      w.zones.slice(0, -1).forEach((zone, i) => {
        const L = zone.zEnd - zone.zStart;
        const at = (z: number): number => (z - zone.zStart) / L;
        const ridge = gates[i]!;
        expect(ridge.z).toBe(zone.zEnd);
        // The grotto with the belt right under the ridge (95%), the multiplier of the section.
        const niches = w.segments.filter((s) => s.type === 'niche' && s.z > zone.zStart && s.z < zone.zEnd);
        const under = niches.sort((a, b) => a.z - b.z).pop()!;
        expect(under['kind']).toBe('ridgeGrotto');
        expect(at(under.z)).toBeGreaterThan(0.9);
        expect(num(under, 'treadmill')).toBe(zone.stepMult);
        // The approach rise inside 75–95%.
        const rise = w.segments.find((s) => s.type === 'ramp' && s['x0'] === undefined && s.z > zone.zStart && s.z < zone.zEnd)!;
        expect(at(rise.z)).toBeGreaterThanOrEqual(0.75);
        expect(at(rise.z + num(rise, 'length'))).toBeLessThanOrEqual(0.95);
        // The flag past the ridge below in the first 5% (from section 2).
        if (i > 0) expect(at(w.segments.find((s) => s.type === 'checkpoint' && num(s, 'wall') === i)!.z)).toBeLessThanOrEqual(0.06);
        // A fork inside 5–40%, 60–120 units; on mountain 1 only section 2.
        const fork = w.segments.find((s) => s.type === 'fork' && num(s, 'section') === i + 1);
        if (wi === 0) expect(!!fork).toBe(i === 1);
        if (fork) {
          expect([fork.z, fork.z + num(fork, 'length')]).toEqual(forkRange(zone.zStart, L));
          expect(at(fork.z)).toBeGreaterThanOrEqual(0.05);
          expect(at(fork.z + num(fork, 'length'))).toBeLessThanOrEqual(0.4 + 1e-9);
          expect(num(fork, 'length')).toBeGreaterThanOrEqual(60);
          expect(num(fork, 'length')).toBeLessThanOrEqual(120);
        }
        // 12 gift places on the path; on a fork one on each lane, the bold one ×2.
        // (Detours — the crevasse bottom, the ledge — are off the path, PS-08.)
        const gifts = w.segments.filter((s) => s.type === 'gift' && s['path'] === true && num(s, 'zone') === i + 1);
        expect(new Set(gifts.map((g) => g.z)).size).toBe(O.pathGifts);
        for (const g of gifts) expect(num(g, 'coins')).toBe(g['lane'] === 'bold' ? 2 * zone.gift : zone.gift);
      });
      // The finish straight: the grotto with the belt before the zone, 4 gifts, the boss line at the summit.
      const finish = w.zones[w.zones.length - 1]!;
      const line = w.segments.find((s) => s.type === 'niche' && s['kind'] === 'bossLine')!;
      expect(line.z + num(line, 'length') / 2).toBeLessThanOrEqual(w.bosses![0]!.zone[0]);
      expect(num(line, 'treadmill')).toBe(finish.stepMult);
      expect(gates[gates.length - 1]!.z).toBe(finish.zEnd);
      expect(w.bosses![0]!.zone[1]).toBe(finish.zEnd);
    });
  });

  it('the ridge: three passages climb the step, the ice is out of a jump’s reach; the giant’s line is never a collider', () => {
    const tuning = files['tuning.json'] as TuningJson;
    const jump = (tuning.controller.jumpSpeed * tuning.controller.jumpSpeed) / (2 * tuning.controller.gravity);
    const level = buildLevel(worlds[0]!);
    const ridge = level.gates[0]!;
    expect(ridge.kind).toBe('ridge');
    expect(ridge.passes).toEqual([...OPEN_SLOPE.passes]);
    expect(ridge.box.max[1] - ridge.y).toBeGreaterThan(jump + 1);
    for (const x of ridge.passes!) expect(level.floorAt(x, ridge.z + OPEN_SLOPE.passLength)).toBeCloseTo(ridge.y + OPEN_SLOPE.ridgeRise, 6);
    // Between the passages the carniz block goes down below the lower floor: nothing passes under it.
    const block = level.boxes.find((b) => b.kind === 'floor' && b.min[2] === ridge.z && b.max[0] < 0)!;
    expect(block.min[1]).toBeLessThan(ridge.y);
    expect(level.gates[level.gates.length - 1]!.kind).toBe('boss');
  });

  it('fairness on every lane: the worst run to a grotto ≤ warnSec × 0.8 with a margin of 2× (01a 16.3)', () => {
    const b = files['balance.json'] as BalanceJson;
    const t = files['tuning.json'] as TuningJson;
    const curve = { ...b.speedCurve, base: t.controller.baseSpeed, max: t.controller.maxSpeed };
    for (const r of openFairnessReport(files['worlds.json'] as WorldsJson, (s) => moveSpeed(s, curve))) expect(r.worstSec * 2, r.world).toBeLessThanOrEqual(r.limitSec);
  });

  it('the validator names a lane without grottos, a broken spawnMaxZ and a hole in a passage', () => {
    const sparse = JSON.parse(JSON.stringify(files)) as PackFiles;
    (sparse['worlds-spec.json'] as OpenSpecJson).mountains[1]!.sections[1]!.shelterEvery = 30;
    expect(validatePack(sparse, { paces: PACES }).errors.some((e) => e.includes('lane') && e.includes('shelterEvery 30'))).toBe(true);
    const high = JSON.parse(JSON.stringify(files)) as PackFiles;
    (high['worlds.json'] as WorldsJson).worlds[2]!.threat.spawnMaxZ = 5;
    expect(validatePack(high, { paces: PACES }).errors.some((e) => e.includes('spawnMaxZ'))).toBe(true);
    const hole = JSON.parse(JSON.stringify(files)) as PackFiles;
    const w = (hole['worlds.json'] as WorldsJson).worlds[0]!;
    w.segments = w.segments.filter((s) => !(s.type === 'ramp' && s['x0'] !== undefined && s.z === byType(0, 'gate')[0]!.z));
    expect(validatePack(hole, { paces: PACES }).errors.some((e) => e.includes('hole in the ground'))).toBe(true);
    // A crevasse wider than 60% of the jump at the speed of its section (stat 0 on section 1: 16 units/s).
    const wide = JSON.parse(JSON.stringify(files)) as PackFiles;
    (wide['worlds.json'] as WorldsJson).worlds[0]!.segments.push({ type: 'gap', z: 100, length: 7, x0: 4, x1: 28, y: 0 });
    expect(validatePack(wide, { paces: PACES }).errors.some((e) => e.includes('gap at z=100'))).toBe(true);
    // A grotto far from the others: the lane goes too long without one.
    const lonely = JSON.parse(JSON.stringify(files)) as PackFiles;
    const w4 = (lonely['worlds.json'] as WorldsJson).worlds[4]!;
    w4.segments = w4.segments.filter((s) => !(s.type === 'niche' && s['kind'] === 'grotto' && num(s, 'zone') === 4));
    expect(validatePack(lonely, { paces: PACES }).errors.some((e) => e.includes('fairness') || e.includes('shelterEvery'))).toBe(true);
  });
});

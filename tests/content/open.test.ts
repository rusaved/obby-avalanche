import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { choosePace, CLASSIC_PACE, mergePatch } from '../../src/content/pace.ts';
import { generateWorlds, stringifyWorlds } from '../../src/level/generate.ts';
import { forkRange, OPEN_SLOPE, passesOf } from '../../src/level/open-slope.ts';
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
    expect(open.camera).toEqual({ ...shared.camera, distance: 13, height: 4.5, pitchDeg: 24, fov: 76, fovSpeedAdd: 18, speedDistanceAdd: 7, speedPow: 0.4, zoomMax: 26, mobileFovAdd: 4, flagHide: 2, backBehind: 'run', minDistance: 7, shelterKeep: 8, archHide: 8, seeThrough: true, grottoShot: { ...shared.camera.grottoShot, orbitDeg: 75 } });
    // SP-03: the ceiling of the run 120 (docs/01a-content.md 19.7), the rest of the controller shared.
    expect(open.controller).toEqual({ ...shared.controller, maxSpeed: 120 });
    expect(open.ridgeShot).toEqual({ rise: 6, back: 4, sec: 1.5 });
    expect(open.bossShot).toEqual({ side: 10, rise: 2, back: 2, sec: 1 });
    expect(open.far).toEqual({ pc: 800, mobile: 600 });
    expect(open.fx).toEqual({ windFrom: 0.4 });
    // RL-06: the light sway on an ice slide of the open slope.
    expect(open.fun).toEqual({ ...shared.fun, slideSway: 6, slideSwayHz: 1.6 });
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
    // Three whole packs through the validator (11 s alone, up to 27 s beside other tests).
  }, 60_000);

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
    const input = { spec, balance: files['balance.json'] as BalanceJson, tuning: files['tuning.json'] as TuningJson };
    const text = stringifyWorlds(generateWorlds(input));
    expect(stringifyWorlds(generateWorlds(input))).toBe(text);
    expect(readFileSync(resolve(root, 'content/avalanche/pace/open/worlds.json'), 'utf8')).toBe(text);
    expect(validatePack(files, { paces: PACES }).errors).toEqual([]);
  });

  it('10 mountains by 01a 16.1 and 19.1 (SP-03: the lengths grew with the run): 3 sections on mountain 1, 4 on the others; ridges and the giant', () => {
    expect(worlds).toHaveLength(10);
    expect(worlds.map((w) => w.length)).toEqual([1450, 2100, 2380, 2660, 2920, 3210, 3470, 3770, 4060, 4640]);
    // SP-04 (01a 19.2): a world is as wide as its widest part.
    expect(worlds.map((w) => w.width)).toEqual([180, 200, 200, 200, 220, 200, 200, 220, 220, 220]);
    worlds.forEach((w, i) => {
      const sections = i === 0 ? 3 : 4;
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
        // The approach rise inside 75–95%: the ramp across the whole section (SP-04: as wide as the section). SP-07 (01a
        // 19.5): the rest of the terrace over the carniz, at the slope of relief (≤ 0.3 where shelterEvery is short); a
        // short section starts it a little before 75%, the top floor keeps room for a grotto.
        const h = (spec.mountains[wi]!.sections[i]!.width ?? spec.width) / 2;
        const across = (s: Segment): boolean => s['x0'] === undefined || (num(s, 'x0') <= -h + 1e-6 && num(s, 'x1') >= h - 1e-6);
        const m = spec.mountains[wi]!;
        // RL-05: from mountain 2 the ramp takes the calm half and the axis, the stairs the bold half.
        const stairs = w.segments.some((s) => s.type === 'stairs' && s.z > zone.zStart && s.z < zone.zEnd);
        const rise = w.segments.find((s) => s.type === 'ramp' && (stairs || across(s)) && s['approach'] === true && s.z > zone.zStart && s.z < zone.zEnd)!;
        expect(stairs).toBe(wi >= 1);
        expect(num(rise, 'rise')).toBe(m.terraceRise! - m.ridgeRise!);
        expect(num(rise, 'rise') / num(rise, 'length')).toBeGreaterThanOrEqual(spec.relief!.approachSlope - 1e-9);
        expect(num(rise, 'rise') / num(rise, 'length')).toBeLessThanOrEqual(0.3);
        expect(at(rise.z)).toBeGreaterThanOrEqual(0.74);
        expect(at(rise.z + num(rise, 'length'))).toBeLessThanOrEqual(0.95);
        // The flag past the ridge below in the first 5% (from section 2).
        if (i > 0) expect(at(w.segments.find((s) => s.type === 'checkpoint' && num(s, 'wall') === i)!.z)).toBeLessThanOrEqual(0.06);
        // A fork inside 5–40%, 60–120 units; on mountain 1 only section 2. A section with elements (RG, docs/01-gdd.md
        // 18.6) has its fork in the slot 40–75% — tests/content/rg-shapes.test.ts.
        const fork = w.segments.find((s) => s.type === 'fork' && num(s, 'section') === i + 1);
        const shaped = (spec.mountains[wi]!.sections[i]!.shape ?? []).length > 0;
        if (wi === 0) expect(!!fork).toBe(i === 1);
        if (fork && !shaped && fork['kind'] === 'split') {
          // SP-05 (01a 19.3): from 5–8% as before (past a change of width there), 150–300 long, the lanes meet before the approach rise.
          const taper = w.segments.find((t) => t.type === 'taper' && t.z >= zone.zStart && t.z < zone.zEnd);
          expect(fork.z).toBe(Math.max(forkRange(zone.zStart, L)[0], taper ? taper.z + num(taper, 'length') + 2 : -Infinity));
          expect(num(fork, 'length')).toBeGreaterThanOrEqual(150);
          expect(num(fork, 'length')).toBeLessThanOrEqual(300);
          expect(fork.z + num(fork, 'length')).toBeLessThan(rise.z);
        } else if (fork && !shaped) {
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
        // The field past a throat ×1.5 (RG, docs/01a-content.md 17.2).
        for (const g of gifts) expect(num(g, 'coins')).toBe(g['field'] === true ? Math.round(1.5 * zone.gift) : g['lane'] === 'bold' ? 2 * zone.gift : zone.gift);
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
    // SP-04 (01a 19.2): one passage every 30 units of the section's width — 100 wide, 3.
    expect(ridge.passes).toEqual(passesOf(spec, (spec.mountains[0]!.sections[0]!.width ?? spec.width) / 2));
    expect(ridge.passes).toHaveLength(3);
    expect(ridge.box.max[1] - ridge.y).toBeGreaterThan(jump + 1);
    for (const x of ridge.passes!) expect(level.floorAt(x, ridge.z + OPEN_SLOPE.passLength)).toBeCloseTo(ridge.y + OPEN_SLOPE.ridgeRise, 6);
    // Between the passages the carniz block goes down below the lower floor: nothing passes under it.
    const block = level.boxes.find((b) => b.kind === 'floor' && b.min[2] === ridge.z && b.max[0] < 0)!;
    expect(block.min[1]).toBeLessThan(ridge.y);
    expect(level.gates[level.gates.length - 1]!.kind).toBe('boss');
  });

  it('fairness on every lane: the worst run to a grotto ≤ warnSec × 0.8 with a margin of 2×, 1.5× on mountain 1 (01a 16.3, 19.2)', () => {
    const b = files['balance.json'] as BalanceJson;
    const t = files['tuning.json'] as TuningJson;
    const curve = { ...b.speedCurve, base: t.controller.baseSpeed, max: t.controller.maxSpeed };
    // SP-04: section 1 of mountain 1 is 100 wide instead of 56 — its novice at 16 units/s keeps 1.5×.
    for (const r of openFairnessReport(files['worlds.json'] as WorldsJson, (s) => moveSpeed(s, curve), 'lanes')) expect(r.worstSec * (r.world === 'slope' ? 1.5 : 2), r.world).toBeLessThanOrEqual(r.limitSec);
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

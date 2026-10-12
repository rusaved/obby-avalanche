import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergePatch } from '../../src/content/pace.ts';
import { baseBelts, basePortals, baseTreadMult, buildBase, type BaseProgress } from '../../src/level/base-layout.ts';
import { fenceGaps, validateBase, validateBaseFile } from '../../src/level/validate-base.ts';
import { basePortalEntered } from '../../src/sim/base-portals.ts';
import type { BalanceJson, BaseJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// FM-07: the base between the mountains (docs/01-gdd.md 19.2–19.4; docs/01a-content.md 18.1).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const base = read<BaseJson>('pace/open/base.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const i18n = { ru: read<Record<string, string>>('i18n/ru.json'), en: read<Record<string, string>>('i18n/en.json') };
const progress = (summits: number, ridge: BaseProgress['ridge'] = null): BaseProgress => ({ mountains: worlds.worlds.map((w) => ({ index: w.index, id: w.id })), summits, ridge, treadMult: 1 });

describe('the base (FM-07)', () => {
  it('the generator is deterministic: the same base.json and progress give the same level byte for byte; worlds.json untouched', () => {
    const before = JSON.stringify(worlds);
    const a = buildBase(base, progress(2, { b: 1, c: 3 }), tuning.bounds?.wallHeight);
    const b = buildBase(structuredClone(base), progress(2, { b: 1, c: 3 }), tuning.bounds?.wallHeight);
    expect(JSON.stringify(b.world)).toBe(JSON.stringify(a.world));
    expect(JSON.stringify(b.level)).toBe(JSON.stringify(a.level));
    expect(JSON.stringify(worlds)).toBe(before);
    // Portals of 01 19.3: as many as mountains, 1 on the left (+x as the hero faces +z), passed / own / locked, the ridge on the own one.
    expect(a.portals.map((p) => p.state)).toEqual(['passed', 'passed', 'own', ...Array(worlds.worlds.length - 3).fill('locked')]);
    expect(a.portals[0]!.x).toBeGreaterThan(a.portals[1]!.x);
    expect(a.portals[2]!.ridge).toEqual({ b: 1, c: 3 });
    // A locked arch is hard: an invisible block of the hero over each.
    expect(a.level.bounds!.length - buildBase(base, progress(worlds.worlds.length), tuning.bounds?.wallHeight).level.bounds!.length).toBe(worlds.worlds.length - 3);
  });

  it('the validator passes base.json of the pace (every portal reached by the physics of the controller from the spawn)', () => {
    expect(validateBaseFile(base, worlds, tuning, balance, i18n)).toEqual([]);
  });

  it('bogus base.json gives errors with the name of the field', () => {
    const bad = (patch: (b: BaseJson) => void): string[] => {
      const b = structuredClone(base);
      patch(b);
      return validateBaseFile(b, worlds, tuning, balance, i18n);
    };
    expect(bad((b) => (b.treadmill.lanes = 0)).join()).toContain('base.json: treadmill.lanes');
    expect(bad((b) => (b.portals.radius = 60)).join()).toContain('base.json: portals');
    expect(bad((b) => (b.spawn = { x: -24, z: 14 })).join()).toContain('base.json: spawn');
    const p1 = basePortals(base, progress(0))[0]!;
    expect(bad((b) => (b.decor.tents = [[p1.x, p1.z]])).join()).toContain('base.json: decor.tents[0]');
    // Tents round the spawn, corner to corner: no portal is reached.
    const boxed = bad((b) => (b.decor.tents = [[0, 13], [0, 3], [-5, 8], [5, 8]]));
    expect(boxed.length).toBe(worlds.worlds.length);
    expect(boxed[0]).toContain('base.json: portals — the hero does not get into the portal of mountain 1');
    // Texts of the base in both languages.
    const ru = { ...i18n.ru };
    delete ru['base.goal'];
    expect(validateBase(base, worlds, tuning, balance, { ru, en: i18n.en })).toEqual(['i18n/ru.json: base.goal — missing (the base shows it)']);
  });

  it('no gap in the fence; a fence box taken away is a gap', () => {
    const level = buildBase(base, progress(1), tuning.bounds?.wallHeight).level;
    expect(fenceGaps(level, base.size[0], base.size[1])).toEqual([]);
    // The east side of the fence (the bank and the invisible wall over it) taken away.
    const east = (b: { min: number[] }): boolean => b.min[0]! >= base.size[0] / 2 - 0.01;
    const holed = { ...level, boxes: level.boxes.filter((b) => !(b.kind === 'border' && east(b))), bounds: (level.bounds ?? []).filter((b) => !east(b)) };
    expect(fenceGaps(holed, base.size[0], base.size[1]).length).toBeGreaterThan(0);
  });

  it('a portal is entered across its opening from the field; a locked one never', () => {
    const ps = basePortals(base, progress(1));
    const own = ps[1]!;
    const s = Math.sin(own.yaw);
    const c = Math.cos(own.yaw);
    // From 1 unit in front of the arch to 0.5 past its plane: entered; along it or from behind: not.
    expect(basePortalEntered(ps, own.x - s, own.z - c, own.x + 0.5 * s, own.z + 0.5 * c)).toBe(own.world);
    expect(basePortalEntered(ps, own.x + 0.5 * s, own.z + 0.5 * c, own.x - s, own.z - c)).toBeNull();
    expect(basePortalEntered(ps, own.x - s + 5 * c, own.z - c - 5 * s, own.x + 0.5 * s + 5 * c, own.z + 0.5 * c - 5 * s)).toBeNull();
    const locked = ps[3]!;
    expect(basePortalEntered(ps, locked.x - Math.sin(locked.yaw), locked.z - Math.cos(locked.yaw), locked.x, locked.z + 0.1)).toBeNull();
  });

  it('FM-09: the base treadmill after 0…10 summits is the row of 01a 18.2 from worlds.json; its belts carry it; bogus data — the mountain named', () => {
    expect([...Array(11).keys()].map((n) => baseTreadMult(worlds.worlds, n))).toEqual([1, 2, 6, 20, 60, 150, 500, 1500, 5000, 15000, 40000]);
    const level = buildBase(base, { ...progress(2), treadMult: baseTreadMult(worlds.worlds, 2) }, tuning.bounds?.wallHeight).level;
    const belts = level.points.filter((p) => p.type === 'treadmill');
    expect(belts.map((p) => [p.x, p.z, p['mult']])).toEqual(baseBelts(base).map((b) => [b.x, b.z, 6]));
    const bogus = structuredClone(worlds);
    bogus.worlds[2]!.zones[0]!.stepMult = 5;
    expect(validateBase(base, bogus, tuning, balance, i18n)).toEqual(['base.json: treadmill — ×6 after 2 summits is more than section 1 of mountain 3 (×5)']);
  });
});

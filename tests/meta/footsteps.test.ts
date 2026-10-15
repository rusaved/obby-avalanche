import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACK_FILES, validatePack, type PackFiles } from '../../src/level/validate.ts';
import { createSave, parseSave } from '../../src/meta/save.ts';
import { chooseSet, defaultSet, footstepsOf, isOpen, setVolume, unlockAd } from '../../src/meta/footsteps.ts';
import type { FootstepsJson, SfxJson } from '../../src/content/types.ts';

// LV-09 (producer 15.10): footsteps — the manifest of sfx.json, the schema, the save with safe defaults.
const root = resolve(__dirname, '../..');
const loadPack = (name: string): PackFiles => {
  const files: Partial<PackFiles> = {};
  for (const f of PACK_FILES) files[f] = JSON.parse(readFileSync(resolve(root, 'content', name, f), 'utf8'));
  return files as PackFiles;
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const pack = loadPack('avalanche');
const steps = (pack['sfx.json'] as SfxJson).footsteps as FootstepsJson;

describe('footsteps manifest (sfx.json)', () => {
  it('6 sets: 3 free, 2 by an ad, 1 of the shop; snow and ice ZzFX params; file null or a path; default volume ~40%', () => {
    expect(steps.sets).toHaveLength(6);
    const by = (u: string): number => steps.sets.filter((s) => s.unlock === u).length;
    expect([by('free'), by('ad'), by('shop')]).toEqual([3, 2, 1]);
    for (const s of steps.sets) {
      expect(s.snow.length).toBeGreaterThan(0);
      expect(s.ice.length).toBeGreaterThan(0);
      expect(s.snow).not.toEqual(s.ice);
      expect(s.file === null || typeof s.file === 'string').toBe(true);
    }
    expect(steps.volume).toBeGreaterThan(0.3);
    expect(steps.volume).toBeLessThan(0.5);
    expect((pack['game.json'] as { ads: { rewarded: string[] } }).ads.rewarded).toContain('footsteps');
  });

  it('the schema: a bad unlock, a missing ice, a numeric file, no free set, a missing name fail; a file path passes', () => {
    const bad = (edit: (f: FootstepsJson) => void): string[] => {
      const files = clone(pack);
      edit((files['sfx.json'] as SfxJson).footsteps as FootstepsJson);
      return validatePack(files).errors;
    };
    expect(bad((f) => ((f.sets[0] as { unlock: string }).unlock = 'gold')).some((e) => e.startsWith('sfx.json: footsteps.sets.0.unlock'))).toBe(true);
    expect(bad((f) => delete (f.sets[1] as { ice?: unknown }).ice).some((e) => e.startsWith('sfx.json: footsteps.sets.1.ice'))).toBe(true);
    expect(bad((f) => ((f.sets[2] as { file: unknown }).file = 5)).some((e) => e.startsWith('sfx.json: footsteps.sets.2.file'))).toBe(true);
    expect(bad((f) => f.sets.forEach((s) => (s.unlock = 'shop'))).some((e) => e.includes('at least one free set'))).toBe(true);
    expect(bad((f) => ((f.sets[0] as { file: unknown }).file = 'audio/steps/soft.mp3'))).toEqual([]);
    const noName = clone(pack);
    delete (noName['i18n/en.json'] as Record<string, string>)[`footsteps.set.${steps.sets[0]!.id}`];
    delete (noName['i18n/ru.json'] as Record<string, string>)[`footsteps.set.${steps.sets[0]!.id}`];
    expect(validatePack(noName).errors).toContain(`i18n/ru.json: footsteps.set.${steps.sets[0]!.id} — missing (sfx.json footsteps)`);
    const noPlace = clone(pack);
    const ads = (noPlace['game.json'] as { ads: { rewarded: string[] } }).ads;
    ads.rewarded = ads.rewarded.filter((x) => x !== 'footsteps');
    expect(validatePack(noPlace).errors.some((e) => e.startsWith('game.json: ads.rewarded'))).toBe(true);
    // A pack without footsteps (the _sample one) is valid: the hero steps silently.
    const none = clone(pack);
    delete (none['sfx.json'] as SfxJson).footsteps;
    expect(validatePack(none).errors).toEqual([]);
  });
});

describe('footsteps in the save', () => {
  const free = steps.sets.filter((s) => s.unlock === 'free').map((s) => s.id);
  const ad = steps.sets.filter((s) => s.unlock === 'ad').map((s) => s.id);
  const shop = steps.sets.find((s) => s.unlock === 'shop')!.id;

  it('an old save without the field (v1 migrated, v2): the first free set, no ad sets, the volume of the data', () => {
    const v1 = parseSave({ v: 1, rev: 3, savedAt: 1, sessions: 2, settings: {} })!;
    const v2 = parseSave({ v: 2, rev: 3, savedAt: 1, sessions: 2, settings: {} })!;
    for (const s of [v1, v2, createSave(0)]) expect(footstepsOf(s, steps)).toEqual({ set: free[0], ads: [], volume: steps.volume });
    expect(defaultSet(steps)).toBe(free[0]);
  });

  it('a broken field falls back to the defaults, never throws; a good one survives parseSave', () => {
    expect(parseSave({ v: 2, rev: 1, savedAt: 1, sessions: 1, settings: {}, footsteps: [1, 2] })!.footsteps).toBeUndefined();
    const odd = parseSave({ v: 2, rev: 1, savedAt: 1, sessions: 1, settings: {}, footsteps: { set: shop, ads: 'x', volume: 7 } })!;
    expect(footstepsOf(odd, steps)).toEqual({ set: free[0], ads: [], volume: 1 });
    const gone = parseSave({ v: 2, rev: 1, savedAt: 1, sessions: 1, settings: {}, footsteps: { set: 'old_set', ads: ['old_set', ad[0]], volume: 'loud' } })!;
    expect(footstepsOf(gone, steps)).toEqual({ set: free[0], ads: [ad[0]], volume: steps.volume });
    const good = parseSave(JSON.parse(JSON.stringify({ ...createSave(5), rev: 2, footsteps: { set: ad[1], ads: [ad[1]], volume: 0.7 } })))!;
    expect(footstepsOf(good, steps)).toEqual({ set: ad[1], ads: [ad[1]], volume: 0.7 });
  });

  it('free sets choose at once; an ad set only after unlockAd (forever); the shop set never; the volume clamps', () => {
    const s = createSave(0);
    expect(chooseSet(s, steps, free[2]!)).toBe(true);
    expect(footstepsOf(s, steps).set).toBe(free[2]);
    expect(isOpen(s, steps, ad[0]!)).toBe(false);
    expect(chooseSet(s, steps, ad[0]!)).toBe(false);
    expect(chooseSet(s, steps, shop)).toBe(false);
    expect(unlockAd(s, steps, shop)).toBe(false);
    expect(unlockAd(s, steps, ad[0]!)).toBe(true);
    expect(unlockAd(s, steps, ad[0]!)).toBe(true);
    expect(chooseSet(s, steps, ad[0]!)).toBe(true);
    expect(footstepsOf(s, steps)).toEqual({ set: ad[0], ads: [ad[0]], volume: steps.volume });
    setVolume(s, steps, 1.5);
    expect(footstepsOf(s, steps).volume).toBe(1);
    setVolume(s, steps, 0);
    expect(footstepsOf(s, steps).volume).toBe(0);
    // Survives a reload: the save is plain JSON.
    expect(footstepsOf(parseSave(JSON.parse(JSON.stringify(s)))!, steps)).toEqual({ set: ad[0], ads: [ad[0]], volume: 0 });
  });
});

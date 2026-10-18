import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACK_FILES, validatePack, type PackFiles } from '../../src/level/validate.ts';
import { createSave, parseSave } from '../../src/meta/save.ts';
import { buyShop, chooseSet, defaultSet, footstepsOf, isOpen, setVolume, unlockAd } from '../../src/meta/footsteps.ts';
import type { FootstepsJson, SfxJson } from '../../src/content/types.ts';

// LV-09 (producer 15.10), SD-14 (producer 16.10): footsteps — the manifest of sfx.json (the producer's files), the schema,
// the save with safe defaults, the shop sets bought for summit trophies.
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
  it('SD-14, MU-12 (Q-MU-6): 5 sets of files — «Light snow» free, «Whisper» of the calendar day 2, «Velvet» for coins, 2 for trophies; the common ice; ~3 a second, ± 1 semitone; every file on disk; no synth', () => {
    expect(steps.sets.map((s) => s.id)).toEqual(['light_snow', 'whisper_snow', 'velvet_snow', 'magic_snow', 'quiet_crust']);
    const by = (u: string): string[] => steps.sets.filter((s) => s.unlock === u).map((s) => s.id);
    expect(by('free')).toEqual(['light_snow']);
    expect(by('daily')).toEqual(['whisper_snow']);
    expect(steps.sets.find((s) => s.id === 'whisper_snow')!.day).toBe(2);
    expect(by('shop')).toEqual(['velvet_snow', 'magic_snow', 'quiet_crust']);
    expect(steps.sets.filter((s) => s.currency === 'coins').map((s) => s.id)).toEqual(['velvet_snow']);
    expect(steps.sets.filter((s) => s.unlock === 'shop' && s.currency !== 'coins').map((s) => s.price)).toEqual([3, 6]);
    expect(by('ad')).toEqual([]);
    for (const s of steps.sets.filter((x) => x.unlock === 'shop')) expect(s.price).toBeGreaterThan(0);
    expect(steps.sets[0]!.weights![0]).toBeGreaterThan(Math.max(...steps.sets[0]!.weights!.slice(1)));
    expect(steps.perSec).toBe(3);
    expect(steps.pitch).toBe(1);
    expect(steps.ice).toHaveLength(4);
    const files = [...steps.ice, ...steps.sets.flatMap((s) => s.files), ...Object.values((pack['sfx.json'] as SfxJson).files ?? {})];
    for (const f of files) expect(existsSync(resolve(root, 'assets/audio', f)), f).toBe(true);
    expect(Object.keys((pack['sfx.json'] as SfxJson).files ?? {}).sort()).toEqual(['levelUp', 'rewardCoins', 'rewardTrophy']);
    expect(existsSync(resolve(root, 'incoming')), 'the incoming folder is gone').toBe(false);
    expect(steps.volume).toBeGreaterThan(0.3);
    expect(steps.volume).toBeLessThan(0.5);
  });

  it('the schema: a bad unlock, no files, a file not an .mp3, no free set, a shop set without its price, weights not one a file, a missing name fail', () => {
    const bad = (edit: (f: FootstepsJson) => void): string[] => {
      const files = clone(pack);
      edit((files['sfx.json'] as SfxJson).footsteps as FootstepsJson);
      return validatePack(files).errors;
    };
    expect(bad((f) => ((f.sets[0] as { unlock: string }).unlock = 'gold')).some((e) => e.startsWith('sfx.json: footsteps.sets.0.unlock'))).toBe(true);
    expect(bad((f) => delete (f.sets[1] as { files?: unknown }).files).some((e) => e.startsWith('sfx.json: footsteps.sets.1.files'))).toBe(true);
    expect(bad((f) => (f.sets[2]!.files = ['steps/x.wav'])).some((e) => e.startsWith('sfx.json: footsteps.sets.2.files'))).toBe(true);
    expect(bad((f) => f.sets.forEach((s) => ((s.unlock = 'shop'), (s.price = 1)))).some((e) => e.includes('at least one free set'))).toBe(true);
    expect(bad((f) => delete f.sets[3]!.price).some((e) => e.includes('a shop set needs its price'))).toBe(true);
    expect(bad((f) => (f.sets[0]!.weights = [1, 2])).some((e) => e.includes('weights — one a file'))).toBe(true);
    expect(bad((f) => delete (f as { ice?: unknown }).ice).some((e) => e.startsWith('sfx.json: footsteps.ice'))).toBe(true);
    const noName = clone(pack);
    delete (noName['i18n/en.json'] as Record<string, string>)[`footsteps.set.${steps.sets[0]!.id}`];
    delete (noName['i18n/ru.json'] as Record<string, string>)[`footsteps.set.${steps.sets[0]!.id}`];
    expect(validatePack(noName).errors).toContain(`i18n/ru.json: footsteps.set.${steps.sets[0]!.id} — missing (sfx.json footsteps)`);
    // A set by an ad still needs the rewarded place `footsteps`.
    const adSet = clone(pack);
    ((adSet['sfx.json'] as SfxJson).footsteps as FootstepsJson).sets[1]!.unlock = 'ad';
    const ads = (adSet['game.json'] as { ads: { rewarded: string[] } }).ads;
    ads.rewarded = ads.rewarded.filter((x) => x !== 'footsteps');
    expect(validatePack(adSet).errors.some((e) => e.startsWith('game.json: ads.rewarded'))).toBe(true);
    // A pack without footsteps (the _sample one) is valid: the hero steps silently.
    const none = clone(pack);
    delete (none['sfx.json'] as SfxJson).footsteps;
    expect(validatePack(none).errors).toEqual([]);
  });
});

describe('footsteps in the save', () => {
  const free = steps.sets.filter((s) => s.unlock === 'free').map((s) => s.id);
  const shop = steps.sets.filter((s) => s.unlock === 'shop' && s.currency !== 'coins');

  it('an old save without the field (v1 migrated, v2) or with a synth set gone: «Light snow», nothing bought, the volume of the data', () => {
    const v1 = parseSave({ v: 1, rev: 3, savedAt: 1, sessions: 2, settings: {} })!;
    const v2 = parseSave({ v: 2, rev: 3, savedAt: 1, sessions: 2, settings: {} })!;
    for (const s of [v1, v2, createSave(0)]) expect(footstepsOf(s, steps)).toEqual({ set: free[0], ads: [], volume: steps.volume, bought: [] });
    expect(defaultSet(steps)).toBe('light_snow');
    const synth = parseSave({ v: 2, rev: 1, savedAt: 1, sessions: 1, settings: {}, footsteps: { set: 'bells', ads: ['squeak'], volume: 0.6 } })!;
    expect(footstepsOf(synth, steps)).toEqual({ set: 'light_snow', ads: [], volume: 0.6, bought: [] });
  });

  it('a broken field falls back to the defaults, never throws', () => {
    expect(parseSave({ v: 2, rev: 1, savedAt: 1, sessions: 1, settings: {}, footsteps: [1, 2] })!.footsteps).toBeUndefined();
    const odd = parseSave({ v: 2, rev: 1, savedAt: 1, sessions: 1, settings: {}, footsteps: { set: shop[0]!.id, ads: 'x', bought: 'y', volume: 7 } })!;
    expect(footstepsOf(odd, steps)).toEqual({ set: free[0], ads: [], volume: 1, bought: [] });
  });

  it('free sets choose at once; a shop set only bought for its trophies (short — not), then for ever; the volume clamps', () => {
    const s = createSave(0);
    expect(chooseSet(s, steps, free[0]!)).toBe(true);
    expect(footstepsOf(s, steps).set).toBe(free[0]);
    expect(isOpen(s, steps, shop[0]!.id)).toBe(false);
    expect(chooseSet(s, steps, shop[0]!.id)).toBe(false);
    expect(unlockAd(s, steps, shop[0]!.id)).toBe(false);
    s.trophies = shop[0]!.price! - 1;
    expect(buyShop(s, steps, shop[0]!.id), 'short of trophies').toBe(false);
    expect(s.trophies).toBe(shop[0]!.price! - 1);
    s.trophies = shop[0]!.price! + 2;
    expect(buyShop(s, steps, shop[0]!.id)).toBe(true);
    expect(s.trophies).toBe(2);
    expect(buyShop(s, steps, shop[0]!.id), 'bought once').toBe(false);
    expect(footstepsOf(s, steps)).toEqual({ set: shop[0]!.id, ads: [], volume: steps.volume, bought: [shop[0]!.id] });
    expect(chooseSet(s, steps, free[0]!)).toBe(true);
    expect(chooseSet(s, steps, shop[0]!.id)).toBe(true);
    setVolume(s, steps, 1.5);
    expect(footstepsOf(s, steps).volume).toBe(1);
    setVolume(s, steps, 0);
    // Survives a reload: the save is plain JSON.
    expect(footstepsOf(parseSave(JSON.parse(JSON.stringify(s)))!, steps)).toEqual({ set: shop[0]!.id, ads: [], volume: 0, bought: [shop[0]!.id] });
  });

  it('MU-12: a set for coins takes them from the wallet once; the set of the calendar opens with its day', () => {
    const s = createSave(0);
    const velvet = steps.sets.find((x) => x.currency === 'coins')!;
    const wallet = { coins: velvet.price! - 1 };
    expect(buyShop(s, steps, velvet.id, wallet), 'short of coins').toBe(false);
    wallet.coins = velvet.price! + 5;
    s.trophies = 0;
    expect(buyShop(s, steps, velvet.id, wallet)).toBe(true);
    expect(wallet.coins).toBe(5);
    expect(buyShop(s, steps, velvet.id, { coins: 1e9 }), 'bought once').toBe(false);
    expect(isOpen(s, steps, velvet.id)).toBe(true);
    const whisper = steps.sets.find((x) => x.unlock === 'daily')!;
    expect(isOpen(s, steps, whisper.id)).toBe(false);
    s.daily = { n: whisper.day! - 1, last: 0, dayStart: 0 };
    expect(chooseSet(s, steps, whisper.id)).toBe(false);
    s.daily = { n: whisper.day!, last: 0, dayStart: 0 };
    expect(chooseSet(s, steps, whisper.id)).toBe(true);
    expect(footstepsOf(s, steps).set).toBe(whisper.id);
  });
});

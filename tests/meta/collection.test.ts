import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addPet, collected, releasePet, type PetBag } from '../../src/meta/pets.ts';
import { createPetsView } from '../../src/app/pets-view.ts';
import { createSave } from '../../src/meta/save.ts';
import { createRng } from '../../src/core/rng.ts';
import { setDictionary } from '../../src/ui/i18n.ts';
import { setNumberLocale } from '../../src/ui/format.ts';
import { PACK_FILES, validatePack, type PackFiles } from '../../src/level/validate.ts';
import balanceJson from '../../content/avalanche/balance.json' with { type: 'json' };
import petsJson from '../../content/avalanche/pets.json' with { type: 'json' };
import eggsJson from '../../content/avalanche/eggs.json' with { type: 'json' };
import themeJson from '../../content/avalanche/theme.json' with { type: 'json' };
import ru from '../../content/avalanche/i18n/ru.json' with { type: 'json' };
import en from '../../content/avalanche/i18n/en.json' with { type: 'json' };
import type { BalanceJson, EggsJson, PetsJson, ThemeJson } from '../../src/content/types.ts';
import type { Hud } from '../../src/ui/hud.ts';
import type { PetsViewDeps } from '../../src/app/pets-view.ts';

const balance = balanceJson as BalanceJson;
const pets = petsJson as PetsJson;
const eggs = eggsJson as EggsJson;
const allIds = pets.pets.map((p) => p.id);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The pets view without a screen: records the toasts, nothing to draw. */
function view(petsData: PetsJson, eggsData: EggsJson) {
  const toasts: Array<{ text: string; sub: string | undefined }> = [];
  const hud = new Proxy({} as Hud, {
    get: (_t, key) => (key === 'toast' ? (text: string, _s?: number, _g?: boolean, sub?: string) => toasts.push({ text, sub }) : () => undefined),
  });
  const save = createSave(0);
  const deps: PetsViewDeps = {
    balance,
    pets: petsData,
    eggs: eggsData,
    theme: themeJson as unknown as ThemeJson,
    save,
    getSim: () => ({ coins: 0, tier: 0 }) as unknown as ReturnType<PetsViewDeps['getSim']>,
    hud,
    windows: { current: null, open: () => undefined, refresh: () => undefined, close: () => undefined },
    visual: { group: null as never, shown: 0, setPets: () => undefined, jumpOut: () => undefined, setStands: () => undefined, update: () => undefined, dispose: () => undefined },
    camera: null as never,
    field: () => ({ width: 1, height: 1 }),
    rng: createRng(1),
    numSuffix: (k) => k,
    persist: () => undefined,
    trackOnce: () => undefined,
    onChange: () => undefined,
  };
  save.totalPlaySec = balance.ui.unlockMenusSec;
  return { v: createPetsView(deps), save, toasts };
}

// M3-13: the collection counter (Q-024; docs/01-gdd.md 7.2): kinds, not pets.
describe('collection counter (M3-13)', () => {
  it('counts kinds, not pets; a released pet counts down only when none of its kind is left', () => {
    const snow = eggs.eggs[0]!.pool.map((s) => s.pet);
    const bag: PetBag = {};
    addPet(bag, pets, balance.pets, 'bunny');
    expect(collected(bag.pets, snow)).toBe(1);
    addPet(bag, pets, balance.pets, 'penguin');
    expect(collected(bag.pets, snow)).toBe(2);
    addPet(bag, pets, balance.pets, 'penguin'); // the second Penguin: k stays
    expect(collected(bag.pets, snow)).toBe(2);
    expect(collected(bag.pets, allIds)).toBe(2);
    addPet(bag, pets, balance.pets, 'bullfinch'); // another egg: the Snow Egg counter stays, the total grows
    expect(collected(bag.pets, snow)).toBe(2);
    expect(collected(bag.pets, allIds)).toBe(3);
    releasePet(bag, pets, balance.pets.slots, 1); // one Penguin of two
    expect(collected(bag.pets, snow)).toBe(2);
    releasePet(bag, pets, balance.pets.slots, bag.pets!.indexOf('penguin')); // the last Penguin
    expect(collected(bag.pets, snow)).toBe(1);
    expect(collected(bag.pets, allIds)).toBe(2);
  });

  it('the hatch toast «Snow Egg: 2 of 5» and the button «2/27»: n and total come from eggs.json and pets.json', () => {
    setDictionary('ru', ru as Record<string, string>);
    setNumberLocale('ru');
    const snow = eggs.eggs[0]!;
    const { v, toasts } = view(pets, eggs);
    v.hatched('bunny', null, true); // «Mountain Gift» of the teaching: no counter line
    expect(toasts.at(-1)).toEqual({ text: 'Новый питомец! +20% к шагу', sub: undefined });
    expect(v.menuItem()?.badge).toBe('1/27');
    v.hatched('penguin', null, false, snow);
    expect(toasts.at(-1)).toEqual({ text: 'Новый питомец! +10% к шагу', sub: 'Снежное яйцо: 2 из 5' });
    expect(v.menuItem()?.badge).toBe('2/27');
    v.hatched('penguin', null, false, snow);
    expect(toasts.at(-1)?.sub).toBe('Снежное яйцо: 2 из 5');
    expect(v.menuItem()?.badge).toBe('2/27');
    setDictionary('en', en as Record<string, string>);
    v.hatched('seal', null, false, snow);
    expect(toasts.at(-1)?.sub).toBe('Snow Egg: 3 of 5');
    expect(v.menuItem()?.badge).toBe('3/27');

    // A pack with 28 pets and 6 in the Snow Egg: the numbers follow the data, none lives in the code.
    const pets28 = clone(pets);
    pets28.pets.push({ id: 'hare', rarity: 'rare', bonus: 0.3, color: '#ffffff', accent: '#000000' });
    const eggs6 = clone(eggs);
    eggs6.eggs[0]!.pool = [...eggs6.eggs[0]!.pool.map((s) => ({ ...s, chance: s.chance * 0.9 })), { pet: 'hare', chance: 0.1 }];
    const w = view(pets28, eggs6);
    w.v.hatched('hare', null, false, eggs6.eggs[0]!);
    expect(w.toasts.at(-1)?.sub).toBe('Snow Egg: 1 of 6');
    expect(w.v.menuItem()?.badge).toBe('1/28');
  });

  it('validate:content: toast.hatchCount and btn.petsCount in ru and en', () => {
    const files: Partial<PackFiles> = {};
    for (const f of PACK_FILES) files[f] = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../content/avalanche', f), 'utf8'));
    expect(validatePack(files as PackFiles).errors).toEqual([]);
    expect((ru as Record<string, string>)['toast.hatchCount']).toBe('{egg}: {k} из {n}');
    expect((en as Record<string, string>)['toast.hatchCount']).toBe('{egg}: {k} of {n}');
    expect((ru as Record<string, string>)['btn.petsCount']).toBe('{k}/{total}');
    for (const [file, key] of [['i18n/ru.json', 'toast.hatchCount'], ['i18n/en.json', 'btn.petsCount']] as const) {
      const broken = clone(files) as PackFiles;
      delete (broken[file] as Record<string, string>)[key];
      const other = file === 'i18n/ru.json' ? 'i18n/en.json' : 'i18n/ru.json';
      delete (broken[other] as Record<string, string>)[key];
      const res = validatePack(broken);
      expect(res.ok).toBe(false);
      expect(res.errors).toContain(`${file}: ${key} — missing (eggs.json, docs/01-gdd.md 7.2)`);
    }
  });
});

// What: Loads the content pack of this build (@content alias, game.json pace, the remote flag pace, ?pace= in debug builds) and exports `content`, `pace`, `paces`, `usePace` and `i18nUrls`.
// Called by: main.ts, debug/index.ts, test-api/index.ts; the @content alias is set in vite.config.ts and the vitest config.
// Keep: Pure data wiring: no numbers or texts here; dictionaries stay URLs, not bundled; the release never reads ?pace= (__DEBUG_TOOLS__ guard); classic = shared files.

/**
 * The content pack of this build (docs/02-tech.md 5.1): `@content` is an alias to content/<VITE_CONTENT>/.
 * Texts are not bundled: the dictionary of the SDK language is fetched before the first UI frame.
 * Pace (docs/01-gdd.md 16.1): every pace of the pack is in the bundle; game.json `pace` picks one at start, the remote
 * flag `pace` (usePace) can pick another, and in builds with debug tools `?pace=` overrides both. The release never
 * reads the parameter.
 */
import game from '@content/game.json';
import theme from '@content/theme.json';
import balance from '@content/balance.json';
import tuning from '@content/tuning.json';
import worlds from '@content/worlds.json';
import skins from '@content/skins.json';
import accessories from '@content/accessories.json';
import pets from '@content/pets.json';
import eggs from '@content/eggs.json';
import trails from '@content/trails.json';
import auras from '@content/auras.json';
import sfx from '@content/sfx.json';
import bots from '@content/bots.json';
import ruUrl from '@content/i18n/ru.json?url';
import enUrl from '@content/i18n/en.json?url';
import type { BaseJson, ContentPack } from './types.ts';
import { CLASSIC_PACE, choosePace, mergePatch, paceOfPath } from './pace.ts';

const byPace = (files: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(files).map(([path, data]) => [paceOfPath(path) ?? path, data]));
const paceWorlds = byPace(import.meta.glob('@content/pace/*/worlds.json', { eager: true, import: 'default' }));
const paceBalance = byPace(import.meta.glob('@content/pace/*/balance.json', { eager: true, import: 'default' }));
const paceTuning = byPace(import.meta.glob('@content/pace/*/tuning.json', { eager: true, import: 'default' }));
// The base between the mountains (docs/01-gdd.md 19): a file of the pace folder, none for classic.
const paceBase = byPace(import.meta.glob('@content/pace/*/base.json', { eager: true, import: 'default' }));

/** Pace folders of the pack (classic is not one of them). */
export const paces: readonly string[] = Object.keys(paceWorlds).sort();

const requested = __DEBUG_TOOLS__ && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('pace') : null;
const gamePace = (game as { pace?: string }).pace;

/** The pack with the patches of one pace merged (only that pace's: the others stay untouched in the bundle). */
function packOf(p: string): ContentPack {
  const classic = p === CLASSIC_PACE;
  return {
    game: game as unknown as ContentPack['game'],
    theme: theme as unknown as ContentPack['theme'],
    balance: (classic ? balance : mergePatch(balance, paceBalance[p])) as unknown as ContentPack['balance'],
    // A pace may patch the feel too (camera of the open slope, docs/01a-content.md 16.7): the same deep merge.
    tuning: (classic ? tuning : mergePatch(tuning, paceTuning[p])) as unknown as ContentPack['tuning'],
    worlds: (classic ? worlds : (paceWorlds[p] ?? worlds)) as unknown as ContentPack['worlds'],
    skins: skins as unknown as ContentPack['skins'],
    accessories: accessories as unknown as ContentPack['accessories'],
    pets: pets as unknown as ContentPack['pets'],
    eggs: eggs as unknown as ContentPack['eggs'],
    trails: trails as unknown as ContentPack['trails'],
    auras: auras as unknown as ContentPack['auras'],
    sfx: sfx as unknown as ContentPack['sfx'],
    bots: bots as unknown as ContentPack['bots'],
    ...(classic || !paceBase[p] ? {} : { base: paceBase[p] as unknown as BaseJson }),
  };
}

/** The pace of this run: classic or a folder of content/<pack>/pace/ (final after usePace at boot). */
export let pace: string = choosePace(gamePace, paces, requested);
export let content: ContentPack = packOf(pace);

/**
 * The remote flag `pace` (docs/06 8.1, the open/fast comparison of 8.2), read with getFlags at boot before the save:
 * a value among the flag's `values` in game.json picks the pace; ?pace= of a debug build still wins; anything else —
 * game.json `pace`. Returns the pace of the run.
 */
export function usePace(flag: string | undefined): string {
  const values = (game as { flags?: Record<string, { values?: string[] }> }).flags?.['pace']?.values ?? [];
  pace = choosePace(flag !== undefined && values.includes(flag) ? flag : gamePace, paces, requested);
  content = packOf(pace);
  return pace;
}

export const i18nUrls: Record<'ru' | 'en', string> = { ru: ruUrl, en: enUrl };

export type { ContentPack } from './types.ts';

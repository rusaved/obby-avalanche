/**
 * The content pack of this build (docs/02-tech.md 5.1): `@content` is an alias to content/<VITE_CONTENT>/.
 * Texts are not bundled: the dictionary of the SDK language is fetched before the first UI frame.
 * Pace (docs/01-gdd.md 16.1): every pace of the pack is in the bundle; game.json `pace` picks one at start, and in
 * builds with debug tools `?pace=` overrides it. The release never reads the parameter.
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
import type { ContentPack } from './types.ts';
import { CLASSIC_PACE, choosePace, mergePatch, paceOfPath } from './pace.ts';

const byPace = (files: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(files).map(([path, data]) => [paceOfPath(path) ?? path, data]));
const paceWorlds = byPace(import.meta.glob('@content/pace/*/worlds.json', { eager: true, import: 'default' }));
const paceBalance = byPace(import.meta.glob('@content/pace/*/balance.json', { eager: true, import: 'default' }));

/** Pace folders of the pack (classic is not one of them). */
export const paces: readonly string[] = Object.keys(paceWorlds).sort();

const requested = __DEBUG_TOOLS__ && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('pace') : null;
/** The pace of this run: classic or a folder of content/<pack>/pace/. */
export const pace: string = choosePace((game as { pace?: string }).pace, paces, requested);

const classic = pace === CLASSIC_PACE;

export const content: ContentPack = {
  game: game as unknown as ContentPack['game'],
  theme: theme as unknown as ContentPack['theme'],
  balance: (classic ? balance : mergePatch(balance, paceBalance[pace])) as unknown as ContentPack['balance'],
  tuning: tuning as unknown as ContentPack['tuning'],
  worlds: (classic ? worlds : (paceWorlds[pace] ?? worlds)) as unknown as ContentPack['worlds'],
  skins: skins as unknown as ContentPack['skins'],
  accessories: accessories as unknown as ContentPack['accessories'],
  pets: pets as unknown as ContentPack['pets'],
  eggs: eggs as unknown as ContentPack['eggs'],
  trails: trails as unknown as ContentPack['trails'],
  auras: auras as unknown as ContentPack['auras'],
  sfx: sfx as unknown as ContentPack['sfx'],
  bots: bots as unknown as ContentPack['bots'],
};

export const i18nUrls: Record<'ru' | 'en', string> = { ru: ruUrl, en: enUrl };

export type { ContentPack } from './types.ts';

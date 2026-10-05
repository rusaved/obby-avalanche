/**
 * The content pack of this build (docs/02-tech.md 5.1): `@content` is an alias to content/<VITE_CONTENT>/.
 * Texts are not bundled: the dictionary of the SDK language is fetched before the first UI frame.
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
import sfx from '@content/sfx.json';
import bots from '@content/bots.json';
import ruUrl from '@content/i18n/ru.json?url';
import enUrl from '@content/i18n/en.json?url';
import type { ContentPack } from './types.ts';

export const content: ContentPack = {
  game: game as unknown as ContentPack['game'],
  theme: theme as unknown as ContentPack['theme'],
  balance: balance as unknown as ContentPack['balance'],
  tuning: tuning as unknown as ContentPack['tuning'],
  worlds: worlds as unknown as ContentPack['worlds'],
  skins: skins as unknown as ContentPack['skins'],
  accessories: accessories as unknown as ContentPack['accessories'],
  pets: pets as unknown as ContentPack['pets'],
  eggs: eggs as unknown as ContentPack['eggs'],
  sfx: sfx as unknown as ContentPack['sfx'],
  bots: bots as unknown as ContentPack['bots'],
};

export const i18nUrls: Record<'ru' | 'en', string> = { ru: ruUrl, en: enUrl };

export type { ContentPack } from './types.ts';

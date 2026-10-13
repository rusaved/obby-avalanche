import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// 03 CNT-05 (FM-15): no links, site addresses, emails or «find us in…» in the texts and the data of the game; the one
// exception — the channels of game.json community (03 4.1, Q-054: telegram, vk).
const root = resolve(__dirname, '../..');
const LINK = /https?:|www\.|\.ru\b|\.com\b|@|t\.me|vk\./i;

/** Every string of a JSON value with its path. */
function strings(v: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}

/** Link-like strings of a pack's JSON files; `community` — the channels of game.json let through (its own fields only). */
export function linkFinds(files: Record<string, unknown>, community: Record<string, string>): string[] {
  const finds: string[] = [];
  for (const [file, data] of Object.entries(files))
    for (const [path, s] of strings(data, '')) {
      if (file.endsWith('game.json') && path.startsWith('community.') && community[path.slice('community.'.length)] === s) continue;
      if (LINK.test(s)) finds.push(`${file}: ${path} — ${s}`);
    }
  return finds;
}

const packFiles = (dir: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      // worlds.json is generated geometry, no texts; the rest — texts, names and data.
      else if (p.endsWith('.json') && !p.endsWith('worlds.json')) out[relative(root, p)] = JSON.parse(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
};

describe('no links but the community (03 CNT-05)', () => {
  it('dictionaries and data of every pack: nothing link-like outside the channels of game.json community', () => {
    for (const pack of readdirSync(resolve(root, 'content')).filter((e) => statSync(resolve(root, 'content', e)).isDirectory())) {
      const files = packFiles(resolve(root, 'content', pack));
      const game = files[`content/${pack}/game.json`] as { community?: Record<string, string> } | undefined;
      expect(linkFinds(files, game?.community ?? {}), pack).toEqual([]);
    }
  });

  it('a planted link fails; the channel addresses themselves pass', () => {
    const community = { telegram: 'https://t.me/some_game', vk: 'https://vk.ru/some_game_yandex' };
    expect(linkFinds({ 'game.json': { community }, 'i18n/ru.json': { a: 'Беги вверх' } }, community)).toEqual([]);
    expect(linkFinds({ 'game.json': { community }, 'i18n/ru.json': { a: 'Ищи нас: t.me/game' } }, community)).toEqual(['i18n/ru.json: a — Ищи нас: t.me/game']);
    expect(linkFinds({ 'game.json': { community: {}, other: community.vk } }, {})).toEqual([`game.json: other — ${community.vk}`]);
  });
});

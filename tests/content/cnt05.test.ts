import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// 03 CNT-05 (FM-15): no links, site addresses, emails or «find us in…» in the texts and the data of the game; the one
// exception — game.json community.url (03 4.1, Q-054).
const root = resolve(__dirname, '../..');
const LINK = /https?:|www\.|\.ru\b|\.com\b|@|t\.me|vk\./i;

/** Every string of a JSON value with its path. */
function strings(v: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}

/** Link-like strings of a pack's JSON files; `community` — the one address let through. */
export function linkFinds(files: Record<string, unknown>, community: string): string[] {
  const finds: string[] = [];
  for (const [file, data] of Object.entries(files))
    for (const [path, s] of strings(data, '')) {
      if (file.endsWith('game.json') && path === 'community.url' && s === community) continue;
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
  it('dictionaries and data of every pack: nothing link-like outside game.json community.url', () => {
    for (const pack of readdirSync(resolve(root, 'content')).filter((e) => statSync(resolve(root, 'content', e)).isDirectory())) {
      const files = packFiles(resolve(root, 'content', pack));
      const game = files[`content/${pack}/game.json`] as { community?: { url: string } } | undefined;
      expect(linkFinds(files, game?.community?.url ?? ''), pack).toEqual([]);
    }
  });

  it('a planted link fails; the community address itself passes', () => {
    const url = 'https://vk.com/some_game_community';
    expect(linkFinds({ 'game.json': { community: { url } }, 'i18n/ru.json': { a: 'Беги вверх' } }, url)).toEqual([]);
    expect(linkFinds({ 'game.json': { community: { url } }, 'i18n/ru.json': { a: 'Ищи нас: t.me/game' } }, url)).toEqual(['i18n/ru.json: a — Ищи нас: t.me/game']);
    expect(linkFinds({ 'game.json': { community: { url: '' }, other: url } }, '')).toEqual([`game.json: other — ${url}`]);
  });
});

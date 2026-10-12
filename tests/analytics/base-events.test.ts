import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// FM-14 (docs/01-gdd.md 19.13): the events of the base in the catalog of docs/06 (section 2, «База между горами», and the
// goals of section 6) with their multiplicity, and main.ts sends each the same way: `player` once a life (trackOnce),
// `always` every time; daily_claim says where it was claimed.
const root = resolve(__dirname, '../..');
const doc = readFileSync(resolve(root, 'docs/06-analytics.md'), 'utf8');
const main = readFileSync(resolve(root, 'src/main.ts'), 'utf8');
const daily = readFileSync(resolve(root, 'src/app/daily-view.ts'), 'utf8');

const EVENTS: Array<{ name: string; times: 'player' | 'always'; code: RegExp }> = [
  { name: 'base_first', times: 'player', code: /trackOnce\('base_first'\)/ },
  { name: 'base_portal', times: 'always', code: /[^e]track\('base_portal', \{ world: w, replay: place\.replay \}\)/ },
  { name: 'shortcut_ok', times: 'player', code: /trackOnce\('shortcut_ok'\)/ },
  { name: 'community_open', times: 'always', code: /[^e]track\('community_open'\)/ },
];

describe('events of the base (FM-14)', () => {
  it('every one is in the catalog of docs/06 with its multiplicity and among the Metrika goals; main.ts sends it so', () => {
    const goals = doc.slice(doc.indexOf('## 6.'), doc.indexOf('## 7.'));
    for (const e of EVENTS) {
      const row = doc.split('\n').find((l) => l.startsWith('|') && l.includes(`\`${e.name}\``));
      expect(row, e.name).toBeDefined();
      expect(row!.split('|').map((c) => c.trim())).toContain(e.times);
      expect(goals, e.name).toContain(`\`${e.name}\``);
      expect(main, e.name).toMatch(e.code);
    }
  });

  it('daily_claim carries `from` — base or window (docs/06, 01 19.13); the protective metric of 8.2', () => {
    expect(doc).toMatch(/`daily_claim`, параметр `from`: `base` или `window`/);
    expect(daily).toMatch(/d\.track\('daily_claim', \{ day: got\.day, from \}\)/);
    expect(main).toMatch(/dailyView\?\.claim\('base'\)/);
    expect(doc.slice(doc.indexOf('### 8.2'))).toMatch(/на базе не теряются/);
  });
});

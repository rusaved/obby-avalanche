import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// PS-13: the events of the open slope in the catalog of docs/06 (section 2, «Простор», and the goals of section 6)
// with their multiplicity, and main.ts sends each the same way: `player` once a life (trackOnce), `always` every time.
const root = resolve(__dirname, '../..');
const doc = readFileSync(resolve(root, 'docs/06-analytics.md'), 'utf8');
const main = readFileSync(resolve(root, 'src/main.ts'), 'utf8');

const EVENTS: Array<{ names: string[]; times: 'player' | 'always'; code: RegExp }> = [
  { names: ['ridge_1', 'ridge_2', 'ridge_3'], times: 'player', code: /trackOnce\(`ridge_\$\{wall\}`\)/ },
  { names: ['boss_enter'], times: 'player', code: /trackOnce\('boss_enter'\)/ },
  { names: ['boss_passed'], times: 'player', code: /trackOnce\('boss_passed'\)/ },
  { names: ['boss_caught'], times: 'always', code: /[^e]track\('boss_caught'/ },
  { names: ['record_up'], times: 'always', code: /[^e]track\('record_up'\)/ },
  // RG-10: the giant slapped a bot.
  { names: ['boss_bot_caught'], times: 'always', code: /[^e]track\('boss_bot_caught'/ },
];

describe('events of the open slope (PS-13)', () => {
  it('every one is in the catalog of docs/06 with its multiplicity and among the Metrika goals; main.ts sends it so', () => {
    const goals = doc.slice(doc.indexOf('## 6.'), doc.indexOf('## 7.'));
    for (const e of EVENTS) {
      const row = doc.split('\n').find((l) => l.startsWith('|') && e.names.every((n) => l.includes(`\`${n}\``)));
      expect(row, e.names.join(', ')).toBeDefined();
      expect(row!.split('|').map((c) => c.trim())).toContain(e.times);
      for (const n of e.names) expect(goals, n).toContain(`\`${n}\``);
      expect(main, e.names.join(', ')).toMatch(e.code);
    }
  });

  it('gameReady carries the pace of the run (docs/06 4)', () => {
    expect(doc).toMatch(/параметр `pace` — темп этой загрузки/);
    expect(main).toMatch(/track\('game_ready', \{ pace \}\)/);
  });
});

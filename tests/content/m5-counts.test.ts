import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import balance from '../../content/avalanche/balance.json' with { type: 'json' };
import stagesBalance from '../../content/avalanche/pace/stages/balance.json' with { type: 'json' };
import pets from '../../content/avalanche/pets.json' with { type: 'json' };
import eggs from '../../content/avalanche/eggs.json' with { type: 'json' };
import trails from '../../content/avalanche/trails.json' with { type: 'json' };
import auras from '../../content/avalanche/auras.json' with { type: 'json' };
import skins from '../../content/avalanche/skins.json' with { type: 'json' };
import game from '../../content/avalanche/game.json' with { type: 'json' };

// M5-05, M5-05b: the content of the release counted against the tables of docs/01a-content.md, sections 5–10.
const DOC = readFileSync('docs/01a-content.md', 'utf8');
/** The text of section `n` (from «## n.» to the next «## »). */
function section(n: number): string {
  const from = DOC.indexOf(`\n## ${n}. `);
  const to = DOC.indexOf('\n## ', from + 5);
  return DOC.slice(from, to);
}
/** The `id` of every data row of the tables in `text` whose first or second cell is `code`. */
function ids(text: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\|\s*(?:\d+\s*\|\s*)?`([a-z0-9_]+)`/.exec(line);
    if (m && m[1]!.startsWith(prefix)) out.push(m[1]!);
  }
  return out;
}
const idsOf = (list: Array<{ id: string }>): string[] => list.map((x) => x.id);

describe('M5-05: content of the release = docs/01a-content.md', () => {
  it('16 shoes (section 5), in order, in both paces', () => {
    const doc = ids(section(5));
    expect(doc).toHaveLength(16);
    expect(idsOf(balance.upgrade.tiers)).toEqual(doc);
    expect(idsOf(stagesBalance.upgrade.tiers as Array<{ id: string }>)).toEqual(doc);
  });

  it('5 eggs and 27 pets (section 6)', () => {
    const s6 = section(6);
    const docEggs = ['snow', 'frost', 'ice', 'blizzard', 'aurora'];
    for (const e of docEggs) expect(s6).toContain(`| \`${e}\` |`);
    expect(idsOf(eggs.eggs)).toEqual(docEggs);
    const docPets = ids(s6.slice(s6.indexOf('**Питомцы')));
    expect(docPets).toHaveLength(27);
    expect(idsOf(pets.pets).sort()).toEqual([...docPets].sort());
  });

  it('8 trails and 6 auras (section 7)', () => {
    const s7 = section(7);
    expect(idsOf(trails.trails)).toEqual(ids(s7, 'trail_'));
    expect(idsOf(auras.auras)).toEqual(ids(s7, 'aura_'));
    expect(trails.trails).toHaveLength(8);
    expect(auras.auras).toHaveLength(6);
  });

  it('the default skin, 7-day calendar, 9 quest templates (q_gold only with the golden gift), 8 time rewards, 10 rebirth steps', () => {
    expect(skins.default).toBe('tangerine');
    expect(balance.daily.days).toHaveLength(7);
    const s10 = section(10);
    const quests = ids(s10, 'q_');
    expect(quests).toHaveLength(9);
    expect(idsOf(balance.quests.list)).toEqual(quests);
    const gold = !!(game as { threat: { bonus?: unknown } }).threat.bonus;
    expect(balance.quests.list.filter((q) => q.id !== 'q_gold' || gold).length).toBe(gold ? 9 : 8);
    expect(balance.timeRewards).toHaveLength(8);
    expect(balance.rebirth.wallScale).toHaveLength(10);
  });
});

describe('M5-05b: 12 skins and 8 wings (section 8)', () => {
  it('ids and order as the tables', () => {
    const s8 = section(8);
    const docWings = ids(s8, 'wings_');
    const docSkins = ids(s8).filter((x) => !x.startsWith('wings_'));
    expect(docSkins).toHaveLength(12);
    expect(docWings).toHaveLength(8);
    expect(idsOf(skins.skins)).toEqual(docSkins);
    expect(idsOf(skins.wings)).toEqual(docWings);
  });
});

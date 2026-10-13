import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCycle, type ModelPack } from '../../scripts/balance-model.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, TuningJson } from '../../src/content/types.ts';

// SP-09 (docs/01-gdd.md 20.9; docs/01a-content.md 19.8): the experienced player of the model — the egg spammer's rules
// plus older eggs while they beat the weakest pet, «Speed now» on the belt of a grotto at a closed ridge every
// statNowCooldownSec, ×2 chest on every summit; F16 — on the data of «База» (FM) the model meets the producer's run.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, f), 'utf8'));
const common = (f: string): unknown => read(`content/avalanche/${f}`);
function packOf(dir: string): ModelPack {
  return {
    game: common('game.json'),
    balance: mergePatch(common('balance.json') as BalanceJson, read(`${dir}/balance.json`)),
    tuning: mergePatch(common('tuning.json') as TuningJson, read(`${dir}/tuning.json`)),
    pets: common('pets.json'),
    eggs: common('eggs.json'),
    trails: common('trails.json'),
    auras: common('auras.json'),
    worlds: (read(`${dir}/worlds.json`) as { worlds: ModelPack['worlds'] }).worlds,
    base: { transitSec: (read(`${dir}/base.json`) as { transitSec: number }).transitSec },
  } as ModelPack;
}
const open = packOf('content/avalanche/pace/open');
const fm = packOf('tests/fixtures/open-fm');

describe('the experienced player of the model (SP-09)', () => {
  it('F16: on the data of «База» (FM) the experienced player climbs the 10 mountains in 17–23 min (the producer: 20)', () => {
    const r = runCycle(fm, { profile: 'experienced' });
    expect(r.sec / 60).toBeGreaterThanOrEqual(17);
    expect(r.sec / 60).toBeLessThanOrEqual(23);
    // Faster than the greedy bot and the egg spammer on the same data: the ads and the pets.
    expect(r.sec).toBeLessThan(runCycle(fm, { profile: 'eggSpammer' }).sec);
    expect(r.sec).toBeLessThan(runCycle(fm, { profile: 'greedy' }).sec);
  });

  it('«Speed now» once in statNowCooldownSec at most, never before rewardedMinPlaySec; with ads off — none, the chest single', () => {
    const b = open.balance;
    const r = runCycle(open, { profile: 'experienced' });
    const off = runCycle(open, { profile: 'experienced', ads: false });
    const watched = r.adsAt.reduce((a, x) => a + x, 0);
    // An ad a summit for the chest, the rest «Speed now»: no more than the cycle allows by the cooldown.
    const summits = r.mountains.length;
    expect(watched - summits).toBeGreaterThan(0);
    expect(watched - summits).toBeLessThanOrEqual(Math.floor((r.sec - b.ads.rewardedMinPlaySec) / b.ads.statNowCooldownSec) + 1);
    expect(off.adsAt.reduce((a, x) => a + x, 0)).toBe(0);
    expect(off.sec).toBeGreaterThan(r.sec);
    // Mountain 1 has no ad before rewardedMinPlaySec: its first minute is the greedy bot's.
    const g = runCycle(open, { profile: 'greedy', mountains: 1 });
    const e1 = runCycle(open, { profile: 'experienced', mountains: 1 });
    expect(e1.walls[0]!.sec).toBeCloseTo(g.walls[0]!.sec, 6);
  });

  it('older eggs only while their average pet beats the weakest in the slots: the pets grow by the later mountains', () => {
    const r = runCycle(open, { profile: 'experienced' });
    const spam = runCycle(open, { profile: 'eggSpammer' });
    const pets8 = (x: typeof r): number => x.walls.filter((w) => w.mountain === 8).at(-1)!.petMult;
    expect(pets8(r)).toBeGreaterThan(pets8(spam));
    // Not every coin into eggs: far fewer eggs by mountain 8 than a bot buying the cheapest one whenever it can.
    expect(r.eggsAt[7]!).toBeLessThan(100);
  });
});

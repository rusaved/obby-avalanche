import { test, expect, testState } from './fixtures.ts';
import { paceBalance, paceWorlds, type Pace } from './pace-data.ts';
import { modelEntry } from '../src/debug/model-entry.ts';
import type { ModelPack } from '../scripts/balance-model.ts';
import game from '../content/avalanche/game.json' with { type: 'json' };
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import pets from '../content/avalanche/pets.json' with { type: 'json' };
import eggs from '../content/avalanche/eggs.json' with { type: 'json' };
import trails from '../content/avalanche/trails.json' with { type: 'json' };
import auras from '../content/avalanche/auras.json' with { type: 'json' };

// PR-09: «to mountain N» of ?debug=1 on both paces (docs/01-gdd.md 16.1): the camp of the last mountain with the state of
// the greedy bot of the balance model entering it (stat, shoes, coins, its pets on), summits 1…N−1 done; gate 1 opens
// on the approach or after the belt of its cave within 30 s of game time; the summit portal of that mountain opens the
// rebirth. The release has neither the button nor the model (check-release, PR-09).
type Seg = { type: string; z: number; x?: number; side?: string };
type W = { id: string; index: number; segments: Seg[] };
const bonusOf = (id: string): number => pets.pets.find((p) => p.id === id)?.bonus ?? 0;

for (const [pace, n] of [
  ['classic', 5],
  ['fast', 10],
] as Array<[Pace, number]>) {
  test(`${pace}: «to mountain ${n}» — its camp with the state of the model bot, gate 1 within 30 s, the summit opens the rebirth`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    const worlds = paceWorlds<W>(pace);
    const w = worlds.find((x) => x.index === n)!;
    const of = (type: string): Seg[] => w.segments.filter((s) => s.type === type).sort((a, b) => a.z - b.z);
    const pack = { game, balance: paceBalance(pace), tuning, pets, eggs, trails, auras, worlds } as unknown as ModelPack;
    await openGame(`pace=${pace}&debug=1`);
    let s = await testState(page);
    expect(s.world).toBe(worlds[0]!.id);
    const want = modelEntry(pack, s.tier, n);
    const gui = page.locator('[data-hud="debug"]');
    await gui.getByText('Mountains', { exact: true }).click();
    await gui.getByText(`to mountain ${n}`, { exact: true }).click();
    await expect.poll(async () => (await testState(page)).world).toBe(w.id);
    s = await testState(page);
    console.log(`to-mountain ${pace} ${n}: model ${JSON.stringify(want)}; game stat ${s.stat}, coins ${s.coins}, shoes ${s.shoeLevel}, pets ${JSON.stringify(s.petsOn)}`);
    expect(s.hero!.z).toBeLessThan(40);
    expect(s.summits).toBe(n - 1);
    expect(s.rebirthReady).toBe(false);
    expect(Math.abs(s.stat - want.stat) / want.stat).toBeLessThan(1e-9);
    expect(Math.abs(s.coins - want.coins) / want.coins).toBeLessThan(1e-9);
    expect(s.shoeLevel).toBe(want.shoe);
    expect(s.petsOn.map(bonusOf).sort((a, b) => b - a)).toEqual(want.pets);

    // Straight up to the cave of gate 1 and onto its belt (the cave also shelters from the first wave of the mountain).
    const gate = of('gate')[0]!;
    const cave = of('niche')[0]!;
    const side = cave.side === 'right' ? 1 : -1;
    await page.evaluate((p) => window.__TEST__!.botPath(p), [
      [0, cave.z - 8],
      [side * 12, cave.z],
      [side * 19, cave.z + 1],
    ] as Array<[number, number]>);
    await page.evaluate(() => window.__TEST__!.setTimeScale(4));
    const opened = (): Promise<number | null> =>
      page.evaluate((world) => window.__TEST__!.simEvents.find((e) => e.name === 'gateOpen' && e['world'] === world && e['index'] === 0)?.tick ?? null, n);
    await expect.poll(opened, { timeout: 60_000 }).not.toBeNull();
    await page.evaluate(() => window.__TEST__!.setTimeScale(1));
    const openSec = (await opened())! / 60;
    console.log(`to-mountain ${pace} ${n}: gate 1 (${gate.z}) open at ${openSec.toFixed(1)} s of game time on the mountain`);
    expect(openSec).toBeLessThanOrEqual(30);

    // The summit of the last mountain: its portal counts summit N — the rebirth opens («All mountains cleared!»).
    const portal = of('portal')[0]!;
    await page.evaluate((z) => window.__TEST__!.teleport(z), portal.z - 8);
    await page.evaluate((p) => window.__TEST__!.botPath(p), [[portal.x ?? 0, portal.z + 4]] as Array<[number, number]>);
    await page.waitForFunction(() => window.__TEST__!.state().window === 'allDone', undefined, { timeout: 60_000 });
    s = await testState(page);
    expect(s.summits).toBe(n);
    expect(s.rebirthReady).toBe(true);
  });
}

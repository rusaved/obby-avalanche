import type { Page } from '@playwright/test';
import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import fastWorlds from '../content/avalanche/pace/fast/worlds.json' with { type: 'json' };

// PS-13: the events of the open slope and the pace flag (docs/06 2, 4, 8.1–8.2). gameReady carries the pace; the remote
// flag `pace` (getFlags of the mock) picks the pace without ?pace=, ?pace= of a debug build still wins; the giant's catch
// sends boss_caught, the first climb back above the record flag — record_up.
type OpenWorld = { bosses: Array<{ zone: [number, number]; requires: number }> };
const world = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[0]!;
const zone = world.bosses[0]!.zone;
const advice = world.bosses[0]!.requires;
const fastGates = (fastWorlds as unknown as { worlds: Array<{ wallCount: number }> }).worlds[0]!.wallCount;
const openGates = (openWorlds as unknown as { worlds: Array<{ wallCount: number }> }).worlds[0]!.wallCount;

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await waitReady(page);
  await waitTicks(page, 2);
}
const ready = (page: Page): Promise<Record<string, unknown> | undefined> =>
  page.evaluate(() => window.__TEST__!.analytics().find((e) => e.name === 'game_ready')?.params);

test('gameReady carries the pace; the flag pace of getFlags picks fast without ?pace=; an unknown value — game.json; ?pace= wins', async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, '');
  expect((await testState(page)).pace).toBe('open');
  expect(await ready(page)).toEqual({ pace: 'open' });

  await open(page, `mock_flags=${encodeURIComponent(JSON.stringify({ pace: 'fast' }))}`);
  let s = await testState(page);
  expect(s.pace).toBe('fast');
  expect(s.gatesOpen).toHaveLength(fastGates);
  expect(await ready(page)).toEqual({ pace: 'fast' });

  await open(page, `mock_flags=${encodeURIComponent(JSON.stringify({ pace: 'nope' }))}`);
  s = await testState(page);
  expect(s.pace).toBe('open');
  expect(s.gatesOpen).toHaveLength(openGates);

  await open(page, `pace=open&mock_flags=${encodeURIComponent(JSON.stringify({ pace: 'fast' }))}`);
  expect((await testState(page)).pace).toBe('open');
});

test('the giant’s catch sends boss_caught {world: 1}; back above the record flag — record_up, once a climb', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await openGame('pace=open');
  await page.evaluate(([z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
  }, [zone[0] - 6, advice / 2] as const);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), zone[1] + 20);
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'caughtEnd'), undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  const names = (): Promise<Array<{ name: string; params: Record<string, unknown> | undefined }>> =>
    page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'boss_caught' || e.name === 'record_up').map((e) => ({ name: e.name, params: e.params })));
  expect(await names()).toEqual([{ name: 'boss_caught', params: { world: 1 } }]);
  // Back up past the record (the point of the catch) and on past the giant: «New height!», record_up.
  const record = (await testState(page)).record!;
  expect(record.z).toBeGreaterThan(zone[0]);
  await page.evaluate((s) => window.__TEST__!.setStat(s), advice * 4);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), zone[1] + 6);
  await page.waitForFunction(() => window.__TEST__!.analytics().some((e) => e.name === 'record_up'), undefined, { timeout: 60_000 });
  await waitTicks(page, 30);
  expect((await names()).map((e) => e.name)).toEqual(['boss_caught', 'record_up']);
});

import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { nextSummit, toFirstBase, worlds } from './base-route.ts';
import base from '../content/avalanche/pace/open/base.json' with { type: 'json' };

// FM-12 (Q-051; docs/01-gdd.md 19.3; docs/01a-content.md 18.8): «My records» on the base — best Speed, trophies over
// all time, summits a/b, the tier, as the save has them; without a leaderboard no call of it and no «Records» at the
// board; with one (and a login) the button at the board opens the records window.
const rec = base.stands.records;

async function standAtBoard(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[rec.x - 2, rec.z]] as Array<[number, number]>);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 60);
}

test('after mountain 2 the board shows the save (best Speed, trophies, 2/10, tier 0); no leaderboard — no button, no call; screenshot', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await toFirstBase(page, openGame);
  await nextSummit(page, 2);
  const s = await testState(page);
  const fmt = (n: number): Promise<string> => page.evaluate((x) => window.__TEST__!.fmt(x), n);
  expect(s.baseBoard).toEqual(['Мои рекорды', `Лучшая Скорость: ${await fmt(s.bestStat)}`, `Кубков всего: ${await fmt(s.trophies.total)}`, `Вершины 2/${worlds.length}`, 'Ступень 0']);
  expect(s.trophies.total).toBeGreaterThan(0);
  await standAtBoard(page);
  expect((await testState(page)).standButton).toBeNull();
  const calls = await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name.startsWith('leaderboards')).length);
  expect(calls).toBe(0);
  // The shot from aside, the hero off the board, no toast over it.
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[rec.x - 4, rec.z + 6]] as Array<[number, number]>);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForFunction(() => !document.querySelector('.toasting'), undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI / 2 + 0.5, pitch: 0.15, dist: 10 }));
  await shot1080(page, 'docs/evidence/fm/records_board_1920x1080_ru.png', 5);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));
});

test('with a leaderboard and a login: «Records» at the board opens the records window', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await toFirstBase(page, (q) => openGame(`${q ?? ''}&mock_auth=1&leaderboard=trophies`));
  await standAtBoard(page);
  await page.waitForFunction(() => window.__TEST__!.state().standButton === 'records', undefined, { timeout: 10_000 });
  await expect(page.locator('[data-hud="stand"]')).toHaveText('Рекорды');
  await page.locator('[data-hud="stand"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'records', undefined, { timeout: 10_000 });
  // The table came (the mock has rows only after a setScore — M4-06): «Loading» is gone, the window stays.
  await page.waitForFunction(() => !!document.querySelector('[data-role="records-list"]') && document.querySelector('[data-role="records-list"]')!.textContent !== 'Загрузка', undefined, { timeout: 10_000 });
  expect((await testState(page)).window).toBe('records');
  const calls = await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'leaderboards.getEntries').length);
  expect(calls).toBe(1);
});

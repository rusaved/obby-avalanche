import type { Page } from '@playwright/test';
import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import { intoPortal, intoSummit, nextSummit, toFirstBase, worlds } from './base-route.ts';

// FM-13 (docs/01-gdd.md 19.10; 03 SDK-08): the desktop shortcut on the mock (?mock_shortcut=) — after summit 2 on the
// base «Desktop shortcut: +5»; accepted — +5 spendable trophies once (trophiesTotal unchanged), the button gone for
// good (F5 too), shortcut_ok; rejected — nothing, no button until a reload; unavailable — none; on a mountain none;
// without the SDK (NullPlatform) none and no error.
const calls = (page: Page, name: string): Promise<number> => page.evaluate((n) => window.__YA_MOCK__?.calls.filter((c) => c.name === n).length ?? 0, name);
const hasButton = async (page: Page): Promise<boolean> => (await testState(page)).menu.includes('shortcut');

async function toSecondBase(page: Page, openGame: (q?: string) => Promise<void>, mode: string): Promise<void> {
  await toFirstBase(page, (q) => openGame(`${q ?? ''}&mock_shortcut=${mode}`));
  await nextSummit(page, 2);
  // The summit group of summit 2 comes one by one after its window (wardrobe, quests, the shortcut).
  await waitTicks(page, 8 * 60);
}

test('accepted: the button after summit 2 on the base, +5 spendable trophies once, gone for good (F5), shortcut_ok', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await toSecondBase(page, openGame, 'accepted');
  expect(await hasButton(page)).toBe(true);
  await expect(page.locator('[data-hud="menu-shortcut"]')).toContainText('Ярлык на рабочий стол: +5');
  const before = (await testState(page)).trophies;
  await page.locator('[data-hud="menu-shortcut"]').dispatchEvent('pointerdown');
  await page.waitForFunction((n) => window.__TEST__!.state().trophies.now === n, before.now + 5, { timeout: 10_000 });
  await waitTicks(page, 10);
  const s = await testState(page);
  expect(s.trophies.total).toBe(before.total);
  expect(await hasButton(page)).toBe(false);
  expect((await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'shortcut_ok')).toHaveLength(1);
  expect(await calls(page, 'shortcut.showPrompt')).toBe(1);
  // F5: back on the base, the reward stays given — no button, no new prompt.
  await page.reload();
  await waitReady(page);
  await waitTicks(page, 120);
  expect((await testState(page)).onBase).toBe(true);
  expect(await hasButton(page)).toBe(false);
  expect((await testState(page)).trophies.now).toBe(before.now + 5);
});

test('rejected: no reward, the button gone until a reload; on a mountain none', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await toSecondBase(page, openGame, 'rejected');
  expect(await hasButton(page)).toBe(true);
  // On the mountain behind portal 3: none.
  await intoPortal(page, 3);
  await waitTicks(page, 30);
  expect(await hasButton(page)).toBe(false);
  // Its summit, «Next» — the base again.
  await intoSummit(page, worlds[2]!);
  await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 60_000 });
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 4 * 60);
  expect(await hasButton(page)).toBe(true);
  const before = (await testState(page)).trophies;
  await page.locator('[data-hud="menu-shortcut"]').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !window.__TEST__!.state().menu.includes('shortcut'), undefined, { timeout: 10_000 });
  await waitTicks(page, 30);
  expect((await testState(page)).trophies).toEqual(before);
  expect(await hasButton(page)).toBe(false);
  // The next session: it is offered again.
  await page.reload();
  await waitReady(page);
  await waitTicks(page, 8 * 60);
  expect(await hasButton(page)).toBe(true);
});

test('unavailable: no button; without the SDK (NullPlatform): no button and no error', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await toSecondBase(page, openGame, 'unavailable');
  expect(await hasButton(page)).toBe(false);
  expect(await calls(page, 'shortcut.canShowPrompt')).toBe(1);
  expect(await calls(page, 'shortcut.showPrompt')).toBe(0);
  // No SDK at all: the same save, the game on NullPlatform.
  await page.route('**/sdk.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* no platform */' }));
  await page.reload();
  await waitReady(page);
  await waitTicks(page, 8 * 60);
  expect(await page.evaluate(() => typeof window.__YA_MOCK__)).toBe('undefined');
  expect(await hasButton(page)).toBe(false);
});

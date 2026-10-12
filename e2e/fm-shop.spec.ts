import type { Page } from '@playwright/test';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { toFirstBase } from './base-route.ts';
import base from '../content/avalanche/pace/open/base.json' with { type: 'json' };

// FM-10 (docs/01-gdd.md 19.3; docs/01a-content.md 18.1): the shop counter of the base — its button only with «Shop»
// of the HUD (180 s), standing by it standSec; the shop on the tab by the coins; running past opens nothing; the hand
// only when something is affordable; after the summit of mountain 1 (chest 500) the Snow egg from it.
const EVIDENCE = 'docs/evidence/fm';
const shop = base.stands.shop;

/** The hero walks to `x, z` on the base and stops there. */
async function walkTo(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[x, z]] as Array<[number, number]>);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
}

/** Coins to `n`, the stand button up again, pressed: the tab the shop opens on; the window closed again. */
async function openedTab(page: Page, coins: number): Promise<string> {
  await page.evaluate((n) => window.__TEST__!.setCoins(n), coins);
  await page.waitForFunction(() => window.__TEST__!.state().standButton === 'shop', undefined, { timeout: 10_000 });
  await page.locator('[data-hud="stand"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'shop', undefined, { timeout: 10_000 });
  const tab = await page.evaluate(() => (document.querySelector('.win-tab.on') as HTMLElement | null)?.dataset['hud'] ?? '');
  return tab.replace('shop-tab-', '');
}

test('the shop counter: no button before 180 s; then by standing — the tab by the coins; running past opens nothing; the hand; the Snow egg; screenshot', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await toFirstBase(page, openGame);
  const chest = (await testState(page)).coins;
  // Before 180 s of play: standing by the counter gives nothing.
  await walkTo(page, shop.x - 1, shop.z - 1);
  await waitTicks(page, 60);
  let s = await testState(page);
  expect(s.playSec).toBeLessThan(180);
  expect(s.standButton).toBeNull();
  expect(s.standHands).toEqual([]);

  // From 180 s on (with «Shop» of the HUD): the hand while something is affordable, the button by standing.
  await page.evaluate(() => window.__TEST__!.setPlaySec(200));
  await waitTicks(page, 30);
  s = await testState(page);
  expect(s.menu).toContain('shop');
  expect(chest).toBeGreaterThanOrEqual(500);
  expect(s.standHands).toEqual(['shop']);
  // The Snow egg affordable after the chest of mountain 1: from the counter on «Eggs» once the sneakers are bought.
  await page.locator('[data-hud="shoes"]').click();
  await page.evaluate(() => window.__TEST__!.setCoins(330));
  await page.locator('[data-hud="shoes"]').click();
  await waitTicks(page, 5);
  await page.locator('[data-hud="shoes"]').click();
  await waitTicks(page, 5);
  expect((await testState(page)).shoeLevel).toBe(2);
  // Three cases of 19.3: the sneakers affordable (900+) — «Sneakers»; only the egg (500…899) — «Eggs»; none — «Sneakers».
  expect(await openedTab(page, 1000)).toBe('shoes');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__TEST__!.state().window, undefined, { timeout: 10_000 });
  expect(await openedTab(page, 100)).toBe('shoes');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__TEST__!.state().window, undefined, { timeout: 10_000 });
  await waitTicks(page, 10);
  expect((await testState(page)).standHands, 'no hand with nothing affordable').toEqual([]);
  expect(await openedTab(page, chest)).toBe('eggs');
  // The Snow egg from it: the «New pet!» card with the count of the collection.
  await page.locator('[data-item="snow"] [data-hud="shop-item"]').click();
  await page.waitForFunction(() => !!document.querySelector('[data-role="new-pet"]'), undefined, { timeout: 10_000 });
  await expect(page.locator('[data-role="new-pet"]')).toContainText('1');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__TEST__!.state().window, undefined, { timeout: 10_000 });
  s = await testState(page);
  expect(s.coins).toBe(chest - 500);

  // Running past the counter: no window, no button.
  await page.evaluate(() => window.__TEST__!.setCoins(1000));
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[shop.x - 8, shop.z + 6], [shop.x + 6, shop.z - 2]] as Array<[number, number]>);
  for (let k = 0; k < 20 && (await page.evaluate(() => window.__TEST__!.botLeft())) > 0; k++) {
    expect((await testState(page)).window).toBeNull();
    await waitTicks(page, 6);
  }
  expect((await testState(page)).window).toBeNull();
  await walkTo(page, shop.x - 1, shop.z - 2.5);
  await page.waitForFunction(() => window.__TEST__!.state().standButton === 'shop', undefined, { timeout: 10_000 });
  await shot1080(page, `${EVIDENCE}/base_shop_1920x1080_ru.png`, 5);
});

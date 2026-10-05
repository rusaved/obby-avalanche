import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

/** Bunny of the teaching in the collection, then the first Snow Egg at the camp stand (seed 1: a Penguin comes out). */
async function hatchFirstSnowEgg(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(181);
    window.__TEST__!.givePet('bunny');
  });
  await waitTicks(page, 3);
  expect((await testState(page)).menuBadges['pets']).toBe('1/27');
  await page.evaluate(() => window.__TEST__!.teleport(27.6, 8));
  await page.evaluate(() => window.__TEST__!.setCoins(500));
  await page.waitForFunction(() => window.__TEST__!.state().eggButton.can, undefined, { timeout: 30_000 });
  await page.locator('[data-hud="egg"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().pets.length === 2, undefined, { timeout: 30_000 });
}

// M3-13 (Q-024): the collection counter — «{egg}: {k} of {n}» under the hatch toast, «{k}/{total}» on the Pets button.
test('collection counter ru: «Снежное яйцо: 2 из 5», «2/27» on the Pets button, the same after F5', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('seed=1');
  await hatchFirstSnowEgg(page);
  let s = await testState(page);
  expect(s.pets).toEqual(['bunny', 'penguin']);
  expect(s.toastSub).toBe('Снежное яйцо: 2 из 5');
  expect(s.menuBadges['pets']).toBe('2/27');
  await page.waitForTimeout(350); // the toast fades in over 0.25 s and stays 3 s
  await page.screenshot({ path: 'docs/evidence/M3/hatch_count_1920x1080_ru.png' });
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  await waitTicks(page, 3);
  s = await testState(page);
  expect(s.pets).toEqual(['bunny', 'penguin']);
  expect(s.menuBadges['pets']).toBe('2/27');
  await page.locator('[data-hud="menu-pets"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="pets-count"]')).toHaveText('Питомцы 2/27');
});

test('collection counter en: «Snow Egg: 2 of 5», «2/27»', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('seed=1&mock_lang=en');
  await hatchFirstSnowEgg(page);
  const s = await testState(page);
  expect(s.toastSub).toBe('Snow Egg: 2 of 5');
  expect(s.menuBadges['pets']).toBe('2/27');
});

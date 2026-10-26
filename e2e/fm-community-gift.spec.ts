import type { Page } from '@playwright/test';
import { test, expect, testState, waitTicks } from './fixtures.ts';
import game from '../content/avalanche/game.json' with { type: 'json' };

// FM-16 (producer 14.10, catalog practice; docs/01-gdd.md 19.10; 03 4.1, SDK-07): under the channels of the pause window
// a card «Egg for subscribing» a channel — its window, «Go» opens the channel in a new tab (window.open caught), nothing
// until the player is back in the game (blur → focus), then a pet from the egg once; the card of that channel is gone,
// after a reload too; the plain channel button gives nothing. «Chest for a review» on the mock: sent — coins once, closed
// — nothing and no card, unavailable — no card. 640 × 360 in ru and en: the cards fit.
const channels = game.community as Record<string, string>;
const IDS = Object.keys(channels);

async function catchOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __opened: unknown[][] }).__opened = [];
    window.open = ((...args: unknown[]) => {
      (window as unknown as { __opened: unknown[][] }).__opened.push(args);
      return null;
    }) as typeof window.open;
  });
}
const opened = (page: Page): Promise<unknown[][]> => page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened);
/** Away to the other tab and back to the game. */
const awayAndBack = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
const events = async (page: Page, name: string): Promise<unknown[]> =>
  (await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === name).map((e) => e.params);

test('G-05: no gift for a visit to the group — the Telegram and VK buttons stay, nothing given back in the game', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await catchOpen(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame('pace=open');
  const pets0 = (await testState(page)).pets.length;
  await page.locator('[data-hud="pause"]').click();
  for (const id of IDS) {
    await expect(page.locator(`[data-hud="gift-sub-${id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-hud="community-${id}"]`)).toBeVisible();
  }
  await page.locator(`[data-hud="community-${IDS[0]}"]`).click();
  expect((await opened(page)).at(-1)).toEqual([channels[IDS[0]!], '_blank', 'noopener,noreferrer']);
  await awayAndBack(page);
  await page.waitForTimeout(500);
  expect((await testState(page)).pets.length).toBe(pets0);
  expect(await events(page, 'community_gift')).toEqual([]);
  await page.screenshot({ path: 'docs/evidence/G/community_pause_1920x1080_ru.png' });
});

for (const mode of ['sent', 'closed', 'unavailable'] as const)
  test(`«Chest for a review», mock_review=${mode}`, async ({ page, openGame }) => {
    test.setTimeout(90_000);
    await openGame(`pace=open&mock_review=${mode}`);
    const coins0 = (await testState(page)).coins;
    await page.locator('[data-hud="pause"]').click();
    const card = page.locator('[data-hud="gift-review"]');
    if (mode === 'unavailable') {
      await page.waitForTimeout(1000);
      await expect(card).toBeHidden();
      return;
    }
    await expect(card).toHaveText('Сундук за отзыв');
    await card.click();
    await expect(card).toBeHidden();
    await page.locator('[data-hud="continue"]').click();
    await waitTicks(page, 10);
    const coins1 = (await testState(page)).coins;
    if (mode === 'sent') {
      expect(coins1).toBeGreaterThan(coins0);
      expect(await events(page, 'review_gift')).toHaveLength(1);
    } else {
      expect(coins1).toBe(coins0);
      expect(await events(page, 'review_gift')).toHaveLength(0);
    }
    // Not again this session.
    await page.locator('[data-hud="pause"]').click();
    await page.waitForTimeout(500);
    await expect(card).toBeHidden();
  });

for (const lang of ['ru', 'en'])
  test(`640 × 360, ${lang}: the gift cards fit`, async ({ page, openGame }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await openGame(`pace=open&mock_lang=${lang}`);
    await page.locator('[data-hud="pause"]').click();
    for (const h of [...IDS.map((id) => `community-${id}`), 'gift-review']) {
      const b = page.locator(`[data-hud="${h}"]`);
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeVisible();
      expect(await b.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), h).toBe(true);
    }
    await page.screenshot({ path: `docs/evidence/sp/community_gift_640x360_${lang}.png` });
  });

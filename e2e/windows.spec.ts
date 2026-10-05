import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import worldsJson from '../content/avalanche/worlds.json' with { type: 'json' };
import balanceJson from '../content/avalanche/balance.json' with { type: 'json' };

// M3-09 (GDD-11, GDD-12; docs/01-gdd.md 10.2, 6.4): every window opens by its own button and closes by the cross, Esc
// and a tap on the veil, has a «next» button, the avalanche stands while it is open; the HUD buttons come by the
// schedule in game time and never earlier; no window before 180 s of play.

const ui = balanceJson.ui;
const portalZ = (world: number): number => worldsJson.worlds.find((w) => w.index === world)!.segments.find((s) => s.type === 'portal')!.z;

type Close = 'cross' | 'esc' | 'veil' | 'next';

async function closeBy(page: Page, how: Close): Promise<void> {
  if (how === 'cross') await page.locator('[data-hud="win-close"]').click();
  else if (how === 'esc') await page.keyboard.press('Escape');
  else if (how === 'veil') await page.mouse.click(20, 540);
  else await page.locator('[data-role="window"] [data-next]:visible').first().click();
  await page.waitForFunction(() => window.__TEST__!.state().window === null, undefined, { timeout: 10_000 });
}

/** The window is open, paused (`menu`), has a visible «next» button, and the game and the avalanche stand. */
async function checkOpen(page: Page, id: string): Promise<void> {
  await page.waitForFunction((w) => window.__TEST__!.state().window === w, id, { timeout: 10_000 });
  await expect(page.locator(`[data-role="window"][data-window="${id}"]`)).toBeVisible();
  await expect(page.locator('[data-role="window"] [data-next]:visible').first()).toBeVisible();
  const a = await testState(page);
  expect(a.pauseReasons).toContain('menu');
  await page.waitForTimeout(400);
  const b = await testState(page);
  expect(b.ticks).toBe(a.ticks);
  expect(b.wave?.timer).toBe(a.wave?.timer);
  expect(b.wave?.phase).toBe(a.wave?.phase);
}

test('no window before 180 s of play; HUD buttons come by the schedule of 6.4 in game time, never earlier', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  let s = await testState(page);
  expect(s.menu).toEqual([]);
  // Game time up to 3:00: nothing opens by itself, the column stays empty.
  for (let t = 30; t < ui.unlockMenusSec; t += 30) {
    await page.evaluate((sec) => window.__TEST__!.runSim(sec), 30);
    s = await testState(page);
    expect(s.window).toBeNull();
    expect(s.menu).toEqual([]);
  }
  const play = async (): Promise<number> => page.evaluate(() => window.__TEST__!.state().playSec);
  const to = async (sec: number): Promise<void> => {
    await page.evaluate((d) => window.__TEST__!.runSim(d), sec - (await play()));
  };
  await to(ui.unlockMenusSec - 0.1);
  s = await testState(page);
  expect(s.window).toBeNull();
  expect(s.menu).toEqual([]);
  await to(ui.unlockMenusSec + 0.05);
  expect((await testState(page)).menu).toEqual(['shop']);
  await to(ui.unlockMenusSec + ui.menuStepSec - 0.1);
  expect((await testState(page)).menu).toEqual(['shop']);
  await to(ui.unlockMenusSec + ui.menuStepSec + 0.05);
  expect((await testState(page)).menu).toEqual(['shop', 'pets']);
  await to(ui.unlockMenusSec + 2 * ui.menuStepSec + 0.05);
  expect((await testState(page)).menu).toEqual(['shop', 'pets', 'daily']);
  await to(ui.unlockTimeRewardsSec - 0.1);
  s = await testState(page);
  expect(s.menu).toEqual(['shop', 'pets', 'daily']);
  expect(s.window).toBeNull();
  await to(ui.unlockTimeRewardsSec + 0.05);
  s = await testState(page);
  expect(s.menu).toEqual(['shop', 'pets', 'daily', 'timeRewards']);
  expect(s.trophyPlaque.shown).toBe(false);
  // Purchases off: no «Special» tab.
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-hud="shop-tab-special"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__TEST__!.state().window === null);

  // The first summit: «Mountain 1 cleared!»; the trophy plaque, «Wardrobe», «Quests», «Rebirth» only after it closes,
  // one after another 2 s apart.
  await page.evaluate((z) => {
    window.__TEST__!.setStat(1e6);
    window.__TEST__!.teleport(z);
    window.__TEST__!.setAutoRun(true);
  }, portalZ(1) - 35);
  await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  s = await testState(page);
  expect(s.menu).toEqual(['shop', 'pets', 'daily', 'timeRewards']);
  expect(s.trophyPlaque.shown).toBe(false);
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().world === 'pass', undefined, { timeout: 10_000 });
  await waitTicks(page, 2);
  s = await testState(page);
  expect(s.trophyPlaque.shown).toBe(true);
  expect(s.menu).toEqual(['shop', 'pets', 'daily', 'timeRewards']);
  await page.evaluate((d) => window.__TEST__!.runSim(d), ui.menuStepSec);
  expect((await testState(page)).menu).toEqual(['shop', 'pets', 'wardrobe', 'daily', 'timeRewards']);
  await page.evaluate((d) => window.__TEST__!.runSim(d), ui.menuStepSec);
  expect((await testState(page)).menu).toEqual(['shop', 'pets', 'wardrobe', 'daily', 'quests', 'timeRewards']);
  await page.evaluate((d) => window.__TEST__!.runSim(d), ui.menuStepSec);
  expect((await testState(page)).menu).toEqual(['shop', 'pets', 'wardrobe', 'daily', 'quests', 'timeRewards', 'rebirth']);
});

test('every window of 10.2 opens by its button, closes by the cross, Esc, the veil and «next»; the avalanche stands; screenshots', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setTrophies(30);
    window.__TEST__!.setCoins(5000);
  });
  await waitTicks(page, 3);
  const s = await testState(page);
  expect(s.menu).toEqual(['shop', 'pets', 'wardrobe', 'daily', 'quests', 'timeRewards', 'rebirth']);
  const byButton: Array<[string, string]> = [
    ['pause', 'pause'],
    ['menu-shop', 'shop'],
    ['menu-pets', 'pets'],
    ['menu-wardrobe', 'wardrobe'],
    ['menu-daily', 'daily'],
    ['menu-quests', 'quests'],
    ['menu-timeRewards', 'timeRewards'],
    ['menu-rebirth', 'rebirth'],
  ];
  for (const [btn, id] of byButton) {
    for (const how of ['cross', 'esc', 'veil', 'next'] as const) {
      await page.locator(`[data-hud="${btn}"]`).dispatchEvent('pointerdown');
      await checkOpen(page, id);
      if (how === 'cross') await page.screenshot({ path: `docs/evidence/M3/window_${id}_1920x1080_ru.png` });
      await closeBy(page, how);
      const after = await testState(page);
      expect(after.pauseReasons).not.toContain('menu');
    }
  }
  // Pause: the game title in one line, «Pause» under it, «Continue».
  await page.locator('[data-hud="pause"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-window="pause"] .win-title')).toHaveText('Обби: Лавина Идёт! +1 к Скорости');
  expect(await page.locator('[data-window="pause"] .win-title').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await expect(page.locator('[data-role="pause"] .panel-sub')).toHaveText('Пауза');
  await page.locator('[data-hud="continue"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === null);

  // Shop tabs: Sneakers (the next pair to buy, the rest in order), Eggs (open mountains only) → «New pet!» → back.
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-hud^="shop-tab-"]')).toHaveText(['Кроссовки', 'Яйца', 'Трейлы', 'Ауры']);
  await expect(page.locator('[data-item="runners"] [data-hud="shop-item"]')).toHaveText('Купить');
  await expect(page.locator('[data-item="snow_runners"] [data-hud="shop-item"]')).toContainText('Сначала: Беговые');
  await page.locator('[data-item="runners"] [data-hud="shop-item"]').click();
  expect((await testState(page)).shoeLevel).toBe(1);
  await expect(page.locator('[data-item="runners"] [data-hud="shop-item"]')).toHaveText('Надето');
  await page.screenshot({ path: 'docs/evidence/M3/shop_shoes_1920x1080_ru.png' });
  await page.locator('[data-hud="shop-tab-eggs"]').click();
  await expect(page.locator('[data-item="frost"] [data-hud="shop-item"]')).toContainText('Откроется на горе 2');
  await page.screenshot({ path: 'docs/evidence/M3/shop_eggs_1920x1080_ru.png' });
  const pets = (await testState(page)).pets.length;
  await page.locator('[data-item="snow"] [data-hud="shop-item"]').click();
  await checkOpen(page, 'newPet');
  expect((await testState(page)).pets.length).toBe(pets + 1);
  await expect(page.locator('[data-role="new-pet"]')).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/M3/new_pet_1920x1080_ru.png' });
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'shop');
  await expect(page.locator('[data-hud="shop-tab-eggs"]')).toHaveClass(/on/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__TEST__!.state().window === null);
  // Rebirth «To eggs» → the shop tab «Eggs».
  await page.locator('[data-hud="menu-rebirth"]').dispatchEvent('pointerdown');
  await page.locator('[data-hud="rebirth-eggs"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'shop');
  await expect(page.locator('[data-hud="shop-tab-eggs"]')).toHaveClass(/on/);
});

test('«Mountain N cleared!» after every portal 1–4: the next mountain on «Next», the cross, Esc and the veil; «Tomorrow in the calendar»', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame();
  const ways: Close[] = ['next', 'cross', 'esc', 'veil'];
  for (let k = 1; k <= 4; k++) {
    if (k > 1) {
      await page.evaluate((w) => window.__TEST__!.gotoWorld(w), k);
      await waitTicks(page, 3);
    }
    const coins = (await testState(page)).coins;
    await page.evaluate((z) => {
      window.__TEST__!.setStat(1e12);
      window.__TEST__!.teleport(z);
      window.__TEST__!.setAutoRun(true);
    }, portalZ(k) - 35);
    await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 60_000 });
    await page.evaluate(() => window.__TEST__!.setAutoRun(false));
    await checkOpen(page, 'summit');
    const win = page.locator('[data-role="window"][data-window="summit"]');
    await expect(win.locator('.win-title')).toHaveText(`Гора ${k} пройдена!`);
    await expect(win).toContainText('Сундук: +');
    await expect(win).toContainText(`Кубки: +${k}`);
    // The chest coins are in the wallet.
    expect((await testState(page)).coins).toBeGreaterThan(coins);
    if (k === 1) {
      // First calendar circle, today's reward not taken: tomorrow is day 2.
      await expect(page.locator('[data-role="summit-tomorrow"]')).toHaveText('Завтра в календаре: Скин «Пингвин»');
      await expect(win).toContainText('Дальше: Ледяной перевал');
      await page.screenshot({ path: 'docs/evidence/M3/summit_window_1920x1080_ru.png' });
    }
    await closeBy(page, ways[k - 1]!);
    await page.waitForFunction((id) => window.__TEST__!.state().world === id, worldsJson.worlds[k]!.id, { timeout: 10_000 });
    expect((await testState(page)).pauseReasons).not.toContain('menu');
  }
});

test('640×360: the column is 3 icons + «More» above 72% H, «More» lists them all and opens each window', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setTrophies(30);
  });
  await waitTicks(page, 3);
  const s = await testState(page);
  expect(s.menu).toEqual(['shop', 'pets', 'wardrobe', 'more']);
  const boxes = await page.locator('[data-role="menu"] [data-hud]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  for (const b of boxes) {
    expect(b.width).toBe(44);
    expect(b.bottom).toBeLessThanOrEqual(360 * 0.72);
  }
  const jump = await page.locator('[data-hud="jump"]').boundingBox();
  if (jump) expect(jump.y).toBeGreaterThanOrEqual(boxes.at(-1)!.bottom);
  await page.screenshot({ path: 'docs/evidence/M3/menu_more_640x360_ru.png' });
  await page.locator('[data-hud="menu-more"]').dispatchEvent('pointerdown');
  await checkOpen(page, 'more');
  await expect(page.locator('[data-hud^="more-"]')).toHaveCount(7);
  await page.screenshot({ path: 'docs/evidence/M3/window_more_640x360_ru.png' });
  await page.locator('[data-hud="more-daily"]').click();
  await checkOpen(page, 'daily');
  expect(await page.locator('.win-panel').evaluate((p) => p.getBoundingClientRect().bottom <= window.innerHeight + 1)).toBe(true);
  await closeBy(page, 'next');
});

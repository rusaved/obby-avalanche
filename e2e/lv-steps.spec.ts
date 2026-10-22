import type { Page } from '@playwright/test';
import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import sfxJson from '../content/avalanche/sfx.json' with { type: 'json' };

// LV-09 (producer 15.10; docs/01-gdd.md 11): a soft sound of the steps — snow on the slope, ice on an ice slide — quiet
// by default; SD-14 (producer 16.10): the producer's files, at most ~3 steps a second at any Speed; the «Footsteps» window
// from the pause: MU-12 — the sets are bought in the «Steps» tab of the shop, the window chooses; its volume slider
// applies at once and survives F5 with the set and the bought ones.
type Seg = { type: string; z: number; x?: number; y?: number; length?: number; width?: number; shape?: string };
const w1 = (openWorlds as unknown as { worlds: Array<{ segments: Seg[] }> }).worlds[0]!;
const slide = w1.segments.find((s) => s.type === 'slide' && !s.shape)!;
const steps = sfxJson.footsteps;
const free = steps.sets.filter((s) => s.unlock === 'free').map((s) => s.id);
const shop = steps.sets.filter((s) => s.unlock === 'shop');
const fs = async (page: Page) => (await testState(page)).footsteps!;

async function openFootsteps(page: Page): Promise<void> {
  await page.locator('[data-hud="pause"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'pause', undefined, { timeout: 10_000 });
  await page.locator('[data-hud="footsteps"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'footsteps', undefined, { timeout: 10_000 });
}

test('steps sound at most ~3 a second: snow on the slope, ice on the slide; quiet by default', async ({ page, openGame }) => {
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.holdWave(300));
  let f = await fs(page);
  expect(f).toMatchObject({ count: 0, surface: null, set: free[0], volume: steps.volume, ads: [], bought: [] });
  expect(steps.volume).toBeLessThan(0.5);
  // The first key press starts the sound; the hero runs up the slope.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__TEST__!.state().audioRunning && window.__TEST__!.state().footsteps!.count > 0, undefined, { timeout: 30_000 });
  const a = await testState(page);
  await waitTicks(page, 120);
  const b = await testState(page);
  await page.keyboard.up('KeyW');
  expect(b.steps - a.steps).toBeGreaterThanOrEqual(3);
  // SD-14: not a sound a step — at most perSec a second (2 s of play here), still a step every third of a second.
  const heard = b.footsteps!.count - a.footsteps!.count;
  expect(heard).toBeLessThanOrEqual(2 * steps.perSec + 1);
  expect(heard).toBeGreaterThanOrEqual(3);
  expect(heard).toBeLessThan(b.steps - a.steps);
  expect(b.footsteps!.surface).toBe('snow');
  // The steps are not in the list of the other sounds (it keeps the events the specs look for).
  expect(b.sfx.filter((n) => n.startsWith('footsteps'))).toEqual([]);

  // The ice slide of mountain 1: from just below it straight up along it.
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [slide.z - (slide.length ?? 16) / 2 - 3, slide.x ?? 0] as const);
  await waitTicks(page, 10);
  await page.keyboard.down('KeyW');
  let onIce = 0;
  for (let i = 0; i < 200 && onIce === 0; i++) {
    await waitTicks(page, 2);
    const s = await testState(page);
    if (s.fun.onSlide >= 0 && s.footsteps!.surface === 'ice') onIce = s.footsteps!.count;
    if (s.hero!.z > slide.z + (slide.length ?? 16) / 2 + 2) break;
  }
  await page.keyboard.up('KeyW');
  expect(onIce, 'a step on the ice slide sounds as ice').toBeGreaterThan(0);
  // Back on snow past it.
  await page.keyboard.down('KeyW');
  await page.waitForFunction((n) => window.__TEST__!.state().footsteps!.count > n && window.__TEST__!.state().fun.onSlide < 0, onIce, { timeout: 30_000 });
  await page.waitForFunction(() => window.__TEST__!.state().footsteps!.surface === 'snow', undefined, { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  f = await fs(page);
  expect(f.surface).toBe('snow');
});

test('«Footsteps» from the pause (MU-07, MU-12, ST-07): seven cards, «Light snow» on, the rest locked — the calendar day 2, the shop, two for an ad; «To the shop» opens its «Steps» tab', async ({ page, openGame }) => {
  await openGame('pace=stages');
  await openFootsteps(page);
  const win = page.locator('[data-role="window"][data-window="footsteps"]');
  await expect(win.locator('.win-title')).toHaveText('Звук шагов');
  await expect(win.locator('[data-footsteps]')).toHaveCount(steps.sets.length);
  await expect(win.locator(`[data-footsteps="${free[0]}"][data-state="on"]`)).toBeVisible();
  await expect(win.locator(`[data-footsteps="${free[0]}"] .card-name`)).toHaveText('Лёгкий снег');
  // ST-07: two sets for an ad.
  await expect(win.locator('[data-hud="footsteps-ad"]')).toHaveCount(steps.sets.filter((x) => x.unlock === 'ad').length);
  await expect(win.locator('[data-hud="footsteps-buy"]')).toHaveCount(0);
  await expect(win.locator('[data-footsteps="velvet_snow"]')).toContainText('День 2');
  for (const s of shop) await expect(win.locator(`[data-footsteps="${s.id}"] [data-hud="footsteps-shop"]`)).toBeVisible();
  await expect(win.locator(`[data-footsteps="${shop[2]!.id}"] .foot-lock`)).toContainText(String(shop[2]!.price));

  // The window alone holds the game (menu): the sound stays on, «listen» plays a set (its files loaded).
  await page.waitForFunction(() => window.__TEST__!.state().audioRunning, undefined, { timeout: 30_000 });
  expect((await testState(page)).pauseReasons).toEqual(['menu']);
  const all = steps.sets.reduce((n, s) => n + s.files.length, 0);
  await page.waitForFunction((n) => window.__TEST__!.state().footsteps!.loaded >= n, all, { timeout: 30_000 });
  const c0 = (await fs(page)).count;
  await win.locator(`[data-footsteps="${shop[1]!.id}"] [data-hud="footsteps-play"]`).click();
  await expect.poll(async () => (await fs(page)).count).toBeGreaterThan(c0);
  expect((await fs(page)).set).toBe(free[0]);
  await win.locator(`[data-footsteps="${shop[1]!.id}"] [data-hud="footsteps-shop"]`).click();
  await expect(page.locator('[data-role="window"][data-window="shop"] [data-hud="shop-tab-steps"]')).toHaveClass(/on/);
  await page.locator('[data-hud="win-close"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === null && window.__TEST__!.state().pauseReasons.length === 0, undefined, { timeout: 10_000 });
});

test('the footsteps volume slider applies at once and survives F5 with the set bought in the shop', async ({ page, openGame }) => {
  await openGame('pace=stages');
  const set = shop[shop.length - 1]!;
  await page.evaluate((n) => window.__TEST__!.setTrophies(n), set.price!);
  await openFootsteps(page);
  const slider = page.locator('[data-hud="footsteps-volume"]');
  await expect(slider).toHaveValue(String(Math.round(steps.volume * 100)));
  await slider.fill('70');
  await expect(page.locator('[data-role="window"] [data-role="footsteps-volume"]')).toHaveText('70\u202f%');
  await expect.poll(async () => (await fs(page)).volume).toBeCloseTo(0.7, 5);
  await page.locator(`[data-footsteps="${set.id}"] [data-hud="footsteps-shop"]`).click();
  await page.locator(`[data-role="window"] [data-item="${set.id}"] [data-hud="shop-item"]`).click();
  await page.waitForFunction((id) => window.__TEST__!.state().footsteps!.set === id, set.id, { timeout: 30_000 });
  await page.reload();
  await waitReady(page);
  const f = await fs(page);
  expect(f.volume).toBeCloseTo(0.7, 5);
  expect(f.set).toBe(set.id);
  expect(f.bought).toEqual([set.id]);
  await openFootsteps(page);
  await expect(page.locator('[data-hud="footsteps-volume"]')).toHaveValue('70');
  await expect(page.locator(`[data-footsteps="${set.id}"][data-state="on"]`)).toBeVisible();
});

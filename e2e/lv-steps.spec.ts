import type { Page } from '@playwright/test';
import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import sfxJson from '../content/avalanche/sfx.json' with { type: 'json' };

// LV-09 (producer 15.10; docs/01-gdd.md 11): a soft sound at every hero step — snow on the slope, ice on an ice slide —
// quiet by default; the «Footsteps» window from the pause: 3 free sets chosen at once, 2 by a rewarded ad, 1 locked;
// its volume slider applies at once and survives F5.
type Seg = { type: string; z: number; x?: number; y?: number; length?: number; width?: number; shape?: string };
const w1 = (openWorlds as unknown as { worlds: Array<{ segments: Seg[] }> }).worlds[0]!;
const slide = w1.segments.find((s) => s.type === 'slide' && !s.shape)!;
const steps = sfxJson.footsteps;
const free = steps.sets.filter((s) => s.unlock === 'free').map((s) => s.id);
const ads = steps.sets.filter((s) => s.unlock === 'ad').map((s) => s.id);
const fs = async (page: Page) => (await testState(page)).footsteps!;

async function openFootsteps(page: Page): Promise<void> {
  await page.locator('[data-hud="pause"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'pause', undefined, { timeout: 10_000 });
  await page.locator('[data-hud="footsteps"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === 'footsteps', undefined, { timeout: 10_000 });
}

test('every step sounds: snow on the slope, ice on the slide; quiet by default', async ({ page, openGame }) => {
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.holdWave(300));
  let f = await fs(page);
  expect(f).toMatchObject({ count: 0, surface: null, set: free[0], volume: steps.volume, ads: [] });
  expect(steps.volume).toBeLessThan(0.5);
  // The first key press starts the sound; the hero runs up the slope.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__TEST__!.state().audioRunning && window.__TEST__!.state().footsteps!.count > 0, undefined, { timeout: 30_000 });
  const a = await testState(page);
  await waitTicks(page, 120);
  const b = await testState(page);
  await page.keyboard.up('KeyW');
  expect(b.steps - a.steps).toBeGreaterThanOrEqual(3);
  // One sound a step (none lost to the limit of equal sounds at this pace).
  expect(b.footsteps!.count - a.footsteps!.count).toBe(b.steps - a.steps);
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

test('«Footsteps» from the pause: 3 free sets chosen at once with a preview, 2 by «Реклама» (opened forever), 1 locked', async ({ page, openGame }) => {
  await openGame('pace=open&mock_ad=ok');
  await openFootsteps(page);
  const win = page.locator('[data-role="window"][data-window="footsteps"]');
  await expect(win.locator('.win-title')).toHaveText('Звук шагов');
  await expect(win.locator('[data-footsteps]')).toHaveCount(6);
  await expect(win.locator('[data-hud="footsteps-choose"]')).toHaveCount(3);
  await expect(win.locator(`[data-footsteps="${free[0]}"][data-state="on"]`)).toBeVisible();
  const adBtns = win.locator('[data-hud="footsteps-ad"]');
  await expect(adBtns).toHaveCount(2);
  for (const t of await adBtns.allTextContents()) expect(t).toContain('Реклама');
  const locked = win.locator('.card.locked');
  await expect(locked).toHaveCount(1);
  await expect(locked.locator('.card-lock')).toContainText('Из магазина');
  await expect(locked.locator('.card-lock svg')).toHaveCount(1);
  await expect(locked.locator('button')).toHaveCount(0);

  // The window alone holds the game (menu): the sound stays on, a tap chooses the set and plays it.
  await page.waitForFunction(() => window.__TEST__!.state().audioRunning, undefined, { timeout: 30_000 });
  expect((await testState(page)).pauseReasons).toEqual(['menu']);
  const c0 = (await fs(page)).count;
  await win.locator(`[data-footsteps="${free[1]}"] [data-hud="footsteps-choose"]`).click();
  await expect.poll(async () => (await fs(page)).set).toBe(free[1]);
  expect((await fs(page)).count).toBeGreaterThan(c0);
  await expect(win.locator(`[data-footsteps="${free[1]}"][data-state="on"]`)).toBeVisible();
  // A set by an ad cannot be chosen before its ad.
  expect((await fs(page)).ads).toEqual([]);

  // The ad: the game and the sound stand while it runs; the reward opens the set for ever and puts it on.
  await win.locator(`[data-footsteps="${ads[0]}"] [data-hud="footsteps-ad"]`).click();
  await page.waitForFunction(() => {
    const s = window.__TEST__!.state();
    return s.footsteps!.busy !== null && s.pauseReasons.includes('ad') && !s.audioRunning;
  }, undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__TEST__!.state().footsteps!.busy === null, undefined, { timeout: 30_000 });
  const f = await fs(page);
  expect(f.ads).toEqual([ads[0]]);
  expect(f.set).toBe(ads[0]);
  expect((await testState(page)).pauseReasons).toEqual(['menu']);
  await expect(win.locator(`[data-footsteps="${ads[0]}"][data-state="on"]`)).toBeVisible();
  await expect(win.locator('[data-hud="footsteps-ad"]')).toHaveCount(1);
  const resume = await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'ad_resume_ok').map((e) => e.params));
  expect(resume).toEqual([{ placement: 'footsteps', type: 'rewarded' }]);
  // Closed: the game goes on, the sound with it.
  await page.locator('[data-hud="win-close"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().window === null && window.__TEST__!.state().pauseReasons.length === 0, undefined, { timeout: 10_000 });
});

test('the footsteps volume slider applies at once and survives F5 with the set and the opened ones', async ({ page, openGame }) => {
  await openGame('pace=open&mock_ad=ok');
  await openFootsteps(page);
  const slider = page.locator('[data-hud="footsteps-volume"]');
  await expect(slider).toHaveValue(String(Math.round(steps.volume * 100)));
  await slider.fill('70');
  await expect(page.locator('[data-role="window"] [data-role="footsteps-volume"]')).toHaveText('70%');
  await expect.poll(async () => (await fs(page)).volume).toBeCloseTo(0.7, 5);
  await page.locator(`[data-footsteps="${ads[1]}"] [data-hud="footsteps-ad"]`).click();
  await page.waitForFunction((id) => window.__TEST__!.state().footsteps!.set === id && window.__TEST__!.state().footsteps!.busy === null, ads[1], { timeout: 30_000 });
  await page.reload();
  await waitReady(page);
  const f = await fs(page);
  expect(f.volume).toBeCloseTo(0.7, 5);
  expect(f.set).toBe(ads[1]);
  expect(f.ads).toEqual([ads[1]]);
  await openFootsteps(page);
  await expect(page.locator('[data-hud="footsteps-volume"]')).toHaveValue('70');
  await expect(page.locator(`[data-footsteps="${ads[1]}"][data-state="on"]`)).toBeVisible();
});

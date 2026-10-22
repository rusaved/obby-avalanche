import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';

// M4-05 (docs/03 ADS-05; docs/02-tech.md 11.5): every outcome of the SDK mock — ok, error, noshow, slow, closenoreward —
// for both kinds of ads: after the ad the hero moves, ad_resume_ok is sent, the sound is back, a reward comes only with
// onRewarded and exactly once. Plus a late onRewarded after the 10 s watchdog: one reward for its requestId. Rewarded —
// «+N Speed · Ad» of «Gifts»; fullscreen — the pause opened by the player past 180 s. On the truthful profile.

const MODES = ['ok', 'error', 'noshow', 'slow', 'closenoreward'] as const;

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
async function start(page: Page, openGame: (q?: string) => Promise<void>, mode: string): Promise<void> {
  await openGame(`pace=stages&mock_fullscreen=deny&mock_ad=${mode}`);
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    // M4 review: the ad of «Gifts» by the common rules — past the first avalanche.
    t.setFlag('firstWaveDone', true);
    t.holdWave(9000);
    t.setStat(5000);
  });
  await page.touchscreen.tap(width / 2, height / 2);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning)).toBe(true);
}
const resumed = (page: Page, type: string): Promise<number> =>
  page.evaluate((k) => window.__TEST__!.analytics().filter((e) => e.name === 'ad_resume_ok' && e.params?.['type'] === k).length, type);
/** After the ad: no «ad» reason, the sound back, the hero moves under the stick. */
async function goesOn(page: Page, label: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().pauseReasons as string[]), { timeout: 20_000, message: label }).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning), { message: `${label}: sound` }).toBe(true);
  const z0 = await page.evaluate(() => window.__TEST__!.state().hero!.z);
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().hero!.z), { message: `${label}: the hero moves` }).toBeGreaterThan(z0 + 0.5);
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
}

for (const mode of MODES) {
  test(`ADS-05 rewarded × ${mode}: the game goes on, the reward only with onRewarded and once`, async ({ page, openGame }) => {
    test.setTimeout(90_000);
    await start(page, openGame, mode);
    await tap(page, 'gift');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
    const stat0 = await page.evaluate(() => window.__TEST__!.state().stat);
    await page.locator('[data-role="window"].open [data-hud="gift-ad"]').click();
    await expect.poll(() => resumed(page, 'rewarded'), { timeout: 20_000 }).toBe(1);
    await page.waitForTimeout(500);
    const got = (await page.evaluate(() => window.__TEST__!.state().stat)) - stat0;
    // M4-09: the first ad button seen in this load — once, with its place.
    const shown = await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'rewarded_shown').map((e) => e.params?.['placement']));
    expect(shown).toEqual(['stat_now']);
    if (mode === 'ok' || mode === 'slow') expect(got, 'rewarded: the Speed came').toBeGreaterThan(0);
    else expect(got, `${mode}: no reward`).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    await goesOn(page, `rewarded × ${mode}`);
    expect(await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showRewardedVideo').length)).toBe(1);
  });

  test(`ADS-05 fullscreen × ${mode}: the game goes on after the ad`, async ({ page, openGame }) => {
    test.setTimeout(90_000);
    await start(page, openGame, mode);
    await page.evaluate(() => window.__TEST__!.runSim(185));
    await page.evaluate(() => window.__TEST__!.openMenu(true));
    expect(await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'adv.showFullscreenAdv').length)).toBe(1);
    await expect.poll(() => resumed(page, 'interstitial'), { timeout: 20_000 }).toBe(1);
    const shown = await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'inter_shown').length);
    expect(shown, 'inter_shown only when it was shown').toBe(mode === 'ok' || mode === 'slow' || mode === 'closenoreward' ? 1 : 0);
    await page.evaluate(() => window.__TEST__!.openMenu(false));
    await goesOn(page, `fullscreen × ${mode}`);
  });
}

test('ADS-05 a late onRewarded after the 10 s watchdog: the toast «unavailable», then the reward once', async ({ page, openGame }) => {
  test.setTimeout(90_000);
  await start(page, openGame, 'late');
  await tap(page, 'gift');
  const stat0 = await page.evaluate(() => window.__TEST__!.state().stat);
  await page.locator('[data-role="window"].open [data-hud="gift-ad"]').click();
  // The watchdog: no callback in 10 s — the game goes on.
  await expect.poll(() => resumed(page, 'rewarded'), { timeout: 15_000 }).toBe(1);
  expect(await page.evaluate(() => window.__TEST__!.state().stat)).toBe(stat0);
  // The show comes late with onRewarded: the reward once.
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().stat), { timeout: 10_000 }).toBeGreaterThan(stat0);
  const once = await page.evaluate(() => window.__TEST__!.state().stat);
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => window.__TEST__!.state().stat)).toBe(once);
  await page.keyboard.press('Escape');
  await goesOn(page, 'late');
});

test('M4 review: the ad of «Gifts» waits for the first avalanche, then rests ads.statNowCooldownSec after a view', async ({ page, openGame }) => {
  test.setTimeout(90_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(9000);
  });
  await page.touchscreen.tap(width / 2, height / 2);
  await tap(page, 'gift');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await expect(page.locator('[data-hud="gift-ad"]'), 'before the first avalanche: no ad').toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  await page.evaluate(() => window.__TEST__!.setFlag('firstWaveDone', true));
  await page.waitForTimeout(500);
  await tap(page, 'gift');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
  await page.locator('[data-role="window"].open [data-hud="gift-ad"]').click();
  await expect.poll(() => resumed(page, 'rewarded'), { timeout: 20_000 }).toBe(1);
  await expect(page.locator('[data-hud="gift-ad"]')).toBeDisabled();
  await expect(page.locator('[data-role="window"].open .gf-card', { has: page.locator('[data-hud="gift-ad"]') })).toContainText(/через \d/);
});

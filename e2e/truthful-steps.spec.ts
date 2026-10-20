import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import sfxJson from '../content/avalanche/sfx.json' with { type: 'json' };

// MU round 4, item 6 (producer 20.10: «Velvet snow» bought, never heard). A set bought in «Shop → Steps» without a preview
// is chosen at once and plays: the steps of a run come from its files — and after a reload too. The sets differ by ear:
// each has its own files and its own pitch (sfx.json `semitones`). On the truthful profile.

const sets = sfxJson.footsteps.sets as Array<{ id: string; files: string[]; semitones?: number; unlock: string; currency?: string }>;
const velvet = sets.find((s) => s.id === 'velvet_snow')!;
const dir = (f: string): string => f.slice(0, f.lastIndexOf('/') + 1);

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

/** A run up holding the stick: the last step heard after a few. */
async function run(page: Page): Promise<{ last: string | null; set: string; heard: number }> {
  const before = await page.evaluate(() => window.__TEST__!.state().footsteps!.count);
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  await page.waitForFunction((n) => window.__TEST__!.state().footsteps!.count >= n + 3, before, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  const f = await page.evaluate(() => window.__TEST__!.state().footsteps!);
  return { last: f.last, set: f.set, heard: f.count - before };
}

test('the sets differ: own files and own pitch for each', () => {
  const dirs = new Set(sets.map((s) => dir(s.files[0]!)));
  expect(dirs.size, 'own files').toBe(sets.length);
  const pitches = new Set(sets.map((s) => s.semitones ?? 0));
  expect(pitches.size, 'own pitch').toBe(sets.length);
  for (const a of sets) for (const b of sets) if (a !== b) expect(Math.abs((a.semitones ?? 0) - (b.semitones ?? 0)), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(2);
});

test('«Velvet snow» bought in the shop without a preview: chosen at once, the steps are its own — after a reload too', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setCoins(5300);
  });
  await page.touchscreen.tap(width / 2, height / 2);
  await page.waitForFunction(() => window.__TEST__!.state().audioRunning, undefined, { timeout: 20_000 });
  const first = await run(page);
  expect(first.last, 'the free set plays first').toMatch(new RegExp(`^${dir(sets[0]!.files[0]!)}`));
  // The shop, «Steps», «Buy» on «Velvet snow» — no preview tapped.
  await tap(page, 'menu-shop');
  await page.locator('[data-hud="shop-tab-steps"]').click();
  await page.locator(`[data-role="window"].open [data-item="${velvet.id}"] [data-hud="shop-item"]`).click();
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().footsteps!.set)).toBe(velvet.id);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  await waitTicks(page, 30);
  const bought = await run(page);
  expect(bought.set).toBe(velvet.id);
  expect(bought.last, 'the bought set is heard').toMatch(new RegExp(`^${dir(velvet.files[0]!)}`));
  // After a reload: still chosen and heard.
  await waitTicks(page, 30);
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.holdWave(900));
  await page.touchscreen.tap(width / 2, height / 2);
  await page.waitForFunction(() => window.__TEST__!.state().audioRunning, undefined, { timeout: 20_000 });
  const again = await run(page);
  expect(again.set).toBe(velvet.id);
  expect(again.last, 'heard after a reload').toMatch(new RegExp(`^${dir(velvet.files[0]!)}`));
});

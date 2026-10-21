import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { scaleText } from './mu-checks.ts';
import { threshold } from './lv-stage-data.ts';

// MU round 5, item 8: the frames of the round at 880 × 405 and 815 × 290, at 100 % and 130 % text — every window and every
// tab (walked from the interface, not listed by hand).

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/MU/r5/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};

test.beforeEach(({ page }) => {
  test.skip(page.viewportSize()!.width === 915, 'the frames of round 5: 880 × 405 and 815 × 290');
});

for (const k of [1, 1.3]) {
  test(`every window and tab at ${Math.round(k * 100)} %`, async ({ page, openGame }) => {
    test.setTimeout(300_000);
    await openGame('pace=stages&mock_fullscreen=deny');
    const { width, height } = page.viewportSize()!;
    await page.evaluate((s) => {
      const t = window.__TEST__!;
      t.setPlaySec(400);
      t.setCoins(5300);
      t.setTrophies(3);
      t.holdWave(900);
      t.setStat(s);
      for (const id of ['penguin', 'bunny', 'seal', 'fox', 'owl', 'bullfinch']) t.givePet(id);
    }, threshold(30));
    await page.touchscreen.tap(width / 2, height / 2);
    await page.waitForTimeout(300);
    const dir = dirOf(page);
    const hud = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.hud [data-hud]'))
        .filter((e) => e.offsetParent !== null && /^(gift|pause|menu-.+)$/.test(e.dataset['hud']!))
        .map((e) => e.dataset['hud']!),
    );
    await tap(page, 'menu-more');
    const more = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open [data-hud^="more-"]')).map((e) => e.dataset['hud']!));
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    await page.waitForTimeout(300);
    const ways: Array<[string, () => Promise<void>]> = [
      ...hud.map((id): [string, () => Promise<void>] => [id, () => tap(page, id)]),
      ...more.map((id): [string, () => Promise<void>] => [id, async () => { await tap(page, 'menu-more'); await page.locator(`[data-hud="${id}"]`).click(); }]),
    ];
    let shots = 0;
    for (const [name, open] of ways) {
      await open();
      await expect(page.locator('[data-role="window"].open'), name).toHaveCount(1);
      const tabs = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open .win-tabs [data-hud]')).map((e) => e.dataset['hud']!));
      for (const tab of tabs.length ? tabs : [null]) {
        if (tab) await page.locator(`[data-role="window"].open [data-hud="${tab}"]`).click();
        if (k > 1) await scaleText(page, k);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${dir}/w-${name.replace(/^(menu|more)-/, '')}${tab ? `-${tab.replace(/^.*-tab-/, '')}` : ''}${k > 1 ? '-130' : ''}.png` });
        shots++;
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
      if (k > 1) await scaleText(page, 1);
    }
    expect(shots).toBeGreaterThan(14);
  });
}


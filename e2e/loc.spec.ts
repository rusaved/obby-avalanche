import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { threshold } from './lv-stage-data.ts';

// M4-08 (docs/03 LOC-; docs/01a section 11): ru and en from the SDK language (?mock_lang=en) — at 640 × 360 no button
// overflows its box in either language, in the HUD and in every window; key screens shot in docs/evidence/M4/loc/.

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
const overflow = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, [data-hud]'))
      .filter((b) => b.offsetParent !== null && b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden')
      .filter((b) => b.scrollWidth > b.clientWidth + 1)
      .map((b) => `${b.dataset['hud'] ?? b.className}: «${(b.textContent ?? '').trim().slice(0, 30)}» ${b.scrollWidth}>${b.clientWidth}`),
  );

for (const lang of ['ru', 'en'] as const) {
  test(`LOC-01 ${lang} at 640×360: no button overflows, in the HUD and every window`, async ({ page, openGame }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 640, height: 360 });
    await openGame(`pace=stages&mock_lang=${lang}&mock_fullscreen=deny`);
    await page.evaluate((s) => {
      const t = window.__TEST__!;
      t.setPlaySec(400);
      t.setCoins(5300);
      t.holdWave(9000);
      t.setStat(s);
    }, threshold(3));
    await page.mouse.click(320, 180);
    await page.waitForTimeout(500);
    const dir = `docs/evidence/M4/loc/${lang}`;
    mkdirSync(dir, { recursive: true });
    expect(await overflow(page), 'HUD').toEqual([]);
    await page.screenshot({ path: `${dir}/hud.png` });
    const hud = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.hud [data-hud]'))
        .filter((e) => e.offsetParent !== null && /^(gift|pause|menu-.+)$/.test(e.dataset['hud']!))
        .map((e) => e.dataset['hud']!),
    );
    await tap(page, 'menu-more');
    const more = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open [data-hud^="more-"]')).map((e) => e.dataset['hud']!));
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    for (const id of [...hud, ...more]) {
      if (id.startsWith('more-')) {
        await tap(page, 'menu-more');
        await page.locator(`[data-hud="${id}"]`).click();
      } else await tap(page, id);
      await expect(page.locator('[data-role="window"].open'), id).toHaveCount(1);
      await page.waitForTimeout(250);
      const tabs = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-role="window"].open .win-tabs [data-hud]')).map((e) => e.dataset['hud']!));
      for (const tab of tabs.length ? tabs : [null]) {
        if (tab) await page.locator(`[data-role="window"].open [data-hud="${tab}"]`).click();
        await page.waitForTimeout(200);
        expect(await overflow(page), `${id}${tab ? ` · ${tab}` : ''}`).toEqual([]);
        await page.screenshot({ path: `${dir}/${id}${tab ? `-${tab}` : ''}.png` });
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
    }
  });
}

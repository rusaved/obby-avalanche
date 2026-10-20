import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { scaleText } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round 4, item 8: the frames of the round at 880 × 405 and 815 × 290, at 100 % and 130 % text — every window and every
// tab (walked from the interface, not listed by hand), the pad of stage 3 from 20 m and 8 m, the base from the arrival and
// at the arch, the row of the HUD with a stub of the sticky banner on the right (the frame squeezed by 160 px).

const W = STAGES[0]!;
async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/MU/r4/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};

test.beforeEach(({ page }) => {
  test.skip(page.viewportSize()!.width === 915, 'the frames of round 4: 880 × 405 and 815 × 290');
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

test('l3: the pad of stage 3 from 20 m (no plaque) and from 8 m (the plaque)', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  const st = W.stages[2]!;
  await page.evaluate(([s]) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
  }, [threshold(st.level + 2)] as const);
  await page.touchscreen.tap(width / 2, height / 2);
  const dir = dirOf(page);
  for (const d of [20, 8]) {
    await page.evaluate(([z, x, y]) => window.__TEST__!.teleport(z, x, y), [st.pad.z - d, st.pad.x * 0.85, st.y + 1] as const);
    await waitTicks(page, 30);
    await page.waitForTimeout(700);
    const shown = await page.locator('[data-role="pad-label"]').evaluate((e) => e.classList.contains('shown') && (e as HTMLElement).style.visibility !== 'hidden');
    expect(shown, `the plaque at ${d} m`).toBe(d < 12);
    await page.screenshot({ path: `${dir}/l3-pad-${d}m.png` });
  }
});

test('the base: from the arrival and at the arch of its portal', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
  }, threshold(30));
  await page.touchscreen.tap(width / 2, height / 2);
  const dir = dirOf(page);
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/l5-camp-far.png` });
  const own = (await page.evaluate(() => window.__TEST__!.state().basePortals)).find((p) => p.state === 'own')!;
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [own.x - 7 * Math.sin(own.yaw), own.z - 7 * Math.cos(own.yaw)] as const);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/l5-camp-arch.png` });
});

test('the row of the HUD in a frame squeezed by a sticky banner on the right (a stub of 160 px)', async ({ page, openGame }) => {
  const STUB = 160;
  await page.addInitScript((stub) => {
    const fake = new EventTarget();
    Object.defineProperties(fake, {
      width: { get: () => window.innerWidth - stub },
      height: { get: () => window.innerHeight },
      offsetLeft: { value: 0 },
      offsetTop: { value: 0 },
      pageLeft: { value: 0 },
      pageTop: { value: 0 },
      scale: { value: 1 },
    });
    Object.defineProperty(window, 'visualViewport', { get: () => fake });
    addEventListener('DOMContentLoaded', () => {
      const b = document.createElement('div');
      b.style.cssText = `position:fixed;top:0;right:0;width:${stub}px;height:100%;background:repeating-linear-gradient(45deg,#d8dde3 0 12px,#c5ccd4 12px 24px);z-index:99;display:flex;align-items:center;justify-content:center;font:600 14px sans-serif;color:#556`;
      b.textContent = 'banner 160';
      document.body.appendChild(b);
    });
  }, STUB);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(([s, z]) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
    window.__TEST__!.setCoins(5300);
    window.__TEST__!.teleport(z);
  }, [threshold(3), W.stages[2]!.start + 20] as const);
  await page.touchscreen.tap((width - STUB) / 2, height / 2);
  await page.waitForFunction(() => document.querySelector('.hud')?.classList.contains('strip-off') ?? false, undefined, { timeout: 10_000 });
  await page.waitForTimeout(400);
  expect(await page.locator('#game').boundingBox()).toMatchObject({ width: width - STUB });
  await page.screenshot({ path: `${dirOf(page)}/hud-banner-stub.png` });
});

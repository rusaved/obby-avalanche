import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import petsJson from '../content/avalanche/pets.json' with { type: 'json' };
import skinsJson from '../content/avalanche/skins.json' with { type: 'json' };
import { STAGES } from './lv-stage-data.ts';

// M5-05, M5-05b (docs/01a-content.md 5–8): every pet, skin and wings of the release is drawn without errors (the fixture
// fails on any console error), the windows of the content on the phone (880 × 405, 815 × 290) and one contact sheet
// docs/evidence/M5/content.png — the figures in every skin and every wings, the windows of pets, shop and wardrobe.
const pets = (petsJson as { pets: Array<{ id: string }> }).pets.map((p) => p.id);
const skins = (skinsJson as { skins: Array<{ id: string }> }).skins.map((s) => s.id);
const wings = (skinsJson as { wings: Array<{ id: string }> }).wings.map((w) => w.id);
const DIR = 'docs/evidence/M5';

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}
async function more(page: Page, id: string): Promise<void> {
  await tap(page, 'menu-more');
  await page.locator(`[data-hud="more-${id}"]`).click();
}
async function closeWindow(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
}

for (const [w, h] of [[880, 405], [815, 290]] as const)
  test.describe(`${w} × ${h}`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    test(`M5-05: all ${pets.length} pets, ${skins.length} skins, ${wings.length} wings — windows and figures`, async ({ page, openGame }) => {
      test.setTimeout(180_000);
      mkdirSync(DIR, { recursive: true });
      await openGame('pace=stages&mock_device=mobile');
      await page.evaluate(([ids, z]) => {
        const t = window.__TEST__!;
        // On the slope of stage 3, away from the camp and its bots.
        t.teleport(z);
        t.setPlaySec(4000);
        t.setSummits(10);
        t.setTrophies(5000);
        t.setCoins(1e12);
        t.holdWave(9000);
        t.setFlag('firstWaveDone', true);
        t.setTutor(9);
        for (const id of ids) t.givePet(id);
      }, [pets, STAGES[0]!.stages[2]!.start + 4] as const);
      await waitTicks(page, 20);
      const frames: Array<[string, Buffer]> = [];
      const shot = async (name: string): Promise<void> => {
        const buf = await page.screenshot({ path: `${DIR}/${w}x${h}/${name}.png` });
        frames.push([name, buf]);
      };
      mkdirSync(`${DIR}/${w}x${h}`, { recursive: true });
      // The figures: skins by 6, then every wings on the default skin.
      for (let i = 0; i < skins.length; i += 6) {
        await page.evaluate((ids) => window.__TEST__!.showLineup(ids, []), skins.slice(i, i + 6));
        await waitTicks(page, 10);
        await shot(`figures-skins-${i / 6 + 1}`);
      }
      for (let i = 0; i < wings.length; i += 6) {
        const part = wings.slice(i, i + 6);
        await page.evaluate(([ids, ws]) => window.__TEST__!.showLineup(ids, ws), [part.map((_, k) => skins[k % skins.length]!), part] as const);
        await waitTicks(page, 10);
        await shot(`figures-wings-${i / 6 + 1}`);
      }
      await page.evaluate(() => {
        window.__TEST__!.showLineup([], []);
        window.__TEST__!.setCamera('auto');
      });
      // The windows of the content.
      await tap(page, 'menu-pets');
      await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
      await page.waitForTimeout(250);
      await shot('win-pets');
      await closeWindow(page);
      for (const tab of ['shoes', 'eggs', 'trails', 'auras'] as const) {
        await tap(page, 'menu-shop');
        await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
        await page.locator(`[data-hud="shop-tab-${tab}"]`).click();
        await page.waitForTimeout(250);
        await shot(`win-shop-${tab}`);
        await closeWindow(page);
      }
      for (const tab of ['skins', 'wings'] as const) {
        await more(page, 'wardrobe');
        await expect(page.locator('[data-role="window"].open')).toHaveCount(1);
        await page.locator(`[data-hud="wardrobe-tab-${tab}"]`).click();
        await page.waitForTimeout(250);
        await shot(`win-wardrobe-${tab}`);
        await closeWindow(page);
      }
      expect((await page.evaluate(() => window.__TEST__!.state().pets.length))).toBeGreaterThanOrEqual(pets.length);
      // One contact sheet of the larger size: every frame in a grid of 3.
      if (w === 880) {
        const cells = frames.map(([n, b]) => `<figure><img src="data:image/png;base64,${b.toString('base64')}"><figcaption>${n}</figcaption></figure>`).join('');
        await page.setViewportSize({ width: 1340, height: 1000 });
        await page.setContent(`<style>body{margin:0;background:#1d2733;font:12px sans-serif;color:#cfe;display:grid;grid-template-columns:repeat(3,440px);gap:6px;padding:6px}figure{margin:0}img{width:440px;display:block}</style>${cells}`);
        await page.screenshot({ path: `${DIR}/content.png`, fullPage: true });
        expect(readFileSync(`${DIR}/content.png`).length).toBeGreaterThan(10_000);
      }
    });
  });

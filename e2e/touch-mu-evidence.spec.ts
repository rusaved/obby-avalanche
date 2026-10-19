import { mkdirSync } from 'node:fs';
import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { labelsOverHud, scaleText } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round of fixes, fix 8 (staff 19.10): every frame of docs/evidence/MU shot again after the fixes, at 812 × 375 and
// 915 × 412 with touch — the HUD with «+N» by the hero, the ridge, the finish, the level toast, the camp after a fall with
// «Ad: from stage N», the camp between mountains with its portals, every window, three windows at 130 % text, the
// rotate screen. Shots only (the rules are checked by touch-mu-hud, touch-mu-screens and touch-mu-rules).

const W = STAGES[0]!;

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

async function prepare(page: Page, stat: number): Promise<void> {
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.setTrophies(3);
    t.holdWave(900);
    t.setStat(s);
  }, stat);
  await page.touchscreen.tap(400, 200);
  await page.waitForTimeout(300);
}

async function closeWindow(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  await page.waitForTimeout(400);
}

for (const view of [{ width: 812, height: 375 }, { width: 915, height: 412 }]) {
  const dir = `docs/evidence/MU/${view.width}x${view.height}`;
  test.describe(`MU evidence ${view.width} × ${view.height}`, () => {
    test.use({ viewport: view });
    test.beforeAll(() => mkdirSync(dir, { recursive: true }));

    test('the run: HUD with «+N» by the hero, the ridge, the finish, the level toast', async ({ page, openGame }) => {
      test.setTimeout(180_000);
      await openGame('pace=stages');
      const st3 = W.stages[2]!;
      await prepare(page, threshold(st3.level + 1));
      // A run on the flat of stage 1 (on stage 3 a 1.5 s run ends in its first crack).
      await page.evaluate((z) => window.__TEST__!.teleport(z), W.stages[0]!.start + 60);
      await waitTicks(page, 10);
      await page.evaluate(() => window.__TEST__!.stick(0, 1));
      await page.waitForTimeout(1500);
      await page.locator('.hud-gain.show').first().waitFor({ state: 'visible', timeout: 10_000 });
      // Running, the hero's feet stand over «N Speed» and the bar (review: the camera lead sank him under them).
      const feet = await page.evaluate(() => {
        const t = window.__TEST__!;
        const h = t.state().hero!;
        return { feet: t.project(h.x, h.y, h.z).y, hud: document.querySelector('.hud-level')!.getBoundingClientRect().top };
      });
      expect(feet.hud - feet.feet, 'running feet over the speed line').toBeGreaterThanOrEqual(8);
      await page.screenshot({ path: `${dir}/l1-run-hud.png` });
      await page.evaluate(() => window.__TEST__!.stick(0, 0));
      const st4 = W.stages[3]!;
      await page.evaluate(([s, z]) => {
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z);
      }, [threshold(st4.level - 3), st4.z0 - 5] as const);
      await expect(page.locator('[data-role="need"]')).toHaveText(/Ещё 3 уровня до рубежа/);
      // After any toast of the stat jump (review: l2 was shot under «LEVEL UP!»): the plaque of the ridge in the slot.
      await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/l2-gate.png` });
      await page.evaluate(([s, z, x, y]) => {
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z, x, y);
      }, [threshold(st3.level + 2), st3.finish[0] - 6, st3.pad.x, st3.y + 1] as const);
      await expect(page.locator('[data-role="pad-label"].shown')).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/l3-stage-finish-before.png` });
      await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x, p.y + 1), st3.pad);
      await expect(page.locator('[data-role="toast"].shown .hud-toast-main svg')).toHaveCount(1, { timeout: 10_000 });
      await page.screenshot({ path: `${dir}/l3-stage-finish.png` });
      // Back in the camp after the button: the level toast.
      await page.waitForFunction(() => window.__TEST__!.state().stage <= 1, undefined, { timeout: 20_000 });
      await expect(page.locator('[data-role="toast"].shown')).toHaveCount(0, { timeout: 10_000 });
      // The toast comes on every 5th level.
      await page.evaluate((s) => window.__TEST__!.setStat(s), threshold(15) + 1);
      await expect(page.locator('[data-role="toast"].shown .hud-toast-main')).toHaveText('УРОВЕНЬ ВЫШЕ!', { timeout: 10_000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${dir}/l4-level-up.png` });
    });

    test('the camp after a fall: «Ad: from stage 2 · 0:5x» in the slot', async ({ page, openGame }) => {
      test.setTimeout(180_000);
      await openGame('pace=stages&mock_ad=ok');
      await page.evaluate(() => window.__TEST__!.setPlaySec(61));
      await page.evaluate(() => window.__TEST__!.setTimeScale(8));
      await page.evaluate(() => window.__TEST__!.triggerWave());
      await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      await prepare(page, threshold(6));
      const st2 = W.stages[1]!;
      const fall = async (): Promise<void> => {
        await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [st2.start + 2, -60] as const);
        await page.waitForFunction(() => window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
        await page.waitForFunction(() => !window.__TEST__!.state().caught, undefined, { timeout: 20_000 });
      };
      await fall();
      // The first of a mountain is free: take it, fall again — now the rewarded ad.
      await page.locator('button.hud-ad[data-ad=continue_free]').click();
      await waitTicks(page, 10);
      await fall();
      await expect(page.locator('button.hud-ad[data-ad=continue_here]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.hud-mountain-label')).toHaveText('Лагерь · гора 1');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/l5-camp-ad.png` });
    });

    test('the camp between mountains: portals with their plaques; the summit window', async ({ page, openGame }) => {
      test.setTimeout(180_000);
      await openGame('pace=stages');
      await prepare(page, threshold(30));
      const last = W.stages[W.stages.length - 1]!;
      const portal = W.segments.find((s) => s.type === 'portal')!;
      await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
      await waitTicks(page, 10);
      await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
      await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
      await page.evaluate(() => window.__TEST__!.botPath(null));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/w-summit.png` });
      await page.locator('[data-hud="win-next"]').click();
      await page.waitForFunction(() => window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.botPath(null));
      await expect(page.locator('[data-role="window"].open')).toHaveCount(0, { timeout: 20_000 });
      // Up to the arches, as l5: 9 units in front of the own portal — the phone camera lays the slope further off into the
      // top band of the HUD, the plaques read near the arches (docs/допущения.md 97).
      const own = (await page.evaluate(() => window.__TEST__!.state().basePortals)).find((p) => p.state === 'own')!;
      await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [own.x - 9 * Math.sin(own.yaw), own.z - 9 * Math.cos(own.yaw)] as const);
      await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__TEST__!.botPath(null));
      await page.waitForTimeout(1500);
      // At least one portal plaque reads here, none of them under the HUD.
      expect(await page.locator('[data-role="portal-label"].shown').evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.visibility !== 'hidden').length)).toBeGreaterThan(0);
      expect(await labelsOverHud(page)).toEqual([]);
      await page.screenshot({ path: `${dir}/l5-camp-portals.png` });
    });

    test('every window, three of them at 130 % text, the rotate screen', async ({ page, openGame }) => {
      test.setTimeout(240_000);
      await openGame('pace=stages');
      await prepare(page, threshold(30));
      const more = (id: string) => async (): Promise<void> => {
        await tap(page, 'menu-more');
        await page.locator(`[data-hud="more-${id}"]`).click();
      };
      const windows: Array<[string, () => Promise<void>]> = [
        ['gifts', () => tap(page, 'gift')],
        ['camp-teleport', () => tap(page, 'menu-teleport')],
        ['pause', () => tap(page, 'pause')],
        ['more', () => tap(page, 'menu-more')],
        ['shop', () => tap(page, 'menu-shop')],
        ['shop-steps', async () => { await tap(page, 'menu-shop'); await page.locator('[data-hud="shop-tab-steps"]').click(); }],
        ['pets', () => tap(page, 'menu-pets')],
        ['footsteps', more('footsteps')],
        ['wardrobe', more('wardrobe')],
        ['rebirth', more('rebirth')],
        ['records', more('records')],
        ['quests', more('quests')],
        ['daily', more('daily')],
        ['promo', async () => { await tap(page, 'pause'); await page.locator('[data-hud="promo"]').click(); }],
      ];
      for (const [id, open] of windows) {
        await open();
        await expect(page.locator('[data-role="window"].open')).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${dir}/w-${id}.png` });
        await closeWindow(page);
      }
      // The rotate screen at the text of 100 % (review: shot after the 130 % it showed a 31 px title).
      await page.setViewportSize({ width: view.height, height: view.width });
      await expect(page.locator('[data-role="rotate"].shown')).toBeVisible();
      await page.screenshot({ path: `${dir}/p1-rotate.png` });
      await page.setViewportSize(view);
      await expect(page.locator('[data-role="rotate"].shown')).toHaveCount(0);
      // Every window at 130 % text (the brief asks «Gifts», «Calendar» and «Shop»; the review asked all of them).
      for (const [id, open] of windows) {
        await open();
        await expect(page.locator('[data-role="window"].open')).toBeVisible();
        await scaleText(page, 1.3);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${dir}/w-${id}-130.png` });
        await closeWindow(page);
      }
    });
  });
}

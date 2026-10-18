import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// LV-12 (the usability review): on a phone in landscape the windows stand over the HUD and their buttons are on the
// screen; in portrait «Turn your phone» covers the game; the tutorial step sits over the Speed plaque, clear of the goal.
test.use({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true });
test('812×375: the pause window over the HUD with its buttons on the screen; the footsteps window OK visible', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_device=mobile');
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.openMenu(true));
  const win = page.locator('[data-role=window]');
  await expect(win).toBeVisible();
  const cont = (await win.locator('[data-hud=continue]').boundingBox())!;
  expect(cont.y + cont.height, '«Continue» on the screen').toBeLessThanOrEqual(375 + 0.5);
  // Nothing of the HUD over the window: the topmost element at the middle of each window button is the button.
  const covered = await page.evaluate(() =>
    [...document.querySelectorAll('[data-role=window] button')].filter((b) => {
      const r = b.getBoundingClientRect();
      if (r.width === 0) return false;
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!top && !b.contains(top) && !top.closest('[data-role=window]');
    }).length,
  );
  expect(covered, 'window buttons under the HUD').toBe(0);
  await page.screenshot({ path: 'docs/evidence/lv/ux-pause-812.png' });
});

test('375×812 portrait: «Turn your phone» over the game', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_device=mobile');
  await waitTicks(page, 5);
  await page.setViewportSize({ width: 375, height: 812 });
  const rot = page.locator('[data-role=rotate]');
  await expect(rot).toBeVisible();
  await expect(rot).toContainText(/Поверни|Turn/);
  await page.screenshot({ path: 'docs/evidence/lv/ux-portrait.png' });
});

test('812×375: the tutorial step in the message slot under the stage strip (MU-02), the goal line gone', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_device=mobile');
  await waitTicks(page, 10);
  const s2 = STAGES[0]!.stages[1]!;
  await page.evaluate(() => window.__TEST__!.setPlaySec(61));
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s2.finish[0] + 2, s2.y] as const);
  const tutor = page.locator('[data-role=tutor]');
  await expect(tutor).toBeVisible();
  const t = (await tutor.boundingBox())!;
  const strip = (await page.locator('[data-role=mountain]').boundingBox())!;
  expect(t.y, 'under the strip').toBeGreaterThanOrEqual(strip.y + strip.height);
  expect(Math.abs(t.y - 50), 'the slot at the top 50').toBeLessThanOrEqual(3);
  const stat = (await page.locator('[data-role=stat]').boundingBox())!;
  expect(t.y + t.height, 'over the Speed').toBeLessThan(stat.y);
  await expect(page.locator('.hud-goal')).toBeHidden();
  await page.screenshot({ path: 'docs/evidence/lv/ux-tutor-812.png' });
});

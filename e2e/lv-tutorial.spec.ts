import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';

// LV-11 (docs/01-gdd.md 22.12): on a fresh save the stage tutorial goes «Run to the reward» → «Take the trophies» → «+3
// levels», each gone by its own action; the teleport pad of the camp opens the stages passed — one costs its trophies and
// puts the hero on its flag, the pets stay with him; a stage not passed is locked.
const W = STAGES[0]!;
const s2 = W.stages[1]!;
const s3 = W.stages[2]!;
test('the stage tutorial step by step, then the camp teleport to a passed stage for its trophies', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  await ready(page);
  const tutor = page.locator('[data-role=tutor]');
  // 1. Past the first minute, on the giant's stage: «Run to the reward».
  const f2 = flagOf(1, s2);
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(s3.level) * 0.5, f2.z, f2.y] as const);
  await expect(tutor).toBeVisible();
  await expect(tutor).toContainText(/Каждый шаг даёт Скорость|Every step gives Speed/);
  // 2. In the safe finish: «Take the trophies».
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s2.finish[0] + 2, s2.y] as const);
  await expect(tutor).toContainText(/Встань на площадку|Step on the pad/);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [s2.pad.x, s2.pad.z] as const);
  await page.waitForFunction(() => window.__TEST__!.state().padsTaken >= 1, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  // 3. «+3 levels», gone with three more levels.
  await expect(tutor).toContainText(/3 уровня|3 more levels/);
  await page.screenshot({ path: 'docs/evidence/lv/tutor-levels.png' });
  const lv = await page.evaluate(() => window.__TEST__!.state().stat);
  await page.evaluate((s) => window.__TEST__!.setStat(s), lv * 1.18 ** 3.2);
  await expect(tutor).toBeHidden();
  expect((await testState(page)).tutor).toBe(3);

  // The camp teleport: stage 3 reached, back in the camp, onto the pad.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s3.start + 2, s3.y] as const);
  await page.waitForFunction((n) => window.__TEST__!.state().stageBest >= n, s3.n);
  await page.evaluate(() => window.__TEST__!.givePet('bunny'));
  await page.evaluate((c) => window.__TEST__!.setCoins(c), s3.trophies + 5);
  await page.evaluate(() => window.__TEST__!.teleport(8, 0, 0.5));
  await waitTicks(page, 10);
  const pets0 = await testState(page);
  await page.evaluate(() => window.__TEST__!.botPath([[20, 20]]));
  const win = page.locator('[data-role=window]');
  await expect(win).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await expect(win.locator(`.tp-item[data-stage="${s3.n}"]`)).toBeEnabled();
  await expect(win.locator(`.tp-item[data-stage="${s3.n + 2}"]`)).toBeDisabled();
  await page.screenshot({ path: 'docs/evidence/lv/camp-teleport.png' });
  // The first tap arms it («Yes, for N»), the second pays.
  await win.locator(`.tp-item[data-stage="${s3.n}"]`).click();
  await expect(win.locator(`.tp-item[data-stage="${s3.n}"]`)).toHaveClass(/armed/);
  await win.locator(`.tp-item[data-stage="${s3.n}"]`).click();
  await waitTicks(page, 10);
  const s = await testState(page);
  expect(Math.abs(s.hero!.z - flagOf(1, s3).z)).toBeLessThanOrEqual(4);
  expect(s.coins).toBe(5);
  expect(s.petsOn).toEqual(pets0.petsOn);
  expect(s.petsShown).toBe(pets0.petsShown);
});

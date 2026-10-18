import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';
import type { Page } from '@playwright/test';

// SD-13 (producer 16.10: «it worked once, then broke and does not work»): the teleport pad of the camp puts the hero on
// the stage he picks every time — 10 in a row to different stages, after the trophy button and the flight to the camp,
// after a fall, after a reload of the page. The cause found: on the next mountain the pad stood dead (no window, no
// label) until its own stage 2 — now it opens there too, the stages not passed locked.
const W = STAGES[0]!;
const W2 = STAGES[1]!;
const PAD = { x: 20, z: 20 };

/** From the camp onto the pad, the window, stage n tapped twice; the hero ends at its flag. */
async function viaPad(page: Page, n: number, world = 1): Promise<void> {
  const st = STAGES[world - 1]!.stages.find((s) => s.n === n)!;
  const win = page.locator('[data-role=window]');
  await expect(win, `stage ${n}: no window left open`).toBeHidden();
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [PAD.x, PAD.z] as const);
  await expect(win, `stage ${n}: the window on the pad`).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  const item = win.locator(`.tp-item[data-stage="${n}"]`);
  await expect(item, `stage ${n}: open`).toBeEnabled();
  await item.click();
  await expect(item).toHaveClass(/armed/);
  await item.click();
  await expect(win).toBeHidden();
  await waitTicks(page, 20);
  const s = await testState(page);
  expect(Math.abs(s.hero!.z - flagOf(world, st).z), `stage ${n}: at its flag (z ${s.hero!.z})`).toBeLessThanOrEqual(4);
}

/** Back in the camp by the test hook, a little off the pad. */
async function toCamp(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.teleport(8, 0, 0.5));
  await waitTicks(page, 10);
}

test('SD-13: the camp teleport 10 times in a row, after the trophy button, after a fall and after a reload', async ({ page, openGame }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  await ready(page);
  // Every stage of mountain 1 reached once, coins for every price.
  const last = W.stages[W.stages.length - 1]!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(last.level) * 1.2, last.start + 2, last.y] as const);
  await page.waitForFunction((n) => window.__TEST__!.state().stageBest >= n, last.n);
  await page.evaluate(() => window.__TEST__!.setCoins(1e9));

  // 10 in a row, a different stage each time, back to the camp between.
  const order = [3, 7, 2, 10, 5, 9, 4, 8, 6, 3].filter((n) => n <= last.n);
  for (const n of order) {
    await toCamp(page);
    await viaPad(page, n);
  }
  // After the trophy button of a stage and the flight to the camp.
  const s4 = W.stages.find((s) => s.n === 4)!;
  await toCamp(page);
  await viaPad(page, 4);
  // Run up its body by the hook (its trial is not the point here), the last steps to the button on foot.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s4.finish[0] + 2, s4.y] as const);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [s4.pad.x, s4.pad.z] as const);
  await page.waitForFunction(() => window.__TEST__!.state().padsTaken >= 1, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForFunction(() => window.__TEST__!.state().hero!.z < 40, undefined, { timeout: 20_000 });
  await waitTicks(page, 20);
  await viaPad(page, 6);
  // After a fall: below the floor of stage 6, the snowball, then the camp.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [W.stages.find((s) => s.n === 6)!.start + 6, -200] as const);
  await page.waitForFunction(() => window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__TEST__!.state().caught === null, undefined, { timeout: 30_000 });
  await toCamp(page);
  await viaPad(page, 8);
  // After a reload: the save keeps the stages reached and the coins.
  await waitTicks(page, 60);
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  await waitTicks(page, 10);
  await toCamp(page);
  await viaPad(page, 5);
  await page.screenshot({ path: 'docs/evidence/sd/teleport-after-reload.png' });

  // The next mountain, nothing passed on it yet: the pad answers, every stage locked; its stage 3 reached — it teleports.
  await page.evaluate(() => window.__TEST__!.gotoWorld(2));
  await waitTicks(page, 30);
  await toCamp(page);
  const win = page.locator('[data-role=window]');
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [PAD.x, PAD.z] as const);
  await expect(win, 'mountain 2: the window on the pad before its stage 2').toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await expect(win.locator('.tp-item').first()).toBeDisabled();
  await expect(win.locator('.tp-item').first()).toContainText(/ещё не пройден|not passed yet/);
  // MU-07 (rule 13): the HUD under an open window is hidden, the pad label with it; back once the window is closed.
  await expect(page.locator('[data-role=pad-label]')).toBeHidden();
  await page.screenshot({ path: 'docs/evidence/sd/teleport-next-mountain.png' });
  await page.locator('[data-hud=win-close]').click();
  await expect(page.locator('[data-role=pad-label]')).toBeVisible();
  const m2s3 = W2.stages.find((s) => s.n === 3)!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(m2s3.level) * 1.2, m2s3.start + 2, m2s3.y] as const);
  await page.waitForFunction((n) => window.__TEST__!.state().stageBest >= n, m2s3.n);
  await toCamp(page);
  await viaPad(page, 3, 2);
});

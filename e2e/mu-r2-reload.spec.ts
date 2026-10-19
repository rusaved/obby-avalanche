import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';

// MU round of fixes 2, item 6 (staff, PC: F5 after stage 3 — the start on stage 2, at once «Oops! Back to the stage start»):
// stage 3 reached by the camp teleport crossed no ridge on foot, the resume flag lagged on stage 2. After F5 the hero
// stands at the start of the farthest stage reached and nothing rolls him back.
const W = STAGES[0]!;
const st = (n: number) => W.stages.find((s) => s.n === n)!;
test('MU round 2 (6): F5 after stage 3 reached by the camp teleport — the start of stage 3, no roll-back', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  await ready(page);
  // Stage 3 reached once (stageBest 3) by the hook, only ridge 1 crossed on foot.
  await page.evaluate(([s, z, y]) => { const t = window.__TEST__!; t.holdWave(900); t.setStat(s); t.teleport(z, 0, y + 0.5); }, [threshold(st(3).level + 2), st(2).z0 - 4, st(1).y] as const);
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st(3).start + 2, st(3).y] as const);
  await page.waitForFunction(() => window.__TEST__!.state().stageBest >= 3);
  await page.evaluate(() => window.__TEST__!.setCoins(1e9));
  // Camp, its pad, stage 3 by the window.
  await page.evaluate(() => window.__TEST__!.teleport(8, 0, 0.5));
  await waitTicks(page, 10);
  const win = page.locator('[data-role=window]');
  await page.evaluate(() => window.__TEST__!.botPath([[20, 20]]));
  await expect(win).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  const item = win.locator('.tp-item[data-stage="3"]');
  await item.click({ timeout: 10_000 });
  await expect(item).toHaveClass(/armed/);
  await item.click({ timeout: 10_000 });
  await expect(win).toBeHidden();
  await waitTicks(page, 20);
  // Stage 3 run (by the hook) and its pad: the flight to the camp.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st(3).finish[0] + 2, st(3).y] as const);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [st(3).pad.x, st(3).pad.z] as const);
  await page.waitForFunction(() => window.__TEST__!.state().padsTaken >= 1, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForTimeout(2500);
  await waitTicks(page, 60);
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  const toasts = new Set<string>();
  let caught = false;
  for (let i = 0; i < 30; i++) {
    caught ||= await page.evaluate(() => window.__TEST__!.state().caught !== null);
    toasts.add((await page.locator('[data-role="toast"]').textContent()) ?? '');
    await page.waitForTimeout(100);
  }
  const s = await page.evaluate(() => window.__TEST__!.state());
  expect(s.stage, 'the stage after F5').toBe(3);
  expect(Math.abs(s.hero!.z - flagOf(1, st(3)).z), 'at the flag of stage 3').toBeLessThanOrEqual(4);
  expect(caught, 'no roll-back').toBe(false);
  expect([...toasts].filter((x) => /Опа/.test(x))).toEqual([]);
});

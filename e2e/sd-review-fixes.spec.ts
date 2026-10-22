import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';

// SD-09 (docs/evidence/sd/review-player.md): the fixes of the player review — the catapult strip no longer hangs over
// the finish of stage 6 (screenshot), a ridge of the stages pace pays no «+0», no avalanche in the maze, and the camera
// past the giant stays behind the hero along the slope.
test.use({ viewport: { width: 812, height: 375 } });
const m1 = STAGES[0]!.stages;

test('finish of stage 6: no plate over it; a ridge: no «+0»; the maze: no wave', async ({ page, openGame }) => {
  await openGame('pace=stages');
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setStat(1e15);
  });
  // The maze (ST-02: first — a wave of the stage before it would still run): standing in it for its delay and more — no warning.
  const mz = m1.find((s) => s.type === 'maze')!;
  await page.evaluate(([z, x, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [mz.maze!.z0 + mz.maze!.cell / 2, mz.maze!.x0 + (mz.maze!.entrance + 0.5) * mz.maze!.cell, mz.y] as const);
  await waitTicks(page, 60 * 8);
  expect((await testState(page)).wave?.phase ?? 'idle').toBe('idle');
  const s6 = m1.find((s) => s.n === 6)!;
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s6.finish[0] + 4, s6.y] as const);
  await waitTicks(page, 30);
  await page.screenshot({ path: 'docs/evidence/sd/fix-finish-6.png' });
  // A ridge passed: no coin gain «+0».
  const s7 = m1.find((s) => s.n === 7)!;
  await page.evaluate(([z]) => window.__TEST__!.botPath([[0, z + 20]]), [s7.z0] as const);
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z > z + 10, s7.z0, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 60);
  await expect(page.locator('[data-role=coin-gain]')).not.toContainText('+0');
});

test('past the giant the view stays along the slope', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages');
  const g = m1.find((s) => s.type === 'giant')!;
  const f = flagOf(1, g);
  await page.evaluate(([st, z, y]) => {
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(g.level) * 1.01, f.z, f.y] as const);
  await waitTicks(page, 10);
  await page.evaluate((p) => window.__TEST__!.botPath(p), [[40, g.start + 20], [40, g.end - 10], [0, g.end + 30]] as Array<[number, number]>);
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z > z, g.end + 10, { timeout: 60_000 });
  const s = await testState(page);
  expect(Math.abs(Math.atan2(Math.sin(s.viewYaw), Math.cos(s.viewYaw))), `yaw ${s.viewYaw.toFixed(2)}`).toBeLessThan(0.35);
  await page.screenshot({ path: 'docs/evidence/sd/fix-after-giant.png' });
});

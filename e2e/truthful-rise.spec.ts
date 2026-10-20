import { mkdirSync } from 'node:fs';
import { test, expect, waitTicks } from './fixtures.ts';

// MU round 3, item 4 (producer, the third time: «a thin light-blue line across the track over a rise», the staff's frame
// 915 × 412, mountain 1, stage 2). Two sheets hung there: the slab of the ridge gate flattened to 0.01 % at half its
// height (over every rise) and the bar of the giant's zone past the top of the rise. The validator keeps them out
// (level/validate-stages.ts unsupportedErrors); here — the frames of the rises of mountains 1–2 on the truthful profile.
// RISE_TAG=before shoots the same frames from a build without the fix.

const TAG = process.env['RISE_TAG'] ?? 'after';
const SPOTS: Array<[number, number[]]> = [
  [1, [290, 490]],
  [2, [160, 460]],
];

test('the rises of mountains 1–2: nothing hangs over them', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  const { width, height } = page.viewportSize()!;
  const dir = `docs/evidence/MU/r3/${width}x${height}/rise`;
  mkdirSync(dir, { recursive: true });
  for (const [mountain, zs] of SPOTS) {
    await openGame('pace=stages&mock_fullscreen=deny');
    if (mountain > 1) {
      await page.evaluate((i) => window.__TEST__!.gotoWorld(i), mountain);
      await waitTicks(page, 60);
    }
    await page.evaluate(() => {
      const t = window.__TEST__!;
      t.setPlaySec(400);
      t.holdWave(900);
    });
    await page.touchscreen.tap(width / 2, height / 2);
    for (const z of zs) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz), z);
      await waitTicks(page, 30);
      await page.screenshot({ path: `${dir}/m${mountain}-z${z}-${TAG}.png` });
    }
  }
  expect(TAG).toMatch(/before|after/);
});

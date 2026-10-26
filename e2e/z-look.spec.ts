import { mkdirSync } from 'node:fs';
import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// Z-04…Z-08 (producer 26.10, «Lavina 19 · Winter look»): frames of the camp, the slope and a stage finish of mountain 1
// at 880×405 and 815×290 — the sky dome, the textured blocks, the winter decor, the animals and the light snow — inside
// the budget of the mountain (≤ 40 draw calls, ≤ 100 K triangles). Z_TAG=before names the frames of the old build.
const TAG = process.env['Z_TAG'] ?? 'after';
for (const vp of [{ width: 880, height: 405 }, { width: 815, height: 290 }]) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true, isMobile: true });
    test(`Z-06: the camp, the slope and a finish of mountain 1 in frames, within the budget (${vp.width}×${vp.height})`, async ({ page, openGame }) => {
      const dir = `docs/evidence/Z/${vp.width}x${vp.height}`;
      mkdirSync(dir, { recursive: true });
      await openGame('pace=stages&mock_device=mobile&quality=medium');
      await page.evaluate(() => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.setTutor(9);
        window.__TEST__!.holdWave(9000);
      });
      const st = STAGES[0]!.stages;
      const shots: Array<[string, number, number]> = [
        ['camp', 12, 0],
        ['slope', st[2]!.start + 6, st[2]!.level],
        ['finish', st[1]!.finish[0] - 6, st[1]!.level],
      ];
      for (const [name, z, lvl] of shots) {
        await page.evaluate(([zz, n]) => {
          window.__TEST__!.setStat(n);
          window.__TEST__!.teleport(zz);
        }, [z, threshold(lvl) * 1.05] as const);
        await waitTicks(page, 40);
        await page.screenshot({ path: `${dir}/${TAG}-${name}.png` });
        if (TAG === 'after') {
          const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
          expect(info.calls, `${name}: draw calls`).toBeLessThanOrEqual(40);
          expect(info.triangles, `${name}: triangles`).toBeLessThanOrEqual(100_000);
        }
      }
    });
  });
}

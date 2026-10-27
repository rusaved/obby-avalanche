import { mkdirSync, readFileSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';

// K-01 (playtest D20: «penguins — dark flat blots on the snow»): on low quality at 880 × 405 the penguins of mountain 1
// read — a light belly, at least 20 px on screen, at least one in the frame ahead on the run up the axis.
const OUT = 'docs/evidence/K01';
const theme = JSON.parse(readFileSync('content/avalanche/theme.json', 'utf8')) as { decor: { walkers: { belly?: string } } };

/** Relative luminance of #rrggbb (0 black … 1 white). */
function luma(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test.describe('K-01 · penguins on the phone', () => {
  test.use({ viewport: { width: 880, height: 405 } });

  test('K-01: low quality — a light belly, ≥ 20 px, one in the frame ahead at each of stages 1, 3, 4', async ({ page, openGame }) => {
    test.setTimeout(150_000);
    expect(luma(theme.decor.walkers.belly ?? '#000000'), 'the belly is light').toBeGreaterThanOrEqual(0.8);
    await openGame('pace=stages&mock_device=mobile&quality=low&seed=3');
    await page.evaluate(() => {
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.holdWave(9000);
    });
    const stages = await page.evaluate(() => window.__TEST__!.stages()!);
    mkdirSync(OUT, { recursive: true });
    const best: Record<string, number> = {};
    for (const n of [1, 3, 4]) {
      const st = stages.find((s) => s.n === n)!;
      const z0 = n === 1 ? 150 : st.start + 8;
      let top = 0;
      // A few steps up the axis: the frame ahead of a child running on.
      for (const dz of [0, 15, 30]) {
        await page.evaluate((z) => window.__TEST__!.teleport(z, 0), z0 + dz);
        await waitTicks(page, 30);
        const seen = (await testState(page)).decor!.seen;
        const px = await page.evaluate(
          (list) =>
            list.map((p) => {
              const a = window.__TEST__!.project(p.x, p.y, p.z);
              const b = window.__TEST__!.project(p.x, p.y + p.h, p.z);
              const inFrame = a.ahead && b.ahead && a.x >= 0 && a.x <= 880 && b.y >= 0 && a.y <= 405;
              return inFrame ? a.y - b.y : 0;
            }),
          seen,
        );
        const m = Math.max(0, ...px);
        if (m > top) {
          top = m;
          await page.screenshot({ path: `${OUT}/penguin-low-stage${n}.png` });
        }
      }
      best[`stage ${n}`] = Math.round(top * 10) / 10;
    }
    console.log('K-01 penguins px', JSON.stringify(best));
    for (const [k, v] of Object.entries(best)) expect(v, `${k}: the biggest penguin in the frame, px`).toBeGreaterThanOrEqual(20);
  });
});

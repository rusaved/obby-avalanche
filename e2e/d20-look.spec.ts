import { mkdirSync } from 'node:fs';
import { test, expect, testState, waitTicks } from './fixtures.ts';

// D-04 (headquarters 27.10): the animals on the phone — on low quality the same creatures, fewer of them, one draw call,
// seen at 880 × 405 on mountain 1. D-03: frames of the middle of the slope (880 × 405, 815 × 290) for the artist.
const OUT = 'docs/evidence/D20';

test.describe('D-04 · animals on the phone', () => {
  test.use({ viewport: { width: 880, height: 405 } });

  test('D-04: low quality on mountain 1 — animals drawn, fewer than on high, ≤ +1 draw call', async ({ page, openGame }) => {
    const counts: Record<string, { drawn: number; calls: number; off: number }> = {};
    for (const q of ['low', 'high'] as const) {
      await openGame(`pace=stages&mock_device=mobile&quality=${q}&seed=3`);
      await page.evaluate(() => {
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.holdWave(9000);
      });
      // The start of the giant's stage: animals on its edges within reach of the view.
      const st = await page.evaluate(() => window.__TEST__!.stages()!.find((s) => s.n === 2)!);
      await page.evaluate((z) => window.__TEST__!.teleport(z, 0), st.start + 4);
      await waitTicks(page, 30);
      const s = await testState(page);
      const calls = (await page.evaluate(() => window.__TEST__!.renderInfo()))!.calls;
      await page.evaluate(() => window.__TEST__!.setDecor(false));
      await waitTicks(page, 3);
      const off = (await page.evaluate(() => window.__TEST__!.renderInfo()))!.calls;
      counts[q] = { drawn: s.decor!.drawn, calls, off };
      if (q === 'low') {
        await page.evaluate(() => window.__TEST__!.setDecor(true));
        // The frame: behind a penguin of the first stage, half-way between it and the axis.
        const pg = (await testState(page)).decor!.walkers.filter((w) => w.z > 60).sort((a, b) => a.z - b.z)[0]!;
        await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [pg.x * 0.6, pg.z - 14] as const);
        await waitTicks(page, 20);
        mkdirSync(`${OUT}/880x405`, { recursive: true });
        await page.screenshot({ path: `${OUT}/880x405/animals-low.png` });
      }
    }
    console.log('D-04 animals', JSON.stringify(counts));
    expect(counts['low']!.drawn).toBeGreaterThan(0);
    expect(counts['low']!.drawn).toBeLessThan(counts['high']!.drawn);
    expect(counts['low']!.calls - counts['low']!.off).toBeLessThanOrEqual(1);
  });
});

// D-03: the middle of the slope of mountain 1 — the frames before / after (D20_LABEL) for the artist, on the phone (low).
for (const vp of [{ width: 880, height: 405 }, { width: 815, height: 290 }]) {
  test.describe(`D-03 · middle of the slope ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });
    test(`D-03: frames of the middle of stages 1, 3 and 4 of mountain 1 (${vp.width}×${vp.height})`, async ({ page, openGame }) => {
      test.setTimeout(180_000);
      const label = process.env.D20_LABEL || 'after';
      await openGame('pace=stages&mock_device=mobile&seed=3');
      await page.evaluate(() => {
        window.__TEST__!.setFlag('firstWaveDone', true);
        window.__TEST__!.holdWave(9000);
      });
      const dir = `${OUT}/${vp.width}x${vp.height}`;
      mkdirSync(dir, { recursive: true });
      const stages = await page.evaluate(() => window.__TEST__!.stages()!);
      for (const n of [1, 3, 4]) {
        const st = stages.find((s) => s.n === n)!;
        const z = n === 1 ? 150 : st.start + 8;
        await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), z);
        await waitTicks(page, 40);
        await page.screenshot({ path: `${dir}/mid-${n}-${label}.png` });
      }
      expect((await testState(page)).hero).not.toBeNull();
    });
  });
}

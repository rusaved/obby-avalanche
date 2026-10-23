import { test, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';

// MT (producer 22.10): three frames of every mountain on the phone (880 × 405, docs/evidence/MT/) — its first stage, the
// trial of its own (docs/01-gdd.md 25.1) and the last finish with its landmark.
const OWN = ['ice', 'stairs', 'throat', 'giant', 'ball', 'maze', 'blizzard', 'catapult', 'giant', 'ball'];

test.describe('880 × 405 @full', () => {
  test.use({ viewport: { width: 880, height: 405 }, hasTouch: true, isMobile: true });
  for (let wi = 1; wi <= 10; wi++)
    test(`mountain ${wi}: start, its own trial, the last finish`, async ({ page, openGame }) => {
      test.setTimeout(120_000);
      await openGame('pace=stages&mock_device=mobile');
      await waitTicks(page, 10);
      await page.evaluate(() => {
        window.__TEST__!.setPlaySec(400);
        window.__TEST__!.setFlag('firstWaveDone', true);
        // MT review: no tutorial hint over the frames (its steps passed).
        window.__TEST__!.setTutor(9);
      });
      if (wi > 1) {
        await page.evaluate((i) => window.__TEST__!.gotoWorld(i), wi);
        await waitTicks(page, 20);
      }
      const stages = STAGES[wi - 1]!.stages;
      const own = [...stages].reverse().find((s) => s.type === OWN[wi - 1]) ?? stages[1]!;
      const last = stages[stages.length - 1]!;
      const frames = [
        ['1-start', stages[0]!, stages[0]!.n === 1 && wi === 1 ? stages[0]!.start + 10 : stages[0]!.start - 6],
        [`2-${own.type}`, own, flagOf(wi, own).z + 2],
        ['3-finish', last, last.finish[0] + 1],
      ] as const;
      // The last finish stands to the side of its landmark (off the axis, at the edge of the field).
      const mark = STAGES[wi - 1]!.segments.find((x) => x.type === 'decor' && x['landmark'] === true);
      for (const [name, st, z] of frames) {
        const x = name === '3-finish' && mark ? Math.round(((mark['x'] as number) ?? 0) * 0.6) : 0;
        await page.evaluate(([s, zz, xx, y]) => {
          window.__TEST__!.holdWave(9000);
          window.__TEST__!.setStat(s);
          window.__TEST__!.teleport(zz, xx, y + 0.5);
        }, [threshold(st.level) * 1.05, z, x, name === '3-finish' ? (STAGES[wi - 1]!.segments.find((x) => x.type === 'trophyPad' && x['stage'] === st.n)?.['y'] as number) : st.y] as const);
        await waitTicks(page, 40);
        // The balls roll a moment after entering their stage: the frame once one is near.
        if (st.type === 'ball')
          await page.waitForFunction(() => {
            const s = window.__TEST__!.state();
            return !!s.snowball && s.snowball.z - s.hero!.z < 70;
          }, undefined, { timeout: 30_000 });
        await page.screenshot({ path: `docs/evidence/MT/880x405/m${String(wi).padStart(2, '0')}-${name}.png` });
      }
    });
});

import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';

// ST (producer 22.10): the frames of the milestone on the phone — the first five minutes of a new player by the steps of
// the tutorial, and every stage of mountains 1–2 from its start (docs/evidence/ST/<size>/).
const W1 = STAGES[0]!;
type Seg = { type: string; z: number; x?: number };

for (const [w, h] of [[880, 405], [815, 290]] as const)
  test.describe(`${w} × ${h}`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const dir = `docs/evidence/ST/${w}x${h}`;
    const shot = (page: Page, name: string): Promise<Buffer> => page.screenshot({ path: `${dir}/${name}.png` });

    test('the first five minutes by the steps of the tutorial', async ({ page, openGame }) => {
      test.setTimeout(300_000);
      await openGame('pace=stages&mock_device=mobile');
      await waitTicks(page, 30);
      await shot(page, 'tut-0-start');
      await ready(page);
      const s2 = W1.stages[1]!;
      const f2 = flagOf(1, s2);
      await page.evaluate(([st, z, y]) => {
        window.__TEST__!.setStat(st);
        window.__TEST__!.teleport(z, 0, y + 0.5);
      }, [threshold(s2.level), s2.finish[0] + 2, f2.y] as const);
      await waitTicks(page, 30);
      await shot(page, 'tut-1-belt');
      const belt = (W1.segments as Seg[]).find((s) => s.type === 'treadmill' && s.z > s2.finish[0] - 1 && s.z < s2.finish[1] + 1)!;
      await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [belt.x ?? 0, belt.z] as const);
      await expect.poll(async () => (await testState(page)).tutor, { timeout: 30_000 }).toBe(1);
      await page.evaluate(() => window.__TEST__!.botPath(null));
      await waitTicks(page, 20);
      await shot(page, 'tut-2-level');
      await page.evaluate(() => window.__TEST__!.setTimeScale(8));
      await expect.poll(async () => (await testState(page)).tutor, { timeout: 150_000, intervals: [1000] }).toBe(2);
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      const s3 = W1.stages[2]!;
      await page.evaluate(([z, y]) => window.__TEST__!.teleport(z - 20, 0, y + 0.5), [s3.z0, s2.y] as const);
      await waitTicks(page, 30);
      await shot(page, 'tut-3-pass');
      await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 14]]), s3.z0);
      await expect.poll(async () => (await testState(page)).tutor, { timeout: 30_000 }).toBe(3);
      await page.evaluate(() => window.__TEST__!.botPath(null));
      const s4 = W1.stages[3]!;
      await page.evaluate(([s, z, x, y]) => {
        window.__TEST__!.setStat(s);
        window.__TEST__!.teleport(z, x, y + 0.5);
      }, [threshold(s4.level) * 1.05, s4.pad.z - 4, s4.pad.x + 10, s4.y] as const);
      await waitTicks(page, 30);
      await shot(page, 'tut-4-pad');
      await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [s4.pad.x, s4.pad.z] as const);
      await expect.poll(async () => (await testState(page)).tutor, { timeout: 30_000 }).toBe(4);
      await page.evaluate(() => window.__TEST__!.botPath(null));
      await waitTicks(page, 60);
      await shot(page, 'tut-5-shoes');
      await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
      await page.locator('[data-hud="shop-tab-shoes"]').click();
      await shot(page, 'tut-5-shop');
      await page.locator('[data-role="window"].open [data-item="runners"] [data-hud="shop-item"]').click();
      await page.locator('[data-hud="win-close"]').click();
      await page.evaluate(() => {
        window.__TEST__!.setPlaySec(310);
        window.__TEST__!.addPlayToday(70);
      });
      await waitTicks(page, 30);
      await shot(page, 'tut-6-gift');
      await page.locator('[data-hud="gift"]').dispatchEvent('pointerdown');
      await shot(page, 'tut-6-gifts-window');
      await page.locator('[data-role="window"].open [data-hud="gift-claim"]').first().click();
      await page.locator('[data-hud="win-close"]').click();
      await waitTicks(page, 30);
      await shot(page, 'tut-7-onward');
    });

    for (const wi of [1, 2])
      test(`the stages of mountain ${wi} from their start`, async ({ page, openGame }) => {
        test.setTimeout(240_000);
        await openGame('pace=stages&mock_device=mobile');
        await waitTicks(page, 10);
        await page.evaluate(() => {
          window.__TEST__!.setPlaySec(400);
          window.__TEST__!.setFlag('firstWaveDone', true);
        });
        if (wi > 1) {
          await page.evaluate((i) => window.__TEST__!.gotoWorld(i), wi);
          await waitTicks(page, 20);
        }
        for (const st of STAGES[wi - 1]!.stages) {
          const f = flagOf(wi, st);
          await page.evaluate(([s, z, y]) => {
            window.__TEST__!.holdWave(9000);
            window.__TEST__!.setStat(s);
            window.__TEST__!.teleport(z, 0, y + 0.5);
          }, [threshold(st.level) * 1.05, st.n === 1 ? st.start + 10 : f.z + 2, st.y] as const);
          await waitTicks(page, 40);
          await shot(page, `m${wi}-stage-${String(st.n).padStart(2, '0')}-${st.type}`);
        }
      });
  });

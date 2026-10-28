import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, waitTicks } from './fixtures.ts';

// V24 (staff 28.10, «Lavina 24 · Look: canopies and gates»): what the producer sees with the usual camera on the run.
// V2-01 — a canopy roof is drawn whole or not at all, and only hidden while the camera is over it above its lower edge:
// the first 2 s of «continue from stage 9» show no roof seen from above (the ridge log lay on the run line), a run at
// level 25 under each of the 9 canopies of mountain 1 has the roof drawn in every frame the hero is under it.
const OUT = 'docs/evidence/V24';

type Rec = { frames: number; under: number[]; underHidden: number[]; above: number };

/** Records every rendered frame: per canopy the frames with the hero under its roof (and of them — not drawn), and the
 * frames with a drawn roof under the camera over its footprint (a roof seen from above). */
async function record(page: Page, on: boolean): Promise<Rec | null> {
  return page.evaluate((start) => {
    const w = window as unknown as { __V24?: Rec & { on: boolean } };
    if (!start) {
      const r = w.__V24 ?? null;
      if (w.__V24) w.__V24.on = false;
      return r;
    }
    const T = window.__TEST__!;
    const roofs = T.canopyRoofs();
    w.__V24 = { on: true, frames: 0, under: roofs.map(() => 0), underHidden: roofs.map(() => 0), above: 0 };
    const rec = w.__V24;
    const loop = (): void => {
      if (!rec.on) return;
      rec.frames++;
      const h = T.state().hero;
      const c = T.cameraPos();
      if (!h) return void requestAnimationFrame(loop);
      T.canopyRoofs().forEach((q, i) => {
        const over = (x: number, z: number): boolean => x > q.min[0]! && x < q.max[0]! && z > q.min[2]! && z < q.max[2]!;
        if (over(h.x, h.z) && h.y < q.min[1]!) {
          rec.under[i]!++;
          if (!q.drawn) rec.underHidden[i]!++;
        }
        if (q.drawn && over(c[0], c[2]) && c[1] > q.min[1]!) rec.above++;
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return null;
  }, on);
}

test.describe('V24 · canopies and gates in the usual camera', () => {
  test.use({ viewport: { width: 880, height: 405 } });

  test('V2-01: stage 9 of mountain 1 — the first 2 s show no canopy roof from above (no log on the run line)', async ({ page, openGame }) => {
    test.setTimeout(120_000);
    await openGame('pace=stages&mock_device=mobile&seed=7&quality=high');
    mkdirSync(OUT, { recursive: true });
    const roofs = await page.evaluate(() => window.__TEST__!.canopyRoofs().length);
    expect(roofs, 'the 9 canopies of mountain 1').toBe(9);
    await page.evaluate(() => {
      const T = window.__TEST__!;
      const at = T.stageStart(9)!;
      T.teleport(at.z, at.x, at.y + 0.05);
    });
    await record(page, true);
    const t0 = Date.now();
    await waitTicks(page, 120);
    await page.screenshot({ path: `${OUT}/v2-01-stage9.jpg`, type: 'jpeg', quality: 75 });
    const r = (await record(page, false))!;
    expect(r.frames, `frames in ${Date.now() - t0} ms`).toBeGreaterThan(3);
    expect(r.above, 'frames with a drawn canopy roof under the camera over its footprint').toBe(0);
  });

  test('V2-01: a run at level 25 under each of the 9 canopies — the roof drawn in every frame the hero is under it', async ({ page, openGame }) => {
    test.setTimeout(400_000);
    await openGame('pace=stages&mock_device=mobile&seed=7&quality=high');
    mkdirSync(OUT, { recursive: true });
    await page.evaluate(() => {
      const T = window.__TEST__!;
      T.setPlaySec(400);
      T.setFlag('firstWaveDone', true);
      T.setTutor(9);
      T.noWaves(true);
      T.setStat(2300);
      T.botJump(true);
    });
    const belts = await page.evaluate(() => window.__TEST__!.shelters().filter((s) => s.kind === 'island' && s.belt));
    expect(belts.length).toBe(9);
    const total: Rec = { frames: 0, under: belts.map(() => 0), underHidden: belts.map(() => 0), above: 0 };
    for (const [i, s] of belts.entries()) {
      // From the flat before its mouth; the camera settles behind him before the run (no fly-in from the last spot).
      await page.evaluate(([z, y]) => {
        const T = window.__TEST__!;
        T.botPath(null);
        T.teleport(z, 0, y + 0.05);
      }, [s.mouth[1] - 6, s.y] as const);
      await waitTicks(page, 60);
      await record(page, true);
      await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), s.z + 40);
      await waitTicks(page, 25);
      if (i === 0) await page.screenshot({ path: `${OUT}/v2-01-run-canopy1.jpg`, type: 'jpeg', quality: 75 });
      await waitTicks(page, 125);
      const r = (await record(page, false))!;
      total.frames += r.frames;
      total.under[i] = r.under[i]!;
      total.underHidden[i] = r.underHidden[i]!;
    }
    console.log('V2-01 run:', JSON.stringify(total));
    for (const [i] of belts.entries()) {
      expect(total.under[i], `canopy ${i + 1}: frames with the hero under it`).toBeGreaterThan(0);
      expect(total.underHidden[i], `canopy ${i + 1}: frames with the hero under it and its roof not drawn`).toBe(0);
    }
  });
});

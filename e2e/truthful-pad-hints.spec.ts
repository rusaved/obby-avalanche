import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round 5, item 3 (producer 21.10): «Stand on the pad» hung at the top before the pad was in sight — now only near a
// pad not taken (18 m) or with the pad on screen from its safe finish, with an arrow to it: «Stand on the gold pad». The
// world labels come in at 27 m (M4-R1: ×1.5 again), «Stage reward» never over its pad. Mountain 1, the first run, a level short at a
// ridge: «Level up on a treadmill» with an arrow to the nearest one. Frames: the pad from 25, 18 and 8 m.

const W = STAGES[0]!;
const s2 = W.stages[1]!;
// ST-02: the dips of stage 5 (stage 2 is the giant's, stage 3 the plates, stage 4 the avalanche — its wave hides the labels).
const s3 = W.stages[4]!;
const PAD_HALF = 3;
const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/MU/r5/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};
const slot = (page: Page): Promise<{ tutor: string | null; need: string | null; arrow: boolean }> =>
  page.evaluate(() => {
    const vis = (e: HTMLElement | null): boolean => !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const tutor = document.querySelector<HTMLElement>('[data-role="tutor"]');
    const need = document.querySelector<HTMLElement>('[data-role="need"]');
    const shown = [tutor, need].find((e) => vis(e)) ?? null;
    return {
      tutor: vis(tutor) ? (tutor!.textContent ?? '').trim() : null,
      need: vis(need) ? (need!.textContent ?? '').trim() : null,
      arrow: vis(shown?.querySelector<HTMLElement>('[data-role="slot-arrow"]') ?? null),
    };
  });
/** The pad label's box and the pad's box on screen, and whether they cross. */
const padCover = (page: Page, pad: { x: number; y: number; z: number }): Promise<{ shown: boolean; crosses: boolean }> =>
  page.evaluate(([px, py, pz, half]) => {
    const t = window.__TEST__!;
    const l = document.querySelector<HTMLElement>('[data-role="pad-label"]');
    const shown = !!l && l.classList.contains('shown') && l.style.visibility !== 'hidden';
    if (!shown) return { shown, crosses: false };
    const r = l.getBoundingClientRect();
    const c = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => t.project(px + sx * half, py, pz + sz * half)));
    const x0 = Math.min(...c.map((q) => q.x));
    const x1 = Math.max(...c.map((q) => q.x));
    const y0 = Math.min(...c.map((q) => q.y));
    const y1 = Math.max(...c.map((q) => q.y));
    return { shown, crosses: r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0 };
  }, [pad.x, pad.y, pad.z, PAD_HALF] as const);

test('«Stand on the gold pad» only near the pad, with an arrow; the label from 27 m and never over the pad', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.holdWave(900);
    t.setStat(s);
  }, threshold(W.stages[3]!.level + 2));
  await page.touchscreen.tap(width / 2, height / 2);
  // The safe finish of stage 2 turns the tutorial to «take the trophies».
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s2.finish[0] + 2, s2.y] as const);
  // ST-01: the step of the pad (the treadmill, the level and the way done).
  await page.evaluate(() => window.__TEST__!.setTutor(3));
  await expect.poll(async () => (await page.evaluate(() => window.__TEST__!.state().tutor))).toBe(3);
  const dir = dirOf(page);
  // Far from every pad not taken, mid-stage: no step at the top.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s3.start + 60, s3.y] as const);
  await waitTicks(page, 30);
  expect((await slot(page)).tutor, 'no step far from a pad').toBeNull();
  const pad = s3.pad;
  for (const [m, name] of [[34, 'pad-34m'], [25, 'pad-25m'], [17, 'pad-18m'], [8, 'pad-8m']] as const) {
    // On the pad's line, `m` short of it, facing it.
    await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [pad.x * 0.9, pad.z - Math.sqrt(m * m - (pad.x * 0.1) ** 2), s3.y] as const);
    await waitTicks(page, 2);
    // M6: entering an avalanche stage cuts the hold to its first delay (sim/threat.ts, SD-06) — hold again once inside,
    // or its wave («Run to the finish!») takes the slot by the 8 m frame.
    await page.evaluate(() => window.__TEST__!.holdWave(900));
    await waitTicks(page, 38);
    await page.waitForTimeout(700);
    const s = await slot(page);
    const cover = await padCover(page, pad);
    if (m === 34) {
      expect(s.tutor, '34 m: no step').toBeNull();
      expect(cover.shown, '34 m: no label').toBe(false);
    } else if (m === 25) {
      // M4-R1: the label comes in at 27 m, the step stays at 18.
      expect(s.tutor, '25 m: no step').toBeNull();
      expect(cover.shown, '25 m: the label').toBe(true);
      expect(cover.crosses, '25 m: the label off the pad').toBe(false);
    } else {
      expect(s.tutor, `${m} m: the step`).toMatch(/Встань на золотую площадку|Stand on the gold pad/);
      expect(s.arrow, `${m} m: the arrow to the pad`).toBe(true);
      expect(cover.shown, `${m} m: the label`).toBe(true);
      expect(cover.crosses, `${m} m: the label off the pad`).toBe(false);
    }
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
});

test('mountain 1, the first run, a level short at a ridge: «Level up on a treadmill» with an arrow', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.holdWave(900);
    t.setStat(s);
  }, threshold(3));
  await page.touchscreen.tap(width / 2, height / 2);
  // Stage 5 (ST-02: the dips), 20 m short of the ridge of stage 6.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s3.finish[0] - 20, s3.y] as const);
  await waitTicks(page, 30);
  await page.waitForTimeout(2500);
  const s = await slot(page);
  expect(s.need, 'the plaque at the ridge').toMatch(/Набери уровень на дорожке|Level up on a treadmill/);
  expect(s.arrow, 'the arrow to the treadmill').toBe(true);
  await page.screenshot({ path: `${dirOf(page)}/ridge-treadmill.png` });
});

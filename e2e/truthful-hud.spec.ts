import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { hudBoxes, tooClose } from './mu-checks.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round 3, item 6 (producer 19.10: the HUD compact). On the truthful profile (915 × 412 and 815 × 290): the level bar
// and the shoes button on one line, «N Speed» 8 px over the bar; the stage strip slides in for 2–3 s on a new stage, at a
// ridge and at the giant and hides between, the message slot takes its place at the top; toasts keep out of the middle;
// «Stage reward» never on the hero; the frame shrunk by a sticky banner on the right (−160 px) keeps the HUD whole.

const W = STAGES[0]!;
type R = { x: number; y: number; w: number; h: number };
const box = (page: Page, sel: string): Promise<R | null> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sel);
const stripShown = (page: Page): Promise<boolean> => page.evaluate(() => Number(getComputedStyle(document.querySelector('.hud-mountain')!).opacity) > 0.9);
const stripHidden = (page: Page): Promise<boolean> => page.evaluate(() => Number(getComputedStyle(document.querySelector('.hud-mountain')!).opacity) < 0.05);
/** The hero's box on screen (feet to over the head, a body wide), as the world labels keep off it. */
const heroBox = (page: Page): Promise<{ x0: number; y0: number; x1: number; y1: number }> =>
  page.evaluate(() => {
    const t = window.__TEST__!;
    const h = t.state().hero!;
    const feet = t.project(h.x, h.y, h.z);
    const head = t.project(h.x, h.y + 2.4, h.z);
    const half = (feet.y - head.y) * 0.4;
    return { x0: feet.x - half, y0: head.y, x1: feet.x + half, y1: feet.y };
  });

async function start(page: Page, openGame: (q?: string) => Promise<void>, stat: number): Promise<void> {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.holdWave(900);
    t.setStat(s);
  }, stat);
  await page.touchscreen.tap(width / 2, height / 2);
}

test('the bar and the shoes on one line between the stick and the jump, «N Speed» 8 px over the bar; at −160 px too', async ({ page, openGame }) => {
  await start(page, openGame, threshold(3));
  await page.evaluate((z) => window.__TEST__!.teleport(z), W.stages[3]!.start + 20); // ST-02: the field of the avalanche stage (stage 3 is plates over a pit)
  await waitTicks(page, 20);
  const { width, height } = page.viewportSize()!;
  for (const w of [width, width - 160]) {
    await page.setViewportSize({ width: w, height });
    await waitTicks(page, 10);
    const bar = (await box(page, '.hud-level-bar'))!;
    const shoes = (await box(page, '[data-hud="shoes"]'))!;
    const speed = (await box(page, '.hud-level .hud-stat'))!;
    const ring = (await page.locator('[data-role="stick"]').boundingBox())!;
    const jump = (await page.locator('[data-hud="jump"]').boundingBox())!;
    expect(Math.abs(bar.y + bar.h / 2 - (shoes.y + shoes.h / 2)), `${w}: one line`).toBeLessThanOrEqual(1.5);
    expect(shoes.x - (bar.x + bar.w), `${w}: 8 px between the bar and the shoes`).toBeGreaterThanOrEqual(7.5);
    expect(bar.x - (ring.x + ring.width), `${w}: off the stick`).toBeGreaterThanOrEqual(7.5);
    // Rule 2: the paid button 100 px off the jump on the whole frame; MU round 4 (A66): squeezed by a banner, 24 at least.
    expect(jump.x - (shoes.x + shoes.w), `${w}: off the jump`).toBeGreaterThanOrEqual(w === width ? 99.5 : 23.5);
    // MU round 4 (A66, Q-MU-16): the shoes button gives way first — its short caption — the bar keeps its width.
    const squeezed = await page.locator('[data-hud="shoes"]').evaluate((e) => e.classList.contains('short'));
    console.log(`${w}: bar ${Math.round(bar.w)}, shoes ${Math.round(shoes.w)}${squeezed ? ' (short)' : ''}, to the jump ${Math.round(jump.x - shoes.x - shoes.w)}`);
    if (w !== width) expect(bar.w, `${w}: the bar keeps its width`).toBeGreaterThanOrEqual(squeezed ? 280 : 319);
    expect(height - (ring.y + ring.height), `${w}: the stick ring 16 px over the bottom`).toBeGreaterThanOrEqual(15.5);
    expect(bar.y - (speed.y + speed.h), `${w}: «N Speed» over the bar`).toBeGreaterThanOrEqual(6);
    expect(height - (shoes.y + shoes.h), `${w}: 16 px from the bottom`).toBeGreaterThanOrEqual(15.5);
    // Round 4: the stage strip measured at rest, not halfway through its slide.
    await page.waitForFunction(() => !(document.querySelector('.hud-mountain')?.getAnimations().some((a) => a.playState === 'running') ?? false));
    const boxes = await hudBoxes(page);
    for (const b of boxes) expect(b.x + b.w, `${w}: ${b.id} inside`).toBeLessThanOrEqual(w - 16 + 0.5);
    expect(tooClose(boxes, 8), `${w}`).toEqual([]);
    await page.screenshot({ path: `docs/evidence/MU/r4/${width}x${height}/hud-${w}.png` });
  }
});

test('the stage strip slides in on a new stage, at a ridge and at the giant for 2–3 s, then hides; the slot moves up', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await start(page, openGame, threshold(3));
  // A new stage: in sight now, gone in 3.5 s; the slot at the top then.
  await page.evaluate((z) => window.__TEST__!.teleport(z), W.stages[3]!.start + 20); // ST-02: the field of the avalanche stage (stage 3 is plates over a pit)
  await waitTicks(page, 5);
  await expect.poll(() => stripShown(page), { message: 'a new stage shows the strip', timeout: 2_000, intervals: [100] }).toBe(true);
  await page.screenshot({ path: `docs/evidence/MU/r4/${page.viewportSize()!.width}x${page.viewportSize()!.height}/strip-in.png` });
  await expect.poll(() => stripHidden(page), { timeout: 4_000, intervals: [250] }).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `docs/evidence/MU/r4/${page.viewportSize()!.width}x${page.viewportSize()!.height}/strip-out.png` });
  const slot = await page.evaluate(() => {
    const e = Array.from(document.querySelectorAll('.hud-hint, .hud-need, .hud-tutor')).find((x) => getComputedStyle(x).visibility === 'visible' && (x as HTMLElement).offsetWidth > 0);
    return e ? e.getBoundingClientRect().top : null;
  });
  if (slot !== null) expect(slot, 'the slot at the top while the strip hides').toBeLessThanOrEqual(10);
  // A ridge: the plaque «N more levels» brings the strip.
  const st4 = W.stages[5]!; // ST-02: the ridge of stage 6 — past the flat avalanche stage (stage 3 is the giant's)
  await page.evaluate(([s, z]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
  }, [threshold(st4.level - 3), st4.z0 - 30] as const);
  await expect.poll(() => stripHidden(page), { timeout: 4_000, intervals: [250] }).toBe(true);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), st4.z0 - 4);
  await expect(page.locator('[data-role="need"]')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => stripShown(page), { message: 'a ridge shows the strip', timeout: 2_000, intervals: [100] }).toBe(true);
  await page.evaluate(() => window.__TEST__!.botPath(null));
  // The giant: into his zone.
  const g = W.stages.find((s) => s.type === 'giant')!;
  await page.evaluate(([s, z]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, 12.5);
  }, [threshold(g.level), g.start - 6] as const);
  await expect.poll(() => stripHidden(page), { timeout: 4_000, intervals: [250] }).toBe(true);
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  await page.waitForFunction(() => window.__TEST__!.state().boss?.zones[0]?.hero === 'in', undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  await expect.poll(() => stripShown(page), { message: 'the giant shows the strip', timeout: 2_000, intervals: [100] }).toBe(true);
});

test('toasts keep out of the middle; «Stage reward» never on the hero', async ({ page, openGame }) => {
  const st3 = W.stages[2]!;
  await start(page, openGame, threshold(st3.level + 2));
  const { height } = page.viewportSize()!;
  // Toward the pad and onto it: the plaque off the hero at every look, the «+N» toast in the top band.
  await page.evaluate(([z, x, y]) => window.__TEST__!.teleport(z, x, y), [st3.finish[0] + 1, st3.pad.x * 0.7, st3.y + 1] as const);
  await waitTicks(page, 10);
  await page.evaluate((p) => window.__TEST__!.botPath([[p.x, p.z]]), st3.pad);
  let looks = 0;
  for (let i = 0; i < 30; i++) {
    const p = await page.evaluate(() => {
      const e = document.querySelector('[data-role="pad-label"]') as HTMLElement;
      const on = e.classList.contains('shown') && getComputedStyle(e).visibility !== 'hidden';
      const r = e.getBoundingClientRect();
      return on ? { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } : null;
    });
    const h = await heroBox(page);
    if (p) {
      looks++;
      // On the run the plaque follows a frame behind: a touch of a corner is not «on the hero», the producer's frame had
      // it over his middle — at most 15 % of his box under it.
      const ox = Math.max(0, Math.min(p.x1, h.x1) - Math.max(p.x0, h.x0));
      const oy = Math.max(0, Math.min(p.y1, h.y1) - Math.max(p.y0, h.y0));
      expect((ox * oy) / Math.max(1, (h.x1 - h.x0) * (h.y1 - h.y0)), `the plaque ${JSON.stringify(p)} on the hero ${JSON.stringify(h)}`).toBeLessThanOrEqual(0.15);
    }
    const toast = await page.evaluate(() => {
      const e = document.querySelector('[data-role="toast"].shown');
      return e ? e.getBoundingClientRect().bottom : null;
    });
    if (toast !== null) expect(toast, 'the toast in the top band').toBeLessThanOrEqual(Math.min(96, height * 0.33) + 0.5);
    await page.waitForTimeout(100);
  }
  expect(looks).toBeGreaterThan(3);
  await page.evaluate(() => window.__TEST__!.botPath(null));
});

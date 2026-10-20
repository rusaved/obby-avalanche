import { test, expect, mockCalls, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { hudBoxes, tooClose } from './mu-checks.ts';

// MU round 3, item 1 (producer 19.10: Yandex Browser on Android, not in full screen, gives the game about 815 × 290 CSS;
// the stick sat under the browser panel, «Shop» and «Gifts» were cut). The first tap of a finger asks for the whole
// screen (ysdk.screen.fullscreen.request on the producer's link); a refusal leaves the game whole in the window; the
// field is the visible part of the window (visualViewport), no bottom band. Runs on the truthful profile: 915 × 412 and
// 815 × 290 (playwright.config.ts).

type Rect = { x: number; y: number; w: number; h: number };
const rect = (page: Page, sel: string): Promise<Rect | null> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, sel);

async function tap(page: Page, hud: string): Promise<void> {
  const b = page.locator(`[data-hud="${hud}"]`).first();
  await b.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  await b.dispatchEvent('click', { detail: 1 });
}

/** Every HUD block and the resting stick inside the frame of width × height, no two closer than 8 px. */
async function hudWhole(page: Page, width: number, height: number, label: string): Promise<void> {
  // Round 4: the stage strip measured at rest, not halfway through its slide.
  await page.waitForFunction(() => !(document.querySelector('.hud-mountain')?.getAnimations().some((a) => a.playState === 'running') ?? false));
  const boxes = await hudBoxes(page);
  expect(boxes.length, label).toBeGreaterThan(8);
  for (const b of boxes) {
    expect(b.x, `${label} ${b.id} left`).toBeGreaterThanOrEqual(16 - 0.5);
    expect(b.x + b.w, `${label} ${b.id} right`).toBeLessThanOrEqual(width - 16 + 0.5);
    expect(b.y, `${label} ${b.id} top`).toBeGreaterThanOrEqual(8 - 0.5);
    expect(b.y + b.h, `${label} ${b.id} bottom`).toBeLessThanOrEqual(height - 8 + 0.5);
  }
  expect(tooClose(boxes, 8), label).toEqual([]);
  const ring = (await page.locator('[data-role="stick"]').boundingBox())!;
  expect(ring.y + ring.height, `${label} stick inside`).toBeLessThanOrEqual(height + 0.5);
  const tiles = boxes.filter((b) => b.id.startsWith('tile'));
  expect(ring.y - Math.max(...tiles.map((b) => b.y + b.h)), `${label} stick under the column`).toBeGreaterThanOrEqual(24 - 0.5);
  for (const b of boxes) {
    const apart = b.x >= ring.x + ring.width || b.x + b.w <= ring.x || b.y >= ring.y + ring.height || b.y + b.h <= ring.y;
    expect(apart, `${label} ${b.id} off the stick`).toBe(true);
  }
}

/** The open window's panel inside the frame and its buttons whole after scrolling the middle. */
async function windowWhole(page: Page, height: number, label: string): Promise<void> {
  const panel = (await rect(page, '[data-role="window"].open .win-panel'))!;
  expect(panel.y, `${label} panel top`).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.h, `${label} panel bottom`).toBeLessThanOrEqual(height + 0.5);
}

test('the first tap of a finger asks for the whole screen; outside it any tap asks again', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_device=desktop');
  await waitTicks(page, 10);
  expect(await mockCalls(page, 'screen.fullscreen.request'), 'nothing before a tap').toBe(0);
  const { width, height } = page.viewportSize()!;
  const full = { x: 0, y: 0, w: width, h: height };
  const inFull = (): Promise<boolean> => page.evaluate(() => !!document.fullscreenElement);
  await page.touchscreen.tap(width / 2, height / 2);
  await expect.poll(() => mockCalls(page, 'screen.fullscreen.request')).toBe(1);
  await expect.poll(inFull).toBe(true);
  await page.waitForTimeout(1100);
  await page.touchscreen.tap(width / 2, height / 2);
  await waitTicks(page, 10);
  expect(await mockCalls(page, 'screen.fullscreen.request'), 'no ask while in the whole screen').toBe(1);
  // MU round 4 (producer 20.10): out of the whole screen (the system «Back»), then a tap — the whole screen again.
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(inFull).toBe(false);
  await page.touchscreen.tap(width / 2, height / 2);
  await expect.poll(() => mockCalls(page, 'screen.fullscreen.request')).toBe(2);
  await expect.poll(inFull).toBe(true);
  await expect.poll(() => rect(page, '#game'), 'canvas = the visible part').toEqual(full);
  // The app folded (the tab hidden) and back: the browser drops the whole screen; a tap brings it back.
  await page.evaluate(async () => {
    await document.exitFullscreen();
    const set = (hidden: boolean): void => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set(true);
    set(false);
  });
  await page.waitForTimeout(1100);
  await page.touchscreen.tap(width / 2, height / 2);
  await expect.poll(() => mockCalls(page, 'screen.fullscreen.request')).toBe(3);
  await expect.poll(inFull).toBe(true);
  await expect.poll(() => rect(page, '#game'), 'canvas = the visible part').toEqual(full);
  await expect.poll(() => rect(page, '#ui'), 'interface layer = the visible part').toEqual(full);
  await hudWhole(page, width, height, `${width}x${height} back in the whole screen`);
});

test('the window resized while out of the whole screen: canvas and HUD follow the visible part', async ({ page, openGame }) => {
  // In the whole screen the window is 40 px taller; leaving it brings the browser panel back — the window gets lower.
  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width, height: height + 40 });
  await openGame('pace=stages&mock_fullscreen=deny');
  await page.touchscreen.tap(width / 2, height / 2);
  await waitTicks(page, 10);
  await expect.poll(() => rect(page, '#game')).toEqual({ x: 0, y: 0, w: width, h: height + 40 });
  await page.setViewportSize({ width, height });
  await expect.poll(() => rect(page, '#game')).toEqual({ x: 0, y: 0, w: width, h: height });
  await expect.poll(() => rect(page, '#ui')).toEqual({ x: 0, y: 0, w: width, h: height });
  // The stage strip of the start hidden again (it slides in on a new stage for 2.5 s).
  await page.waitForFunction(() => document.querySelector('.hud')?.classList.contains('strip-off') ?? false, undefined, { timeout: 10_000 });
  await page.waitForTimeout(400);
  await hudWhole(page, width, height, 'lower window');
});

test('the whole screen refused: the game is whole in the window — the HUD and the windows', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_device=desktop&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setCoins(5300);
    t.setTrophies(3);
    t.holdWave(900);
  });
  await page.touchscreen.tap(width / 2, height / 2);
  await expect.poll(() => mockCalls(page, 'screen.fullscreen.request')).toBe(1);
  await waitTicks(page, 20);
  const full = { x: 0, y: 0, w: width, h: height };
  expect(await rect(page, '#game'), 'canvas').toEqual(full);
  expect(await rect(page, '#ui'), 'interface layer').toEqual(full);
  await hudWhole(page, width, height, `${width}x${height}`);
  await page.screenshot({ path: `docs/evidence/MU/r4/${width}x${height}/size-refused.png` });
  for (const id of ['pause', 'gift', 'menu-shop']) {
    await tap(page, id);
    await expect(page.locator('[data-role="window"].open'), id).toHaveCount(1);
    await windowWhole(page, height, id);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="window"].open')).toHaveCount(0);
  }
});

test('a browser panel over the page: the field is the visible part of the window (visualViewport)', async ({ page, openGame }) => {
  // The window is 45 px taller than the profile and the panel lies over its bottom: the visible part is the profile.
  const CUT = 45;
  const { width, height: visible } = page.viewportSize()!;
  const height = visible + CUT;
  await page.setViewportSize({ width, height });
  await page.addInitScript((cut) => {
    const fake = new EventTarget();
    Object.defineProperties(fake, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight - cut },
      offsetLeft: { value: 0 },
      offsetTop: { value: 0 },
      pageLeft: { value: 0 },
      pageTop: { value: 0 },
      scale: { value: 1 },
    });
    Object.defineProperty(window, 'visualViewport', { get: () => fake });
  }, CUT);
  await openGame('pace=stages&mock_device=desktop&mock_fullscreen=deny');
  await page.touchscreen.tap(width / 2, (height - CUT) / 2);
  await waitTicks(page, 20);
  expect(await rect(page, '#game'), 'canvas').toEqual({ x: 0, y: 0, w: width, h: height - CUT });
  await hudWhole(page, width, height - CUT, 'under the panel');
  const jump = (await page.locator('[data-hud="jump"]').boundingBox())!;
  expect(Math.abs(jump.y + jump.height - (height - CUT - 16)), 'jump 16 px over the panel').toBeLessThanOrEqual(1);
  await tap(page, 'pause');
  await windowWhole(page, height - CUT, 'pause under the panel');
});

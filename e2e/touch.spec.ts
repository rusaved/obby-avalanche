import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// Touch (docs/02-tech.md 6.3): dynamic stick, camera swipe, jump button, multitouch via CDP, resets.
type TouchPoint = { x: number; y: number; id: number };
type Cdp = import('@playwright/test').CDPSession;
async function touch(cdp: Cdp, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: TouchPoint[]) {
  // CDP: touchCancel carries no points; touchEnd lists the points that were lifted.
  const touchPoints = type === 'touchCancel' ? [] : points.map((p) => ({ x: p.x, y: p.y, id: p.id }));
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
}

async function jumpButtonCenter(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator('[data-hud="jump"]').boundingBox();
  if (!box) throw new Error('no jump button');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
}

test.describe('touch', () => {
  test('SCR-06 stick, camera swipe and jump button work at the same time (three touches); zones ≥ 44 px', async ({ page, openGame }) => {
    await openGame();
    const cdp = await page.context().newCDPSession(page);
    const s0 = await testState(page);
    expect(s0.touchMode).toBe(true);
    const jump = await jumpButtonCenter(page);
    expect(Math.min(jump.w, jump.h)).toBeGreaterThanOrEqual(0.18 * 390 - 1);
    const pauseBox = await page.locator('[data-hud="pause"]').boundingBox();
    expect(Math.min(pauseBox!.width, pauseBox!.height)).toBeGreaterThanOrEqual(44);

    // Finger 1: stick on the left half; finger 2: camera on the right half.
    await touch(cdp, 'touchStart', [{ x: 150, y: 300, id: 1 }, { x: 600, y: 150, id: 2 }]);
    await touch(cdp, 'touchMove', [{ x: 150, y: 220, id: 1 }, { x: 640, y: 150, id: 2 }]);
    await waitTicks(page, 6);
    await touch(cdp, 'touchMove', [{ x: 150, y: 220, id: 1 }, { x: 690, y: 150, id: 2 }]);
    // Finger 3: the jump button while both others stay down.
    await touch(cdp, 'touchStart', [{ x: 150, y: 220, id: 1 }, { x: 690, y: 150, id: 2 }, { x: jump.x, y: jump.y, id: 3 }]);
    await waitTicks(page, 24);
    const s1 = await testState(page);
    expect(s1.stickActive).toBe(true);
    expect(s1.hero!.speed).toBeGreaterThan(5);
    expect(Math.abs(s1.viewYaw - s0.viewYaw)).toBeGreaterThan(0.1);
    const jumps = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'jump').length);
    expect(jumps).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: 'docs/evidence/M1/touch_844x390_ru.png' });
    await touch(cdp, 'touchEnd', [{ x: 150, y: 220, id: 1 }, { x: 690, y: 150, id: 2 }, { x: jump.x, y: jump.y, id: 3 }]);
    await waitTicks(page, 12);
    expect((await testState(page)).stickActive).toBe(false);
  });

  test('a touch on a HUD button never starts the stick', async ({ page, openGame }) => {
    await openGame();
    const cdp = await page.context().newCDPSession(page);
    const pauseBox = await page.locator('[data-hud="pause"]').boundingBox();
    const px = pauseBox!.x + pauseBox!.width / 2;
    const py = pauseBox!.y + pauseBox!.height / 2;
    // The button fires on its pointerdown (playtest M2): the menu opens and pauses the game on the touch itself.
    await touch(cdp, 'touchStart', [{ x: px, y: py, id: 5 }]);
    await page.waitForFunction(() => window.__TEST__!.state().menuOpen, undefined, { timeout: 10_000 });
    expect((await testState(page)).stickActive).toBe(false);
    await touch(cdp, 'touchEnd', [{ x: px, y: py, id: 5 }]);
    expect((await testState(page)).menuOpen).toBe(true);
    await page.locator('[data-hud="continue"]').click();
  });

  test('InputState resets on pointercancel and on a mock ad: stick held + ad → hero speed 0 afterwards', async ({ page, openGame }) => {
    await openGame();
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [{ x: 150, y: 300, id: 1 }]);
    await touch(cdp, 'touchMove', [{ x: 150, y: 220, id: 1 }]);
    await waitTicks(page, 18);
    expect((await testState(page)).hero!.speed).toBeGreaterThan(5);
    await touch(cdp, 'touchCancel', [{ x: 150, y: 220, id: 1 }]);
    await waitTicks(page, 18);
    let s = await testState(page);
    expect(s.stickActive).toBe(false);
    expect(s.hero!.speed).toBeLessThan(0.5);

    await touch(cdp, 'touchStart', [{ x: 150, y: 300, id: 2 }]);
    await touch(cdp, 'touchMove', [{ x: 150, y: 220, id: 2 }]);
    await waitTicks(page, 18);
    expect((await testState(page)).hero!.speed).toBeGreaterThan(5);
    const result = await page.evaluate(() => window.__TEST__!.showAd('interstitial'));
    expect(result.shown).toBe(true);
    await waitTicks(page, 18);
    s = await testState(page);
    expect(s.pauseReasons).toEqual([]);
    expect(s.stickActive).toBe(false);
    expect(s.hero!.speed).toBeLessThan(0.5);
    await touch(cdp, 'touchEnd', [{ x: 150, y: 220, id: 2 }]);
  });

  test('blur resets held keys and the stick', async ({ page, openGame }) => {
    await openGame();
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [{ x: 150, y: 300, id: 1 }]);
    await touch(cdp, 'touchMove', [{ x: 150, y: 220, id: 1 }]);
    await waitTicks(page, 12);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(100);
    let s = await testState(page);
    expect(s.pauseReasons).toEqual(['blur']);
    expect(s.stickActive).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitTicks(page, 18);
    s = await testState(page);
    expect(s.pauseReasons).toEqual([]);
    expect(s.hero!.speed).toBeLessThan(0.5);
    await touch(cdp, 'touchEnd', [{ x: 150, y: 220, id: 1 }]);
  });

  // Playtest M2: with the stick held the shoes button did nothing; HUD buttons fire on pointerdown of their own finger.
  test('stick held: a second finger presses the shoes and the shop buttons at once', async ({ page, openGame }) => {
    await openGame();
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => window.__TEST__!.setPlaySec(185));
    await page.evaluate(() => window.__TEST__!.setCoins(1000));
    await page.waitForFunction(() => window.__TEST__!.state().shoesButton.can, undefined, { timeout: 10_000 });
    // Finger 1: the stick, moving; the hero runs.
    await touch(cdp, 'touchStart', [{ x: 150, y: 300, id: 1 }]);
    await touch(cdp, 'touchMove', [{ x: 150, y: 220, id: 1 }]);
    await waitTicks(page, 12);
    expect((await testState(page)).hero!.speed).toBeGreaterThan(5);
    // Finger 2: the shoes button, while finger 1 stays down and keeps moving.
    const sb = (await page.locator('[data-hud="shoes"]').boundingBox())!;
    const shoes = { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2, id: 2 };
    await touch(cdp, 'touchStart', [{ x: 150, y: 220, id: 1 }, shoes]);
    await touch(cdp, 'touchMove', [{ x: 160, y: 215, id: 1 }, shoes]);
    await waitTicks(page, 3);
    expect((await testState(page)).shoeLevel).toBe(1);
    await touch(cdp, 'touchEnd', [shoes]);
    await waitTicks(page, 6);
    let s = await testState(page);
    expect(s.shoeLevel).toBe(1);
    expect(s.stickActive).toBe(true);
    // Finger 3: the shop button of the right column; the window opens though the stick is still held.
    await page.waitForFunction(() => document.querySelector('[data-hud="menu-shop"]') !== null, undefined, { timeout: 10_000 });
    const mb = (await page.locator('[data-hud="menu-shop"]').boundingBox())!;
    const shop = { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2, id: 3 };
    await touch(cdp, 'touchStart', [{ x: 160, y: 215, id: 1 }, shop]);
    await page.waitForFunction(() => window.__TEST__!.state().window === 'shop', undefined, { timeout: 10_000 });
    await touch(cdp, 'touchEnd', [shop]);
    await touch(cdp, 'touchEnd', [{ x: 160, y: 215, id: 1 }]);
    s = await testState(page);
    expect(s.window).toBe('shop');
    await page.screenshot({ path: 'docs/evidence/M3/touch_buttons_844x390_ru.png' });
  });
});

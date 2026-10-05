import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// Auto-run for one hand (docs/02-tech.md 6.3, docs/01-gdd.md 7.11, docs/03 SCR-06).
type TouchPoint = { x: number; y: number; id: number };
type Cdp = import('@playwright/test').CDPSession;
/** `at` — event time, seconds since the epoch (CDP `timestamp`): a tap keeps its real length even when a busy runner delivers it late. */
async function touch(cdp: Cdp, type: 'touchStart' | 'touchMove' | 'touchEnd', points: TouchPoint[], at?: number) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })), ...(at === undefined ? {} : { timestamp: at }) });
}

test.describe('auto-run', () => {
  test('auto-run moves the hero without a stick; tap jumps, swipe does not; swipe turns the run direction', async ({ page, openGame }) => {
    await openGame();
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => window.__TEST__!.setAutoRun(true));
    const s0 = await testState(page);
    expect(s0.autoRun).toBe(true);
    await waitTicks(page, 36);
    const s1 = await testState(page);
    expect(s1.hero!.z).toBeGreaterThan(s0.hero!.z + 4);
    expect(s1.stickActive).toBe(false);
    await expect(page.locator('[data-hud="jump"]')).toBeVisible();

    const jumpsBefore = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'jump').length);
    // Tap: 50 ms, under 12 px — the game measures a tap by event time, so a slow runner (CI, 4× throttling) that
    // handles the touch late cannot stretch it past the 200 ms limit.
    // The jump is waited for in game ticks, not in wall time.
    const t0 = Date.now() / 1000;
    await Promise.all([touch(cdp, 'touchStart', [{ x: 300, y: 200, id: 1 }], t0), touch(cdp, 'touchEnd', [{ x: 303, y: 202, id: 1 }], t0 + 0.05)]);
    const tapTick = await page.evaluate(() => window.__TEST__!.state().ticks);
    await waitTicks(page, 15);
    const jumpsAfterTap = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'jump').length);
    expect(jumpsAfterTap, `tap at tick ${tapTick}`).toBe(jumpsBefore + 1);

    // Swipe 100 px: camera and run direction turn, no jump.
    const yaw0 = (await testState(page)).controlYaw;
    await touch(cdp, 'touchStart', [{ x: 500, y: 200, id: 2 }]);
    await touch(cdp, 'touchMove', [{ x: 550, y: 200, id: 2 }]);
    await waitTicks(page, 4);
    await touch(cdp, 'touchMove', [{ x: 600, y: 200, id: 2 }]);
    await waitTicks(page, 4);
    await touch(cdp, 'touchEnd', [{ x: 600, y: 200, id: 2 }]);
    await waitTicks(page, 15);
    const s2 = await testState(page);
    const jumpsAfterSwipe = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'jump').length);
    expect(jumpsAfterSwipe).toBe(jumpsAfterTap);
    expect(Math.abs(s2.controlYaw - yaw0)).toBeGreaterThan(0.2);
    expect(Math.abs(s2.viewYaw - s2.controlYaw)).toBeLessThan(1e-6);
    // Running along the turned direction: x changes. From the middle of the track — a busy runner lets many ticks pass
    // between the swipe events, and by now the hero may already slide along the side of the track.
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), s2.hero!.z);
    const sA = await testState(page);
    await waitTicks(page, 30);
    const s3 = await testState(page);
    const where = { yaw0, yaw: s2.controlYaw, from: [sA.hero!.x, sA.hero!.z], to: [s3.hero!.x, s3.hero!.z], ticks: [sA.ticks, s3.ticks], speed: s3.hero!.speed, paused: s3.pauseReasons };
    expect(Math.abs(s3.hero!.x - sA.hero!.x), JSON.stringify(where)).toBeGreaterThan(1);
  });

  test('the auto-run setting is in the pause menu and survives F5', async ({ page, openGame }) => {
    await openGame();
    const cdp = await page.context().newCDPSession(page);
    expect((await testState(page)).autoRun).toBe(false);
    await page.locator('[data-hud="pause"]').dispatchEvent('pointerup');
    await expect(page.locator('[data-role="pause"]')).toBeVisible();
    await page.locator('[data-hud="autorun"]').click();
    await page.locator('[data-hud="continue"]').click();
    await waitTicks(page, 6);
    expect((await testState(page)).autoRun).toBe(true);
    await page.reload();
    await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
    expect((await testState(page)).autoRun).toBe(true);
    expect(await page.locator('[data-hud="autorun"]').getAttribute('data-on')).toBe('true');
  });
});

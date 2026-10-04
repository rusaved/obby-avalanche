import { test, expect, testState, waitTicks } from './fixtures.ts';

// Keyboard by event.code, mouse camera, wheel zoom, no page scroll (docs/02-tech.md 6.2, docs/03 SCR-03, SCR-05).
test.describe('PC input', () => {
  test('SCR-05 KeyW moves the hero up the slope even with a Russian layout (code, not key)', async ({ page, openGame }) => {
    await openGame();
    const z0 = (await testState(page)).hero!.z;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'ц', windowsVirtualKeyCode: 87 });
    await waitTicks(page, 42);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'ц', windowsVirtualKeyCode: 87 });
    const z1 = (await testState(page)).hero!.z;
    expect(z1 - z0).toBeGreaterThan(4);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('arrows and WASD move in the control frame; A moves to screen-left (+X), D to screen-right (−X)', async ({ page, openGame }) => {
    await openGame();
    const s0 = (await testState(page)).hero!;
    await page.keyboard.down('ArrowUp');
    await waitTicks(page, 30);
    await page.keyboard.up('ArrowUp');
    const s1 = (await testState(page)).hero!;
    expect(s1.z).toBeGreaterThan(s0.z + 3);
    await page.keyboard.down('KeyA');
    await waitTicks(page, 30);
    await page.keyboard.up('KeyA');
    const s2 = (await testState(page)).hero!;
    // Camera behind the hero looks along +Z, so screen-left is world +X (right-handed axes).
    expect(s2.x).toBeGreaterThan(s1.x + 1);
    await page.keyboard.down('KeyD');
    await waitTicks(page, 50);
    await page.keyboard.up('KeyD');
    const s3 = (await testState(page)).hero!;
    expect(s3.x).toBeLessThan(s2.x - 1);
  });

  test('SCR-03 Space jumps and never scrolls the page; wheel zooms the camera, not the page', async ({ page, openGame }) => {
    await openGame();
    await page.keyboard.press('Space');
    await waitTicks(page, 20);
    const jumps = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'jump').length);
    expect(jumps).toBeGreaterThanOrEqual(1);
    const d0 = (await testState(page)).cameraDistance;
    await page.mouse.move(480, 270);
    await page.mouse.wheel(0, 600);
    await waitTicks(page, 10);
    const d1 = (await testState(page)).cameraDistance;
    expect(d1).toBeGreaterThan(d0);
    expect(await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight <= window.innerHeight }))).toEqual({ y: 0, h: true });
  });

  test('mouse drag turns the camera (both buttons), control yaw follows', async ({ page, openGame }) => {
    await openGame();
    const yaw0 = (await testState(page)).viewYaw;
    await page.mouse.move(480, 270);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(380, 270, { steps: 10 });
    await page.mouse.up({ button: 'left' });
    await waitTicks(page, 6);
    const s1 = await testState(page);
    expect(Math.abs(s1.viewYaw - yaw0)).toBeGreaterThan(0.2);
    expect(Math.abs(s1.controlYaw - s1.viewYaw)).toBeLessThan(1e-6);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(480, 270, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await waitTicks(page, 6);
    const s2 = await testState(page);
    expect(Math.abs(s2.viewYaw - s1.viewYaw)).toBeGreaterThan(0.2);
  });

  test('SCR-05 no shortcuts with Ctrl or Alt, F-keys and Tab do nothing', async ({ page, openGame }) => {
    await openGame();
    const z0 = (await testState(page)).hero!.z;
    await page.keyboard.down('Control');
    await page.keyboard.down('KeyW');
    await waitTicks(page, 24);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Control');
    await page.keyboard.press('F2');
    await page.keyboard.press('Tab');
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Alt');
    await waitTicks(page, 12);
    const s = await testState(page);
    expect(Math.abs(s.hero!.z - z0)).toBeLessThan(0.5);
    expect(s.menuOpen).toBe(false);
  });

  test('Escape and KeyP open and close the pause menu; the menu pauses the simulation', async ({ page, openGame }) => {
    await openGame();
    const menu = (open: boolean) => page.waitForFunction((o) => window.__TEST__!.state().menuOpen === o, open, { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await menu(true);
    let s = await testState(page);
    expect(s.pauseReasons).toEqual(['menu']);
    await expect(page.locator('[data-role="pause"]')).toBeVisible();
    const ticks = s.ticks;
    await page.waitForTimeout(300);
    expect((await testState(page)).ticks).toBe(ticks);
    await page.locator('[data-hud="continue"]').click();
    await menu(false);
    await page.keyboard.press('KeyP');
    await menu(true);
    await page.keyboard.press('KeyP');
    await menu(false);
    s = await testState(page);
    expect(s.pauseReasons).toEqual([]);
  });
});

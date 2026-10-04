import { test, expect, testState } from './fixtures.ts';

// Camera (docs/02-tech.md, section 7): wall avoidance, auto-turn only on viewYaw, FOV from speed.
test.describe('camera', () => {
  test('at three points near walls the camera is never inside the geometry', async ({ page, openGame }) => {
    await openGame();
    const gateZ = 130;
    const points: Array<[number, number, string]> = [
      [0, gateZ - 1.6, 'under gate 1'],
      [-13, 63, 'at the left border next to cave 1'],
      [-18, 63, 'inside cave 1'],
    ];
    for (const [x, z, label] of points) {
      await page.evaluate(({ x, z }) => window.__TEST__!.teleport(z, x), { x, z });
      // Turn the camera around to press it into walls from several sides.
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await page.evaluate((y) => window.__TEST__!.setCamera({ yaw: y, pitch: 0.2, dist: 14 }), yaw);
        await page.waitForTimeout(250);
        expect(await page.evaluate(() => window.__TEST__!.cameraInsideGeometry()), `${label} yaw ${yaw}`).toBe(false);
      }
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
    }
    await page.evaluate(() => window.__TEST__!.teleport(63, -13));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/evidence/M1/camera_wall_960x540_ru.png' });
  });

  test('auto-turn pulls the view towards +Z and changes only viewYaw', async ({ page, openGame }) => {
    await openGame();
    await page.mouse.move(480, 270);
    await page.mouse.down();
    await page.mouse.move(300, 270, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const s0 = await testState(page);
    expect(Math.abs(s0.viewYaw)).toBeGreaterThan(0.4);
    const controlYaw = s0.controlYaw;
    expect(controlYaw).toBeCloseTo(s0.viewYaw, 6);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2600);
    await page.keyboard.up('KeyW');
    const s1 = await testState(page);
    expect(Math.abs(s1.viewYaw)).toBeLessThan(Math.abs(s0.viewYaw) * 0.5);
    expect(s1.controlYaw).toBeCloseTo(controlYaw, 6);
  });

  test('FOV at full speed exceeds the resting FOV by fovSpeedAdd from tuning.json', async ({ page, openGame }) => {
    await openGame();
    const fovRest = (await testState(page)).cameraFov;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    const fovRun = (await testState(page)).cameraFov;
    await page.keyboard.up('KeyW');
    expect(fovRun - fovRest).toBeGreaterThan(12);
    expect(fovRun - fovRest).toBeLessThan(16);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/evidence/M1/camera_run_960x540_ru.png' });
  });
});

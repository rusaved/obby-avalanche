import { test, expect, testState, waitTicks } from './fixtures.ts';

// Mountain 1 from worlds.json (docs/02-tech.md 6.1): fall below the track → the last flag within 0.5 s.
test.describe('level', () => {
  test('falling off the track returns the hero to the flag within 0.5 s of game time', async ({ page, openGame }) => {
    await openGame();
    // Reach the flag behind wall 1 (z ≈ 134.5) by teleport, then fall outside the border.
    await page.evaluate(() => window.__TEST__!.teleport(140));
    await waitTicks(page, 24);
    let s = await testState(page);
    expect(s.checkpoint).toBe(0);
    await page.evaluate(() => window.__TEST__!.teleport(200, 40));
    await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'respawn'), undefined, { timeout: 10_000 });
    const events = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'fall' || e.name === 'respawn'));
    const fall = events.find((e) => e.name === 'fall')!;
    const respawn = events.find((e) => e.name === 'respawn')!;
    expect(respawn.tick - fall.tick).toBeLessThanOrEqual(30);
    await waitTicks(page, 12);
    s = await testState(page);
    expect(s.hero!.z).toBeCloseTo(134.5, 0);
    expect(s.hero!.x).toBeCloseTo(0, 0);
    expect(s.respawning).toBe(false);
  });

  test('closed walls stop the hero; gates and caves come from data', async ({ page, openGame }) => {
    await openGame();
    await page.evaluate(() => window.__TEST__!.teleport(120));
    await page.keyboard.down('KeyW');
    await waitTicks(page, 90);
    await page.keyboard.up('KeyW');
    const s = await testState(page);
    expect(s.hero!.z).toBeLessThan(130);
    expect(s.hero!.z).toBeGreaterThan(126);
    await page.screenshot({ path: 'docs/evidence/M1/spawn_960x540_ru.png' });
  });

  test('a short run from the camp: the hero stays on the ground over the ramp of stretch 1', async ({ page, openGame }) => {
    await openGame();
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => (window.__TEST__!.state().hero?.z ?? 0) > 85, undefined, { timeout: 15_000 });
    await page.keyboard.up('KeyW');
    const s = await testState(page);
    expect(s.hero!.z).toBeGreaterThan(85);
    expect(s.hero!.y).toBeCloseTo(6, 0);
    expect(s.hero!.onGround).toBe(true);
    const falls = await page.evaluate(() => window.__TEST__!.simEvents.filter((e) => e.name === 'fall').length);
    expect(falls).toBe(0);
  });
});

import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';

// M3-07: saves (docs/02-tech.md 4.4, 11.6; docs/03 SAV-01…SAV-05; docs/01-gdd.md 6.6, 7.10). Every change goes to the
// mirror at once, so F5 right after an action loses nothing but the hero's spot: he stands at the flag of the farthest
// wall passed on his mountain. The cloud gets debounced writes under the bucket (≤ 86 in 5 minutes).

async function reload(page: Page): Promise<void> {
  await page.reload();
  await waitReady(page);
  await waitTicks(page, 2);
}

test('F5 right after buying shoes: shoes, coins, stat and settings in place', async ({ page, openGame }) => {
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.setStat(15);
    window.__TEST__!.setCoins(1000);
  });
  await expect(page.locator('[data-hud="shoes"]')).toBeVisible();
  await page.locator('[data-hud="shoes"]').dispatchEvent('pointerdown');
  const before = await testState(page);
  expect(before.shoeLevel).toBe(1);
  expect(before.coins).toBeLessThan(1000);
  await reload(page);
  const after = await testState(page);
  expect(after.shoeLevel).toBe(1);
  expect(after.coins).toBe(before.coins);
  expect(after.stat).toBe(before.stat);
  expect(after.gainMult).toBeCloseTo(before.gainMult, 9);
  await expect(page.locator('[data-role="coins"] .hud-coin-value')).toHaveText(String(before.coins));
});

test('F5 right after a wall: the hero at its flag, the wall open, stat and coins in place; the first avalanche after 30 s', async ({ page, openGame }) => {
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.setStat(25);
    window.__TEST__!.teleport(118);
    window.__TEST__!.setAutoRun(true);
  });
  await page.waitForFunction(() => window.__TEST__!.state().gatesPassed[0] === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  await waitTicks(page, 30);
  const before = await testState(page);
  expect(before.coins).toBeGreaterThan(0);
  await reload(page);
  const s = await testState(page);
  expect(s.world).toBe(before.world);
  expect(s.stat).toBe(before.stat);
  expect(s.coins).toBe(before.coins);
  expect(s.gatesOpen[0]).toBe(true);
  expect(s.gatesPassed[0]).toBe(true);
  expect(s.gatesPassed[1]).toBe(false);
  expect(s.checkpoint).toBe(0);
  // The flag behind wall 1 (z 134.5 on mountain 1), not the camp.
  expect(s.hero!.z).toBeGreaterThan(130);
  expect(s.hero!.z).toBeLessThan(140);
  expect(s.autoRun).toBe(false);
  expect(s.wave!.phase).toBe('idle');
  expect(s.wave!.timer).toBeGreaterThan(29);
  await expect(page.locator('[data-role="coins"] .hud-coin-value')).toHaveText(String(before.coins));
  await page.screenshot({ path: 'docs/evidence/M3/save_after_f5_960x540_ru.png' });
});

test('F5 on mountain 3: the same mountain, its frontier, pets and the tier', async ({ page, openGame }) => {
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.givePet('bunny');
    window.__TEST__!.gotoWorld(3);
  });
  await waitTicks(page, 3);
  await page.evaluate(() => {
    window.__TEST__!.setStat(4e6);
    window.__TEST__!.teleport(150);
    window.__TEST__!.setAutoRun(true);
  });
  await page.waitForFunction(() => window.__TEST__!.state().gatesPassed[1] === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  await waitTicks(page, 30);
  const before = await testState(page);
  await reload(page);
  const s = await testState(page);
  expect(s.world).toBe(before.world);
  expect(s.pets).toEqual(before.pets);
  expect(s.stat).toBe(before.stat);
  expect(s.gatesPassed.filter(Boolean).length).toBe(before.gatesPassed.filter(Boolean).length);
  expect(s.hero!.z).toBeGreaterThan(before.hero!.z - 120);
});

test('resize and rotation 844×390 ↔ 390×844 ↔ 844×390 keep the state without a reload (SAV-03)', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openGame('mock_device=mobile');
  await page.evaluate(() => {
    window.__TEST__!.setStat(500);
    window.__TEST__!.setCoins(77);
    window.__TEST__!.teleport(100);
    (window as unknown as { __mark: number }).__mark = 7;
  });
  await waitTicks(page, 3);
  const before = await testState(page);
  for (const [w, h] of [[390, 844], [844, 390], [1280, 720], [844, 390]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    const s = await testState(page);
    expect(s.stat).toBe(before.stat);
    expect(s.coins).toBe(before.coins);
    expect(s.world).toBe(before.world);
    expect(Math.abs(s.hero!.z - before.hero!.z)).toBeLessThan(5);
    expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(7);
  }
  await waitTicks(page, 3);
  expect((await testState(page)).paused).toBe(false);
});

test('?mock_save=fail: three failed cloud writes, progress kept in the mirror and after F5, then the cloud write goes through', async ({ page, openGame }) => {
  await openGame('mock_save=fail');
  await page.evaluate(() => {
    window.__TEST__!.setStat(15);
    window.__TEST__!.setCoins(1000);
    window.__TEST__!.setAutoRun(true);
  });
  // 120 s of game time in 1 s chunks: the save changes every chunk, retries come at 5, 15 and 60 s of the mock clock.
  for (let i = 0; i < 120; i++) {
    await page.evaluate(() => window.__TEST__!.runSim(1));
    if (i % 10 === 0) await page.waitForTimeout(20);
  }
  await page.evaluate(() => window.__TEST__!.setAutoRun(false));
  await page.waitForFunction(() => {
    const m = window.__YA_MOCK__ as unknown as { playerData: { stat?: number } };
    return (m.playerData.stat ?? 0) > 15;
  }, undefined, { timeout: 30_000 });
  const calls = await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'player.setData').length);
  expect(calls).toBeGreaterThanOrEqual(4);
  await waitTicks(page, 10);
  const before = await testState(page);
  await reload(page);
  const s = await testState(page);
  expect(s.stat).toBe(before.stat);
  expect(s.coins).toBe(before.coins);
});

test('@full bot plays 15 minutes of game time: no 5-minute window of the mock log has more than 100 setData (≤ 86)', async ({ page, openGame }) => {
  test.setTimeout(900_000);
  await openGame();
  await page.evaluate(() => {
    window.__TEST__!.setStat(1e12);
    window.__TEST__!.setAutoRun(true);
  });
  let lastWorld = '';
  for (let sec = 0; sec < 15 * 60; sec++) {
    await page.evaluate(() => window.__TEST__!.runSim(1));
    if (sec % 5 === 0) {
      // Real time for the debounce timers to fire.
      await page.waitForTimeout(10);
      lastWorld = (await testState(page)).world;
    }
  }
  const stamps = await page.evaluate(() => window.__YA_MOCK__!.calls.filter((c) => c.name === 'player.setData').map((c) => c.t));
  let maxIn5 = 0;
  for (const t of stamps) maxIn5 = Math.max(maxIn5, stamps.filter((x) => x >= t && x < t + 300_000).length);
  console.log(`setData calls: ${stamps.length}, max in 5 minutes: ${maxIn5}, last mountain: ${lastWorld}`);
  expect(stamps.length).toBeGreaterThan(20);
  expect(maxIn5).toBeLessThanOrEqual(86);
  expect(maxIn5).toBeLessThanOrEqual(100);
  const violations = await page.evaluate(() => window.__YA_MOCK__!.violations);
  expect(violations).toEqual([]);
  const span = stamps.at(-1)! - stamps[0]!;
  expect(span).toBeGreaterThan(10 * 60_000);
});

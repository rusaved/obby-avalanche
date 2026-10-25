import { test, expect, testState, waitReady, waitTicks } from './fixtures.ts';

// M5-04 (docs/03 SND-01, SND-05): all sound through Web Audio — no <audio>, <video> or HTMLMediaElement.play; the effects
// switch is kept over F5; the game runs with no music files (assets/audio/music/ is empty: docs/QUESTIONS Q-M5-1).
test('SND-01: no <audio> or <video>, HTMLMediaElement.play never called, a played round of sounds', async ({ page, openGame }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __mediaPlays: number };
    w.__mediaPlays = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) {
      w.__mediaPlays++;
      return orig.apply(this, a);
    };
  });
  await openGame('pace=stages');
  await page.keyboard.press('F8');
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().audioRunning), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__TEST__!.keyDown('KeyW'));
  await waitTicks(page, 90);
  await page.evaluate(() => window.__TEST__!.keyUp('KeyW'));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitTicks(page, 30);
  const s = await testState(page);
  expect(s.hums['avalancheRumble'] ?? 0).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.querySelectorAll('audio,video').length)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __mediaPlays: number }).__mediaPlays)).toBe(0);
});

test('SND-05: the effects switch survives F5, off — no sound plays', async ({ page, openGame }) => {
  await openGame('pace=stages');
  const btn = page.locator('.hud-sound');
  await expect(btn).toHaveAttribute('data-on', 'true');
  await btn.click();
  await expect(btn).toHaveAttribute('data-on', 'false');
  await page.reload();
  await waitReady(page);
  await expect(page.locator('.hud-sound')).toHaveAttribute('data-on', 'false');
  await page.keyboard.press('F8');
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitTicks(page, 30);
  const s = await testState(page);
  expect(s.sfx).toEqual([]);
  expect(s.hums['avalancheRumble'] ?? 0).toBe(0);
});

import { test, expect } from './fixtures.ts';

// G-01 (producer 26.10): on mountain 1 the first avalanche comes within the first minute (the scripted wave, at the
// latest by ftue.fallbackSec), and never while the hero is in a giant's zone; the first giant catch rolls nothing back.
test.describe('G-01 · first minute of mountain 1', () => {
  test.use({ viewport: { width: 880, height: 405 } });

  test('a newbie standing in the camp meets the first avalanche before 60 s', async ({ page, openGame }) => {
    await openGame('pace=stages');
    const w0 = await page.evaluate(() => window.__TEST__!.state().wave);
    expect(w0?.scriptedPending).toBe(true);
    await page.evaluate(() => window.__TEST__!.runSim(40));
    const w = await page.evaluate(() => window.__TEST__!.state().wave!);
    expect(w.phase === 'warn' || w.phase === 'run' || w.phase === 'gone' || w.scriptedPending === false, `phase ${w.phase}`).toBe(true);
    expect(w.scripted || w.scriptedPending === false).toBe(true);
  });

  test('not inside the giant zone: the wave waits till the hero is out', async ({ page, openGame }) => {
    await openGame('pace=stages');
    const zone = await page.evaluate(() => window.__TEST__!.state().boss!.zones[0]!.zone);
    const mid = (zone[0] + zone[1]) / 2;
    for (let i = 0; i < 9; i++) {
      await page.evaluate((z) => {
        window.__TEST__!.teleport(z, 0);
        window.__TEST__!.resetGiants();
        window.__TEST__!.runSim(5);
      }, mid);
      const z = await page.evaluate(() => window.__TEST__!.state().hero!.z);
      if (z >= zone[0] && z <= zone[1]) expect(await page.evaluate(() => window.__TEST__!.state().wave!.phase)).toBe('idle');
    }
    // Z-01: out of it where a grotto is in reach (above it lies the safe finish under a closed ridge — the wave waits there).
    await page.evaluate((z) => {
      window.__TEST__!.teleport(z, 0);
      window.__TEST__!.runSim(1);
    }, zone[0] - 40);
    expect(await page.evaluate(() => window.__TEST__!.state().wave!.phase)).not.toBe('idle');
  });

  test('the first giant catch keeps the hero in place, with «let you go»', async ({ page, openGame }) => {
    await openGame('pace=stages');
    await page.evaluate(() => {
      window.__TEST__!.setFlag('firstWaveDone', true);
      window.__TEST__!.holdWave(9000);
    });
    const zone = await page.evaluate(() => window.__TEST__!.state().boss!.zones[0]!.zone);
    const z0 = zone[0] + 4;
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), z0);
    await page.waitForFunction(() => window.__TEST__!.analytics().some((e) => e.name === 'boss_caught'), undefined, { timeout: 60_000 });
    const s = await page.evaluate(() => window.__TEST__!.state());
    expect(s.caught).toBeNull();
    expect(Math.abs(s.hero!.z - z0)).toBeLessThan(2);
    await expect(page.locator('body')).toContainText(/Великан отпустил|The giant let you go/);
  });
});

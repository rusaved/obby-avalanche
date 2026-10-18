import { test, expect, testState, waitTicks } from './fixtures.ts';
import { STAGES, flagOf, threshold } from './lv-stage-data.ts';

// MU-11 (docs/briefs/mu-mobile-ui.md): the giant is a trial at every meeting — on the phone (812 × 375, touch), two
// meetings in a row holding the stick forward: caught both times (before the fix the second meeting ran past a giant
// that had given the hero up, or one level above a straight run slipped by). The Speed the first try added is kept.
test.use({ viewport: { width: 812, height: 375 } });

test('the giant of mountain 1: forward is caught at the first and the second meeting', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages');
  const g = STAGES[0]!.stages.find((s) => s.type === 'giant')!;
  const f = flagOf(1, g);
  await page.evaluate(([st, z, y]) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(g.level), f.z, f.y] as const);
  await waitTicks(page, 10);
  for (let meet = 1; meet <= 2; meet++) {
    await page.evaluate(() => window.__TEST__!.stick(0, 1));
    // Caught (the snowball) or out of the far end of the zone, whichever first.
    await page.waitForFunction((end) => window.__TEST__!.state().caught !== null || window.__TEST__!.state().hero!.z > end, g.end, { timeout: 60_000 });
    const s = await testState(page);
    await page.evaluate(() => window.__TEST__!.stick(0, 0));
    expect(s.caught, `meeting ${meet}: caught (hero at z ${s.hero!.z.toFixed(0)})`).not.toBeNull();
    // Rolled back to the start of the giant's stage, the zone his again.
    await page.waitForFunction(() => window.__TEST__!.state().caught === null, undefined, { timeout: 30_000 });
    await waitTicks(page, 10);
    const after = await testState(page);
    expect(after.hero!.z, `meeting ${meet}: back below the zone`).toBeLessThan(g.start);
    expect(after.boss!.zones[0]!.hero).toBe('out');
  }
});

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

// MU round of fixes (staff check 19.10): from a clean save holding forward got past the giant at 2 of 4 meetings (the
// levels of mountain 1 are cheap — by the second meeting the hero was 4 above the stage and a straight run slipped past),
// then the first crack of stage 3 rolled him back before the giant. Forward is caught at every meeting now (no slip
// margin); past the giant a fall on the next stage keeps its own start (`caught.pastGiant`, Q-MU-12).
test('from a clean save on mountain 1: holding forward is caught at 10 meetings in a row', async ({ page, openGame }) => {
  test.setTimeout(420_000);
  await openGame('pace=stages');
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  const meets = (): Promise<{ caught: number; passed: number }> =>
    page.evaluate(() => {
      const ev = window.__TEST__!.simEvents;
      return { caught: ev.filter((e) => e.name === 'bossCaught').length, passed: ev.filter((e) => e.name === 'bossPassed').length };
    });
  await page.waitForFunction(() => window.__TEST__!.simEvents.filter((e) => e.name === 'bossCaught' || e.name === 'bossPassed').length >= 10, undefined, { timeout: 400_000 });
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  const m = await meets();
  expect(m.passed, 'forward never gets past him').toBe(0);
  expect(m.caught).toBeGreaterThanOrEqual(10);
});

test('a dodge at the last moment gets past, and the hero stays on stage 3 (a crack there keeps its own start)', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('pace=stages');
  const g = STAGES[0]!.stages.find((s) => s.type === 'giant')!;
  const next = STAGES[0]!.stages.find((s) => s.n === g.n + 1)!;
  const f = flagOf(1, g);
  await page.evaluate(([st, z, y]) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(next.level), f.z, f.y] as const);
  await waitTicks(page, 10);
  // The player's hand in the page, frame by frame: up the slope; the giant ahead and under ~0.3 s away — the stick hard
  // to the side away from him; past him — up again and on into stage 3 (the first crack is not jumped on purpose).
  const passes = (STAGES[0]!.segments.find((x) => x.type === 'gate' && Math.abs(x.z - next.z0) < 1e-6)!['passes'] as number[]) ?? [0];
  await page.evaluate(([end, ways]) => {
    const T = window.__TEST__!;
    let side = 0;
    let from = 0;
    const tick = (): void => {
      (window as unknown as { __dodge: number }).__dodge = requestAnimationFrame(tick);
      const s = T.state();
      const h = s.hero;
      const z = s.boss?.zones[0];
      const gi = z?.giants[0];
      if (!h || !z || !gi) return;
      if (s.caught) side = 0;
      else if (z.hero === 'in' && side === 0 && gi.z > h.z && Math.hypot(gi.x - h.x, gi.z - h.z) / (h.speed + 15) < 0.3) {
        side = gi.x > h.x ? -1 : 1;
        from = h.x;
      }
      // A step aside of 14 units (the stage-bot of tests/sim), then up again; past the zone — the world-space bot through
      // the nearest pass of the ridge of stage 3 (a wall stands between the passes; the stick turns with the camera).
      if (h.z > end && !s.caught) {
        cancelAnimationFrame((window as unknown as { __dodge: number }).__dodge);
        const way = ways.reduce((a, b) => (Math.abs(b - h.x) < Math.abs(a - h.x) ? b : a));
        T.stick(0, 0);
        T.botPath([[way, end + 20], [way, end + 90]]);
        return;
      }
      T.stick(side !== 0 && Math.abs(h.x - from) < 14 ? side : 0, side !== 0 && Math.abs(h.x - from) < 14 ? 0.35 : 1);
    };
    tick();
  }, [g.end, passes] as const);
  // A few attempts may be caught (the dodge is a moment, not a sure thing): at most 5 tries for one pass.
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'bossPassed') || window.__TEST__!.simEvents.filter((e) => e.name === 'bossCaught').length >= 5, undefined, { timeout: 240_000 });
  expect(await page.evaluate(() => window.__TEST__!.simEvents.some((e) => e.name === 'bossPassed')), 'got past the giant').toBe(true);
  // On into the first crack of stage 3: the roll keeps stage 3, never back before the giant.
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'fall'), undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__TEST__!.state().caught === null, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 60);
  const s = await testState(page);
  expect(s.stage, `stays on stage ${next.n} (hero z ${s.hero!.z.toFixed(0)})`).toBe(next.n);
  expect(s.hero!.z).toBeGreaterThan(g.end);
});

// Staff check 19.10: on the PC «Continue from stage N» came after a roll-back, on the phone not — the phone slot offers it
// too (the first of a mountain free).
test('phone: a fall on stage 4 rolls to stage 3 and the slot offers «Continue from stage 4»', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages&mock_ad=ok');
  await waitTicks(page, 10);
  const st = STAGES[0]!.stages[3]!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(st.level) * 1.01, st.start - 4, st.y] as const);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.botPath([[30, z]]), st.start + 6);
  await page.waitForFunction(() => window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.waitForFunction(() => !window.__TEST__!.state().caught, undefined, { timeout: 20_000 });
  const free = page.locator('button.hud-ad[data-ad=continue_free]');
  await expect(free).toBeVisible({ timeout: 10_000 });
  await expect(free).toContainText(String(st.n));
});

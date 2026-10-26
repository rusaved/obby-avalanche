import { test, expect, waitTicks } from './fixtures.ts';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round 3, item 5 (producer 19.10): the golden pad of a stage's reward stood on the run to the outer pass (x 26, the
// pass at 33.3 ± 5.5) — a step on it is the reward and the flight to the camp. The pads stand by the edge of the field
// now: a run from the end of a stage to any pass of the next ridge never steps on one; taken, the plaque says no more
// «you can run past». On the truthful profile (915 × 412 and 815 × 290).

const W = STAGES[0]!;
const gateAt = (z: number): { passes: number[] } => {
  const g = W.segments.find((s) => s.type === 'gate' && Math.abs(s.z - z) < 1e-3)!;
  return { passes: (g['passes'] as number[] | undefined) ?? [0] };
};

test('straight runs up through the finishes of stages 2–5, anywhere across the passes (x −38…38), never step on the pad', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
  });
  await page.touchscreen.tap(width / 2, height / 2);
  // The outer pass of a ridge ends at 33.3 + 5.5: a run up to any pass is within ±38.8 (before: the pad at 23–29).
  const outer = Math.max(...W.stages.slice(1, 5).flatMap((st) => gateAt(st.finish[1]).passes.map((p) => Math.abs(p) + 5.5)));
  let runs = 0;
  for (const st of W.stages.slice(1, 5)) {
    const next = W.stages.find((s) => s.n === st.n + 1)!;
    expect(Math.abs(st.pad.x) - 3, `stage ${st.n}: the pad past the corridor of the outer pass`).toBeGreaterThan(outer);
    for (let x = -38; x <= 38; x += 4) {
      await page.evaluate(([s, z, xx, y]) => {
        const t = window.__TEST__!;
        t.setStat(s);
        t.teleport(z, xx, y);
      }, [threshold(next.level), st.finish[0] + 0.5, x, st.y + 0.5] as const);
      await waitTicks(page, 3);
      const taken = await page.evaluate(() => window.__TEST__!.state().padsTaken);
      await page.evaluate(([xx, z]) => window.__TEST__!.botPath([[xx, z]]), [x, st.finish[1] - 1] as const);
      await page.waitForFunction(() => window.__TEST__!.botLeft() === 0 || window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
      await page.evaluate(() => window.__TEST__!.botPath(null));
      const s = await page.evaluate(() => ({ taken: window.__TEST__!.state().padsTaken, z: window.__TEST__!.state().hero!.z }));
      expect(s.taken, `stage ${st.n}: a run up at x ${x} stepped on the pad`).toBe(taken);
      expect(s.z, `stage ${st.n}: a run up at x ${x} — no flight to the camp`).toBeGreaterThan(st.finish[0]);
      runs++;
    }
  }
  expect(runs).toBe(4 * 20);
});

test('on the pad: «+N · to camp» without «you can run past» once taken', async ({ page, openGame }) => {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  const st3 = W.stages[2]!;
  await page.evaluate(([s]) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
  }, [threshold(st3.level + 2)] as const);
  await page.touchscreen.tap(width / 2, height / 2);
  // Before it: the plaque with «you can run past».
  await page.evaluate(([z, x, y]) => window.__TEST__!.teleport(z, x, y), [st3.finish[0] + 1, st3.pad.x, st3.y + 1] as const);
  await waitTicks(page, 20);
  await expect(page.locator('[data-role="pad-label"] .hud-pad-sub')).toHaveText('можно бежать мимо');
  // G-02 (producer 26.10): standing on it — «+N · to camp» with the ring, no «you can run past» (the flight in ~0.5 s).
  await page.evaluate((p) => window.__TEST__!.teleport(p.z, p.x, p.y + 1), st3.pad);
  await expect(page.locator('[data-role="pad-label"].shown')).toBeVisible();
  await expect(page.locator('[data-role="pad-label"]')).toContainText('в лагерь');
  await expect(page.locator('[data-role="pad-label"] .hud-pad-sub')).toHaveText('');
  await page.screenshot({ path: `docs/evidence/MU/r4/${width}x${height}/l3-on-pad.png` });
});

import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { STAGES, threshold } from './lv-stage-data.ts';
import { labelsOverHud } from './mu-checks.ts';

// MU round 4, item 4 (producer 20.10: «Stage reward» and the plaques of the portals big, read from afar, standing in the
// middle from the start of a stage and shaking). On the phone a world label shows within 18 m of its pad or arch and (round 5: ×1.5)
// hides past 21 m (a gap — no blinking at the border); no wider than a quarter of the frame, never in the top middle,
// never on the hero; its place glides. A run to a pad and to the arches: past 21 m no label, the label flips at most once
// in 0.5 s. On the truthful profile (880 × 405, 915 × 412, 815 × 290).

const W = STAGES[0]!;
type Sample = { t: number; dist: number; shown: boolean; x: number; y: number; w: number; h: number; hero: { x0: number; x1: number; y0: number; y1: number } | null };

/** Samples a label every 50 ms while `run` goes: shown, its box, the hero's distance to (x, z) — the nearest of `points`. */
async function sample(page: Page, sel: string, points: Array<[number, number]>, run: () => Promise<void>): Promise<Sample[]> {
  await page.evaluate(([s, pts]) => {
    const out: Sample[] = [];
    (window as unknown as { __labelSamples: Sample[] }).__labelSamples = out;
    const t0 = performance.now();
    const id = setInterval(() => {
      const st = window.__TEST__!.state();
      const h = st.hero!;
      const dist = Math.min(...pts.map(([x, z]) => Math.hypot(x - h.x, z - h.z)));
      const els = Array.from(document.querySelectorAll<HTMLElement>(s)).filter((e) => e.classList.contains('shown') && e.style.visibility !== 'hidden');
      const e = els[0];
      const r = e?.getBoundingClientRect();
      out.push({ t: (performance.now() - t0) / 1000, dist, shown: !!e, x: r?.left ?? 0, y: r?.top ?? 0, w: r?.width ?? 0, h: r?.height ?? 0, hero: null });
    }, 50);
    (window as unknown as { __labelStop: () => void }).__labelStop = () => clearInterval(id);
  }, [sel, points] as const);
  await run();
  return page.evaluate(() => {
    (window as unknown as { __labelStop: () => void }).__labelStop();
    return (window as unknown as { __labelSamples: Sample[] }).__labelSamples;
  });
}

/** Past 21 m no label (a sample's lag of 50 ms at a run allows 1 m more); flips no closer than 0.5 s; a quarter wide. */
function check(samples: Sample[], width: number, height: number, label: string): void {
  expect(samples.length, label).toBeGreaterThan(20);
  expect(samples.some((s) => s.shown), `${label}: the label showed near`).toBe(true);
  for (const s of samples) if (s.shown) expect(s.dist, `${label}: shown at ${s.dist.toFixed(1)} m`).toBeLessThanOrEqual(22);
  const flips = samples.filter((s, i) => i > 0 && s.shown !== samples[i - 1]!.shown).map((s) => s.t);
  for (let i = 1; i < flips.length; i++) expect(flips[i]! - flips[i - 1]!, `${label}: flips at ${flips.join(', ')}`).toBeGreaterThanOrEqual(0.45);
  for (const s of samples.filter((x) => x.shown)) {
    expect(s.w, `${label}: no wider than a quarter`).toBeLessThanOrEqual(width / 4 + 0.5);
    const topMid = s.y < height * 0.3 && s.x + s.w > width / 4 && s.x < (width * 3) / 4;
    expect(topMid, `${label}: not in the top middle (${Math.round(s.x)}, ${Math.round(s.y)})`).toBe(false);
  }
}

test('a run to the pad of stage 3: «Stage reward» only within 21 m, no blinking, a quarter wide at most', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  const st = W.stages[2]!;
  await page.evaluate(([s]) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
  }, [threshold(st.level + 2)] as const);
  await page.touchscreen.tap(width / 2, height / 2);
  // From 40 m short of the pad on its line, up to it and back down past 21 m.
  await page.evaluate(([z, x, y]) => window.__TEST__!.teleport(z, x, y), [st.pad.z - 40, st.pad.x * 0.8, st.y + 1] as const);
  await waitTicks(page, 10);
  const samples = await sample(page, '[data-role="pad-label"]', [[st.pad.x, st.pad.z]], async () => {
    for (const z of [st.pad.z - 6, st.pad.z - 30]) {
      await page.evaluate(([x, zz]) => window.__TEST__!.botPath([[x, zz]]), [st.pad.x * 0.8, z] as const);
      await page.waitForFunction(() => window.__TEST__!.botLeft() === 0 || window.__TEST__!.state().caught !== null, undefined, { timeout: 30_000 });
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => window.__TEST__!.botPath(null));
  });
  if (process.env.LBL_DEBUG) console.log(JSON.stringify(samples.map((x) => [x.t.toFixed(2), x.dist.toFixed(1), x.shown ? 1 : 0, Math.round(x.x), Math.round(x.y)])));
  check(samples, width, height, 'pad');
  expect(await labelsOverHud(page)).toEqual([]);
});

test('a run to the arches of the base: the portal plaques only within 21 m, no blinking', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate((s) => {
    window.__TEST__!.setPlaySec(400);
    window.__TEST__!.holdWave(900);
    window.__TEST__!.setStat(s);
  }, threshold(30));
  await page.touchscreen.tap(width / 2, height / 2);
  const last = W.stages[W.stages.length - 1]!;
  const portal = W.segments.find((s) => s.type === 'portal')!;
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y), [last.finish[0] + 2, last.y + 0.5] as const);
  await waitTicks(page, 10);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction(() => window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
  await expect(page.locator('[data-role="window"].open')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const portals = (await page.evaluate(() => window.__TEST__!.state().basePortals)).filter((p) => !p.hidden);
  const own = portals.find((p) => p.state === 'own')!;
  // From the place of the arrival: no plaque (the arches are farther than 21 m), the way — arrows on the snow.
  const start = await page.evaluate(() => window.__TEST__!.state().hero!);
  const far = Math.min(...portals.map((p) => Math.hypot(p.x - start.x, p.z - start.z)));
  if (far > 21) expect(await page.locator('[data-role="portal-label"].shown').evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.visibility !== 'hidden').length), 'no plaque from afar').toBe(0);
  const samples = await sample(page, '[data-role="portal-label"]', portals.map((p) => [p.x, p.z] as [number, number]), async () => {
    await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [own.x - 6 * Math.sin(own.yaw), own.z - 6 * Math.cos(own.yaw)] as const);
    await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [start.x, start.z] as const);
    await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__TEST__!.botPath(null));
  });
  check(samples, width, height, 'portals');
});

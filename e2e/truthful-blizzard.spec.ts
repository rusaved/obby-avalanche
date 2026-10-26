import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { STAGES, threshold } from './lv-stage-data.ts';

// MU round 5, item 5 (producer 21.10): the blizzard holds back the feet only — a jump in it is not slowed; the first
// blizzard says «Blizzard! Jump, it's faster» in the slot while the hero is in it, until his first jump there.

const W = STAGES[1]!;
const st = W.stages.find((s) => s.type === 'blizzard')!;
const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/MU/r5/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};
type H = { speed: number; vx: number; vz: number; onGround: boolean; z: number };
const hero = (page: Page): Promise<H> => page.evaluate(() => window.__TEST__!.state().hero!);

test('in the blizzard: «Blizzard! Jump, it\'s faster» in the slot, a jump not slowed', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => window.__TEST__!.gotoWorld(2));
  await waitTicks(page, 30);
  await page.evaluate((s) => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.holdWave(9000);
    t.setStat(s);
  }, threshold(st.level + 1));
  await page.touchscreen.tap(width / 2, height / 2);
  // In just before the blizzard stage: entering it starts its blizzard.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [st.start - 6, st.y] as const);
  await page.evaluate(([z]) => window.__TEST__!.botPath([[0, z]]), [st.start + 30] as const);
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().blizzard.on), { timeout: 20_000 }).toBe(true);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await expect(page.locator('[data-role="tutor"]')).toContainText(/Буран! Прыгай, так быстрее|Blizzard! Jump, it's faster/);
  await page.screenshot({ path: `${dirOf(page)}/blizzard-hint.png` });
  // Run on the first leg of the bridge (on the axis): the speed on the feet, then in a jump.
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  await waitTicks(page, 40);
  const ground = await hero(page);
  expect(ground.onGround).toBe(true);
  await page.evaluate(() => window.__TEST__!.jump());
  let air: H | null = null;
  for (let i = 0; i < 20 && !air; i++) {
    await waitTicks(page, 3);
    const h = await hero(page);
    if (!h.onGround) air = h;
  }
  expect(air, 'in the air').not.toBeNull();
  await page.screenshot({ path: `${dirOf(page)}/blizzard-jump.png` });
  const runOnFeet = Math.hypot(ground.vx, ground.vz);
  const runInAir = Math.hypot(air!.vx, air!.vz);
  console.log(`in the blizzard: feet ${runOnFeet.toFixed(2)}, air ${runInAir.toFixed(2)}`);
  // The blizzard is ×0.7 on the feet; in the air the full run (never slower than the feet / 0.7 with some slack).
  expect(runInAir, 'a jump is not slowed by the blizzard').toBeGreaterThan(runOnFeet * 1.25);
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  // His first jump there taught it: the hint is gone.
  await waitTicks(page, 30);
  // The plaque hides (its last text may stay in the hidden element when nothing takes the slot after it).
  await expect
    .poll(() => page.evaluate(() => {
      const el = document.querySelector('[data-role="tutor"]')!;
      return el.classList.contains('shown') && /Буран! Прыгай|Blizzard! Jump/.test(el.textContent ?? '');
    }))
    .toBe(false);
});

import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { STAGES, flagOf, ready, threshold } from './lv-stage-data.ts';

// ST-01 (producer 22.10: the tutorial 2–3 times fuller, up to stage 2 of mountain 2): a new player past the first minute
// does only what the plaque says — the treadmill (with its arrow), the level, the way through the ridge, the reward pad,
// the sneakers in the shop, on to the summit, the portal of mountain 2, its stage 2 and the gift. Each plaque is short
// (6 words at most), one at a time, and none stands over an open window. The run between the plaques (the trials
// themselves) is the bot of lv-types — here the hero is carried along the stages the plaque sends him to.
const W1 = STAGES[0]!;
const W2 = STAGES[1]!;
type Seg = { type: string; z: number; x?: number; y?: number };

/** The plaque of the message slot now (MU-02: one at a time — the tutorial step, or the ridge's «Level up on a treadmill»). */
const SLOT = '[data-role=tutor].shown, [data-role=need].shown';
async function tutorText(page: Page, re: RegExp): Promise<string> {
  await expect.poll(async () => (await page.locator(SLOT).allInnerTexts()).join(' | '), { timeout: 30_000 }).toMatch(re);
  const text = (await page.locator(SLOT).allInnerTexts()).find((x) => re.test(x))!.trim();
  expect(text.split(/\s+/).length, `«${text}»: six words at most`).toBeLessThanOrEqual(6);
  return text;
}
const tutorStep = async (page: Page): Promise<number> => (await testState(page)).tutor;

test('ST-01: a new player gets to stage 2 of mountain 2 by the plaques alone', async ({ page, openGame }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('pace=stages');
  await waitTicks(page, 10);
  // The first minute (its own hints, e2e open-first-minute) done; the hero at the flag of stage 2.
  await ready(page);
  const s2 = W1.stages[1]!;
  const f2 = flagOf(1, s2);
  // The Speed of a new player at stage 2 (its own level): the ridge of stage 3 is closed.
  await page.evaluate(([st, z, y]) => {
    window.__TEST__!.setStat(st);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(s2.level), f2.z, f2.y] as const);
  expect(await tutorStep(page)).toBe(0);

  // 1. «Stand on the treadmill» — at the finish of stage 2, its arrow to the belt.
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [s2.finish[0] + 2, s2.y] as const);
  await tutorText(page, /Встань на дорожку|Набери уровень на дорожке|Stand on the treadmill|Level up on a treadmill/);
  await expect(page.locator(SLOT).filter({ visible: true }).locator('[data-role=slot-arrow]')).toBeVisible();
  const belt = (W1.segments as Seg[]).find((s) => s.type === 'treadmill' && s.z > s2.finish[0] - 1 && s.z < s2.finish[1] + 1)!;
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [belt.x ?? 0, belt.z] as const);
  await expect.poll(() => tutorStep(page), { timeout: 30_000 }).toBe(1);
  await page.evaluate(() => window.__TEST__!.botPath(null));

  // 2. «Reach level N» — stand on the belt till the ridge opens (game time ×8).
  await tutorText(page, /Набери уровень|Reach level|Level up/);
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await expect.poll(() => tutorStep(page), { timeout: 150_000, intervals: [1000] }).toBe(2);
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));

  // 3. «The way is open, run!» — through the ridge of stage 3.
  const s3 = W1.stages[2]!;
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z - 20, 0, y + 0.5), [s3.z0, s2.y] as const);
  await tutorText(page, /Проход открыт|The way is open/);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 14]]), s3.z0);
  await expect.poll(() => tutorStep(page), { timeout: 30_000 }).toBe(3);
  await page.evaluate(() => window.__TEST__!.botPath(null));

  // 4. «Stand on the gold pad» — the reward of stage 4 (carried past the giant of stage 3 to the finish of the next).
  const s4 = W1.stages[3]!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(s4.level) * 1.05, s4.finish[0] + 2, s4.y] as const);
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [s4.pad.x + 10, s4.pad.z - 4, s4.y] as const);
  await tutorText(page, /золотую площадку|gold pad/);
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [s4.pad.x, s4.pad.z] as const);
  await expect.poll(() => tutorStep(page), { timeout: 30_000 }).toBe(4);
  await page.evaluate(() => window.__TEST__!.botPath(null));

  // 5. «Buy sneakers in the shop» — the shop of the HUD, the first pair; the plaque never over the window.
  await tutorText(page, /Купи кроссовки|Buy sneakers/);
  await page.locator('[data-hud="menu-shop"]').dispatchEvent('pointerdown');
  await expect(page.locator('[data-role="window"].open')).toBeVisible();
  await expect(page.locator(SLOT).filter({ visible: true })).toHaveCount(0);
  await page.locator('[data-hud="shop-tab-shoes"]').click();
  await page.locator('[data-role="window"].open [data-item="runners"] [data-hud="shop-item"]').click();
  await page.locator('[data-hud="win-close"]').click();
  await expect.poll(() => tutorStep(page), { timeout: 20_000 }).toBe(5);

  // 6. «Run on to the summit!» — on up, the stages carried to the summit and its portal.
  const back = await testState(page);
  const at = W1.stages.find((s) => s.n === Math.max(2, back.stage))!;
  await page.evaluate(([z, y]) => window.__TEST__!.teleport(z, 0, y + 0.5), [at.finish[0] + 2, at.y] as const);
  await tutorText(page, /Беги дальше|Run on/);
  const last = W1.stages[W1.stages.length - 1]!;
  const portal = (W1.segments as Seg[]).find((s) => s.type === 'portal')!;
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(last.level) * 2, last.finish[0] + 2, last.y] as const);
  await expect.poll(() => tutorStep(page), { timeout: 20_000 }).toBe(6);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z + 2]]), portal.z);
  await expect(page.locator('[data-role="window"].open')).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await page.locator('[data-hud="win-next"]').click();

  // 7. On the base: «Run into the mountain 2 portal», its arrow.
  await tutorText(page, /портал горы 2|mountain 2 portal/);
  await expect(page.locator('[data-role=tutor] [data-role=slot-arrow]')).toBeVisible();
  const bp = (await testState(page)).basePortals.find((b) => b.world === 2)!;
  await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [bp.x, bp.z] as const);
  await expect.poll(async () => (await testState(page)).world, { timeout: 60_000 }).toBe((W2 as unknown as { id: string }).id);
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await waitTicks(page, 20);
  await expect.poll(() => tutorStep(page), { timeout: 20_000 }).toBe(7);

  // 8. «Mountain 2: new trials!» — up to its stage 2.
  await tutorText(page, /Гора 2|Mountain 2/);
  const m2s2 = W2.stages[1]!;
  const f = flagOf(2, m2s2);
  await page.evaluate(([s, z, y]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z, 0, y + 0.5);
  }, [threshold(m2s2.level) * 1.05, f.z, f.y] as const);
  await expect.poll(() => tutorStep(page), { timeout: 20_000 }).toBe(8);

  // 9. «Take your gift, top right» — last (game designer review: the time gifts open at 5 min, the steps did not wait for them) — the gift plaque of the HUD, «Take» in the window.
  // Five minutes of play in all (the gift plaque opens, balance.ui.unlockTimeRewardsSec) and a minute today (its first gift).
  await page.evaluate(() => {
    window.__TEST__!.setPlaySec(310);
    window.__TEST__!.addPlayToday(70);
  });
  await tutorText(page, /Забери подарок|Take your gift/);
  await page.locator('[data-hud="gift"]').dispatchEvent('pointerdown');
  await page.locator('[data-role="window"].open [data-hud="gift-claim"]').first().click();
  await page.locator('[data-hud="win-close"]').click();
  await expect.poll(() => tutorStep(page), { timeout: 20_000 }).toBe(9);

  await expect(page.locator('[data-role=tutor]')).toBeHidden();
});

import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// MU round 5, item 4 (producer 21.10): the golden gift — its reward at the moment it is handed in in the cave, one toast
// «Gift saved! +N» with the coin; «Phew, made it!» with no number of its own; no «Golden gift! +N». Almost in a cave
// (its mouth, within the grace) — the avalanche lets him off and nothing says «back to the stage start»: «in a cave» is
// one check for the avalanche and the roll-back.

const dirOf = (page: Page): string => {
  const { width, height } = page.viewportSize()!;
  const d = `docs/evidence/MU/r5/${width}x${height}`;
  mkdirSync(d, { recursive: true });
  return d;
};
async function start(page: Page, openGame: (q?: string) => Promise<void>): Promise<void> {
  await openGame('pace=stages&mock_fullscreen=deny');
  const { width, height } = page.viewportSize()!;
  await page.evaluate(() => {
    const t = window.__TEST__!;
    t.setPlaySec(400);
    t.setStat(1e6);
    t.holdWave(9000);
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    const el = document.querySelector('[data-role="toast"]')!;
    new MutationObserver(() => {
      const s = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (s && seen[seen.length - 1] !== s) seen.push(s);
    }).observe(el, { childList: true, subtree: true, characterData: true });
  });
  await page.touchscreen.tap(width / 2, height / 2);
}
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.slice());
const phase = (page: Page): Promise<string> => page.evaluate(() => window.__TEST__!.state().wave?.phase ?? 'none');

test('the golden gift handed in: one toast «Gift saved! +N» with the coin, then «Phew, made it!» with no number', async ({ page, openGame }) => {
  test.setTimeout(90_000);
  await start(page, openGame);
  const cave = (await page.evaluate(() => window.__TEST__!.shelters())).find((s) => s.kind === 'grotto')!;
  await page.evaluate(([z]) => window.__TEST__!.teleport(z, 0), [cave.z] as const);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await expect.poll(() => phase(page), { timeout: 20_000 }).toMatch(/warn|run/);
  expect(await page.evaluate(() => window.__TEST__!.giveBonus()), 'the gift over his head').toBe(true);
  await page.evaluate(() => ((window as unknown as { __toasts: string[] }).__toasts.length = 0));
  // Into the cave with it.
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [cave.inside[0], cave.inside[1], cave.y] as const);
  await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 5_000 }).toMatch(/Сохранил подарок! \+\d+|Gift saved! \+\d+/);
  expect(await page.locator('[data-role="toast"] .mark-coin').count(), 'the coin mark on the toast').toBe(1);
  await expect(page.locator('[data-role="toast"]'), 'seen at once, over the avalanche plaque').toBeVisible();
  // Seen at once: the slot is the toast's, over the avalanche plaque.
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('.hud')!.dataset['slot'])).toBe('toast');
  await page.screenshot({ path: `${dirOf(page)}/cave-gift.png` });
  await expect.poll(() => phase(page), { timeout: 40_000 }).toMatch(/gone|idle/);
  await page.waitForTimeout(3_500);
  const all = await toasts(page);
  expect(all.filter((s) => /Сохранил подарок|Gift saved/.test(s)), `one gift toast: ${all.join(' | ')}`).toHaveLength(1);
  expect(all.some((s) => /Золотой подарок|Golden gift/.test(s)), all.join(' | ')).toBe(false);
  for (const s of all.filter((x) => /Уф, успел|Phew/.test(x))) expect(s, '«Phew» with no number').not.toMatch(/\d/);
});

test('standing at a cave mouth within the grace: the wave lets him off, no «back to the stage start», he stays', async ({ page, openGame }) => {
  test.setTimeout(90_000);
  await start(page, openGame);
  const cave = (await page.evaluate(() => window.__TEST__!.shelters())).find((s) => s.kind === 'grotto')!;
  // One metre out of the mouth onto the slope (the grace is 3).
  const out = Math.sign(cave.mouth[0] - cave.inside[0]);
  const at = { x: cave.mouth[0] + out * 1, z: cave.mouth[1] };
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [at.x, at.z, cave.y] as const);
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await expect.poll(() => phase(page), { timeout: 40_000 }).toMatch(/gone|idle/);
  await page.waitForTimeout(2_500);
  const all = await toasts(page);
  expect(all.some((s) => /Опа|Oops|Накрыло|Snowed/.test(s)), all.join(' | ')).toBe(false);
  const h = await page.evaluate(() => window.__TEST__!.state().hero!);
  expect(Math.hypot(h.x - at.x, h.z - at.z), 'he stays').toBeLessThan(2);
});

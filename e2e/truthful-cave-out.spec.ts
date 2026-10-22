import { test, expect, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { pastScriptedWave } from './base-route.ts';

// M4-R2 (rest of MU, producer 22.10): ran out of a cave while the avalanche goes — «back to the stage start» and «made it»
// came at once. One outcome per avalanche, by the one check shelterNow: in-out-in, ran out and stayed out, stood at the
// mouth — each time exactly one toast of the wave's outcome.

type Cave = { kind: string; z: number; y: number; mouth: [number, number]; inside: [number, number] };
const OUTCOME = /Уф, успел|Phew|Накрыло|Snowed|Опа|Oops/;

async function start(page: Page, openGame: (q?: string) => Promise<void>): Promise<Cave> {
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
  // A normal wave (the scripted lesson of mountain 1 has its own toast).
  await pastScriptedWave(page);
  await page.waitForTimeout(3_500);
  await page.evaluate(() => ((window as unknown as { __toasts: string[] }).__toasts.length = 0));
  return (await page.evaluate(() => window.__TEST__!.shelters())).find((s) => s.kind === 'grotto')! as Cave;
}
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.slice());
const wave = (page: Page): Promise<{ phase: string; frontZ: number; outcome: string }> =>
  page.evaluate(() => {
    const w = window.__TEST__!.state().wave!;
    return { phase: w.phase, frontZ: w.frontZ, outcome: w.outcome };
  });
/** Walks to (x, z) by the bot path and waits there. */
async function walk(page: Page, x: number, z: number): Promise<void> {
  await page.evaluate(([xx, zz]) => window.__TEST__!.botPath([[xx, zz]]), [x, z] as const);
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0 || window.__TEST__!.state().caught !== null, undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
}
/** The wave over and its toasts shown: exactly one outcome toast. */
async function oneOutcome(page: Page, label: string): Promise<string> {
  let outcome = 'none';
  await expect
    .poll(
      async () => {
        const w = await wave(page);
        if (w.outcome !== 'none') outcome = w.outcome;
        return w.phase;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toMatch(/gone|idle/);
  await page.waitForFunction(() => window.__TEST__!.state().caught === null, undefined, { timeout: 20_000 });
  await page.waitForTimeout(3_500);
  const all = await toasts(page);
  const out = all.filter((s) => OUTCOME.test(s));
  expect(out, `${label} (${outcome}): one outcome toast — ${all.join(' | ')}`).toHaveLength(1);
  return out[0]!;
}

test('in-out-in during the warning: one outcome — «Phew, made it!»', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  const cave = await start(page, openGame);
  const out = Math.sign(cave.mouth[0] - cave.inside[0]);
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [cave.inside[0], cave.inside[1], cave.y] as const);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await expect.poll(async () => (await wave(page)).phase, { timeout: 20_000 }).toBe('warn');
  await walk(page, cave.mouth[0] + out * 6, cave.mouth[1]);
  await walk(page, cave.inside[0], cave.inside[1]);
  expect(await oneOutcome(page, 'in-out-in')).toMatch(/Уф, успел|Phew/);
});

test('in the cave when the front passed, out while its snow still goes by: one outcome', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  const cave = await start(page, openGame);
  const out = Math.sign(cave.mouth[0] - cave.inside[0]);
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [cave.inside[0], cave.inside[1], cave.y] as const);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await expect.poll(async () => (await wave(page)).phase, { timeout: 20_000 }).toBe('warn');
  // The front past him: the outcome is decided («survived»), the snow body still goes by.
  await expect.poll(async () => (await wave(page)).outcome, { timeout: 40_000 }).toBe('survived');
  await walk(page, cave.mouth[0] + out * 8, cave.mouth[1] - 4);
  expect(await oneOutcome(page, 'out under the snow')).toMatch(/Уф, успел|Phew/);
});

test('ran out during the warning and never came back: one outcome', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  const cave = await start(page, openGame);
  const out = Math.sign(cave.mouth[0] - cave.inside[0]);
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [cave.inside[0], cave.inside[1], cave.y] as const);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await expect.poll(async () => (await wave(page)).phase, { timeout: 20_000 }).toBe('warn');
  await walk(page, cave.mouth[0] + out * 8, cave.mouth[1]);
  expect(await oneOutcome(page, 'out and stayed')).toMatch(/Накрыло|Snowed/);
});

test('stood at the mouth within the grace: one outcome — «Phew, made it!», no «back»', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  const cave = await start(page, openGame);
  const out = Math.sign(cave.mouth[0] - cave.inside[0]);
  // The test API's mouth is 4 m in front of the entrance: 1 m out of the entrance — 3 m inward of it (the grace is 3).
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [cave.mouth[0] - out * 3, cave.mouth[1], cave.y] as const);
  await waitTicks(page, 20);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await expect.poll(async () => (await wave(page)).phase, { timeout: 20_000 }).toBe('warn');
  expect(await oneOutcome(page, 'at the mouth')).toMatch(/Уф, успел|Phew/);
});

test('in the cave when the front passed, then rolled back (a fall) while the snow still goes by: one outcome — «back», no «Phew»', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  const cave = await start(page, openGame);
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y + 0.5), [cave.inside[0], cave.inside[1], cave.y] as const);
  await waitTicks(page, 10);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await expect.poll(async () => (await wave(page)).phase, { timeout: 20_000 }).toBe('warn');
  await expect.poll(async () => (await wave(page)).outcome, { timeout: 40_000 }).toBe('survived');
  // Out of the cave and down off the slope at once: the roll-back to the stage start.
  await page.evaluate(([x, z, y]) => window.__TEST__!.teleport(z, x, y - 200), [cave.mouth[0], cave.mouth[1] - 6, cave.y] as const);
  expect(await oneOutcome(page, 'rolled back')).toMatch(/Опа|Oops/);
});

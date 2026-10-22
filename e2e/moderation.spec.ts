import { test, expect } from './fixtures.ts';

// M4-10 (docs/03 7.1.5): the scenarios of moderation by their ids — SCR-07 the browser «Back», SND-02 a tab change,
// SCR-04 right click and a long tap, SCR-05 keys in the Russian layout (their own specs: layout, input, smoke), BLD-06 no
// WebGL2 — a calm screen with no error, and a lost and restored WebGL context — the game draws and moves again.

test('SCR-07 the browser «Back» and «Forward»: the game loads again with no hang and no error, history untouched', async ({ page, openGame }) => {
  await openGame('pace=stages');
  const len = await page.evaluate(() => history.length);
  await page.goto('/?pace=stages&from=back');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  await page.goBack();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => location.search)).not.toContain('from=back');
  await page.goForward();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  // The game itself never adds to the history.
  expect(await page.evaluate(() => history.length)).toBe(len + 1);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  expect(await page.evaluate(() => window.__TEST__!.state().hero!.speed >= 0)).toBe(true);
});

test('BLD-06 no WebGL2: a calm screen with the name of the game, no «WebGL», no «error», no console error', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      if (id === 'webgl2') return null;
      return (get as (this: HTMLCanvasElement, ...a: unknown[]) => RenderingContext | null).call(this, id, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/?pace=stages');
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  await expect(page.locator('canvas.fallback')).toHaveCount(1);
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/WebGL|ошибк|error/i);
  expect(await page.evaluate(() => window.__TEST__!.analytics().some((e) => e.name === 'webgl_unavailable'))).toBe(true);
});

test('WebGL context lost and restored: the game stands while it is lost, then draws and is controlled again', async ({ page, openGame }) => {
  await openGame('pace=stages');
  await page.evaluate(() => window.__TEST__!.holdWave(9000));
  await page.mouse.click(480, 300);
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas')!;
    const ext = (c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = ext;
    ext.loseContext();
  });
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().pauseReasons as string[])).toContain('transition');
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().pauseReasons as string[]), { timeout: 10_000 }).toEqual([]);
  const frame0 = await page.evaluate(() => window.__TEST__!.state().framesRendered);
  const z0 = await page.evaluate(() => window.__TEST__!.state().hero!.z);
  await page.evaluate(() => window.__TEST__!.stick(0, 1));
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().hero!.z)).toBeGreaterThan(z0 + 0.5);
  await page.evaluate(() => window.__TEST__!.stick(0, 0));
  await expect.poll(() => page.evaluate(() => window.__TEST__!.state().framesRendered)).toBeGreaterThan(frame0);
});

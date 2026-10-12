import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { intoPortal, intoSummit, toFirstBase, upPastRidge, worlds } from './base-route.ts';
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// FM-07: the base between the mountains (docs/01-gdd.md 19.2–19.4): the first summit → the window → «Next» → the base
// (base_first) → the portal of mountain 2 → its camp; F5 on mountain 3 after ridge 2 → the base → portal 3 → the flag of
// ridge 2; mountain 1 run again — its summit with no window and no trophies; base.json off — the camp of mountain 2.
const dict = ru as Record<string, string>;
const EVIDENCE = 'docs/evidence/fm';
const CALLS = 30;

test('mountain 1 → «Mountain 1 cleared!» → «Next» → the base (base_first) → portal 2 within 10 s → the camp of mountain 2; screenshots; draw calls', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await toFirstBase(page, openGame);
  let s = await testState(page);
  expect(s.world).toBe('base');
  expect(s.basePortals.map((p) => p.state)).toEqual(['passed', 'own', ...Array(worlds.length - 2).fill('locked')]);
  const names = (await page.evaluate(() => window.__TEST__!.analytics())).map((e) => e.name);
  expect(names.filter((n) => n === 'base_first')).toHaveLength(1);
  // HUD of the base: no mountain bar, the goal — the portal of mountain 2.
  await expect(page.locator('.hud-mountain')).toBeHidden();
  await expect(page.locator('[data-role="goal"]')).toContainText(dict[`world.${worlds[1]!.id}`]!);
  await waitTicks(page, 30);
  const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
  console.log(`base draw calls: ${info.calls}`);
  expect(info.calls, JSON.stringify(await page.evaluate(() => window.__TEST__!.drawList()))).toBeLessThanOrEqual(CALLS);
  await shot1080(page, `${EVIDENCE}/base_first_1920x1080_ru.png`, 5);
  await page.setViewportSize({ width: 640, height: 360 });
  await waitTicks(page, 5);
  await page.screenshot({ path: `${EVIDENCE}/base_first_640x360_ru.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  // No avalanche on the base: the wave stays idle.
  expect(s.wave?.phase ?? 'idle').toBe('idle');

  const sec = await intoPortal(page, 2);
  console.log(`base → portal 2: ${sec.toFixed(1)} s of game time`);
  expect(sec).toBeLessThanOrEqual(10);
  s = await testState(page);
  expect(s.world).toBe(worlds[1]!.id);
  expect(s.hero!.z).toBeLessThan(60);
  expect(s.replay).toBe(false);
  const portal = (await page.evaluate(() => window.__TEST__!.analytics())).filter((e) => e.name === 'base_portal');
  expect(portal).toHaveLength(1);
  expect(portal[0]!.params).toMatchObject({ world: 2, replay: false });
});

test('F5 on mountain 3 after ridge 2 → the base → portal 3 («ridge 2/3») → the flag of ridge 2', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await toFirstBase(page, openGame);
  const w = worlds[2]!;
  const ridges = w.segments.filter((x) => x.type === 'gate' && x.kind === 'ridge');
  const r2 = ridges[1]!;
  await page.evaluate(() => {
    window.__TEST__!.setSummits(2);
    window.__TEST__!.gotoWorld(3);
  });
  await waitTicks(page, 20);
  // Up past ridge 2 with the Speed of it, through its pass.
  await upPastRidge(page, w, 1);
  await waitTicks(page, 30);
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60_000 });
  let s = await testState(page);
  expect(s.onBase).toBe(true);
  expect(s.basePortals.find((p) => p.world === 3)!.state).toBe('own');
  await intoPortal(page, 3);
  s = await testState(page);
  expect(s.world).toBe(w.id);
  expect(s.hero!.z, 'at the flag behind ridge 2').toBeGreaterThan(r2.z);
  expect(s.hero!.z).toBeLessThan(ridges[2]!.z);
});

test('mountain 1 run again from the base: its summit with no window, chest or trophies — «Top again!» and back to the base', async ({ page, openGame }) => {
  test.setTimeout(180_000);
  await toFirstBase(page, openGame);
  const before = (await testState(page)).trophies;
  await intoPortal(page, 1);
  let s = await testState(page);
  expect(s.world).toBe(worlds[0]!.id);
  expect(s.replay).toBe(true);
  await intoSummit(page, worlds[0]!);
  await page.waitForFunction((text) => (document.querySelector('[data-role="toast"].shown')?.textContent ?? '').includes(text), dict['toast.replaySummit']!, { timeout: 60_000 });
  await page.waitForFunction(() => window.__TEST__!.state().onBase, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  s = await testState(page);
  expect(s.window).toBeNull();
  expect(s.trophies).toEqual(before);
  expect(s.summits).toBe(1);
  expect(s.basePortals.find((p) => p.world === 2)!.state).toBe('own');
});

test('base.json off: the summit of mountain 1 → «Next» → the camp of mountain 2, as before FM', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setBaseEnabled(false));
  await intoSummit(page, worlds[0]!);
  await page.waitForFunction(() => window.__TEST__!.state().window === 'summit', undefined, { timeout: 60_000 });
  await page.locator('[data-hud="win-next"]').click();
  await page.waitForFunction((id) => window.__TEST__!.state().world === id, worlds[1]!.id, { timeout: 60_000 });
  const s = await testState(page);
  expect(s.onBase).toBe(false);
  expect(s.hero!.z).toBeLessThan(60);
  expect((await page.evaluate(() => window.__TEST__!.analytics())).some((e) => e.name === 'base_first')).toBe(false);
});

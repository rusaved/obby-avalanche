import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import theme from '../content/avalanche/theme.json' with { type: 'json' };

// PS-07: the giant of the open slope (docs/01-gdd.md 17.6). The physical bot (controller and collisions in the browser)
// passes the zone of mountain 1 on the first try with the Speed of the advice, and is caught at half of it — back at the
// start of the zone, nothing lost. The giant is seen from the camp; in his zone no ad button and no window shows.
type OpenWorld = { bosses: Array<{ zone: [number, number]; requires: number }>; length: number };
const world = (openWorlds as unknown as { worlds: OpenWorld[] }).worlds[0]!;
const zone = world.bosses[0]!.zone;
const advice = world.bosses[0]!.requires;
const EVIDENCE = 'docs/evidence/open';

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

test('with the Speed of the advice the bot slips past the giant to the summit on the first try; screenshots', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  // The scripted first wave out of the way (it would start at section 2 on the way up).
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate(([z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
  }, [zone[0] - 14, advice] as const);
  await waitTicks(page, 150);
  await shot1080(page, `${EVIDENCE}/boss_zone_1920x1080_ru.png`);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), zone[1] + 20);
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'bossEnter'), undefined, { timeout: 30_000 });
  // The chase: the giant turned to the hero and walks at him.
  await page.waitForFunction(() => window.__TEST__!.state().boss?.zones[0]?.giants[0]?.mode === 'chase', undefined, { timeout: 30_000 });
  await shot1080(page, `${EVIDENCE}/boss_chase_1920x1080_ru.png`, 20);
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'bossPassed' || e.name === 'bossCaught'), undefined, { timeout: 60_000 });
  // The toast right away: under load 30 ticks may outlive it.
  await expect.poll(async () => (await testState(page)).waveHud.toast).toContain('Проскочил великана');
  await waitTicks(page, 30);
  const s = await testState(page);
  const events = await page.evaluate(() => window.__TEST__!.simEvents.map((e) => e.name));
  expect(events).toContain('bossPassed');
  expect(events).not.toContain('bossCaught');
  expect(s.gatesOpen[s.gatesOpen.length - 1]).toBe(true);
  await shot1080(page, `${EVIDENCE}/boss_passed_1920x1080_ru.png`);
});

test('at half the advice the giant catches the bot: back at the start of the zone, Speed and coins kept', async ({ page, openGame }) => {
  test.setTimeout(120_000);
  await openGame('pace=open');
  await page.evaluate(([z, s]) => {
    window.__TEST__!.setStat(s);
    window.__TEST__!.teleport(z);
  }, [zone[0] - 10, advice / 2] as const);
  await waitTicks(page, 10);
  const before = await testState(page);
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), zone[1] + 20);
  await page.waitForFunction(() => window.__TEST__!.simEvents.some((e) => e.name === 'bossCaught'), undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  await expect.poll(async () => (await testState(page)).waveHud.toast).toContain('Великан поймал');
  await page.waitForFunction(() => window.__TEST__!.state().caught === null, undefined, { timeout: 30_000 });
  const s = await testState(page);
  expect(s.hero!.z).toBeLessThan(zone[0]);
  expect(s.hero!.z).toBeGreaterThan(zone[0] - 10);
  expect(s.stat).toBeGreaterThanOrEqual(before.stat);
  expect(s.coins).toBeGreaterThanOrEqual(before.coins);
  expect(s.gatesOpen[s.gatesOpen.length - 1]).toBe(false);
});

test('the giant is seen from the camp looking up the slope; in his zone no ad button and no window', async ({ page, openGame }) => {
  test.setTimeout(150_000);
  await openGame('pace=open&quality=high');
  // Off the axis: the giant patrols the middle of the slope, the hero would stand in front of him on the screen.
  await page.evaluate(() => window.__TEST__!.teleport(20, -18));
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0.2, pitch: 0.05 }));
  await waitTicks(page, 20);
  const s = await testState(page);
  expect(s.boss!.silhouette).toBe(true);
  // A pixel of the silhouette's chest: the silhouette colour, not the sky behind it.
  const c = s.boss!.silhouetteChest!;
  const chest = await page.evaluate(([x, y, z]) => window.__TEST__!.project(x, y, z), c);
  expect(chest.ahead).toBe(true);
  const px = await page.evaluate(([x, y]) => window.__TEST__!.pixelAt(x, y), [chest.x, chest.y] as const);
  const want = hex(theme.boss.silhouette);
  expect(Math.max(...px.map((c, i) => Math.abs(c - want[i]!))), `pixel ${px} vs ${want}`).toBeLessThan(40);
  await page.evaluate(() => window.__TEST__!.setCamera('auto'));

  // 60 s of play and the first wave over: the buttons may show — but not in the zone.
  await page.evaluate(() => window.__TEST__!.setPlaySec(61));
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  await page.evaluate((z) => window.__TEST__!.teleport(z), zone[0] + 30);
  for (let i = 0; i < 10; i++) {
    await waitTicks(page, 12);
    const st = await testState(page);
    expect(st.adButtons).toEqual([]);
    expect(st.window).toBeNull();
  }
});

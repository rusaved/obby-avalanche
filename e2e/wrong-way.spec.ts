import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { PACES, SHOT_PACE, paceWorlds, type Pace } from './pace-data.ts';

// PR-06 (docs/01-gdd.md 16.7): no auto-turn of the camera to +Z (tuning camera.autoTurn = false), and the small
// «wrong way» arrow by the hero towards the next closed gate while he runs down the slope on a calm mountain.
const DEG = Math.PI / 180;

type Seg = { type: string; z: number; y: number; side?: string; wall?: number; requires?: number };
/** Mountain 1 of the pace: its gates and caves bottom up, and a stat that opens walls 1–2 and keeps wall 3 closed. */
function mountain1(pace: Pace): { gates: Seg[]; niches: Seg[]; stat: number } {
  const segs = paceWorlds<{ segments: Seg[] }>(pace)[0]!.segments;
  const gates = segs.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
  const niches = segs.filter((s) => s.type === 'niche').sort((a, b) => a.z - b.z);
  return { gates, niches, stat: Math.min(50, gates[2]!.requires! - 1) };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Screen angle from the hero's middle to the gate point, as the camera sees them now (null — the gate is behind). */
async function gateAngle(page: Page, gate: Seg): Promise<number | null> {
  return page.evaluate((g) => {
    const api = window.__TEST__!;
    const h = api.state().hero!;
    const a = api.project(h.x, h.y + 2.5, h.z);
    const b = api.project(0, g.y + 2, g.z);
    return b.ahead ? Math.atan2(b.y - a.y, b.x - a.x) : null;
  }, gate);
}

/** Holds a key until the arrow shows (or `maxTicks` pass); returns the ticks it took. */
async function holdUntilArrow(page: Page, key: string, maxTicks: number): Promise<number> {
  const t0 = (await testState(page)).ticks;
  await page.keyboard.down(key);
  for (;;) {
    await waitTicks(page, 3);
    const s = await testState(page);
    if (s.wrongWay.shown || s.ticks - t0 > maxTicks) return s.ticks - t0;
  }
}

/** Runs `key` for `ticks` and says whether the arrow showed at any moment. */
async function arrowWhileRunning(page: Page, key: string, ticks: number): Promise<boolean> {
  let seen = false;
  await page.keyboard.down(key);
  const t0 = (await testState(page)).ticks;
  for (;;) {
    await waitTicks(page, 3);
    const s = await testState(page);
    seen ||= s.wrongWay.shown;
    if (s.ticks - t0 >= ticks) break;
  }
  await page.keyboard.up(key);
  return seen;
}

for (const pace of PACES) {
  const { gates, niches, stat } = mountain1(pace);
  test(`camera without auto-turn (${pace}): turned down the slope, «forward» 5 s without the mouse — viewYaw stays within 2°`, async ({ page, openGame }) => {
    await openGame('pace=' + pace);
    await page.evaluate((v) => window.__TEST__!.setStat(v), stat);
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), gates[2]!.z - 10);
    await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI }));
    await waitTicks(page, 5);
    await page.evaluate(() => window.__TEST__!.setCamera('auto'));
    await waitTicks(page, 5);
    const s0 = await testState(page);
    expect(Math.abs(wrap(s0.viewYaw - Math.PI))).toBeLessThan(0.01);
    await page.keyboard.down('KeyW');
    await waitTicks(page, 300);
    const s1 = await testState(page);
    await page.keyboard.up('KeyW');
    // He ran down the slope all the time, the view did not turn back up.
    expect(s1.hero!.z).toBeLessThan(s0.hero!.z - 40);
    expect(Math.abs(wrap(s1.viewYaw - s0.viewYaw))).toBeLessThanOrEqual(2 * DEG);
  });

  test(`wrong-way arrow (${pace}): shows running down, points to the next closed gate, goes on stop and on the way up`, async ({ page, openGame }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGame('pace=' + pace);
    // Walls 1–2 open, wall 3 closed (classic 50, fast below wall 3): the hero between them runs down towards the camp.
    await page.evaluate((v) => window.__TEST__!.setStat(v), stat);
    const gate = gates[2]!;
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), gate.z - 10);
    await waitTicks(page, 10);
    let s = await testState(page);
    expect(s.wave!.phase).toBe('idle');
    expect(s.wrongWay.shown).toBe(false);

    // 1. Camera up the slope, S: he runs towards the camera — the gate is ahead on screen, above him.
    const took = await holdUntilArrow(page, 'KeyS', 200);
    expect(took, 'ticks to the arrow').toBeLessThanOrEqual(150);
    await waitTicks(page, 12);
    s = await testState(page);
    expect(s.wrongWay.shown).toBe(true);
    const want = await gateAngle(page, gate);
    expect(want).not.toBeNull();
    expect(Math.abs(wrap(s.wrongWay.angle - want!)), `arrow ${s.wrongWay.angle.toFixed(2)} vs gate ${want!.toFixed(2)}`).toBeLessThanOrEqual(30 * DEG);
    // Small, white on a dark plaque, no text.
    const box = await page.locator('[data-role="way-arrow"]').evaluate((e) => {
      const cs = getComputedStyle(e);
      return { w: e.getBoundingClientRect().width, text: e.textContent ?? '', color: cs.color, bg: cs.backgroundColor };
    });
    expect(box.w).toBeGreaterThanOrEqual(40);
    expect(box.w).toBeLessThanOrEqual(48);
    expect(box.text).toBe('');
    expect(box.color).toBe('rgb(255, 255, 255)');
    expect(box.bg).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d+\)$/);
    if (pace === SHOT_PACE) await page.screenshot({ path: 'docs/evidence/proto/wrong_way_1920x1080_ru.png' });

    // 2. Stop: the arrow goes within 0.5 s.
    let t0 = (await testState(page)).ticks;
    await page.keyboard.up('KeyS');
    for (;;) {
      await waitTicks(page, 2);
      s = await testState(page);
      if (!s.wrongWay.shown) break;
      expect(s.ticks - t0, 'ticks until the arrow goes after the stop').toBeLessThanOrEqual(30);
    }
    expect(s.ticks - t0).toBeLessThanOrEqual(30);

    // 3. Down again, then up: it goes within 0.5 s and does not come back on the way up.
    expect(await holdUntilArrow(page, 'KeyS', 200)).toBeLessThanOrEqual(150);
    await page.keyboard.up('KeyS');
    t0 = (await testState(page)).ticks;
    await page.keyboard.down('KeyW');
    for (;;) {
      await waitTicks(page, 2);
      s = await testState(page);
      if (!s.wrongWay.shown) break;
      expect(s.ticks - t0, 'ticks until the arrow goes on the way up').toBeLessThanOrEqual(30);
    }
    await page.keyboard.up('KeyW');
    expect(await arrowWhileRunning(page, 'KeyW', 60)).toBe(false);

    // 4. Camera turned down the slope, W: the gate is behind the camera — the arrow points down (back).
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), gate.z - 10);
    await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI }));
    await waitTicks(page, 5);
    await page.evaluate(() => window.__TEST__!.setCamera('auto'));
    expect(await holdUntilArrow(page, 'KeyW', 200)).toBeLessThanOrEqual(150);
    await waitTicks(page, 12);
    s = await testState(page);
    await page.keyboard.up('KeyW');
    expect(s.wrongWay.shown).toBe(true);
    expect(await gateAngle(page, gate)).toBeNull();
    expect(Math.abs(wrap(s.wrongWay.angle - Math.PI / 2)), `arrow ${s.wrongWay.angle.toFixed(2)}`).toBeLessThanOrEqual(30 * DEG);
  });

  test(`no wrong-way arrow (${pace}) on warn and run, in a cave, in the camp, in a snowball`, async ({ page, openGame }) => {
    test.setTimeout(180_000);
    await openGame('pace=' + pace);
    await page.evaluate((v) => window.__TEST__!.setStat(v), stat);
    const from = gates[2]!.z - 10;
    // In a cave: the length of cave 2 down its floor.
    const cave = niches[1]!;
    const side = cave.side === 'right' ? 1 : -1;
    await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [side * 17, cave.y + 0.05, cave.z + 4.5] as const);
    await waitTicks(page, 5);
    expect((await testState(page)).inShelter).toBe(true);
    expect(await arrowWhileRunning(page, 'KeyS', 40), 'in a cave').toBe(false);
    // In the camp.
    await page.evaluate(() => window.__TEST__!.teleport(38, 0));
    expect(await arrowWhileRunning(page, 'KeyS', 60), 'in the camp').toBe(false);
    // On warn and on run (the scripted first wave never catches).
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), from);
    await page.evaluate(() => window.__TEST__!.triggerWave());
    await waitTicks(page, 3);
    expect((await testState(page)).wave!.phase).toBe('warn');
    expect(await arrowWhileRunning(page, 'KeyS', 90), 'on warn').toBe(false);
    await page.waitForFunction(() => window.__TEST__!.state().wave!.phase === 'run', undefined, { timeout: 30_000 });
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), from);
    expect(await arrowWhileRunning(page, 'KeyS', 60), 'on run').toBe(false);
    await page.evaluate(() => window.__TEST__!.setTimeScale(4));
    await page.waitForFunction(() => window.__TEST__!.state().wave!.phase === 'idle', undefined, { timeout: 60_000 });
    await page.evaluate(() => window.__TEST__!.setTimeScale(1));
    // Calm again: the same run down shows it (the checks above are not empty).
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), from);
    expect(await holdUntilArrow(page, 'KeyS', 200)).toBeLessThanOrEqual(150);
    await page.keyboard.up('KeyS');
    // A normal wave catches him on the open slope: the snowball rolls down to a cave, no arrow.
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), from);
    await page.evaluate(() => window.__TEST__!.triggerWave());
    let caughtSeen = false;
    let arrowInBall = false;
    for (let i = 0; i < 2000; i++) {
      await waitTicks(page, 3);
      const s = await testState(page);
      if (s.caught) caughtSeen = true;
      if (s.caught && s.wrongWay.shown) arrowInBall = true;
      if (caughtSeen && !s.caught) break;
    }
    expect(caughtSeen).toBe(true);
    expect(arrowInBall).toBe(false);
  });
}

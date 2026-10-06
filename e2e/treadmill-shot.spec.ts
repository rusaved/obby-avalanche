import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import { PACES, SHOT_PACE, paceBalance, paceWorlds, type Pace } from './pace-data.ts';

// PR-11 (playtest of the prototype, item 2 «camera» = 2: on every belt the camera flew into the hero, through an open
// gate it flew through the sign): the hero on the belt of a cave outside an avalanche gets the wide frame of the
// avalanche (PR-07); a turn by the mouse gives the player's camera back; through an open gate its sign is never
// between the camera and the hero.
/** The hero as a box over his feet (characters ≈ 5 units with the hat, arms out), as in cave-shot.spec.ts. */
const HERO_H = 5.1;
const HERO_HALF = 0.9;
/** Track borders: the cave box starts at the track edge and goes BORDER + depth outwards (src/level/builder.ts). */
const BORDER = 3;
const BELT_HALF = 1.5;
const BACK_TICKS = Math.ceil(tuning.avalanche.shotReturnSec * 60) + 2;

type Seg = { type: string; z: number; y: number; side?: string; length?: number; depth?: number; requires?: number };
type Cave = { side: number; z: number; y: number; mouthX: number; beltX: number };

function mountain(pace: Pace): { gates: Seg[]; caves: Cave[] } {
  const w = paceWorlds<{ width: number; segments: Seg[] }>(pace)[0]!;
  const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
  const caves = w.segments
    .filter((s) => s.type === 'niche')
    .sort((a, b) => a.z - b.z)
    .map((s) => {
      const side = s.side === 'right' ? 1 : -1;
      return { side, z: s.z, y: s.y, mouthX: (side * w.width) / 2, beltX: side * (w.width / 2 + BORDER + (s.depth ?? 4) - BELT_HALF) };
    });
  return { gates, caves };
}

type Probe = { beltShot: boolean; onBelt: boolean; phase: string; inGeo: boolean; dist: number; visible: boolean; whole: boolean; heightFrac: number };

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(
    ({ h, half }) => {
      const api = window.__TEST__!;
      const s = api.state();
      const hero = s.hero!;
      const f = s.field;
      let whole = true;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const dx of [-half, half]) for (const dz of [-half, half]) for (const dy of [0, h]) {
        const p = api.project(hero.x + dx, hero.y + dy, hero.z + dz);
        if (!p.ahead || p.x < 0 || p.x > f.width || p.y < 0 || p.y > f.height) whole = false;
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      const [cx, cy, cz] = s.cameraPos;
      const st = api.cameraStats();
      return {
        beltShot: s.waveHud.beltShot,
        onBelt: s.onBelt,
        phase: s.wave!.phase,
        inGeo: api.cameraInsideGeometry(),
        dist: Math.hypot(cx - hero.x, cy - (hero.y + 1.5), cz - hero.z),
        visible: st.heroHidden === 0,
        whole,
        heightFrac: (y1 - y0) / f.height,
      };
    },
    { h: HERO_H, half: HERO_HALF },
  );
}

/** The scripted first wave out of the way (a teleport past its cave starts it): on the belt of its cave, at ×4 until it is over. */
async function scriptedWaveDone(page: Page, cave: Cave): Promise<void> {
  await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [cave.beltX, cave.y + 0.05, cave.z] as const);
  await waitTicks(page, 5);
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await waitTicks(page, 3);
  expect((await testState(page)).wave).toMatchObject({ phase: 'warn', scripted: true });
  await page.evaluate(() => window.__TEST__!.setTimeScale(4));
  await page.waitForFunction(() => window.__TEST__!.state().wave!.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

for (const pace of PACES) {
  const balance = paceBalance(pace);
  const { gates, caves } = mountain(pace);

  test(`belt frame (${pace}): 20 s on the belt of a cave at a closed gate — wide frame, never in the hero; a mouse turn gives the camera back`, async ({ page, openGame }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openGame('pace=' + pace);
    await scriptedWaveDone(page, caves[balance.ftue.scriptedWaveWall - 1]!);
    // The cave right below the gate after the scripted one (its number is far above the stat).
    const k = balance.ftue.scriptedWaveWall;
    const cave = caves[k]!;
    await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [cave.beltX, cave.y + 0.05, cave.z] as const);
    await waitTicks(page, BACK_TICKS + 3);
    let s = await testState(page);
    expect(s.onBelt).toBe(true);
    expect(s.gatesOpen[k], `gate ${k + 1} (${gates[k]!.requires}) closed`).toBe(false);
    await page.evaluate(() => window.__TEST__!.resetCameraStats());
    // 20 s of game time, a probe every 0.5 s.
    for (let i = 0; i < 40; i++) {
      const p = await probe(page);
      const at = `${pace} probe ${i} (${(i / 2).toFixed(1)} s)`;
      expect(p.phase, `${at}: outside an avalanche`).toBe('idle');
      expect(p.onBelt, at).toBe(true);
      expect(p.beltShot, `${at}: wide frame`).toBe(true);
      expect(p.inGeo, `${at}: camera in the level`).toBe(false);
      expect(p.dist, `${at}: camera to the hero`).toBeGreaterThanOrEqual(3);
      expect(p.visible, `${at}: hero hidden`).toBe(true);
      expect(p.whole, `${at}: hero whole in the frame`).toBe(true);
      expect(p.heightFrac, `${at}: hero height share`).toBeLessThanOrEqual(0.3);
      if (i === 20 && pace === SHOT_PACE) await page.screenshot({ path: 'docs/evidence/proto/treadmill_shot_1920x1080_ru.png' });
      await waitTicks(page, 30);
    }
    const st = await page.evaluate(() => window.__TEST__!.cameraStats());
    expect(st.frames).toBeGreaterThan(20);
    expect(st.inside, st.bad.join('\n')).toBe(0);
    expect(st.heroHidden, st.bad.join('\n')).toBe(0);
    expect(st.heroNear, st.bad.join('\n')).toBe(0);
    expect(st.heroBlocked, st.bad.join('\n')).toBe(0);

    // A turn by the mouse: the player's camera, and it stays his while the hero is on the belt.
    const f = s.field;
    await page.mouse.move(f.left + f.width / 2, f.top + f.height / 2);
    await page.mouse.down();
    await page.mouse.move(f.left + f.width / 2 - 300, f.top + f.height / 2, { steps: 10 });
    await page.mouse.up();
    await waitTicks(page, BACK_TICKS);
    s = await testState(page);
    expect(s.onBelt).toBe(true);
    expect(s.waveHud.beltShot).toBe(false);
    expect(s.cameraFixedBlend, `${pace}: camera back to the player`).toBe(0);
    await waitTicks(page, 60);
    expect((await testState(page)).waveHud.beltShot, `${pace}: the turn holds while on the belt`).toBe(false);

    // Off the belt: the player's camera; back on it: the wide frame again.
    await page.evaluate(([x, z]) => window.__TEST__!.botPath([[x, z]]), [cave.mouthX + cave.side * 2, cave.z] as const);
    await page.waitForFunction(() => !window.__TEST__!.state().onBelt, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__TEST__!.botPath(null));
    expect((await testState(page)).waveHud.beltShot).toBe(false);
    await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [cave.beltX, cave.y + 0.05, cave.z] as const);
    await waitTicks(page, BACK_TICKS + 3);
    s = await testState(page);
    expect(s.onBelt).toBe(true);
    expect(s.waveHud.beltShot).toBe(true);
    expect(s.cameraFixedBlend).toBe(1);
  });

  test(`open gate (${pace}): walking through it the gate sign is in no frame between the camera and the hero`, async ({ page, openGame }) => {
    test.setTimeout(120_000);
    await openGame('pace=' + pace);
    const k = 1;
    const gate = gates[k]!;
    await page.evaluate((n) => window.__TEST__!.setStat(n), gate.requires ?? 0);
    await waitTicks(page, 3);
    expect((await testState(page)).gatesOpen[k]).toBe(true);
    const from = Math.max(gates[k - 1]!.z + 6, gate.z - 24);
    await page.evaluate((z) => window.__TEST__!.teleport(z, 0), from);
    await waitTicks(page, BACK_TICKS);
    await page.evaluate(() => window.__TEST__!.resetCameraStats());
    // At a quarter of game speed: more drawn frames per unit of the way on a slow runner.
    await page.evaluate(() => window.__TEST__!.setTimeScale(0.25));
    await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), gate.z + 24);
    let hidden = 0;
    let polls = 0;
    for (;;) {
      const s = await testState(page);
      if ((await page.evaluate((i) => window.__TEST__!.signBox(i).hidden, k)) === true) hidden++;
      polls++;
      if (s.hero!.z >= gate.z + 22 || polls > 600) break;
      await waitTicks(page, 1);
    }
    await page.evaluate(() => window.__TEST__!.setTimeScale(1));
    const st = await page.evaluate(() => window.__TEST__!.cameraStats());
    console.log(`gate sign (${pace}): frames ${st.frames}, sign hidden in ${hidden} of ${polls} polls`);
    expect((await testState(page)).hero!.z).toBeGreaterThan(gate.z + 20);
    expect(st.frames).toBeGreaterThan(40);
    expect(hidden, 'the sign was in the way and hidden').toBeGreaterThan(0);
    expect(st.signBlocked, st.bad.join('\n')).toBe(0);
    expect(st.inside, st.bad.join('\n')).toBe(0);
  });
}

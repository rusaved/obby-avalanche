import { test, expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import worldsJson from '../content/avalanche/worlds.json' with { type: 'json' };
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import balance from '../content/avalanche/balance.json' with { type: 'json' };

// PR-07 (docs/01-gdd.md 16.7; playtest M3, item 2): the avalanche from the cave is a wide frame from the back wall.
// The hero on the belt: on warn and run the camera is not in the level, ≥ 3 units from him, he is whole in the frame and
// at most 30% of its height, the cave mouth is in the frame; after the wave the camera is back in shotReturnSec.
const PACES = ['classic'] as const;
/** The hero as a box over his feet (characters ≈ 5 units with the hat, arms out). */
const HERO_H = 5.1;
const HERO_HALF = 0.9;
/** Track borders: the cave box starts at the track edge and goes BORDER + depth outwards (src/level/builder.ts). */
const BORDER = 3;
const BELT_HALF = 1.5;

type Seg = { type: string; z: number; y: number; side?: string; length?: number; depth?: number };
type Cave = { side: number; z: number; y: number; z0: number; z1: number; mouthX: number; beltX: number };

function caves(): Cave[] {
  const w = (worldsJson as unknown as { worlds: Array<{ width: number; segments: Seg[] }> }).worlds[0]!;
  return w.segments
    .filter((s) => s.type === 'niche')
    .sort((a, b) => a.z - b.z)
    .map((s) => {
      const side = s.side === 'right' ? 1 : -1;
      const len = s.length ?? 10;
      return { side, z: s.z, y: s.y, z0: s.z - len / 2, z1: s.z + len / 2, mouthX: (side * w.width) / 2, beltX: side * (w.width / 2 + BORDER + (s.depth ?? 4) - BELT_HALF) };
    });
}

type Probe = { phase: string; shot: boolean; inGeo: boolean; dist: number; whole: boolean; heightFrac: number; mouth: boolean; dz: number };

async function probe(page: Page, cave: Cave): Promise<Probe> {
  return page.evaluate(
    ({ cave, h, half }) => {
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
      const m = api.project(cave.mouthX, cave.y + 4, cave.z);
      const [cx, cy, cz] = s.cameraPos;
      return {
        phase: s.wave!.phase,
        shot: s.waveHud.shot,
        inGeo: api.cameraInsideGeometry(),
        dist: Math.hypot(cx - hero.x, cy - (hero.y + 1.5), cz - hero.z),
        whole,
        heightFrac: (y1 - y0) / f.height,
        mouth: m.ahead && m.x >= 0 && m.x <= f.width && m.y >= 0 && m.y <= f.height,
        dz: s.wave!.frontZ - hero.z,
      };
    },
    { cave, h: HERO_H, half: HERO_HALF },
  );
}

/** On warn and run with the hero on the belt of `cave`: every probe as PR-07 asks; one screenshot as the front passes. */
async function watchWave(page: Page, cave: Cave, label: string, shotPath: string | null): Promise<void> {
  // Three spots of the belt on the warning: the downhill end (under the camera side), the middle, the uphill end.
  const spots = [cave.z0 + 1.2, cave.z, cave.z1 - 1.2];
  let seen = 0;
  let shotTaken = false;
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  for (let i = 0; i < 600; i++) {
    const s = await testState(page);
    const w = s.wave!;
    if (w.phase !== 'warn' && w.phase !== 'run') break;
    if (w.phase === 'warn' && i < 3 * 8) {
      const z = spots[Math.floor(i / 8)]!;
      if (Math.abs(s.hero!.z - z) > 0.5) await page.evaluate(([x, y, zz]) => window.__TEST__!.teleport(zz, x, y), [cave.beltX, cave.y + 0.05, z] as const);
    } else if (w.phase === 'warn') {
      // The rest of the warning at ×3 (game time on a slow runner), the run at ×1.
      await page.evaluate(() => window.__TEST__!.setTimeScale(3));
      await page.waitForFunction(() => window.__TEST__!.state().wave!.phase !== 'warn', undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      continue;
    }
    const p = await probe(page, cave);
    if (!p.shot) {
      // The frame lasts until the front is shotTriggerDist past the hero.
      expect(p.phase === 'run' && p.dz < -tuning.avalanche.shotTriggerDist + 2, `${label}: no frame at ${p.phase} dz ${p.dz.toFixed(1)}`).toBe(true);
      break;
    }
    const at = `${label} ${p.phase} dz ${p.dz.toFixed(1)} hero z ${s.hero!.z.toFixed(1)}`;
    expect(s.onBelt, at).toBe(true);
    expect(p.inGeo, `${at}: camera in the level`).toBe(false);
    expect(p.dist, `${at}: camera to the hero`).toBeGreaterThanOrEqual(3);
    expect(p.whole, `${at}: hero whole in the frame`).toBe(true);
    expect(p.heightFrac, `${at}: hero height share`).toBeLessThanOrEqual(0.3);
    expect(p.mouth, `${at}: cave mouth in the frame`).toBe(true);
    seen++;
    if (shotPath && !shotTaken && p.phase === 'run' && Math.abs(p.dz) < 8) {
      await page.screenshot({ path: shotPath });
      shotTaken = true;
    }
    await waitTicks(page, 3);
  }
  expect(seen, `${label}: probes in the frame`).toBeGreaterThan(20);
  if (shotPath) expect(shotTaken, `${label}: screenshot`).toBe(true);
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  expect(st.inside, st.bad.join('\n')).toBe(0);
  expect(st.heroHidden, st.bad.join('\n')).toBe(0);
  expect(st.heroBlocked, st.bad.join('\n')).toBe(0);
  // Back to the player's camera in shotReturnSec.
  await waitTicks(page, Math.ceil(tuning.avalanche.shotReturnSec * 60) + 2);
  expect((await testState(page)).cameraFixedBlend, `${label}: camera back`).toBe(0);
}

for (const pace of PACES) {
  for (const [width, height] of [[1920, 1080], [1280, 720]] as const) {
    test(`cave frame on the avalanche (${pace}, ${width}x${height}): scripted and normal wave, hero on the belt`, async ({ page, openGame }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width, height });
      await openGame();
      const list = caves();
      // 1. The scripted first wave in its cave (docs/01-gdd.md 4.6).
      const scripted = list[balance.ftue.scriptedWaveWall - 1]!;
      await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [scripted.beltX, scripted.y + 0.05, scripted.z] as const);
      await waitTicks(page, 5);
      await page.evaluate(() => window.__TEST__!.triggerWave());
      await waitTicks(page, 3);
      expect((await testState(page)).wave).toMatchObject({ phase: 'warn', scripted: true, shelter: balance.ftue.scriptedWaveWall - 1 });
      await watchWave(page, scripted, `${pace} scripted`, null);
      await page.evaluate(() => window.__TEST__!.setTimeScale(4));
      await page.waitForFunction(() => window.__TEST__!.state().wave!.phase === 'idle', undefined, { timeout: 60_000 });
      await page.evaluate(() => window.__TEST__!.setTimeScale(1));

      // 2. A normal wave with the hero on the belt of cave 3.
      const cave = list[2]!;
      await page.evaluate(([x, y, z]) => window.__TEST__!.teleport(z, x, y), [cave.beltX, cave.y + 0.05, cave.z] as const);
      await waitTicks(page, 5);
      await page.evaluate(() => window.__TEST__!.triggerWave());
      await waitTicks(page, 3);
      expect((await testState(page)).wave).toMatchObject({ phase: 'warn', scripted: false, shelter: 2 });
      await watchWave(page, cave, `${pace} normal`, `docs/evidence/proto/cave_shot_${width}x${height}_ru.png`);
    });
  }
}

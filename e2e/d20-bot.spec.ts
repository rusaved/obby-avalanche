import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, testState } from './fixtures.ts';
import { STAGES } from './lv-stage-data.ts';

// D-01, D-08 (headquarters 27.10, «Lavina 20»): the first minutes of mountain 1 by two newbie bots on the phone view
// (880 × 405, the mock phone, quality low), fresh save, seed 7: «straight» holds the run up the axis and jumps at edges;
// «obedient» does the same and follows the game — on «Level up needed» to the belt the arrow points at, on «Avalanche in N»
// into the lit shelter. Both press the sneakers button when it can buy. Counted: the longest press against a closed ridge
// (off a belt), seconds at closed ridges, coins and level at 180 s, giant catches, avalanche catches, falls, the summit.
// The report goes to docs/evidence/D20/bot-<D20_LABEL>.txt (before / after the milestone).
const SCALE = 6;
const GAME_SEC = Number(process.env.D20_SEC || 300);
const NEAR = 14;
const W1 = STAGES[0]!;
const GATE_Z = W1.stages.slice(1).map((s) => s.z0);
const FAR = W1.stages[W1.stages.length - 1]!.end + 40;

type Report = {
  mode: string;
  maxWallSec: number;
  wallSec: number;
  walls: Array<{ gate: number; at: number; sec: number }>;
  coins180: number;
  level180: number;
  stage180: number;
  shoes: number;
  giant: number;
  avalanche: number;
  falls: number;
  waves: number;
  summitSec: number | null;
  stageBest: number;
};

async function runBot(page: Page, mode: 'straight' | 'obedient'): Promise<Report> {
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), SCALE);
  await page.evaluate(() => window.__TEST__!.botJump(true));
  await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), FAR);
  const r: Report = { mode, maxWallSec: 0, wallSec: 0, walls: [], coins180: -1, level180: -1, stage180: -1, shoes: 0, giant: 0, avalanche: 0, falls: 0, waves: 0, summitSec: null, stageBest: 0 };
  const t0 = (await testState(page)).ticks;
  let lastTick = (await testState(page)).simTick;
  let prevSec = 0;
  let wallRun = 0;
  let wallGate = -1;
  let wallAt = 0;
  let task: 'run' | 'belt' | 'shelter' = 'run';
  let back: [number, number] = [0, 0];
  let beltGate = -1;
  const endWall = (): void => {
    if (wallRun > 0.5) r.walls.push({ gate: wallGate + 1, at: Math.round(wallAt), sec: Math.round(wallRun * 10) / 10 });
    wallRun = 0;
    wallGate = -1;
  };
  for (;;) {
    const s = await testState(page);
    const sec = (s.ticks - t0) / 60;
    const dt = sec - prevSec;
    prevSec = sec;
    const evs = (await page.evaluate((t) => window.__TEST__!.simEvents.filter((e) => e.world === 1 && e.tick > t).map((e) => ({ name: e.name, tick: e.tick })), lastTick)) as Array<{ name: string; tick: number }>;
    for (const e of evs) {
      lastTick = Math.max(lastTick, e.tick);
      if (e.name === 'bossCaught') r.giant++;
      else if (e.name === 'waveCaught') r.avalanche++;
      else if (e.name === 'fall') r.falls++;
      else if (e.name === 'waveWarn') r.waves++;
    }
    r.stageBest = Math.max(r.stageBest, s.stageBest);
    if (r.coins180 < 0 && sec >= 180) {
      r.coins180 = s.coins;
      r.level180 = s.gatesOpen.filter(Boolean).length;
      r.stage180 = s.stage;
    }
    if (s.window === 'summit') {
      r.summitSec = Math.round(sec);
      break;
    }
    if (sec >= GAME_SEC) break;
    // The sneakers button with its green arrow: the newbie presses it.
    if (s.shoesButton.shown && s.shoesButton.can) {
      const before = s.shoeLevel;
      await page.locator('[data-hud="shoes"]').click({ timeout: 2000 }).catch(() => undefined);
      if ((await testState(page)).shoeLevel > before) r.shoes++;
    }
    const h = s.hero!;
    const gate = GATE_Z.findIndex((z, i) => !s.gatesOpen[i] && z > h.z - 2);
    const atWall = gate >= 0 && GATE_Z[gate]! - h.z < NEAR && !s.onBelt && !s.caught && !s.inShelter;
    if (atWall) {
      if (wallGate !== gate) {
        endWall();
        wallGate = gate;
        wallAt = sec;
      }
      wallRun += dt;
      r.wallSec += dt;
      r.maxWallSec = Math.max(r.maxWallSec, wallRun);
    } else endWall();
    if (mode === 'obedient') {
      const wave = s.wave;
      const warn = wave && (wave.phase === 'warn' || wave.phase === 'run') && wave.shelter >= 0;
      if (warn && task !== 'shelter') {
        const sh = (await page.evaluate(() => window.__TEST__!.shelters()))[wave!.shelter];
        if (sh) {
          task = 'shelter';
          back = sh.mouth;
          await page.evaluate((p) => window.__TEST__!.botPath(p), [sh.mouth, sh.inside] as Array<[number, number]>);
        }
      } else if (task === 'shelter' && !warn && !s.caught) {
        task = 'run';
        await page.evaluate(([b, z]) => window.__TEST__!.botPath([b, [0, b[1] + 6], [0, z]]), [back, FAR] as const);
      } else if (task === 'run' && s.hint === 'hint.stuck' && gate >= 0) {
        const shelters = await page.evaluate(() => window.__TEST__!.shelters());
        // The cave of the hint: the nearest below the ridge (app/ftue-view.ts caveBelow) — its belt, if it has one.
        let best = -1;
        shelters.forEach((c, i) => {
          if (c.z < GATE_Z[gate]! && (best < 0 || c.z > shelters[best]!.z)) best = i;
        });
        const c = shelters[best];
        if (c?.belt) {
          task = 'belt';
          beltGate = gate;
          back = c.mouth;
          await page.evaluate((p) => window.__TEST__!.botPath(p), [c.mouth, c.belt] as Array<[number, number]>);
        }
      } else if (task === 'belt' && s.gatesOpen[beltGate] === true) {
        task = 'run';
        await page.evaluate(([b, z]) => window.__TEST__!.botPath([b, [0, b[1] + 6], [0, z]]), [back, FAR] as const);
      }
    }
    if ((await page.evaluate(() => window.__TEST__!.botLeft())) === 0 && task === 'run') await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), FAR);
    await page.waitForTimeout(100);
  }
  endWall();
  r.wallSec = Math.round(r.wallSec);
  r.maxWallSec = Math.round(r.maxWallSec * 10) / 10;
  return r;
}

test.describe('D-01 · bots of the first minutes of mountain 1', () => {
  test.use({ viewport: { width: 880, height: 405 } });
  for (const mode of ['straight', 'obedient'] as const) {
    test(`@full D-01 ${mode} newbie: no press against a closed ridge longer than 10 s in the first 3 minutes`, async ({ page, openGame }) => {
      test.setTimeout(900_000);
      await openGame('pace=stages&mock_device=mobile&seed=7');
      const r = await runBot(page, mode);
      mkdirSync('docs/evidence/D20', { recursive: true });
      const label = process.env.D20_LABEL || 'after';
      writeFileSync(`docs/evidence/D20/bot-${label}-${mode}.json`, JSON.stringify(r, null, 1) + '\n');
      if (process.env.D20_STRICT !== '0') {
        const early = r.walls.filter((w) => w.at < 180);
        expect(Math.max(0, ...early.map((w) => w.sec)), JSON.stringify(r.walls)).toBeLessThanOrEqual(10);
      }
    });
  }
});

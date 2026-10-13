import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { test, expect, shot1080, testState, waitTicks } from './fixtures.ts';
import { passX, type Seg } from './base-route.ts';
import openWorlds from '../content/avalanche/pace/open/worlds.json' with { type: 'json' };
import openBalance from '../content/avalanche/pace/open/balance.json' with { type: 'json' };
import baseTuning from '../content/avalanche/tuning.json' with { type: 'json' };
import openTuning from '../content/avalanche/pace/open/tuning.json' with { type: 'json' };
import ru from '../content/avalanche/i18n/ru.json' with { type: 'json' };

// SP-06 (docs/01-gdd.md 20.6; docs/01a-content.md 19.4): the giant of mountain 1 runs at the hero, rocks to hide behind.
// The physical bot, 10 runs each (@full, ~6 min; a run or two of each without it; start x −20…20, waiting k × 0.9 s
// below the zone): the Speed of the advice straight up passes ≥ 9; 0.85 of its run speed behind a rock passes ≥ 7; 0.7
// is caught ≥ 9. Running up, the giant ahead stays
// within camera.bossKeepDeg of the view axis; «Duck behind a rock!» once, at the first catch; boss_passed and boss_caught
// carry `cover`; draw calls in the giant's zones of mountains 1, 5, 10 ≤ 45; the screenshot of the zone.
type Cover = { x: number; z: number; r: number; h: number };
type Boss = { zone: [number, number]; requires: number; covers: Cover[] };
const worlds = (openWorlds as unknown as { worlds: Array<{ bosses: Boss[]; segments: Seg[] }> }).worlds;
const boss1 = worlds[0]!.bosses[0]!;
const [A, C] = boss1.zone;
const ridge3 = worlds[0]!.segments.filter((g) => g.type === 'gate' && g.kind === 'ridge').sort((a, b) => a.z - b.z)[2]!;
const curve = { base: baseTuning.controller.baseSpeed, k: openBalance.speedCurve.k, max: openTuning.controller.maxSpeed };
const runSpeed = (stat: number): number => Math.min(curve.max, curve.base * (1 + curve.k * Math.log10(1 + stat)));
const statFor = (v: number): number => 10 ** ((v / curve.base - 1) / curve.k) - 1;
const KEEP_DEG = (openTuning.camera as { bossKeepDeg?: number }).bossKeepDeg ?? baseTuning.camera.bossKeepDeg;
const EVIDENCE = 'docs/evidence/sp';
type Policy = 'straight' | 'hide';
type Look = {
  hero: { x: number; z: number; vz: number };
  zone: string;
  giants: Array<{ x: number; z: number; mode: string; sight: string; search: number }>;
  caught: boolean;
  viewYaw: number;
  toast: string;
};

async function pastScriptedWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(8));
  await page.evaluate(() => window.__TEST__!.triggerWave());
  await page.waitForFunction(() => window.__TEST__!.state().wave?.scriptedPending === false && window.__TEST__!.state().wave?.phase === 'idle', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

const look = (page: Page): Promise<Look> =>
  page.evaluate(() => {
    const s = window.__TEST__!.state();
    const z = s.boss!.zones[0]!;
    return { hero: { x: s.hero!.x, z: s.hero!.z, vz: s.hero!.vz }, zone: z.hero, giants: z.giants, caught: s.caught !== null, viewYaw: s.viewYaw, toast: s.waveHud.toast };
  });

const angle = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Does the line a–b cross the square of half `r` round c? */
function crossSq(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [o, d] of [
    [ax - cx, bx - ax],
    [az - cz, bz - az],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) >= r) return false;
      continue;
    }
    const u = (-r - o) / d;
    const w = (r - o) / d;
    t0 = Math.max(t0, Math.min(u, w));
    t1 = Math.min(t1, Math.max(u, w));
    if (t0 >= t1) return false;
  }
  return true;
}

/** One run of the zone (the bot of tests/sim/boss.test.ts on the physical hero); `keep` — angles giant ↔ view axis. */
async function runZone(page: Page, k: number, stat: number, policy: Policy, keep: number[], toasts: string[]): Promise<'passed' | 'caught' | 'timeout'> {
  await page.evaluate(() => {
    window.__TEST__!.botPath(null);
    window.__TEST__!.resetGiants();
    window.__TEST__!.holdWave(900);
  });
  // Just below the line (the grotto by the axis is lower down); the giants' patrol phase — ×3 time.
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [A - 2, -20 + (40 * k) / 9] as const);
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await waitTicks(page, 10 + Math.round(k * 0.9 * 60));
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
  let state: 'wait' | 'duck' | 'away' | 'up' = policy === 'hide' ? 'wait' : 'up';
  let rock: Cover | null = null;
  let held = 0;
  let ax = 0;
  let az = 1;
  let entered = -1;
  for (let i = 0; i < 1500; i++) {
    const s = await look(page);
    if (s.caught) {
      // The toast of this catch (the hint once, then the usual).
      await waitTicks(page, 3);
      toasts.push((await look(page)).toast);
      await page.evaluate(() => window.__TEST__!.botPath(null));
      await page.waitForFunction(() => window.__TEST__!.state().caught === null, undefined, { timeout: 20_000 });
      return 'caught';
    }
    if (s.zone === 'passed') return 'passed';
    const h = s.hero;
    if (s.zone === 'in' && entered < 0) entered = i;
    const G = s.giants.reduce((p, g) => (Math.hypot(g.x - h.x, g.z - h.z) < Math.hypot(p.x - h.x, p.z - h.z) ? g : p));
    // Running up in the zone, the entry shot over: the giant ahead against the view axis.
    if (s.zone === 'in' && entered >= 0 && i - entered > 20 && h.vz > 0.5 && G.z > h.z + 2) keep.push((angle(s.viewYaw, Math.atan2(G.x - h.x, G.z - h.z)) * 180) / Math.PI);
    let tx = h.x;
    let tz = C + 30;
    if (state === 'wait') {
      if (Math.min(...s.giants.map((g) => g.z - A)) >= 0.6 * (C - A) || i > 600) {
        state = 'duck';
        await page.evaluate(() => window.__TEST__!.setTimeScale(1));
      } else {
        tz = A - 2;
        if (i === 0) await page.evaluate(() => window.__TEST__!.setTimeScale(3));
      }
    }
    if (state === 'duck') {
      held += 1;
      rock = boss1.covers.find((cv) => cv.z > h.z - cv.r) ?? null;
      if (!rock || held > 160) state = 'up';
      else if (s.giants.some((g) => g.sight === 'lost' && g.search >= 0)) {
        state = 'away';
        const d = Math.hypot(h.x - G.x, h.z - G.z) || 1;
        ax = (h.x - G.x) / d;
        az = (h.z - G.z) / d;
      } else {
        const dx = rock.x - G.x;
        const dz = rock.z - G.z;
        const d = Math.max(Math.abs(dx), Math.abs(dz)) || 1;
        tx = rock.x + (dx / d) * (rock.r + 1.5);
        tz = rock.z + (dz / d) * (rock.r + 1.5);
      }
    }
    if (state === 'away') {
      tx = h.x + ax * 10;
      tz = h.z + Math.max(az, 0.3) * 10;
      if (h.z >= rock!.z + 25 || Math.abs(h.x - rock!.x) > 25) state = 'up';
    }
    for (const cv of boss1.covers) {
      if (!crossSq(h.x, h.z, tx, tz, cv.x, cv.z, cv.r + 0.5)) continue;
      const e = cv.r + 1.5;
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const px = cv.x + sx * e;
        const pz = cv.z + sz * e;
        if (Math.hypot(px - h.x, pz - h.z) < 0.6 || crossSq(h.x, h.z, px, pz, cv.x, cv.z, cv.r + 0.5)) continue;
        const dd = Math.hypot(px - h.x, pz - h.z) + Math.hypot(tx - px, tz - pz);
        if (dd < bd) {
          bd = dd;
          best = [px, pz];
        }
      }
      if (best) [tx, tz] = best;
    }
    // His Speed as set: steps add none during the run.
    await page.evaluate(
      ([p, st]) => {
        window.__TEST__!.botPath([p]);
        window.__TEST__!.setStat(st);
      },
      [[tx, tz], stat] as [[number, number], number],
    );
    await waitTicks(page, 3);
  }
  return 'timeout';
}

test.describe.configure({ mode: 'serial' });

type Plan = Array<[string, number, Policy, number[]]>;

/** The runs of `plan` in a row on one page: results by name, angles giant ↔ view axis (advice runs), toasts of the catches. */
async function policies(page: Page, openGame: (q?: string) => Promise<void>, plan: Plan) {
  await openGame('pace=open');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  const keep: number[] = [];
  const toasts: string[] = [];
  const results: Record<string, string[]> = {};
  for (const [name, stat, policy, ks] of plan) {
    const res: string[] = [];
    for (const k of ks) res.push(await runZone(page, k, stat, policy, name === 'advice' ? keep : [], toasts));
    results[name] = res;
  }
  const rows = Object.entries(results).map(([name, res]) => `${name}: ${res.join(' ')}`);
  console.log(rows.join('\n'));
  const n = (name: string, what: string): number => results[name]!.filter((r) => r === what).length;
  return { keep, toasts, rows, n };
}

/** Running up at the giant: within bossKeepDeg of the view axis (a frame of slack for the turn of the view); «Duck behind
 * a rock!» at the first catch only; boss_passed once (the first giant), every catch boss_caught; both with `cover`. */
async function commonChecks(page: Page, keep: number[], toasts: string[], minKeep: number): Promise<void> {
  expect(keep.length).toBeGreaterThan(minKeep);
  const off = keep.filter((d) => d > KEEP_DEG + 3);
  expect(off.length / keep.length, `off by ${off.slice(0, 10).map((d) => d.toFixed(0)).join(', ')}°`).toBeLessThanOrEqual(0.05);
  expect(toasts.length).toBeGreaterThan(1);
  expect(toasts[0]).toBe(ru['hint.cover']);
  expect(toasts.slice(1).filter((t) => t === ru['hint.cover'])).toEqual([]);
  const ev = (await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'boss_passed' || e.name === 'boss_caught'))) as Array<{ name: string; params?: Record<string, unknown> }>;
  const passedEv = ev.filter((e) => e.name === 'boss_passed');
  expect(passedEv).toHaveLength(1);
  expect(typeof passedEv[0]!.params?.['cover']).toBe('boolean');
  const caughtEv = ev.filter((e) => e.name === 'boss_caught');
  expect(caughtEv.length).toBe(toasts.length);
  for (const e of caughtEv) expect(typeof e.params?.['cover']).toBe('boolean');
}

const v1 = runSpeed(boss1.requires);
const TEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

test('mountain 1, a run of each: the advice straight passes, 0.85 behind a rock passes, 0.7 is caught; the giant in view; the hint once; cover in the events', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  const { keep, toasts, rows, n } = await policies(page, openGame, [
    ['advice', boss1.requires, 'straight', [3]],
    ['0.85', statFor(0.85 * v1), 'hide', [3, 5]],
    ['0.7', statFor(0.7 * v1), 'hide', [3, 6]],
  ]);
  expect(n('advice', 'passed'), rows.join('\n')).toBe(1);
  expect(n('0.85', 'passed'), rows.join('\n')).toBeGreaterThanOrEqual(1);
  expect(n('0.7', 'caught'), rows.join('\n')).toBe(2);
  await commonChecks(page, keep, toasts, 5);
});

test('mountain 1: 10 runs a policy — the advice straight ≥ 9 pass, 0.85 behind a rock ≥ 7 pass, 0.7 ≥ 9 caught; the giant in view; the hint once; cover in the events @full', async ({ page, openGame }) => {
  test.setTimeout(1_200_000);
  const { keep, toasts, rows, n } = await policies(page, openGame, [
    ['advice', boss1.requires, 'straight', TEN],
    ['0.85', statFor(0.85 * v1), 'hide', TEN],
    ['0.7', statFor(0.7 * v1), 'hide', TEN],
  ]);
  expect(n('advice', 'passed'), rows.join('\n')).toBeGreaterThanOrEqual(9);
  expect(n('0.85', 'passed'), rows.join('\n')).toBeGreaterThanOrEqual(7);
  expect(n('0.7', 'caught'), rows.join('\n')).toBeGreaterThanOrEqual(9);
  await commonChecks(page, keep, toasts, 20);
});

test('draw calls in the giant’s zones of mountains 1, 5, 10 ≤ 45; screenshot of the zone of mountain 1', async ({ page, openGame }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await openGame('pace=open&quality=high');
  await page.evaluate(() => window.__TEST__!.setPlaySec(400));
  await pastScriptedWave(page);
  const rows: string[] = [];
  for (const index of [1, 5, 10]) {
    if (index > 1) {
      await page.evaluate((i) => window.__TEST__!.gotoWorld(i), index);
      await waitTicks(page, 20);
    }
    await page.evaluate(() => {
      window.__TEST__!.holdWave(900);
      window.__TEST__!.setStat(1e18);
    });
    const [a, c] = worlds[index - 1]!.bosses[0]!.zone;
    for (const t of [0.05, 0.3, 0.6, 0.9]) {
      const z = Math.round(a + t * (c - a));
      await page.evaluate((zz) => window.__TEST__!.teleport(zz, 0), z);
      await waitTicks(page, 20);
      const info = (await page.evaluate(() => window.__TEST__!.renderInfo()))!;
      rows.push(`mountain ${index}, z ${z}: ${info.calls}`);
      expect(info.calls, rows.join('\n')).toBeLessThanOrEqual(45);
    }
  }
  // Mountain 1: running in with the advice, the giant coming down at the hero, the rocks either side (slow motion).
  await page.evaluate(() => window.__TEST__!.gotoWorld(1));
  await waitTicks(page, 20);
  await page.evaluate((st) => {
    window.__TEST__!.holdWave(900);
    window.__TEST__!.resetGiants();
    window.__TEST__!.setStat(st);
  }, boss1.requires);
  // In the pass of ridge 3 nearest the middle (Q-064: on the axis; x 10 is its carniz now).
  await page.evaluate(([z, x]) => window.__TEST__!.teleport(z, x), [A - 30, passX(ridge3)] as const);
  // The banner of the finish straight gone.
  await waitTicks(page, 240);
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: 0, pitch: 0.3, dist: 20 }));
  await page.evaluate((z) => window.__TEST__!.botPath([[24, z]]), C);
  await page.waitForFunction((z) => (window.__TEST__!.state().hero?.z ?? 0) > z, A + 50, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(0.05));
  await shot1080(page, `${EVIDENCE}/giant_zone_1920x1080_ru.png`, 2);
  await page.evaluate(() => {
    window.__TEST__!.setTimeScale(1);
    window.__TEST__!.botPath(null);
    window.__TEST__!.setCamera('auto');
  });
  const s = await testState(page);
  expect(s.boss!.zones[0]!.giants.length).toBeGreaterThan(0);
});

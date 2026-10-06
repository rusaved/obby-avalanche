import { expect, testState, waitTicks } from './fixtures.ts';
import type { Page } from '@playwright/test';
import tuning from '../content/avalanche/tuning.json' with { type: 'json' };
import { paceBalance, paceWorlds, type Pace } from './pace-data.ts';

// PR-13 (playtest of the prototype 2, item 2 «camera» = 2): off a belt the camera sat in the hero's hat for about 1 s and
// stayed turned ~70° to the side, so «forward» led across the slope; on the phone the wide frame came on 3 belts of 6.
// One exit as a player does it, shared by the desktop spec (keys) and the mobile one (a touch stick through CDP): the
// hero runs up, walks onto the belt of the cave at a closed gate, stays there 5 s (an avalanche on some stays), the gate
// opens, he runs on by «forward». Every 0.1 s of the exit the camera is ≥ 2.5 units off his body and not in the level;
// in every rendered frame of it he is drawn and the camera is never that close (cameraStats); shotReturnSec + 0.2 s off
// the belt the view is within 10° of the yaw before the frame, and he runs up the slope.

/** Track borders: the cave box starts at the track edge and goes BORDER + depth outwards (src/level/builder.ts). */
const BORDER = 3;
const BELT_HALF = 1.5;
const DEG = Math.PI / 180;
/** Hero chest and head centre over the feet; the closest the camera may come to the body between them (PR-13). */
const CHEST = 1.5;
const HEAD = 4.4;
export const NEAR_HERO = 2.5;
const RETURN_TICKS = Math.round((tuning.avalanche.shotReturnSec + 0.2) * 60);

type Seg = { type: string; z: number; y: number; side?: string; depth?: number; requires?: number };
export type Cave = { index: number; side: number; z: number; y: number; mouthX: number; beltX: number; requires: number; nextGateZ: number };

/** Caves of mountain 1 bottom up with the number of the gate right above each (the cave at gate i, docs/01-gdd.md 16.3). */
export function caves(pace: Pace): Cave[] {
  const w = paceWorlds<{ width: number; segments: Seg[] }>(pace)[0]!;
  const gates = w.segments.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
  return w.segments
    .filter((s) => s.type === 'niche')
    .sort((a, b) => a.z - b.z)
    .map((s, index) => {
      const side = s.side === 'right' ? 1 : -1;
      const beltX = side * (w.width / 2 + BORDER + (s.depth ?? 4) - BELT_HALF);
      return { index, side, z: s.z, y: s.y, mouthX: (side * w.width) / 2, beltX, requires: gates[index]!.requires ?? 0, nextGateZ: gates[index + 1]?.z ?? Infinity };
    });
}

/** Ten caves from the one below the scripted wave's (its gate opens on the approach in fast): the scripted wave comes
 * on the approach to the second. */
export function exitCaves(pace: Pace, n: number): Cave[] {
  const first = paceBalance(pace).ftue.scriptedWaveWall - 2;
  return caves(pace).slice(first, first + n);
}

/** «Forward» held or let go: W on the keyboard, the stick on the phone. */
export interface Mover {
  forward(on: boolean): Promise<void>;
  /** On the way up, before the belt (the phone: a thumb drags the camera and stays resting on its zone). */
  onTheWay(): Promise<void>;
  /** Every finger and key off (on the belt). */
  release(): Promise<void>;
}

export const keyboardMover = (page: Page): Mover => ({
  async forward(on) {
    if (on) await page.keyboard.down('KeyW');
    else await page.keyboard.up('KeyW');
  },
  async onTheWay() {},
  async release() {
    await page.keyboard.up('KeyW');
  },
});

type Point = { x: number; y: number; id: number };
/** A dynamic stick on the left half (finger 1) and a camera thumb on the right half (finger 2), as real touches (CDP). */
export async function touchMover(page: Page): Promise<Mover> {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Point[]): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
  let down: Point[] = [];
  const releaseAll = async (): Promise<void> => {
    if (down.length === 0) return;
    down = [];
    await send('touchEnd', []);
  };
  const set = async (p: Point): Promise<void> => {
    const had = down.some((d) => d.id === p.id);
    down = [...down.filter((d) => d.id !== p.id), p];
    await send(had ? 'touchMove' : 'touchStart', down);
  };
  return {
    async forward(on) {
      if (!on) {
        // A touchEnd lifts every finger: the stick is let go with the rest.
        await releaseAll();
        return;
      }
      await set({ x: 150, y: 300, id: 1 });
      await set({ x: 150, y: 255, id: 1 });
    },
    async onTheWay() {
      // A short look to the right and back, then the thumb rests on the camera zone (as children hold a phone).
      await set({ x: 640, y: 200, id: 2 });
      for (const x of [660, 680, 660, 640]) {
        await set({ x, y: 200, id: 2 });
        await waitTicks(page, 1);
      }
    },
    release: releaseAll,
  };
}

/** A wave (scripted or forced) waited out with the hero where he is; the camera checked on the belt after it. */
async function waitWave(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.setTimeScale(3));
  await page.waitForFunction(() => window.__TEST__!.state().wave!.phase === 'idle', undefined, { timeout: 90_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

type Sample = { tick: number; onBelt: boolean; z: number; viewYaw: number; controlYaw: number; dist: number; inGeo: boolean; fixed: number };

async function sample(page: Page): Promise<Sample> {
  return page.evaluate(
    ({ chest, head }) => {
      const api = window.__TEST__!;
      const s = api.state();
      const h = s.hero!;
      const [cx, cy, cz] = s.cameraPos;
      const y = Math.min(h.y + head, Math.max(h.y + chest, cy));
      return {
        tick: s.ticks,
        onBelt: s.onBelt,
        z: h.z,
        viewYaw: s.viewYaw,
        controlYaw: s.controlYaw,
        dist: Math.hypot(cx - h.x, cy - y, cz - h.z),
        inGeo: api.cameraInsideGeometry(),
        fixed: s.cameraFixedBlend,
      };
    },
    { chest: CHEST, head: HEAD },
  );
}

export type ExitResult = { wide: boolean; wave: boolean; yawErrDeg: number; minDist: number; dz: number; frames: number };

/**
 * One stay on the belt of `cave` and the exit by «forward». `wave`: an avalanche while the hero is on the belt (forced if
 * none comes by itself). `spot`: where along the belt he steps on (units from its middle). `shot`: screenshot path of the
 * frame right after the way back.
 */
export async function beltExit(page: Page, mover: Mover, cave: Cave, label: string, opts: { wave?: boolean; spot?: number | undefined; shot?: string | undefined } = {}): Promise<ExitResult> {
  await mover.release();
  await page.evaluate(() => window.__TEST__!.botPath(null));
  // Below the cave, the gate above it closed (a stay on the belt adds less than 3/4 of its number).
  await page.evaluate(([x, z]) => window.__TEST__!.teleport(z, x), [0, cave.z - 16] as const);
  let s = await testState(page);
  if (s.stat * 4 > cave.requires) await page.evaluate((n) => window.__TEST__!.setStat(n), Math.floor(cave.requires / 4));
  await waitTicks(page, 3);
  // Up the slope by «forward», then into the cave and onto the belt (the bot walks, the camera is left alone).
  await mover.forward(true);
  await mover.onTheWay();
  await page.waitForFunction((z) => window.__TEST__!.state().hero!.z >= z, cave.z - 5, { timeout: 30_000 });
  s = await testState(page);
  const yawBefore = s.viewYaw;
  expect(s.gatesOpen[cave.index], `${label}: gate ${cave.index + 1} (${cave.requires}) closed`).toBe(false);
  const spot = opts.spot ?? 0;
  await page.evaluate(([a, b, c, d]) => window.__TEST__!.botPath([[a, b], [c, d]]), [cave.side * 12, cave.z - 1 + spot, cave.beltX, cave.z + spot] as const);
  await page.waitForFunction(() => window.__TEST__!.state().onBelt, undefined, { timeout: 30_000 });
  await mover.release();
  await page.waitForFunction(() => window.__TEST__!.botLeft() === 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__TEST__!.botPath(null));
  // The wide frame on the belt (on the phone too: the resting thumb is not a turn by hand).
  await waitTicks(page, Math.ceil(tuning.avalanche.shotReturnSec * 60) + 30);
  s = await testState(page);
  const wide = s.onBelt && (s.waveHud.beltShot || s.waveHud.shot) && s.cameraFixedBlend === 1;
  const waveSeen = s.wave!.phase !== 'idle';
  // 5 s on the belt; an avalanche on it when asked, when one runs, or when the next one is near (it never starts on the exit).
  await waitTicks(page, 300 - 30);
  s = await testState(page);
  let wave = s.wave!.phase !== 'idle';
  if (opts.wave && !wave) {
    await page.evaluate(() => window.__TEST__!.triggerWave());
    wave = true;
  }
  if (!wave && !s.wave!.scriptedPending && s.wave!.timer < 25) {
    await page.evaluate(() => window.__TEST__!.triggerWave());
    wave = true;
  }
  if (wave) {
    await waitTicks(page, 3);
    await waitWave(page);
    await waitTicks(page, 3);
    s = await testState(page);
    expect(s.onBelt, `${label}: on the belt after the avalanche`).toBe(true);
    expect(s.waveHud.beltShot, `${label}: wide frame on the belt after the avalanche`).toBe(true);
  }
  if (!s.gatesOpen[cave.index]) {
    await page.evaluate((n) => window.__TEST__!.setStat(n), cave.requires);
    await waitTicks(page, 3);
  }
  s = await testState(page);
  expect(s.gatesOpen[cave.index], `${label}: gate open`).toBe(true);
  expect(s.onBelt, `${label}: still on the belt`).toBe(true);

  // Off the belt by «forward» (pressed anew: the movement frame is the frame's, out of the cave to the gate).
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  await mover.forward(true);
  let leftAt = -1;
  let leftZ = 0;
  let atReturn: Sample | null = null;
  let minDist = Infinity;
  for (let i = 0; i < 200; i++) {
    const p = await sample(page);
    if (leftAt < 0 && !p.onBelt) {
      leftAt = p.tick;
      leftZ = p.z;
    }
    const at = `${label} exit ${i} (tick ${leftAt < 0 ? 'on belt' : p.tick - leftAt})`;
    minDist = Math.min(minDist, p.dist);
    expect(p.dist, `${at}: camera to the hero's body`).toBeGreaterThanOrEqual(NEAR_HERO);
    expect(p.inGeo, `${at}: camera in the level`).toBe(false);
    if (leftAt >= 0 && atReturn === null && p.tick - leftAt >= RETURN_TICKS) {
      atReturn = p;
      if (opts.shot) await page.screenshot({ path: opts.shot });
    }
    if (atReturn && p.tick - atReturn.tick >= 12) {
      const yawErrDeg = Math.abs(Math.atan2(Math.sin(atReturn.viewYaw - yawBefore), Math.cos(atReturn.viewYaw - yawBefore))) / DEG;
      const ctlErrDeg = Math.abs(Math.atan2(Math.sin(p.controlYaw - yawBefore), Math.cos(p.controlYaw - yawBefore))) / DEG;
      const st = await page.evaluate(() => window.__TEST__!.cameraStats());
      await mover.release();
      expect(atReturn.fixed, `${label}: back to the player's camera`).toBe(0);
      expect(yawErrDeg, `${label}: view yaw shotReturnSec + 0.2 s off the belt vs before the frame`).toBeLessThanOrEqual(10);
      expect(ctlErrDeg, `${label}: «forward» up the slope again`).toBeLessThanOrEqual(10);
      // Up the slope: higher than where he left the belt, and still climbing unless the next closed gate stops him.
      expect(atReturn.z - leftZ, `${label}: the hero went up the slope`).toBeGreaterThan(2);
      const atGate = cave.nextGateZ - p.z < 3;
      expect(p.z - atReturn.z > 1 || atGate, `${label}: the hero runs up the slope (z ${atReturn.z.toFixed(1)} → ${p.z.toFixed(1)}, next gate ${cave.nextGateZ})`).toBe(true);
      expect(st.frames, `${label}: frames of the exit`).toBeGreaterThan(5);
      expect(st.heroNear, `${label}: frames with the camera at the hero\n${st.bad.join('\n')}`).toBe(0);
      expect(st.heroHidden, `${label}: frames with the hero hidden\n${st.bad.join('\n')}`).toBe(0);
      expect(st.inside, `${label}: frames with the camera in the level\n${st.bad.join('\n')}`).toBe(0);
      return { wide, wave: wave || waveSeen, yawErrDeg, minDist, dz: atReturn.z - leftZ, frames: st.frames };
    }
    await waitTicks(page, 6);
  }
  throw new Error(`${label}: the hero never left the belt`);
}

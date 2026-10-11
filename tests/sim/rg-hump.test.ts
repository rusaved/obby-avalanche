import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { validateOpenFun, validateOpenShapes } from '../../src/level/validate-open.ts';
import { createSim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, OpenSpecJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-08: the hump — up an ice slide, off a trampoline over the section (docs/01-gdd.md 18.3; docs/01a-content.md 17.2).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const speedAt = (st: number): number => moveSpeed(st, curve);
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w8 = worlds.worlds[7]!;
const level = buildLevel(w8);
const hump = level.shapes!.find((s) => s.kind === 'hump' && s.section === 2)!;
const xm = (hump.x0 + hump.x1) / 2;
const ridges = spec.mountains[7]!.ridges;

/** Runs up the hump at the stat; where he lands, which air gifts he took, steps counted in the air. */
function fly(stat: number): { land: number; landX: number; airTaken: number; air: number; airSteps: number; launched: boolean } {
  const s = createSim(level, tuning, { balance, speedCurve: curve, stat });
  const air = s.gifts.flatMap((g, i) => (g.z > hump.z1 && g.z < hump.land![1] && g.y > hump.y + 2 ? [i] : []));
  const taken = new Set<number>();
  s.events.on('giftTake', ({ index }) => taken.add(index));
  let launched = false;
  let land = -1;
  let landX = 0;
  let airSteps = 0;
  s.events.on('padLaunch', () => (launched = true));
  s.events.on('gain', () => {
    if (launched && land < 0) airSteps++;
  });
  s.events.on('land', () => {
    if (launched && land < 0) {
      land = s.hero.pos.z;
      landX = s.hero.pos.x;
    }
  });
  s.teleport(xm, hump.y, hump.z0 - 10);
  for (let i = 0; i < 400 && land < 0; i++) s.step(RUN, DT);
  return { land, landX, airTaken: air.filter((i) => taken.has(i)).length, air: air.length, airSteps, launched };
}

describe('hump (RG-08)', () => {
  it('mountain 8: up 10 over 40 on the bold lane, the trampoline the width of the lane on the crest', () => {
    expect(hump.side).toBe(w8.segments.find((s) => s.type === 'fork' && s['section'] === 2)!['bold']);
    const ramp = level.ramps.find((r) => r.z0 === hump.z0 && r.x0 === hump.x0)!;
    expect(ramp.y1 - ramp.y0).toBe(10);
    expect(ramp.z1 - ramp.z0).toBe(40);
    expect(ramp.material).toBe('ice');
    const pad = level.points.find((p) => p.type === 'jumpPad' && p.z > hump.z0 && p.z < hump.z1)!;
    expect(pad['width']).toBe(hump.x1 - hump.x0);
    expect(pad.y).toBe(hump.y + 10);
  });

  it('at the minimum speed of the section: into the landing, all 6 gifts of the flight taken, no steps in the air', () => {
    const r = fly(ridges[0]!.requires);
    expect(r.launched).toBe(true);
    expect(r.air).toBe(6);
    expect(r.airTaken).toBe(6);
    expect(r.airSteps).toBe(0);
    expect(r.land).toBeGreaterThanOrEqual(hump.land![0] - 2);
    expect(r.land).toBeLessThanOrEqual(hump.land![1] + 2);
    expect(Math.abs(r.landX)).toBeLessThan(w8.width / 2);
  });

  it('at the top speed of the section (its ridge) into the landing too, on the track', () => {
    const r = fly(ridges[1]!.requires);
    expect(r.launched).toBe(true);
    expect(r.land).toBeGreaterThanOrEqual(hump.land![0] - 2);
    expect(r.land).toBeLessThanOrEqual(hump.land![1] + 2);
    expect(Math.abs(r.landX)).toBeLessThan(w8.width / 2);
  });

  it('validator: the landing grotto is a must; flight and the run to it ≤ warnSec × 0.8', () => {
    expect(validateOpenShapes(worlds, spec)).toEqual([]);
    expect(validateOpenFun(worlds, tuning, speedAt)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(worlds)) as WorldsJson;
    const segs = bad.worlds[7]!.segments;
    const i = segs.findIndex((s) => s.type === 'niche' && s['side'] === hump.side && s.z > hump.land![1] && s.z < hump.land![1] + 10);
    expect(i).toBeGreaterThanOrEqual(0);
    segs.splice(i, 1);
    expect(validateOpenShapes(bad, spec).some((e) => e.includes('(clouds): section 2') && e.includes('no landing grotto'))).toBe(true);
  });
});

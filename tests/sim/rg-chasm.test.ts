import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { validateOpenFun, validateOpenShapes } from '../../src/level/validate-open.ts';
import { createSim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, BotsJson, OpenSpecJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-02: the chasm and its trampolines — mountain 2 (docs/01-gdd.md 18.3; docs/01a-content.md 17.2).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const bots = read<BotsJson>('bots.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w2 = worlds.worlds[1]!;
const level = buildLevel(w2);
const chasm = level.shapes!.find((c) => c.kind === 'chasm' && c.section === 2)!;
// The minimum speed of the section: the stat of the ridge below it, no newbie bonus.
const stat = spec.mountains[1]!.ridges[0]!.requires;
const vmin = moveSpeed(stat, curve);
const sim = (): ReturnType<typeof createSim> => createSim(level, tuning, { balance, speedCurve: curve, stat });

describe('chasm and trampoline (RG-02)', () => {
  // SP-03 (docs/01a-content.md 19.5): 18 wide — at the run of «Размах» a hero would run over the 10 of RG.
  it('mountain 2: a chasm 18 wide and 3 deep across the whole slope, a trampoline on every lane before it', () => {
    expect(chasm.z1 - chasm.z0).toBe(18);
    expect(chasm.depth).toBe(3);
    expect(chasm.x0).toBe(-w2.width / 2);
    expect(chasm.x1).toBe(w2.width / 2);
    const pads = level.points.filter((p) => p.type === 'jumpPad' && p.z < chasm.z0 && p.z > chasm.z0 - 20);
    expect(pads.map((p) => p.x).sort((a, b) => a - b)).toEqual([-18, 0, 18]);
  });

  it('from the trampoline at the minimum speed of the section the hero lands ≥ 2 units past the far edge; no steps in the air', () => {
    const s = sim();
    expect(s.params.speed).toBeCloseTo(vmin, 6);
    s.teleport(0, chasm.y, chasm.z0 - 30);
    let launched = false;
    let landedZ = -1;
    let airGains = 0;
    s.events.on('padLaunch', () => (launched = true));
    s.events.on('gain', () => {
      if (launched && landedZ < 0) airGains++;
    });
    s.events.on('land', () => {
      if (launched && landedZ < 0) landedZ = s.hero.pos.z;
    });
    for (let i = 0; i < 180 && landedZ < 0; i++) s.step(RUN, DT);
    expect(launched).toBe(true);
    expect(landedZ).toBeGreaterThanOrEqual(chasm.z1 + 2);
    expect(airGains).toBe(0);
  });

  it('past the plates: down into it without a teleport, a gift of the bottom in his lane, out up the ramp in ≤ 4 s, «chasmDown» once', () => {
    const s = sim();
    s.teleport(-9, chasm.y, chasm.z0 - 8);
    const down: number[] = [];
    let respawns = 0;
    s.events.on('chasmDown', ({ section }) => down.push(section));
    s.events.on('respawn', () => respawns++);
    const bottomGifts = s.gifts.flatMap((g, i) => (g.z > chasm.z0 && g.z < chasm.z1 && g.y < chasm.y - 2 ? [i] : []));
    expect(bottomGifts).toHaveLength(3);
    const taken: number[] = [];
    s.events.on('giftTake', ({ index }) => taken.push(index));
    let prev = { y: s.hero.pos.y, z: s.hero.pos.z };
    let bottomAt = -1;
    let outAt = -1;
    for (let i = 0; i < 600 && outAt < 0; i++) {
      s.step(RUN, DT);
      const p = s.hero.pos;
      // No jumps of the position: at most a run step along z and a fall step in y.
      expect(Math.abs(p.z - prev.z)).toBeLessThan(2);
      expect(Math.abs(p.y - prev.y)).toBeLessThan(2);
      prev = { y: p.y, z: p.z };
      // Down in it: the bottom or the foot of its ramp (running off the edge he comes down there).
      if (bottomAt < 0 && s.hero.onGround && p.y < chasm.y - chasm.depth! + 1) bottomAt = i;
      if (bottomAt >= 0 && p.z > chasm.z1 && s.hero.onGround && p.y >= chasm.y - 0.01) outAt = i;
    }
    expect(respawns).toBe(0);
    expect(bottomAt).toBeGreaterThanOrEqual(0);
    expect(outAt).toBeGreaterThan(bottomAt);
    expect((outAt - bottomAt) * DT).toBeLessThanOrEqual(4);
    expect(down).toEqual([2]);
    expect(taken.filter((i) => bottomGifts.includes(i))).toHaveLength(1);
  });

  it('a trampoline throws only a hero running up the slope: back down over it from the bottom to a grotto behind — no throw', () => {
    const s = sim();
    const pad = level.points.find((p) => p.type === 'jumpPad' && p.z < chasm.z0 && p.x === -18)!;
    s.teleport(-18, chasm.y, pad.z + 6);
    const BACK: HeroInput = { moveX: 0, moveZ: -1, jump: false, jumpHeld: false };
    for (let i = 0; i < 40; i++) s.step(BACK, DT);
    expect(s.hero.pos.z).toBeLessThan(pad.z - 4);
    expect(s.fun.launches).toBe(0);
  });

  it('bots: one over the plate flies over, one past it goes down and up the ramp', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat, bots: { cfg: bots, count: 2, seed: 3 } });
    const [a, b] = s.bots!.list;
    for (const [bot, x] of [[a!, 0], [b!, -9]] as const) {
      bot.mode = 'up';
      bot.lane = x;
      bot.x = x;
      bot.z = chasm.z0 - 20;
      bot.path = [[x, chasm.z1 + 30]];
    }
    let aMin = Infinity;
    let bMin = Infinity;
    let aTop = -Infinity;
    for (let i = 0; i < 300; i++) {
      s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, DT);
      if (a!.z > chasm.z0 && a!.z < chasm.z1) {
        aMin = Math.min(aMin, a!.y);
        aTop = Math.max(aTop, a!.y);
      }
      if (b!.z > chasm.z0 && b!.z < chasm.z1) bMin = Math.min(bMin, b!.y);
    }
    expect(aMin).toBeGreaterThan(chasm.y);
    expect(aTop).toBeGreaterThan(chasm.y + 3);
    expect(bMin).toBeCloseTo(chasm.y - chasm.depth!, 3);
    expect(a!.z).toBeGreaterThan(chasm.z1);
    expect(b!.z).toBeGreaterThan(chasm.z1);
    expect(b!.y).toBeCloseTo(level.floorAt(b!.x, b!.z), 3);
  });

  it('validator: a trampoline whose arc at the ceiling of the run meets a cliff is an error (RG-09: the fork right past a chasm)', () => {
    const speedAt = (st: number): number => moveSpeed(st, curve);
    expect(validateOpenFun(worlds, tuning, speedAt)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(worlds)) as WorldsJson;
    bad.worlds[1]!.segments.push({ type: 'fork', z: chasm.z1 + 20, length: 30, x: 0, y: chasm.y, width: 8, height: 10, bold: 'left', section: 99 });
    expect(validateOpenFun(bad, tuning, speedAt).some((e) => e.includes('(pines)') && e.includes('meets a cliff or a wall'))).toBe(true);
  });

  it('validator: a chasm without a trampoline on one of the lanes is an error', () => {
    const bad = JSON.parse(JSON.stringify(worlds)) as WorldsJson;
    const segs = bad.worlds[1]!.segments;
    const pad = segs.findIndex((x) => x.type === 'jumpPad' && x['shape'] === 'chasm');
    segs.splice(pad, 1);
    expect(validateOpenShapes(bad, spec).some((e) => e.includes('(pines)') && e.includes('trampolines, one on every lane'))).toBe(true);
    expect(validateOpenShapes(worlds, spec)).toEqual([]);
  });
});

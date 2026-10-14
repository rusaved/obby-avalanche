import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_INPUT, type HeroInput } from '../../src/sim/controller.ts';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, Segment, TuningJson, WorldsJson } from '../../src/content/types.ts';

// Q-068 (producer 14.10: on a trampoline arc the hero flew past the gifts and took none; gifts came back after every
// avalanche): on the open slope every trampoline throws along its gifts in the air — the controller's own flight, run
// onto the pad at the speed of the ridge below and faster up to the top speed, takes every gift of its arc; with
// balance.gifts.respawn "never" a gone wave puts no gift back.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/open/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/open/balance.json')) as unknown as BalanceJson;
const worlds = read('pace/open/worlds.json') as WorldsJson;
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const num = (s: Segment, k: string): number => s[k] as number;

describe('gifts in the air over trampolines (Q-068)', () => {
  it('mountains 2, 4, 8: from the speed of the ridge below to the top speed every flight takes all gifts of its arc', () => {
    let flights = 0;
    // Mountain 2: the chasm and the crevasse; 4: the side pad a rock stood on; 8: the hump.
    const sims: Record<string, ReturnType<typeof createSim>> = {};
    for (const mi of [1, 3, 7]) {
      const w = worlds.worlds[mi]!;
      const level = buildLevel(w);
      const ridges = w.segments.filter((s) => s.type === 'gate' && s['kind'] === 'ridge').sort((a, b) => a.z - b.z);
      for (const pad of w.segments.filter((s) => s.type === 'jumpPad')) {
        const x = num(pad, 'x');
        const air = level.points.filter((g) => g.type === 'gift' && g['air'] === true && g.x === x && g.z > pad.z && g.z < pad.z + 60);
        const below = ridges.filter((r) => r.z < pad.z).at(-1);
        if (!below || air.length === 0) continue;
        const req = num(below, 'requires');
        // The hump's pad stands on its crest: the run starts at the foot of its ramp.
        const hump = w.segments.find((s) => s.type === 'hump' && pad.z >= s.z && pad.z <= s.z + num(s, 'length') + 10);
        const z0 = hump ? hump.z - 6 : pad.z - 12;
        for (const stat of [req, req * 30, 1e12]) {
          // RL-01: a trampoline on many more sections — one sim a mountain, its gifts back and its stat reset each flight.
          const s = (sims[`${mi}`] ??= createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat }));
          s.respawnGifts();
          s.progress.stat = stat;
          const idx = air.map((g) => s.gifts.findIndex((q) => q.x === g.x && q.z === g.z && q.y === g.y));
          s.teleport(x, level.floorAt(x, z0) + 0.05, z0);
          for (let k = 0; k < 10; k++) s.step(NO_INPUT, DT);
          const zEnd = Math.max(...air.map((g) => g.z)) + 4;
          for (let k = 0; k < 600 && s.hero.pos.z < zEnd; k++) s.step(RUN, DT);
          const missed = idx.filter((i) => !s.gifts[i]!.taken).map((i) => `z ${s.gifts[i]!.z} y ${s.gifts[i]!.y}`);
          expect(missed, `mountain ${mi + 1}, trampoline z ${pad.z} x ${x}, stat ${stat}`).toEqual([]);
          flights++;
        }
      }
    }
    expect(flights).toBeGreaterThanOrEqual(30);
  }, 240_000);

  it('with respawn "never" a gone wave puts no gift back', () => {
    const level = buildLevel(worlds.worlds[0]!);
    const s = createSim(level, tuning, { balance, speedCurve: balance.speedCurve, stat: 1e6 });
    const g = s.gifts[0]!;
    s.teleport(g.x, level.floorYAt(g.z - 6) + 0.05, g.z - 6);
    for (let k = 0; k < 10; k++) s.step(NO_INPUT, DT);
    for (let k = 0; k < 40 && !g.taken; k++) s.step(RUN, DT);
    expect(g.taken).toBe(true);
    let respawned = 0;
    s.events.on('giftsRespawn', () => respawned++);
    s.events.emit('waveGone', { tick: s.tick });
    expect(respawned).toBe(0);
    expect(g.taken).toBe(true);
  });
});

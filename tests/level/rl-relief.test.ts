import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { createSim } from '../../src/sim/world.ts';
import type { BalanceJson, OpenSpecJson, ThemeJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RL-04: dips with a way out that throws, and every mountain its own sky and snow (docs/01-gdd.md 21.4).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const theme = read<ThemeJson>('theme.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };

describe('dips and tints (RL-04)', () => {
  it('a dip on every mountain (mountain 1 on section 3): 4–6 deep, its way out up to kick over the slope; no grotto in it', () => {
    const D = spec.shapes!.dip!;
    for (const w of worlds.worlds) {
      const dips = w.segments.filter((s) => s.type === 'dip');
      expect(dips.length, w.id).toBeGreaterThan(0);
      if (w.index === 1) expect(dips.map((d) => d['section'])).toEqual([3]);
      const level = buildLevel(w);
      for (const d of dips) {
        const depth = d['depth'] as number;
        expect(depth).toBeGreaterThanOrEqual(4);
        expect(depth).toBeLessThanOrEqual(6);
        expect(d['length']).toBe(D.down + D.bottom + D.up);
        expect(level.floorAt(0, d.z + D.down + D.bottom / 2)).toBeCloseTo((d['y'] as number) - depth, 6);
        expect(level.floorAt(0, d.z + (d['length'] as number) - 0.01)).toBeCloseTo((d['y'] as number) + D.kick, 1);
        for (const n of level.niches) expect(n.box.max[2] <= d.z + 1e-6 || n.box.min[2] >= d.z + (d['length'] as number) - 1e-6, `${w.id} grotto at ${n.z}`).toBe(true);
      }
    }
  });

  it('the hero runs through a dip at the speed of its section: down, out up the ramp, thrown a little over its lip', () => {
    for (const wi of [0, 1, 6]) {
      const w = worlds.worlds[wi]!;
      const level = buildLevel(w);
      const d = w.segments.find((s) => s.type === 'dip')!;
      const below = w.segments.filter((s) => s.type === 'gate' && s.z < d.z).at(-1)!;
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat: below['requires'] as number });
      s.teleport(0, level.floorAt(0, d.z - 20) + 0.05, d.z - 20);
      let minY = Infinity;
      let airPast = false;
      const end = d.z + (d['length'] as number);
      for (let i = 0; i < 240 && s.hero.pos.z < end + 15; i++) {
        s.step(RUN, DT);
        if (s.hero.pos.z > d.z && s.hero.pos.z < end) minY = Math.min(minY, s.hero.pos.y);
        if (s.hero.pos.z > end && !s.hero.onGround) airPast = true;
      }
      expect(s.hero.pos.z, w.id).toBeGreaterThan(end + 15);
      expect(minY, w.id).toBeLessThan((d['y'] as number) - 1);
      expect(airPast, `${w.id}: thrown over the lip`).toBe(true);
      expect(s.caught).toBeNull();
    }
  });

  it('theme.json tints: mountains 2–10 each their own sky and snow, unlike mountain 1 and unlike the one before', () => {
    const tints = theme.tints!;
    expect(tints[worlds.worlds[0]!.id]).toBeUndefined();
    let prev = { top: theme.sky.top, track: theme.materials['track']!.color };
    for (const w of worlds.worlds.slice(1)) {
      const t = tints[w.id]!;
      expect(t, w.id).toBeDefined();
      expect(t.sky.top).not.toBe(theme.sky.top);
      expect(t.track).not.toBe(theme.materials['track']!.color);
      expect(t.sky.top).not.toBe(prev.top);
      expect(t.track).not.toBe(prev.track);
      prev = { top: t.sky.top, track: t.track };
    }
  });
});

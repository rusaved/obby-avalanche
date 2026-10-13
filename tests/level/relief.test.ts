import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import { validateOpenFairness, validateOpenFun, validateOpenGround, validateOpenShapes } from '../../src/level/validate-open.ts';
import type { BalanceJson, OpenSpecJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SP-07 (docs/01-gdd.md 20.7; docs/01a-content.md 19.5): the relief of the open slope — terraces 12…24 by mountain, the
// carniz of a ridge 4–6, chasms 18–28, the hump up 20 with a flight of 120–160, the throat 16 high, the ice cliff 12–16;
// mountain 1 only terraces 12 (no trampolines, no chasms).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const speedAt = (st: number): number => moveSpeed(st, curve);
const TERRACE = [12, 13, 15, 16, 18, 19, 21, 22, 23, 24];

describe('SP-07: relief', () => {
  it('the spec by 19.5: terraces, carniz 4–6, chasms 18–28, hump 20 / 140 (8: 120, 10: 160), throat 16, ice cliff 12–16', () => {
    expect(spec.mountains.map((m) => m.terraceRise)).toEqual(TERRACE);
    for (const m of spec.mountains) {
      expect(m.ridgeRise!).toBeGreaterThanOrEqual(4);
      expect(m.ridgeRise!).toBeLessThanOrEqual(6);
    }
    expect(spec.mountains[0]!.ridgeRise).toBe(4);
    const S = spec.shapes!;
    expect([S.chasm.width, ...Object.values(S.chasm.widthByWorld ?? {})].every((x) => x >= 18 && x <= 28)).toBe(true);
    expect([S.hump.rise, S.hump.flight, S.hump.flightByWorld]).toEqual([20, 140, { 8: 120, 10: 160 }]);
    expect(S.throat.height).toBe(16);
    for (const m of spec.mountains.slice(1)) {
      expect(m.cliffHeight!).toBeGreaterThanOrEqual(12);
      expect(m.cliffHeight!).toBeLessThanOrEqual(16);
    }
  });

  for (const [wi, w] of worlds.worlds.entries()) {
    it(`mountain ${wi + 1} (${w.id}): every terrace rises ${TERRACE[wi]}, every carniz ${spec.mountains[wi]!.ridgeRise}; the cliffs as the spec says`, () => {
      const m = spec.mountains[wi]!;
      const level = buildLevel(w);
      const ridges = level.gates.filter((g) => g.kind === 'ridge');
      expect(ridges.length).toBe(m.sections.length);
      // The floor of a section past its flag against the one below: one terrace up; the carniz of its ridge.
      const floorPast = (k: number): number => {
        const z = w.zones[k]!.zStart + 13;
        return level.floorAt(0, z);
      };
      for (let k = 1; k < w.zones.length; k++) {
        expect(floorPast(k) - floorPast(k - 1), `zone ${k + 1}`).toBeCloseTo(m.terraceRise!, 6);
        const g = w.segments.find((s) => s.type === 'gate' && s.z === w.zones[k]!.zStart)!;
        expect(g['rise'], `ridge ${k}`).toBe(m.ridgeRise);
      }
      for (const c of w.segments.filter((s) => s.type === 'cliff')) expect(c['height']).toBe(m.cliffHeight);
      if (wi === 0) {
        // Mountain 1: terraces and the crevasse of the fork only.
        expect(w.segments.filter((s) => s.type === 'jumpPad' || s.type === 'chasm' || s.type === 'hump' || s.type === 'cliff')).toEqual([]);
      }
    });
  }

  it('the validator: gaps within 60% of a jump at the slowest speed of the section, trampoline arcs land, no dead ends', () => {
    expect(validateOpenShapes(worlds, spec)).toEqual([]);
    expect(validateOpenFun(worlds, tuning, speedAt)).toEqual([]);
    expect(validateOpenFairness(worlds, speedAt)).toEqual([]);
    expect(validateOpenGround(worlds, tuning, speedAt)).toEqual([]);
  });
});

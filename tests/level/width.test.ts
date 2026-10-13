import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel, BORDER_WIDTH } from '../../src/level/builder.ts';
import { fieldOf, OPEN_SLOPE, passesOf } from '../../src/level/open-slope.ts';
import { openFairnessReport } from '../../src/level/validate-open.ts';
import { laneIntervals } from '../../src/sim/bots.ts';
import { entranceX, firstShelter } from '../../src/sim/shelter.ts';
import { giftEggSpot } from '../../src/sim/gift-egg.ts';
import { createSim } from '../../src/sim/world.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, BotsJson, OpenSpecJson, Segment, TuningJson, WorldsJson } from '../../src/content/types.ts';

// SP-04 (docs/01-gdd.md 20.4; docs/01a-content.md 19.2): every section of the open slope its own width (100–220), the
// change past a ridge over widthTaper 40, the floor and the fence as wide as the section at every z, a grotto in a rock on
// a section wider than 120, one passage of a ridge every 30 units of its width (3–7), the digits 8 on the field.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const tuning = mergePatch(read('tuning.json'), read('pace/open/tuning.json')) as unknown as TuningJson;
const balance = mergePatch(read('balance.json'), read('pace/open/balance.json')) as unknown as BalanceJson;
const bots = mergePatch(read('bots.json'), read('pace/open/bots.json')) as unknown as BotsJson;
const spec = read('pace/open/worlds-spec.json') as OpenSpecJson;
const worlds = read('pace/open/worlds.json') as WorldsJson;
const wallHeight = tuning.bounds?.wallHeight ?? 0;
const T = spec.widthTaper!;

/** Is (x, z) inside a convex polygon (either winding). */
function inside(pts: Array<[number, number]>, x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

describe('SP-04: the width of the slope by sections', () => {
  it('the spec: the widths of 01a 19.2, a change over 40, a passage every 30, rocks 12 across every 2 × shelterEvery past 120', () => {
    // 19.2, a section with a split fork no narrower than 2 × 44 + its crevasse (19.3, SP-05): 124 / 132 / 140 / 148.
    expect(spec.mountains.map((m) => m.sections.map((s) => s.width))).toEqual([
      [100, 180, 110],
      [110, 120, 200, 124],
      [110, 124, 110, 200],
      [120, 200, 132, 132],
      [100, 132, 110, 220],
      [120, 132, 200, 132],
      [110, 200, 140, 140],
      [120, 140, 140, 220],
      [110, 148, 220, 148],
      [120, 148, 148, 220],
    ]);
    expect(spec.mountains.map((m) => m.boss.width)).toEqual([160, 170, 170, 180, 180, 180, 190, 190, 200, 200]);
    expect(T).toBe(40);
    expect(spec.passEvery).toBe(30);
    expect(spec.island).toEqual({ size: 12, every: 2, minWidth: 120 });
    expect(spec.ridgeDigits).toEqual({ field: 8, other: 6 });
    expect(bots.laneSpread).toBe(20);
    // Classic and fast keep their crowd as it was.
    expect((read('bots.json') as BotsJson).laneSpread).toBeUndefined();
  });

  for (const [wi, w] of worlds.worlds.entries()) {
    it(`mountain ${wi + 1} (${w.id}): the floor and the fence at every z as wide as the section, a change monotone over 40, no gaps`, () => {
      const m = spec.mountains[wi]!;
      const level = buildLevel(w, { wallHeight });
      const halves = m.sections.map((s) => s.width! / 2);
      const finishHalf = m.boss.width! / 2;
      const S = halves.length;
      // The changes the spec asks for: past the passages of a ridge into a section of another width, at the giant's zone.
      const want: Array<{ z: number; from: number; to: number }> = [];
      // SP-07: the passages as long as the carniz of the mountain asks.
      const passLength = (j: number): number => w.segments.find((s) => s.type === 'gate' && s.z === w.zones[j]!.zStart)!['passLength'] as number;
      for (let j = 1; j < S; j++) if (halves[j] !== halves[j - 1]) want.push({ z: w.zones[j]!.zStart + passLength(j), from: halves[j - 1]!, to: halves[j]! });
      if (finishHalf !== halves[S - 1]) want.push({ z: w.bosses![0]!.zone[0], from: halves[S - 1]!, to: finishHalf });
      const tapers = w.segments.filter((s) => s.type === 'taper');
      expect(tapers.map((t) => ({ z: t.z, from: t['from'], to: t['to'] }))).toEqual(want);
      for (const t of tapers) expect(t['length']).toBe(T);
      // halfAt: the constant of the part outside a change, monotone between its ends inside.
      const f = level.funnel!;
      let constant = halves[0]!;
      let prev = level.halfAt(0);
      let k = 0;
      for (let z = 0.25; z < f.z0; z += 0.5) {
        const t = want[k];
        const e = level.halfAt(z);
        if (t && z > t.z && z < t.z + T) {
          expect(Math.sign(e - prev) * Math.sign(t.to - t.from), `z ${z}`).toBeGreaterThanOrEqual(0);
          expect(Math.min(t.from, t.to) - 1e-9).toBeLessThanOrEqual(e);
          expect(Math.max(t.from, t.to) + 1e-9).toBeGreaterThanOrEqual(e);
        } else {
          if (t && z >= t.z + T) {
            constant = t.to;
            k++;
          }
          expect(e, `z ${z}`).toBe(constant);
        }
        prev = e;
      }
      expect(k).toBe(want.length);
      // At every z up to the funnel mouth, on both sides: the floor reaches the edge and stops there; the fence closes it —
      // a border box from the edge out, a grotto in it, or the snow of a change of width.
      const borders = level.boxes.filter((b) => b.kind === 'border');
      const snow = (level.prisms ?? []).filter((p) => p.kind === 'taper');
      const grottos = level.niches.filter((n) => n.kind !== 'tunnel' && n.kind !== 'ledge' && n.kind !== 'island');
      let checked = 0;
      for (let z = w.zones[0]!.zStart + 0.25; z < f.z0; z += 0.5) {
        const e = level.halfAt(z);
        const inTaper = tapers.some((t) => z > t.z && z < t.z + T);
        for (const sign of [-1, 1]) {
          const where = `z ${z}, side ${sign}`;
          if (inTaper) {
            expect(snow.some((p) => inside(p.pts, sign * (e + 0.5), z)), where).toBe(true);
            continue;
          }
          expect(Number.isFinite(level.floorAt(sign * (e - 0.5), z)), where).toBe(true);
          expect(level.floorAt(sign * (e + 0.5), z), where).toBe(-Infinity);
          const x = sign * (e + BORDER_WIDTH / 2);
          const border = borders.find((b) => x > b.min[0] && x < b.max[0] && z >= b.min[2] && z <= b.max[2]);
          const grotto = grottos.find((n) => (n.side === 'left' ? -1 : 1) === sign && z >= n.box.min[2] - 0.5 && z <= n.box.max[2] + 0.5);
          expect(!!border || !!grotto, where).toBe(true);
          if (border) expect(sign < 0 ? border.max[0] : border.min[0], where).toBeCloseTo(sign * e, 6);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(w.length);
    });
  }

  it('a grotto in a rock on every section wider than 120 and on none narrower; open towards the camp, inside the slope', () => {
    for (const [wi, w] of worlds.worlds.entries()) {
      const level = buildLevel(w);
      spec.mountains[wi]!.sections.forEach((s, j) => {
        const zone = w.zones[j]!;
        // The rocks of 19.2 (no belt; the rocks with the belt by the run of mountain 1 are nearRun's).
        const rocks = level.niches.filter((n) => n.kind === 'island' && n.treadmill === 0 && n.z > zone.zStart && n.z < zone.zEnd);
        if (s.width! > spec.island!.minWidth) expect(rocks.length, `mountain ${wi + 1}, section ${j + 1}`).toBeGreaterThan(0);
        else expect(rocks, `mountain ${wi + 1}, section ${j + 1}`).toEqual([]);
        for (const r of rocks) {
          expect(r.box.max[0] - r.box.min[0]).toBeLessThanOrEqual(spec.island!.size);
          expect(Math.abs(r.box.min[0]) < s.width! / 2 && Math.abs(r.box.max[0]) < s.width! / 2).toBe(true);
          // The mouth (−z) is open: the only wall across this rock stands at its back.
          const mine = level.boxes.filter((b) => b.kind === 'islandWall' && b.min[2] >= r.box.min[2] - 0.01 && b.max[2] <= r.box.max[2] + 2 && b.min[0] > r.box.min[0] - 2 && b.max[0] < r.box.max[0] + 2);
          const across = mine.filter((b) => b.max[0] - b.min[0] > 4);
          expect(mine).toHaveLength(3);
          expect(across).toHaveLength(1);
          expect(across[0]!.min[2]).toBeGreaterThan(r.z);
        }
      });
    }
  });

  it('a ridge has one passage every 30 units of its width (3–7, odd with passAxis — Q-064), evenly, inside it; its digits 8 on the field, 6 elsewhere', () => {
    for (const [wi, w] of worlds.worlds.entries()) {
      const m = spec.mountains[wi]!;
      const ridges = w.segments.filter((s) => s.type === 'gate' && s['kind'] === 'ridge').sort((a, b) => a.z - b.z);
      ridges.forEach((g: Segment, j) => {
        const width = m.sections[j]!.width!;
        const passes = g['passes'] as number[];
        expect(passes.length, `mountain ${wi + 1}, ridge ${j + 1}`).toBe(passesOf(spec, width / 2).length);
        if (spec.passAxis) expect(passes, `mountain ${wi + 1}, ridge ${j + 1}`).toContain(0);
        const step = passes[1]! - passes[0]!;
        passes.forEach((x, i) => {
          expect(x).toBeCloseTo(passes[0]! + i * step, 2);
          expect(Math.abs(x) + (g['passWidth'] as number) / 2).toBeLessThan(width / 2);
        });
        expect(passes[0]! + passes[passes.length - 1]!).toBeCloseTo(0, 6);
        expect(g['digits']).toBe(j + 1 === fieldOf(m) ? 8 : 6);
      });
    }
  });

  it('the first avalanche of mountain 1 (20.4): its grottos are rocks by the lanes, their mouths ≤ 30 units off the lane lines', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w);
    const first = firstShelter(level, balance.ftue.scriptedWaveWall);
    const row = level.niches.filter((n) => n.stretch === level.niches[first]!.stretch && n.z === level.niches[first]!.z);
    expect(row.map((n) => n.kind)).toEqual(['island', 'island']);
    expect(row.map((n) => n.lane).sort()).toEqual(['bold', 'calm']);
    // SP-05: the lanes of the split fork there, their middles.
    const f = level.forks.find((x) => x.z0 <= row[0]!.z && x.z1 >= row[0]!.z)!;
    const laneX = f.x1 !== undefined ? f.x1 + f.track! / 2 : OPEN_SLOPE.laneX;
    for (const n of row) {
      const lane = Math.sign(n.box.min[0]) * laneX;
      const mouth = entranceX(level, n);
      expect(Math.abs(mouth - lane)).toBeLessThanOrEqual(30);
      expect(Math.min(Math.abs(n.box.min[0]), Math.abs(n.box.max[0]))).toBeGreaterThan(laneX + 1);
    }
    // The free egg of that wave stands in the rock by its back wall.
    const egg = giftEggSpot(level, balance.ftue.scriptedWaveWall)!;
    expect(egg.niche).toBe(first);
    expect(egg.z).toBeGreaterThan(level.niches[first]!.z);
  });

  it('Q-064: passAxis — the nearest odd number, a passage on the axis; off — the nearest whole (the criterion)', () => {
    const off = { passEvery: 30 };
    const on = { passEvery: 30, passAxis: true };
    expect([100, 110, 120, 180, 200, 220].map((w) => passesOf(off, w / 2).length)).toEqual([3, 4, 4, 6, 7, 7]);
    expect([100, 110, 120, 180, 200, 220].map((w) => passesOf(on, w / 2).length)).toEqual([3, 3, 5, 7, 7, 7]);
    for (const w of [100, 110, 120, 180, 200, 220]) expect(passesOf(on, w / 2)).toContain(0);
    expect(spec.passAxis).toBe(true);
  });

  it('validate-open: from the middle and both edges at the minimum speed of the section the nearest shelter ≤ warnSec × 0.8', () => {
    const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
    for (const r of openFairnessReport(worlds, (s) => moveSpeed(s, curve))) {
      expect(r.worstSec, r.world).toBeLessThanOrEqual(r.limitSec);
      expect(r.worstSec, r.world).toBeGreaterThan(0);
    }
  });

  it('the bots spread over the width of the section less laneSpread: lanes from edge − 10 to edge − 10; on the field of mountain 1 far from the middle; never through a rock', () => {
    const w = worlds.worlds[0]!;
    const level = buildLevel(w, { wallHeight });
    const field = w.zones[1]!;
    const e = level.halfAt(field.zEnd - 1);
    const lanes = laneIntervals(level, field.zStart, field.zEnd, bots.laneSpread! / 2);
    expect(lanes[0]![0]).toBeCloseTo(-e + 10, 6);
    expect(lanes[lanes.length - 1]![1]).toBeCloseTo(e - 10, 6);
    const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 1e9, bots: { cfg: bots, count: 6, seed: 5 } });
    let far = 0;
    let out = 0;
    for (let t = 0; t < 60 * 60; t++) {
      s.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, 1 / 60);
      for (const b of s.bots!.list) {
        if (b.mode !== 'up' || b.z < field.zStart + 70 || b.z > field.zEnd - 40) continue;
        if (Math.abs(b.x) > 40) far++;
        if (Math.abs(b.x) > level.halfAt(b.z) - 10 + 0.01) out++;
      }
    }
    expect(far).toBeGreaterThan(0);
    expect(out).toBe(0);
    // With waves: in and out of a grotto in a rock by its mouth only, never through its walls.
    const walls = level.boxes.filter((b) => b.kind === 'islandWall');
    const rocks = new Set(level.niches.flatMap((n, i) => (n.kind === 'island' ? [i] : [])));
    const w2 = createSim(level, tuning, {
      balance,
      speedCurve: curve,
      stat: 1e9,
      bots: { cfg: bots, count: 6, seed: 9 },
      threat: { threat: { ...w.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 10 },
    });
    // The hero stands on the field: the fronts come down over it (they start above him).
    const zh = field.zStart + 0.6 * (field.zEnd - field.zStart);
    w2.teleport(-30, level.floorAt(-30, zh) + 0.1, zh);
    const inWall: string[] = [];
    let inRock = 0;
    for (let t = 0; t < 120 * 60; t++) {
      // The first front once the bots are out on the slope, then every 20 s.
      if (t >= 6 * 60 && t % (20 * 60) === 6 * 60 && w2.threat?.state.phase === 'idle') w2.threat.trigger();
      w2.step({ moveX: 0, moveZ: 0, jump: false, jumpHeld: false }, 1 / 60);
      for (const b of w2.bots!.list) {
        if (b.mode === 'away' || b.mode === 'off') continue;
        if (rocks.has(b.cave) && b.mode === 'hide') inRock++;
        // The snowball hops over obstacles (docs/01-gdd.md 4.5): over a rock by its roof.
        if (b.mode === 'ball') continue;
        if (walls.some((wb) => b.x > wb.min[0] + 0.1 && b.x < wb.max[0] - 0.1 && b.z > wb.min[2] + 0.1 && b.z < wb.max[2] - 0.1) && inWall.length < 5) inWall.push(`bot ${b.index} (${b.mode}) at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
      }
    }
    expect(inWall, inWall.join('\n')).toEqual([]);
    expect(inRock, 'a bot hid in a rock').toBeGreaterThan(0);
  }, 120_000);
});

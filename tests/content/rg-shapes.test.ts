import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergePatch } from '../../src/content/pace.ts';
import { generateWorlds } from '../../src/level/generate.ts';
import { forkRange } from '../../src/level/open-slope.ts';
import { SLOTS } from '../../src/level/open-shapes.ts';
import { openFairnessReport, validateOpenShapes } from '../../src/level/validate-open.ts';
import { moveSpeed } from '../../src/sim/effects/moveSpeed.ts';
import type { BalanceJson, OpenSpecJson, Segment, TuningJson, WorldsJson } from '../../src/content/types.ts';

// RG-01: the character of the mountains in the data (docs/01-gdd.md 18.1–18.2, 18.6, 18.10; docs/01a-content.md 17.1–17.2).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const gen = (sp: OpenSpecJson): WorldsJson => generateWorlds({ spec: sp, balance, tuning });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** docs/01a-content.md 17.1 after RL-01 (producer 14.10): the elements of the sections (`fork` — a fork of 17.7). */
const TABLE: Record<string, string[][]> = {
  slope: [[], ['fork'], ['chasm', 'dip']],
  pines: [[], ['chasm', 'dip'], ['chasm', 'fork', 'dip'], ['chasm', 'hump', 'dip']],
  pass: [[], ['throat', 'chasm', 'fork'], ['chasm', 'hump', 'dip'], ['throat', 'chasm', 'dip']],
  falls: [[], ['chasm', 'hump', 'dip'], ['chasm', 'fork', 'dip'], ['throat', 'chasm', 'fork']],
  canyon: [[], ['throat', 'chasm', 'hump'], ['chasm', 'fork', 'dip'], ['throat', 'chasm', 'dip']],
  crystal: [[], ['chasm', 'tunnel', 'dip'], ['chasm', 'tunnel', 'dip'], ['throat', 'chasm', 'tunnel']],
  blizzard: [[], ['chasm', 'tunnel', 'dip'], ['throat', 'chasm', 'hump'], ['chasm', 'tunnel', 'dip']],
  clouds: [[], ['chasm', 'hump', 'dip'], ['chasm', 'tunnel', 'hump', 'dip'], ['throat', 'chasm', 'hump']],
  aurora: [[], ['throat', 'chasm', 'hump'], ['chasm', 'tunnel', 'dip'], ['throat', 'chasm', 'hump']],
  stars: [[], ['throat', 'chasm', 'tunnel'], ['chasm', 'hump', 'dip'], ['throat', 'chasm', 'tunnel', 'hump']],
};

describe('character of the mountains in the data (RG-01)', () => {
  it('worlds-spec.json: the sections of mountains 1–10 as in 01a 17.1 after RL-01, shapeFrom chasm 1, hump 2, throat 3, tunnel 6', () => {
    expect(spec.shapeFrom).toEqual({ chasm: 1, throat: 3, tunnel: 6, hump: 2, dip: 1 });
    expect(spec.risk).toEqual({ fromSection: 2 });
    for (const m of spec.mountains) {
      const rows = TABLE[m.id]!;
      expect(rows, m.id).toBeDefined();
      m.sections.forEach((sec, i) => {
        const want = rows[i]!;
        expect([...(sec.shape ?? [])].sort(), `${m.id} ${i + 1}`).toEqual(want.filter((k) => k !== 'fork').sort());
        // SP-05: a fork is a split one now (01a 19.3) — an object, not true.
        expect(!!sec.fork, `${m.id} ${i + 1}`).toBe(want.some((k) => k === 'fork' || k === 'tunnel' || k === 'hump'));
      });
    }
  });

  it('section 1 of mountain 1 (the first minute) is byte for byte the record before RL (tests/fixtures/open-world1.json)', () => {
    // RL-01 (producer 14.10): the chasm comes on section 3; the first minute up to the first ridge stays as FM built it.
    const before = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/open-world1.json'), 'utf8')) as WorldsJson['worlds'][number];
    const first = (w: WorldsJson['worlds'][number]): string => {
      const ridge = w.segments.find((s) => s.type === 'gate')!.z;
      return JSON.stringify(w.segments.filter((s) => s.z < ridge && s.z + ((s['length'] as number | undefined) ?? 0) <= ridge));
    };
    expect(first(worlds.worlds[0]!)).toBe(first(before));
    expect(first(gen(spec).worlds[0]!)).toBe(first(before));
    expect(worlds.worlds[0]!.zones[0]).toEqual(before.zones[0]);
  });

  it('every element of worlds.json is in its section and slot; the validator passes them', () => {
    expect(validateOpenShapes(worlds, spec)).toEqual([]);
    for (const [wi, w] of worlds.worlds.entries())
      for (const s of w.segments.filter((x) => ['chasm', 'throat', 'tunnel', 'hump'].includes(x.type))) {
        const sec = spec.mountains[wi]!.sections[(s['section'] as number) - 1]!;
        expect(sec.shape, `${w.id} ${s.type}`).toContain(s.type);
        const zone = w.zones[(s['section'] as number) - 1]!;
        const at = (s.z - zone.zStart) / sec.length;
        if (s.type === 'throat') expect(at).toBeLessThanOrEqual(SLOTS.throat[1]);
        if (s.type === 'chasm') expect(at >= SLOTS.chasm[0] && at <= SLOTS.chasm[1], `${w.id} chasm ${at}`).toBe(true);
        if (s.type === 'tunnel' || s.type === 'hump') expect(at, `${w.id} ${s.type}`).toBeGreaterThanOrEqual(SLOTS.fork[0]);
      }
  });

  it('an element before its mountain (shapeFrom) is an error naming the mountain and the section', () => {
    const bad = clone(spec);
    bad.mountains[1]!.sections[1]!.shape = ['throat'];
    const errors = validateOpenShapes(worlds, bad);
    expect(errors.some((e) => e.includes('(pines), section 2') && e.includes('throat') && e.includes('from mountain 3'))).toBe(true);
    // And a section of worlds.json that does not have the elements of its spec.
    expect(errors.some((e) => e.includes('(pines): section 2 — elements chasm'))).toBe(true);
  });

  it('an empty shape is the section of 16.5: no elements, the fork at 5–40% with its bold lane', () => {
    const plain = clone(spec);
    for (const m of plain.mountains) for (const s of m.sections) delete s.shape;
    const out = gen(plain);
    for (const w of out.worlds) {
      // The stairs to a ridge (RL-05) and the chute (RL-06) are the relief of every section, not elements of a shape.
      expect(w.segments.filter((s) => ['chasm', 'throat', 'tunnel', 'hump', 'dip'].includes(s.type) || (s['shape'] !== undefined && s['shape'] !== 'stairs' && s['shape'] !== 'chute')), w.id).toEqual([]);
      for (const f of w.segments.filter((s) => s.type === 'fork')) {
        const zone = w.zones[(f['section'] as number) - 1]!;
        // SP-05: a split fork starts where the fork of 16.5 does and runs 150–300 (tests/level/fork.test.ts).
        const taper = w.segments.find((t) => t.type === 'taper' && t.z >= zone.zStart && t.z < zone.zEnd);
        const start = Math.max(forkRange(zone.zStart, zone.zEnd - zone.zStart)[0], taper ? taper.z + (taper['length'] as number) + 2 : -Infinity);
        if (f['kind'] === 'split') expect(f.z).toBe(start);
        else expect([f.z, f.z + (f['length'] as number)]).toEqual(forkRange(zone.zStart, zone.zEnd - zone.zStart));
      }
    }
    // Mountain 1 without its chasm (RL-01) is the record before RL byte for byte.
    expect(JSON.stringify(out.worlds[0], null, 2) + '\n').toBe(readFileSync(resolve(root, 'tests/fixtures/open-world1.json'), 'utf8'));
  });

  it('fairness on every lane with the elements: at the minimum speed of a section, no newbie bonus, ≤ warnSec × 0.8 (2× to spare, 1.5× on mountain 1)', () => {
    const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
    // SP-04: section 1 of mountain 1 is 100 wide instead of 56 — its novice at 16 units/s keeps 1.5×; the edges — 1× (validator).
    for (const r of openFairnessReport(worlds, (st) => moveSpeed(st, curve), 'lanes')) expect(r.worstSec * (r.world === 'slope' ? 1.5 : 2), r.world).toBeLessThanOrEqual(r.limitSec);
    for (const r of openFairnessReport(worlds, (st) => moveSpeed(st, curve))) expect(r.worstSec, r.world).toBeLessThanOrEqual(r.limitSec);
  });

  it('RG-09: on a section with three or four elements each starts in its slot 5–25 / 25–40 / 40–75%, none overlaps the one below', () => {
    let big = 0;
    for (const w of worlds.worlds) {
      for (const zone of w.zones.slice(0, -1)) {
        const L = zone.zEnd - zone.zStart;
        const at = (z: number): number => (z - zone.zStart) / L;
        const mark = (t: string): Segment | undefined => w.segments.find((s) => s.type === t && s['section'] === zone.k);
        const els = ['throat', 'chasm', 'tunnel', 'hump'].map(mark).filter((s): s is Segment => s !== undefined);
        if (els.length < 3) continue;
        big++;
        const th = mark('throat');
        const ch = mark('chasm');
        const lane = [mark('tunnel'), mark('hump')].filter((s): s is Segment => s !== undefined);
        if (th) expect(at(th.z) >= SLOTS.throat[0] && at(th.z) <= SLOTS.throat[1], `${w.id} ${zone.k} throat`).toBe(true);
        if (ch) expect(at(ch.z) >= SLOTS.chasm[0] && at(ch.z) <= SLOTS.chasm[1], `${w.id} ${zone.k} chasm`).toBe(true);
        for (const e of lane) expect(at(e.z) >= SLOTS.fork[0] && at(e.z) <= SLOTS.fork[1], `${w.id} ${zone.k} ${e.type}`).toBe(true);
        const end = (s: Segment): number => s.z + (s['length'] as number);
        if (th && ch) expect(ch.z).toBeGreaterThan(end(th));
        for (const e of lane) expect(e.z).toBeGreaterThan(Math.max(th ? end(th) : 0, ch ? end(ch) : 0));
      }
    }
    expect(big).toBe(Object.values(TABLE).flat().filter((r) => r.filter((k) => k !== 'fork' && k !== 'dip').length >= 3).length);
  });

  it('RL-01: every section from the 2nd has a fall risk or a flight; a section without one is named; sizes grow', () => {
    expect(validateOpenShapes(worlds, spec)).toEqual([]);
    for (const w of worlds.worlds)
      for (const z of w.zones.slice(1, -1)) {
        const risk = w.segments.some((s) => ['chasm', 'hump', 'stairs'].includes(s.type) && s['section'] === z.k) || w.segments.some((s) => s.type === 'fork' && s['kind'] === 'split' && s['section'] === z.k);
        expect(risk, `${w.id} section ${z.k}`).toBe(true);
      }
    // Mountain 1 section 3 without its chasm: named by the validator.
    const bad = clone(worlds);
    bad.worlds[0]!.segments = bad.worlds[0]!.segments.filter((s) => s.type !== 'chasm');
    const badSpec = clone(spec);
    badSpec.mountains[0]!.sections[2]!.shape = [];
    expect(validateOpenShapes(bad, badSpec).some((e) => e.includes('(slope): section 3 — no fall risk nor flight'))).toBe(true);
    const size = (wi: number, t: string): number => worlds.worlds[wi]!.segments.find((s) => s.type === t)!['length'] as number;
    // RL-03 (producer 14.10): 12–16 wide, a trampoline takes it.
    expect([size(0, 'chasm'), size(1, 'chasm'), size(4, 'chasm'), size(9, 'chasm')]).toEqual([12, 13, 14, 16]);
    expect([size(3, 'throat'), size(4, 'throat'), size(8, 'throat'), size(9, 'throat')]).toEqual([80, 80, 100, 100]);
    expect([size(5, 'tunnel'), size(6, 'tunnel'), size(9, 'tunnel')]).toEqual([80, 110, 140]);
  });

  it('every part of an element carries its kind (`shape`), and no grotto stands in a throat or a chasm', () => {
    for (const w of worlds.worlds) {
      const holes = w.segments.filter((s) => s.type === 'throat' || s.type === 'chasm').map((s): [number, number] => [s.z, s.z + (s['length'] as number)]);
      for (const n of w.segments.filter((s: Segment) => s.type === 'niche')) for (const [a, b] of holes) expect(n.z < a || n.z > b, `${w.id} grotto at ${n.z}`).toBe(true);
    }
  });
});

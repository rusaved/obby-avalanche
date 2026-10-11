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

/** docs/01a-content.md 17.1: the elements of sections 1–4 of mountains 2–10 (`fork` — a plain fork of 17.7). */
const TABLE: Record<string, string[][]> = {
  pines: [[], ['chasm'], ['chasm', 'fork'], ['fork']],
  pass: [[], ['throat', 'fork'], ['throat'], ['throat', 'chasm']],
  falls: [[], ['fork'], ['chasm', 'fork'], ['throat', 'fork']],
  canyon: [[], ['throat', 'fork'], ['chasm'], ['throat', 'chasm']],
  crystal: [[], ['tunnel'], ['chasm', 'tunnel'], ['throat', 'tunnel']],
  blizzard: [[], ['tunnel'], ['throat', 'fork'], ['chasm', 'tunnel']],
  clouds: [[], ['hump'], ['hump', 'tunnel'], ['throat', 'hump']],
  aurora: [[], ['throat', 'chasm', 'hump'], ['chasm', 'tunnel'], ['throat', 'chasm', 'hump']],
  stars: [[], ['throat', 'chasm', 'tunnel'], ['throat', 'chasm', 'hump'], ['throat', 'chasm', 'tunnel', 'hump']],
};

describe('character of the mountains in the data (RG-01)', () => {
  it('worlds-spec.json: the sections of mountains 2–10 as in 01a 17.1, shapeFrom chasm 2, throat 3, tunnel 6, hump 8', () => {
    expect(spec.shapeFrom).toEqual({ chasm: 2, throat: 3, tunnel: 6, hump: 8 });
    expect(spec.mountains[0]!.sections.every((s) => (s.shape ?? []).length === 0)).toBe(true);
    for (const m of spec.mountains.slice(1)) {
      const rows = TABLE[m.id]!;
      expect(rows, m.id).toBeDefined();
      m.sections.forEach((sec, i) => {
        const want = rows[i]!;
        expect([...(sec.shape ?? [])].sort(), `${m.id} ${i + 1}`).toEqual(want.filter((k) => k !== 'fork').sort());
        expect(sec.fork, `${m.id} ${i + 1}`).toBe(want.some((k) => k === 'fork' || k === 'tunnel' || k === 'hump'));
      });
    }
  });

  it('mountain 1 in worlds.json is byte for byte the record before RG (tests/fixtures/open-world1.json)', () => {
    const before = readFileSync(resolve(root, 'tests/fixtures/open-world1.json'), 'utf8');
    expect(JSON.stringify(worlds.worlds[0], null, 2) + '\n').toBe(before);
    expect(JSON.stringify(gen(spec).worlds[0], null, 2) + '\n').toBe(before);
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
    bad.mountains[1]!.sections[1]!.shape = ['hump'];
    const errors = validateOpenShapes(worlds, bad);
    expect(errors.some((e) => e.includes('(pines), section 2') && e.includes('hump') && e.includes('from mountain 8'))).toBe(true);
    // And a section of worlds.json that does not have the elements of its spec.
    expect(errors.some((e) => e.includes('(pines): section 2 — elements chasm'))).toBe(true);
  });

  it('an empty shape is the section of 16.5: no elements, the fork at 5–40% with its bold lane', () => {
    const plain = clone(spec);
    for (const m of plain.mountains) for (const s of m.sections) delete s.shape;
    const out = gen(plain);
    for (const w of out.worlds) {
      expect(w.segments.filter((s) => ['chasm', 'throat', 'tunnel', 'hump'].includes(s.type) || s['shape'] !== undefined), w.id).toEqual([]);
      for (const f of w.segments.filter((s) => s.type === 'fork')) {
        const zone = w.zones[(f['section'] as number) - 1]!;
        expect([f.z, f.z + (f['length'] as number)]).toEqual(forkRange(zone.zStart, zone.zEnd - zone.zStart));
      }
    }
    expect(out.worlds[0]).toEqual(worlds.worlds[0]);
  });

  it('fairness on every lane with the elements: at the minimum speed of a section, no newbie bonus, ≤ warnSec × 0.8 (2× to spare)', () => {
    const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
    for (const r of openFairnessReport(worlds, (st) => moveSpeed(st, curve))) expect(r.worstSec * 2, r.world).toBeLessThanOrEqual(r.limitSec);
  });

  it('every part of an element carries its kind (`shape`), and no grotto stands in a throat or a chasm', () => {
    for (const w of worlds.worlds) {
      const holes = w.segments.filter((s) => s.type === 'throat' || s.type === 'chasm').map((s): [number, number] => [s.z, s.z + (s['length'] as number)]);
      for (const n of w.segments.filter((s: Segment) => s.type === 'niche')) for (const [a, b] of holes) expect(n.z < a || n.z > b, `${w.id} grotto at ${n.z}`).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildLevel } from '../../src/level/builder.ts';
import { WAVE } from '../../src/level/stage-slope.ts';
import { seamErrors, validateStageWorld, waveErrors } from '../../src/level/validate-stages.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { TuningJson, World } from '../../src/content/types.ts';

// ST-02, ST-03, ST-05 (producer 22.10): mountains 1–2 go in a wave of difficulty, differ from each other, and their
// grounds meet without steps and slits.
const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../content/avalanche/${p}`, import.meta.url), 'utf8'));
const worlds = (read('pace/stages/worlds.json') as { worlds: World[] }).worlds;
const tuning = mergePatch(read('tuning.json'), read('pace/stages/tuning.json')) as unknown as TuningJson;
const levels = (read('pace/stages/balance.json') as { levels: { first: number; growth: number } }).levels;
const field = (read('pace/stages/worlds-spec.json') as { stages: { field: number } }).stages.field;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const top = (w: World): number => Math.max(...w.segments.map((s) => s.z + (typeof s['length'] === 'number' ? (s['length'] as number) : 0)));

describe('ST: the wave, the joins, two different mountains', () => {
  it('mountains 1–2 read the wave easy — mid — hard — mid — easy — very hard — very easy; a broken wave is caught', () => {
    for (const w of worlds.slice(0, 2)) expect(waveErrors(w.stages!), w.id).toEqual([]);
    const w = clone(worlds[0]!);
    w.stages![3]!.tier = 'easy';
    expect(waveErrors(w.stages!)[0]).toContain('the wave reads');
    expect(validateStageWorld(w, levels, tuning, 0.05).some((e) => e.includes('the wave reads'))).toBe(true);
    expect(WAVE).toHaveLength(7);
  });
  it('a hard tier has more pieces than an easy one of the same kind (cracks of mountain 1 against those of the sample)', () => {
    const pits = (w: World, n: number): number => {
      const st = w.stages!.find((s) => s.n === n)!;
      return w.segments.filter((s) => s.type === 'pit' && s.z >= st.start && s.z < st.end && (s['x0'] as number) <= 0 && (s['x1'] as number) >= 0).length;
    };
    const m1 = worlds[0]!;
    const cracks = m1.stages!.find((s) => s.type === 'cracks')!;
    expect(cracks.tier).toBe('veryHard');
    expect(pits(m1, cracks.n)).toBeGreaterThanOrEqual(5);
    // The very hard throat has a leg more than the plain one (3).
    const throat = m1.stages!.find((s) => s.type === 'throat')!;
    expect(throat.tier).toBe('veryHard');
    const legs = m1.segments.filter((s) => s.type === 'floor' && s.z >= throat.start && s.z < throat.end && (s['x1'] as number) - (s['x0'] as number) <= 10 && (s['length'] as number) > 20).length;
    expect(legs).toBeGreaterThanOrEqual(4);
  });
  it('the first two stages of mountain 1 have no gap to jump at the edge of the reach (the first minute, the giant)', () => {
    const m1 = worlds[0]!;
    for (const st of m1.stages!.slice(0, 2)) expect(['intro', 'giant', 'dips', 'ice', 'stairs']).toContain(st.type);
    expect(m1.stages![0]!.tier).toBe('easy');
  });
  it('mountains 1 and 2 differ in half their stages at least; each has a trial the other has not', () => {
    const [a, b] = [worlds[0]!.stages!, worlds[1]!.stages!];
    const same = a.filter((s, k) => b[k]?.type === s.type).length;
    expect(same).toBeLessThanOrEqual(a.length / 2);
    const ta = new Set(a.map((s) => s.type));
    const tb = new Set(b.map((s) => s.type));
    expect([...tb].some((x) => !ta.has(x))).toBe(true);
    expect([...ta].some((x) => !tb.has(x))).toBe(true);
  });
  it('no step and no slit on the built mountains; a step put in is caught', () => {
    for (const w of worlds) expect(seamErrors(buildLevel(w), field, top(w)), w.id).toEqual([]);
    const w = clone(worlds[0]!);
    const st = w.stages![1]!;
    const f = w.segments.find((s) => s.type === 'floor' && s.z >= st.finish[0] - 1e-6 && (s['x1'] as number) - (s['x0'] as number) >= 60)!;
    f['y'] = (f['y'] as number) + 0.8;
    expect(seamErrors(buildLevel(w), field, top(w)).some((e) => e.includes('a step'))).toBe(true);
  });
});

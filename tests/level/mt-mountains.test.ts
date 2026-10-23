import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { crossErrors, waveErrors } from '../../src/level/validate-stages.ts';
import type { World } from '../../src/content/types.ts';

// MT-01…MT-06 (producer 22.10): mountains 3–10 each with its own trials and the character of RG, the wave on all ten
// and across them, the giants with helpers on the last ones, the decor of each.
const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../content/avalanche/${p}`, import.meta.url), 'utf8'));
const worlds = (read('pace/stages/worlds.json') as { worlds: World[] }).worlds;
const spec = read('pace/stages/worlds-spec.json') as { stages: { decor: Array<{ start: string; finish: string; landmark: string }> } };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const count = (w: World, ...types: string[]): number => w.stages!.filter((s) => types.includes(s.type)).length;

describe('MT: mountains 3–10', () => {
  it('every mountain reads the wave, starts easy and ends very easy; the cross rules hold', () => {
    for (const w of worlds) {
      expect(waveErrors(w.stages!), w.id).toEqual([]);
      expect(w.stages![0]!.tier, w.id).toBe('easy');
      expect(w.stages![w.stages!.length - 1]!.tier, w.id).toBe('veryEasy');
    }
    expect(crossErrors(worlds)).toEqual([]);
  });
  it('the cross rules catch a copied plan, a higher start and a mountain without a wave', () => {
    const copy = clone(worlds);
    copy[3]!.stages = clone(copy[2]!.stages!);
    expect(crossErrors(copy).some((e) => e.includes('as on mountain 3'))).toBe(true);
    const high = clone(worlds);
    high[4]!.stages![0]!.level = high[3]!.stages![high[3]!.stages!.length - 1]!.level + 1;
    expect(crossErrors(high).some((e) => e.includes('over the last stage'))).toBe(true);
    const flat = clone(worlds);
    for (const s of flat[6]!.stages!) delete s.tier;
    expect(crossErrors(flat).some((e) => e.includes('no wave'))).toBe(true);
  });
  it('the character of RG: 3 — the throat and the icy chute twice; 4 — the giant with helpers; 5 — balls; 6 — two mazes; 7 — blizzard thrice; 8 — catapults and stairs', () => {
    const [m3, m4, m5, m6, m7, m8] = worlds.slice(2, 8) as [World, World, World, World, World, World];
    expect(count(m3, 'throat')).toBeGreaterThanOrEqual(2);
    expect(count(m3, 'chute')).toBeGreaterThanOrEqual(2);
    expect(m4.bosses!.every((b) => (b.helpers ?? []).length >= 1)).toBe(true);
    expect(count(m5, 'ball')).toBeGreaterThanOrEqual(2);
    expect(count(m6, 'maze')).toBe(2);
    expect(count(m7, 'blizzard')).toBeGreaterThanOrEqual(3);
    expect(count(m8, 'catapult', 'stairs')).toBeGreaterThanOrEqual(3);
    for (const w of worlds.slice(0, 3)) expect(w.bosses!.every((b) => !b.helpers), w.id).toBe(true);
  });
  it('9–10: two giant stages with helpers; the very hard peak at most 4 stages long, easy stages before it; the last ridge of 10 no wall', () => {
    for (const w of worlds.slice(8)) {
      expect(count(w, 'giant'), w.id).toBe(2);
      expect(w.bosses!.every((b) => (b.helpers ?? []).length === 2)).toBe(true);
    }
    for (const w of worlds) {
      const tiers = w.stages!.map((s) => s.tier);
      const first = tiers.indexOf('veryHard');
      expect(tiers.filter((t) => t === 'veryHard').length, w.id).toBeLessThanOrEqual(w.index <= 2 ? 3 : 4);
      expect(tiers[first - 1], w.id).toBe('easy');
    }
    const m10 = worlds[9]!.stages!;
    expect(m10[m10.length - 1]!.level - m10[m10.length - 2]!.level).toBeLessThanOrEqual(1);
  });
  it('from mountain 3 a ridge asks at most 2 levels over the stage before (an easy start after a hard top)', () => {
    for (const w of worlds.slice(2)) for (let k = 1; k < w.stages!.length; k++) expect(w.stages![k]!.level - w.stages![k - 1]!.level, `${w.id} stage ${k + 1}`).toBeLessThanOrEqual(2);
  });
  it('MT-05: every mountain has its decor, neighbours differ in it', () => {
    expect(spec.stages.decor).toHaveLength(10);
    const key = (d: { start: string; finish: string; landmark: string }): string => `${d.start}/${d.finish}/${d.landmark}`;
    for (let i = 1; i < 10; i++) expect(key(spec.stages.decor[i]!), `mountain ${i + 1}`).not.toBe(key(spec.stages.decor[i - 1]!));
    expect(new Set(spec.stages.decor.map(key)).size).toBe(10);
    for (const w of worlds) expect(w.segments.some((s) => s.type === 'decor' && s['landmark'] === true), w.id).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { levelThreshold } from '../../src/sim/levels.ts';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../content/avalanche/${p}`, import.meta.url), 'utf8'));
type Seg = { type: string; z: number; kind?: string; requires?: number; level?: number };
type W = { id: string; segments: Seg[] };
const stages = (read('pace/stages/worlds.json') as { worlds: W[] }).worlds;
const open = (read('pace/open/worlds.json') as { worlds: W[] }).worlds;
const levels = (read('pace/stages/balance.json') as { levels: { first: number; growth: number } }).levels;

describe('stages pace: ridges ask for a level (docs/01-gdd.md 22.2)', () => {
  it('every ridge of mountains 1–10 requires the threshold of its level', () => {
    for (const w of stages)
      for (const s of w.segments.filter((x) => x.type === 'gate' && x.kind === 'ridge')) {
        expect(Number.isInteger(s.level), `${w.id} z ${s.z}`).toBe(true);
        expect(s.requires).toBe(Math.round(levelThreshold(s.level!, levels) * 1000) / 1000);
      }
  });
  it('the hardest ridge of a mountain within ±9% of the open one (one value moved, the balance not recounted)', () => {
    stages.forEach((w, i) => {
      const max = (ws: W): number => Math.max(...ws.segments.filter((x) => x.type === 'gate' && x.kind === 'ridge').map((x) => x.requires!));
      expect(Math.abs(Math.log(max(w) / max(open[i]!)))).toBeLessThanOrEqual(Math.log(1.18) / 2 + 1e-9);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { levelLips, ridgePartBox, ridgeParts } from '../../src/level/surface-lines.ts';
import { surfaceLineErrors } from '../../src/level/validate-stages.ts';
import type { WorldsJson } from '../../src/content/types.ts';

// MU-13 (docs/briefs/mu-mobile-ui.md, producer: «on a ramp with a rise the blue edge line hangs in the air over the
// slope»): every line the renderer lays on the ground lies on it — the floor lips of SD-07 and the melted ridges.
const read = (f: string): WorldsJson => JSON.parse(readFileSync(resolve(__dirname, '../../content/avalanche', f), 'utf8')) as WorldsJson;
const stages = read('pace/stages/worlds.json').worlds;
const open = read('worlds.json').worlds;

describe('the edge lines lie on the surface (MU-13)', () => {
  it('stages pace mountains 1–10 and the open slope: no line over or under the ground, a melted ridge leaves nothing', () => {
    for (const w of [...stages, ...open]) {
      const level = buildLevel(w);
      expect(levelLips(level).length, w.id).toBeGreaterThan(0);
      expect(surfaceLineErrors(level), w.id).toEqual([]);
    }
  });
  it('a lip lifted off its floor is named; a ridge part is whole at 0, shrinks while melting and is gone at 1', () => {
    const level = buildLevel(stages[0]!);
    const lip = levelLips(level)[0]!;
    const up = { ...lip, min: [lip.min[0], lip.min[1] + 2, lip.min[2]] as [number, number, number], max: [lip.max[0], lip.max[1] + 2, lip.max[2]] as [number, number, number] };
    const errs = surfaceLineErrors(level, [lip, up]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('over the ground');
    const parts = ridgeParts(level);
    expect(parts.some((p) => p.crest)).toBe(true);
    for (const p of parts) {
      expect(ridgePartBox(p, 0)!.max[1] - ridgePartBox(p, 0)!.min[1]).toBeCloseTo(p.h);
      expect(ridgePartBox(p, 0.5)!.max[1] - ridgePartBox(p, 0.5)!.min[1]).toBeCloseTo(p.h / 2);
      expect(ridgePartBox(p, 1)).toBeNull();
    }
  });
});

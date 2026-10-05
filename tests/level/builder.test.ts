import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import type { WorldsJson } from '../../src/content/types.ts';

const worlds = JSON.parse(readFileSync(resolve(__dirname, '../../content/avalanche/worlds.json'), 'utf8')) as WorldsJson;
const sample = JSON.parse(readFileSync(resolve(__dirname, '../../content/_sample/worlds.json'), 'utf8')) as WorldsJson;

describe('level builder (docs/02-tech.md 6.1): geometry comes from worlds.json', () => {
  it('mountain 1: 12 gates, 12 caves, 12 checkpoints, spawn in the camp, triangles for the Octree', () => {
    const level = buildLevel(worlds.worlds[0]!);
    expect(level.gates).toHaveLength(12);
    expect(level.niches).toHaveLength(12);
    expect(level.checkpoints.filter((c) => c.wall < 12)).toHaveLength(11);
    expect(level.spawn).toEqual([0, 0, 20]);
    expect(level.length).toBe(1180);
    expect(level.staticTriangles.length % 9).toBe(0);
    expect(level.staticTriangles.length / 9).toBeGreaterThan(500);
    expect(level.gates.map((g) => g.requires)).toEqual([20, 40, 80, 2000, 4000, 12000, 15000, 25000, 30000, 40000, 80000, 100000]);
    expect(level.niches.map((n) => n.side)).toEqual(['left', 'right', 'left', 'right', 'left', 'right', 'left', 'right', 'left', 'right', 'left', 'right']);
    expect(level.killY).toBeLessThan(-10);
  });
  it('floor height follows the ramps: +6 per stretch', () => {
    const level = buildLevel(worlds.worlds[0]!);
    expect(level.floorYAt(20)).toBe(0);
    expect(level.floorYAt(100)).toBe(6);
    expect(level.floorYAt(63.5)).toBeCloseTo(3, 5);
    expect(level.floorYAt(1150)).toBe(72);
    for (const g of level.gates) expect(g.y).toBeCloseTo(level.floorYAt(g.z - 1), 5);
  });
  it('_sample: 3 gates and caves at the documented positions', () => {
    const level = buildLevel(sample.worlds[0]!);
    expect(level.gates.map((g) => g.z)).toEqual([100, 160, 220]);
    expect(level.niches.map((n) => n.z)).toEqual([82, 142, 202]);
    expect(level.length).toBe(280);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { decorPlan } from '../../src/render/decor.ts';
import type { ThemeJson, WorldsJson } from '../../src/content/types.ts';

// RG-12: decor of the open slope — penguins walk, birds sit (docs/01-gdd.md 18.7; docs/01a-content.md 17.5).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const theme = read<ThemeJson>('theme.json');
const cfg = theme.decor!;
const worlds = read<WorldsJson>('pace/open/worlds.json').worlds;
const SIGN = { top: 7.8, half: 9 };
const plan = (i: number, seed: number) => {
  const w = worlds[i - 1]!;
  return { level: buildLevel(w), p: decorPlan(buildLevel(w), w.look!, cfg, seed, SIGN) };
};

describe('decor (RG-12)', () => {
  it('placed by the seed: the same seed — the same places, another — others', () => {
    expect(plan(1, 5).p).toEqual(plan(1, 5).p);
    expect(plan(1, 6).p).not.toEqual(plan(1, 5).p);
    expect(plan(9, 5).p).toEqual(plan(9, 5).p);
  });

  it('penguins on slope, canyon and aurora — 2–4 a patch inside the track, clear of grottos, elements and gates', () => {
    for (let i = 1; i <= 10; i++) {
      const w = worlds[i - 1]!;
      const { level, p } = plan(i, 11);
      const walk = cfg.walkers.on.includes(w.look!);
      expect(p.walkers.length > 0, `mountain ${i}`).toBe(walk);
      const patches = new Map<string, number>();
      for (const q of p.walkers) {
        const [x0, z0, x1, z1] = q.patch;
        expect(q.x).toBeGreaterThanOrEqual(x0);
        expect(q.x).toBeLessThanOrEqual(x1);
        expect(q.z).toBeGreaterThanOrEqual(z0);
        expect(q.z).toBeLessThanOrEqual(z1);
        expect(Math.max(Math.abs(x0), Math.abs(x1))).toBeLessThanOrEqual(level.width / 2);
        for (const n of level.niches) expect(n.z < z0 - 4 || n.z > z1 + 4 || (n.side === 'left') !== x0 < 0, `grotto at ${n.z}`).toBe(true);
        for (const s of level.shapes ?? []) expect(s.z1 < z0 || s.z0 > z1, `${s.kind} at ${s.z0}`).toBe(true);
        for (const g of level.gates) expect(g.z < z0 || g.z > z1).toBe(true);
        patches.set(q.patch.join(), (patches.get(q.patch.join()) ?? 0) + 1);
      }
      for (const n of patches.values()) {
        expect(n).toBeGreaterThanOrEqual(cfg.walkers.perSection[0]);
        expect(n).toBeLessThanOrEqual(cfg.walkers.perSection[1]);
      }
    }
  });

  it('birds on pass, blizzard and aurora — on cliffs, the borders under a ridge and the giant sign, at most 3 a section', () => {
    for (let i = 1; i <= 10; i++) {
      const w = worlds[i - 1]!;
      const { level, p } = plan(i, 11);
      const sit = cfg.sitters.on.includes(w.look!);
      expect(p.sitters.length > 0, `mountain ${i}`).toBe(sit);
      expect(p.bird !== null).toBe(sit);
      if (p.bird) expect(cfg.sitters.looks).toContain(p.bird);
      for (const s of level.sections) expect(p.sitters.filter((b) => b.z >= s.z0 && b.z < s.z1).length).toBeLessThanOrEqual(cfg.sitters.perSection[1]);
      // Up on something: over the floor under them.
      for (const b of p.sitters) expect(b.y - level.floorAt(0, b.z)).toBeGreaterThan(1);
    }
  });

  it('nothing of the decor in the simulation or the colliders', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
    for (const f of [...files(resolve(root, 'src/sim')), ...files(resolve(root, 'src/level'))]) expect(readFileSync(f, 'utf8'), f).not.toMatch(/decor\.ts/);
  });
});

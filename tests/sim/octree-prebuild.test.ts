import { describe, expect, it } from 'vitest';
import { Sphere, Vector3, type Triangle } from 'three';
import type { Octree } from 'three/examples/jsm/math/Octree.js';
import { buildLevel } from '../../src/level/builder.ts';
import { createCollisionWorld, octreeFromTriangles, octreeJob, prebuildCollision, prebuildReady, prebuildStep } from '../../src/sim/collision.ts';
import worldsJson from '../../content/avalanche/pace/stages/worlds.json' with { type: 'json' };
import type { WorldsJson } from '../../src/content/types.ts';

const worlds = worldsJson as unknown as WorldsJson;

/** The leaves of a tree in query order, each as the corners of its triangles: equal shapes answer every query the same. */
function shape(tree: Octree): string {
  const out: string[] = [];
  const walk = (t: Octree): void => {
    const n = t as unknown as { triangles: Triangle[]; subTrees: Octree[] };
    if (n.triangles.length > 0) out.push(n.triangles.map((q) => `${q.a.x},${q.a.y},${q.a.z},${q.c.x},${q.c.z}`).join(';'));
    n.subTrees.forEach(walk);
  };
  walk(tree);
  return out.join('|');
}

// M6 (docs/02-tech.md 9.5: a switch of mountains ≤ 1 s at CPU ×4): the next mountain's tree is built ahead in slices on
// the base; the slices give the very same tree, and the switch takes it instead of building its own.
describe('collision tree built ahead in slices', () => {
  const level = buildLevel(worlds.worlds[1]!, { wallHeight: 38 });

  it('a build cut into the smallest slices gives the same leaves in the same order as one build', () => {
    const job = octreeJob(level.staticTriangles);
    let slices = 0;
    while (!job.step(0)) slices++;
    expect(slices).toBeGreaterThan(1000);
    expect(shape(job.tree!)).toBe(shape(octreeFromTriangles(level.staticTriangles)));
  });

  it('the world of the same triangles takes the prebuilt trees once; other triangles build their own', () => {
    prebuildCollision(level.staticTriangles, level.boundsTriangles);
    expect(prebuildReady()).toBe(false);
    let slices = 0;
    while (!prebuildStep(performance.now() + 5)) slices++;
    expect(prebuildReady()).toBe(true);
    const t0 = performance.now();
    const w = createCollisionWorld(level.staticTriangles, level.boundsTriangles);
    const takeMs = performance.now() - t0;
    expect(prebuildReady(), 'taken once').toBe(false);
    expect(shape(w.static)).toBe(shape(octreeFromTriangles(level.staticTriangles)));
    expect(shape(w.bounds!)).toBe(shape(octreeFromTriangles(level.boundsTriangles!)));
    expect(takeMs).toBeLessThan(50);
    // Another mountain: the prebuild is dropped, the world builds its own and meets the level the same.
    prebuildCollision(level.staticTriangles, level.boundsTriangles);
    const other = buildLevel(worlds.worlds[0]!);
    const w1 = createCollisionWorld(other.staticTriangles, other.boundsTriangles);
    expect(prebuildReady()).toBe(false);
    expect(shape(w1.static)).toBe(shape(octreeFromTriangles(other.staticTriangles)));
    const s = new Sphere(new Vector3(0, other.floorYAt(40) + 0.3, 40), 0.6);
    expect(!!w1.sphereHit(s)).toBe(true);
  });
});

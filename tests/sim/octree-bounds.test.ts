import { describe, expect, it } from 'vitest';
import { Sphere, Triangle, Vector3 } from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { buildLevel } from '../../src/level/builder.ts';
import { octreeFromTriangles } from '../../src/sim/collision.ts';
import { createRng } from '../../src/core/rng.ts';
import worldsJson from '../../content/avalanche/pace/stages/worlds.json' with { type: 'json' };
import type { WorldsJson } from '../../src/content/types.ts';

const worlds = worldsJson as unknown as WorldsJson;

function reference(tris: Float32Array): Octree {
  const ref = new Octree();
  for (let i = 0; i + 8 < tris.length; i += 9)
    ref.addTriangle(new Triangle(new Vector3(tris[i], tris[i + 1], tris[i + 2]), new Vector3(tris[i + 3], tris[i + 4], tris[i + 5]), new Vector3(tris[i + 6], tris[i + 7], tris[i + 8])));
  (ref as unknown as { bounds: { expandByScalar(s: number): void } }).bounds.expandByScalar(0.0137);
  return ref.build();
}

// M5-06 (docs/02-tech.md 9.5: a switch of mountains ≤ 1 s at CPU ×4): bigger leaves and the bounds check build the
// collision tree many times faster; a capsule (the hero, bots) and a sphere (the camera) meet the level as with three's
// own Octree — the same hit, depth and normal at points all over the mountain.
describe('collision octree of the release pace', () => {
  it('mountain 10: built many times faster, the the same capsule and sphere hits at 3000 points (≤ 1% of two-triangle touches pushed out in another order)', () => {
    const level = buildLevel(worlds.worlds[9]!);
    const t0 = performance.now();
    const fast = octreeFromTriangles(level.staticTriangles);
    const fastMs = performance.now() - t0;
    const t1 = performance.now();
    const ref = reference(level.staticTriangles);
    const refMs = performance.now() - t1;
    expect(fastMs * 4).toBeLessThan(refMs);
    const rng = createRng(42);
    let differ = 0;
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      const z = rng.next() * level.length;
      const x = (rng.next() - 0.5) * level.width;
      const floor = level.floorYAt(z);
      const y = (Number.isFinite(floor) ? floor : 0) + (rng.next() - 0.3) * 1.5;
      const cap = new Capsule(new Vector3(x, y + 0.45, z), new Vector3(x, y + 1.35, z), 0.45);
      const a = fast.capsuleIntersect(cap.clone());
      const b = ref.capsuleIntersect(cap.clone());
      const sa = fast.sphereIntersect(new Sphere(new Vector3(x, y + 1, z), 0.6));
      const sb = ref.sphereIntersect(new Sphere(new Vector3(x, y + 1, z), 0.6));
      if (a) hits++;
      const same = (p: false | { depth: number; normal: Vector3 }, q: false | { depth: number; normal: Vector3 }): boolean =>
        !p || !q ? p === q : Math.abs(p.depth - q.depth) < 1e-6 && p.normal.distanceTo(q.normal) < 1e-6;
      if (!same(a, b) || !same(sa, sb)) differ++;
      // Both hit or both miss; the depth of a capsule push-out within 0.2 units.
      expect(!!a, `capsule at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(!!b);
      expect(!!sa, `sphere at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(!!sb);
      if (a && b) expect(Math.abs(a.depth - b.depth)).toBeLessThan(0.2);
    }
    expect(hits).toBeGreaterThan(500);
    // Where a capsule touches two triangles at once three pushes it out by them in the order it meets them in the tree:
    // other leaves — another order, an equally good push-out (docs/допущения.md); everywhere else the very same.
    expect(differ).toBeLessThanOrEqual(30);
  });
});

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { boxTriangles, createCollisionWorld, octreeFromTriangles } from '../../src/sim/collision.ts';
import { heroCapsule } from '../../src/sim/controller.ts';

describe('collision world', () => {
  it('finds triangles that lie on the Octree bounds (ledge top at the root box max)', () => {
    const tris: number[] = [];
    boxTriangles({ min: [-100, -2, -100], max: [100, 0, 100] }, tris);
    boxTriangles({ min: [5, 0, -20], max: [30, 0.9, 20] }, tris);
    const w = createCollisionWorld(tris);
    const hit = w.capsuleHit(heroCapsule(new Vector3(10, 0.5, 0)));
    expect(hit).not.toBeNull();
    expect(hit!.normal.y).toBeGreaterThan(0.9);
    expect(hit!.depth).toBeCloseTo(0.4, 2);
  });

  it('keeps every triangle after build', () => {
    const tris: number[] = [];
    for (let i = 0; i < 40; i++) boxTriangles({ min: [i * 3, 0, 0], max: [i * 3 + 2, 1 + (i % 4), 2] }, tris);
    const tree = octreeFromTriangles(tris);
    const seen = new Set<unknown>();
    const walk = (t: unknown): void => {
      const n = t as { triangles: unknown[]; subTrees: unknown[] };
      n.triangles.forEach((x) => seen.add(x));
      n.subTrees.forEach(walk);
    };
    walk(tree);
    expect(seen.size).toBe(tris.length / 9);
  });

  it('dynamic boxes (gates) collide and can be removed', () => {
    const tris: number[] = [];
    boxTriangles({ min: [-50, -2, -50], max: [50, 0, 50] }, tris);
    const w = createCollisionWorld(tris);
    // Touching the gate slab from below the slope: the capsule surface overlaps its front face by 0.25.
    const c = heroCapsule(new Vector3(0, 0.2, 8.5));
    expect(w.capsuleHit(c)).toBeNull();
    w.setDynamicBoxes([{ min: [-14, 0, 9.25], max: [14, 12, 10.75] }]);
    expect(w.capsuleHit(c)).not.toBeNull();
    w.setDynamicBoxes([]);
    expect(w.capsuleHit(c)).toBeNull();
  });
});

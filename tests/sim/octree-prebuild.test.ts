import { describe, expect, it } from 'vitest';
import { Ray, Sphere, Triangle, Vector3 } from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { buildLevel } from '../../src/level/builder.ts';
import { FlatOctree, createCollisionWorld, octreeFromTriangles, octreeJob, prebuildCollision, prebuildReady, prebuildStep } from '../../src/sim/collision.ts';
import worldsJson from '../../content/avalanche/pace/stages/worlds.json' with { type: 'json' };
import type { WorldsJson } from '../../src/content/types.ts';

const worlds = worldsJson as unknown as WorldsJson;

/** The leaves of a tree in query order, each as the corners of its triangles: equal shapes answer every query the same.
 * Walks three's object tree and the flat one (M6 polish) alike. */
function shape(tree: Octree): string {
  const out: string[] = [];
  const key = (q: Triangle): string => `${q.a.x},${q.a.y},${q.a.z},${q.c.x},${q.c.z}`;
  if (tree instanceof FlatOctree) {
    const walk = (i: number): void => {
      if (tree.triCount[i]! > 0) {
        const s = tree.triStart[i]!;
        out.push(Array.from(tree.refs.subarray(s, s + tree.triCount[i]!), (r) => key(tree.tris[r]!)).join(';'));
      }
      for (let c = tree.first[i]!; c < tree.first[i]! + tree.count[i]!; c++) walk(c);
    };
    if (tree.nodes > 0) walk(0);
    return out.join('|');
  }
  const walk = (t: Octree): void => {
    const n = t as unknown as { triangles: Triangle[]; subTrees: Octree[] };
    if (n.triangles.length > 0) out.push(n.triangles.map(key).join(';'));
    n.subTrees.forEach(walk);
  };
  walk(tree);
  return out.join('|');
}

// M6 (docs/02-tech.md 9.5: a switch of mountains ≤ 1 s at CPU ×4): the next mountain's tree is built ahead in slices on
// the base; the slices give the very same tree, and the switch takes it instead of building its own.
describe('collision tree built ahead in slices', () => {
  const level = buildLevel(worlds.worlds[1]!, { wallHeight: 38 });

  it('M6 polish: the flat tree has the leaves of three\'s own build and gives the same hits, in a tenth of the memory', () => {
    const tris = level.staticTriangles;
    const ref = new Octree();
    for (let i = 0; i + 8 < tris.length; i += 9) {
      ref.addTriangle(new Triangle(new Vector3(tris[i], tris[i + 1], tris[i + 2]), new Vector3(tris[i + 3], tris[i + 4], tris[i + 5]), new Vector3(tris[i + 6], tris[i + 7], tris[i + 8])));
    }
    (ref as unknown as { bounds: { expandByScalar(s: number): void } }).bounds.expandByScalar(0.0137);
    ref.calcBox();
    ref.split(0);
    const flat = octreeFromTriangles(tris) as FlatOctree;
    expect(flat).toBeInstanceOf(FlatOctree);
    expect(shape(flat)).toBe(shape(ref));
    // Queries round the slope: spheres (the camera), capsules (the hero), rays (the blob shadow) — the very same answers.
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const z0 = level.length;
    let hits = 0;
    for (let k = 0; k < 400; k++) {
      const x = (rnd() - 0.5) * 60;
      const z = rnd() * z0;
      const y = level.floorYAt(z) + (rnd() - 0.3) * 6;
      const sp = new Sphere(new Vector3(x, y, z), 0.3 + rnd());
      const a = ref.sphereIntersect(sp.clone());
      expect(flat.sphereIntersect(sp.clone())).toEqual(a);
      const cap = new Capsule(new Vector3(x, y, z), new Vector3(x, y + 1.5, z), 0.5);
      const c = ref.capsuleIntersect(cap.clone());
      expect(flat.capsuleIntersect(cap.clone())).toEqual(c);
      const ray = new Ray(new Vector3(x, y + 5, z), new Vector3(rnd() - 0.5, -1, rnd() - 0.5).normalize());
      const r1 = ref.rayIntersect(ray);
      const r2 = flat.rayIntersect(ray);
      expect(r2 && { d: r2.distance, p: r2.position }).toEqual(r1 && { d: r1.distance, p: r1.position });
      if (a || c) hits++;
    }
    expect(hits).toBeGreaterThan(50);
    // Memory: three's nodes are objects (two Box3, Layers, two arrays); the flat one — 6 doubles and 4 ints a node.
    expect(flat.boxes.byteLength + flat.refs.byteLength + 16 * flat.nodes).toBeLessThan(40 * 1024 * 1024);
  });

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

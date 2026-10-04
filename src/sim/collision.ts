/** Static Octree from triangle arrays (docs/02-tech.md 6.1); gates and other movers live in a second small Octree. */
import { Triangle, Vector3, Sphere } from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import type { Aabb } from '../level/types.ts';

export interface Hit {
  normal: Vector3;
  depth: number;
}

export interface CollisionWorld {
  readonly static: Octree;
  dynamic: Octree | null;
  capsuleHit(capsule: Capsule): Hit | null;
  sphereHit(sphere: Sphere): Hit | null;
  setDynamicBoxes(boxes: Aabb[]): void;
}

/** Expands the Octree bounds so no triangle lies exactly on a split boundary (floating point drops it). */
const OCTREE_PADDINGS = [0.0137, 0.0731, 0.2371];

function countLeafTriangles(tree: Octree, seen = new Set<Triangle>()): number {
  const t = tree as unknown as { triangles: Triangle[]; subTrees: Octree[] };
  for (const tri of t.triangles) seen.add(tri);
  for (const sub of t.subTrees) countLeafTriangles(sub, seen);
  return seen.size;
}

export function octreeFromTriangles(tris: Float32Array | number[]): Octree {
  const triangles: Triangle[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    triangles.push(
      new Triangle(
        new Vector3(tris[i], tris[i + 1], tris[i + 2]),
        new Vector3(tris[i + 3], tris[i + 4], tris[i + 5]),
        new Vector3(tris[i + 6], tris[i + 7], tris[i + 8]),
      ),
    );
  }
  let tree = new Octree();
  for (const pad of OCTREE_PADDINGS) {
    tree = new Octree();
    for (const t of triangles) tree.addTriangle(t);
    if (triangles.length > 0) (tree as unknown as { bounds: { expandByScalar(s: number): void } }).bounds.expandByScalar(pad);
    tree.build();
    if (countLeafTriangles(tree) === triangles.length) return tree;
  }
  throw new Error('octreeFromTriangles: triangles lost on split boundaries');
}

export function boxTriangles(b: Aabb, out: number[] = []): number[] {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const quad = (a: number[], b2: number[], c: number[], d: number[]): void => {
    out.push(...a, ...b2, ...c, ...a, ...c, ...d);
  };
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
  return out;
}

export function createCollisionWorld(staticTriangles: Float32Array | number[]): CollisionWorld {
  const staticTree = octreeFromTriangles(staticTriangles);
  const world: CollisionWorld = {
    static: staticTree,
    dynamic: null,
    capsuleHit(capsule) {
      const a = staticTree.capsuleIntersect(capsule);
      const b = world.dynamic ? world.dynamic.capsuleIntersect(capsule) : false;
      if (!a && !b) return null;
      if (a && b) {
        const n = a.normal.clone().multiplyScalar(a.depth).add(b.normal.clone().multiplyScalar(b.depth));
        const depth = n.length();
        return depth > 0 ? { normal: n.normalize(), depth } : null;
      }
      const hit = (a || b) as { normal: Vector3; depth: number };
      return { normal: hit.normal.clone(), depth: hit.depth };
    },
    sphereHit(sphere) {
      const a = staticTree.sphereIntersect(sphere);
      const b = world.dynamic ? world.dynamic.sphereIntersect(sphere) : false;
      const hit = a || b;
      return hit ? { normal: hit.normal.clone(), depth: hit.depth } : null;
    },
    setDynamicBoxes(boxes) {
      if (boxes.length === 0) {
        world.dynamic = null;
        return;
      }
      const tris: number[] = [];
      for (const b of boxes) boxTriangles(b, tris);
      world.dynamic = octreeFromTriangles(tris);
    },
  };
  return world;
}

export { Capsule, Octree };

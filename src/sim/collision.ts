// What: Static Octree from triangle arrays plus a small dynamic Octree for gates and the invisible-wall Octree; capsule and sphere hit queries for the controller.
// Called by: sim/controller.ts, sim/world.ts, render/blob.ts, render/camera.ts; tests/sim/collision.test.ts, controller.test.ts, gates.test.ts, steps.test.ts
// Keep: From three only the math whitelist plus Capsule/Octree addons (architecture test); keep the padded Octree retry; the bounds tree answers capsules only, never spheres (camera).

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
  /** The invisible wall of the slope (docs/01-gdd.md 19.9): capsules (the hero) meet it, spheres (the camera) do not. */
  readonly bounds: Octree | null;
  capsuleHit(capsule: Capsule): Hit | null;
  sphereHit(sphere: Sphere): Hit | null;
  setDynamicBoxes(boxes: Aabb[]): void;
}

/** Expands the Octree bounds so no triangle lies exactly on a split boundary (floating point drops it). */
const OCTREE_PADDINGS = [0.0137, 0.0731, 0.2371];

/** M5-06: triangles a leaf holds before it splits — three's 8. With 32 the build of mountain 10 took 0.08 s instead of
 * 1.4 s, but the order of the triangles in a query changed and with it the camera at a rock (sp-wave-camera): kept 8. */
const LEAF_TRIANGLES = 8;
/** M5-06 (docs/02-tech.md 9.5: a switch of mountains ≤ 1 s at CPU ×4): the bounds of each triangle, made once per build. */
const triBounds = new WeakMap<Triangle, Float64Array>();
function boundsOf(t: Triangle): Float64Array {
  let b = triBounds.get(t);
  if (!b) {
    const { a, b: q, c } = t;
    b = new Float64Array([Math.min(a.x, q.x, c.x), Math.min(a.y, q.y, c.y), Math.min(a.z, q.z, c.z), Math.max(a.x, q.x, c.x), Math.max(a.y, q.y, c.y), Math.max(a.z, q.z, c.z)]);
    triBounds.set(t, b);
  }
  return b;
}

interface OctreeBox {
  min: Vector3;
  max: Vector3;
  clone(): OctreeBox;
  intersectsTriangle(t: Triangle): boolean;
}

interface OctreeInner {
  box: OctreeBox | null;
  triangles: Triangle[];
  subTrees: Octree[];
  trianglesPerLeaf: number;
  maxLevel: number;
}

/**
 * The Octree of three with the same split, but a triangle is first checked by its bounds against the child box: apart —
 * not in it, inside — in it; only the rest goes to the exact box–triangle test (which the bounds checks never contradict),
 * so every leaf holds the same triangles as before, without most of the exact tests (they were 95% of a switch).
 */
class BoundsOctree extends Octree {
  constructor(box?: never) {
    super(box);
    (this as unknown as OctreeInner).trianglesPerLeaf = LEAF_TRIANGLES;
  }

  override split(level: number): this {
    const self = this as unknown as OctreeInner;
    const box = self.box;
    if (!box) return this;
    const half = new Vector3().copy(box.max).sub(box.min).multiplyScalar(0.5);
    const subs: BoundsOctree[] = [];
    const v = new Vector3();
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 2; z++) {
          const b = box.clone();
          b.min.copy(box.min).add(v.set(x, y, z).multiply(half));
          b.max.copy(b.min).add(half);
          subs.push(new BoundsOctree(b as never));
        }
    let tri: Triangle | undefined;
    while ((tri = self.triangles.pop())) {
      const t = boundsOf(tri);
      for (const sub of subs) {
        const sb = (sub as unknown as OctreeInner).box!;
        const mn = sb.min;
        const mx = sb.max;
        if (t[3]! < mn.x || t[0]! > mx.x || t[4]! < mn.y || t[1]! > mx.y || t[5]! < mn.z || t[2]! > mx.z) continue;
        const inside = t[0]! >= mn.x && t[3]! <= mx.x && t[1]! >= mn.y && t[4]! <= mx.y && t[2]! >= mn.z && t[5]! <= mx.z;
        if (inside || sb.intersectsTriangle(tri)) (sub as unknown as OctreeInner).triangles.push(tri);
      }
    }
    for (const sub of subs) {
      const len = (sub as unknown as OctreeInner).triangles.length;
      if (len > self.trianglesPerLeaf && level < self.maxLevel) sub.split(level + 1);
      if (len !== 0) self.subTrees.push(sub);
    }
    return this;
  }
}

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
  let tree: Octree = new BoundsOctree();
  for (const pad of OCTREE_PADDINGS) {
    tree = new BoundsOctree();
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

export function createCollisionWorld(staticTriangles: Float32Array | number[], boundsTriangles?: Float32Array | number[]): CollisionWorld {
  const staticTree = octreeFromTriangles(staticTriangles);
  const boundsTree = boundsTriangles && boundsTriangles.length > 0 ? octreeFromTriangles(boundsTriangles) : null;
  const world: CollisionWorld = {
    static: staticTree,
    dynamic: null,
    bounds: boundsTree,
    capsuleHit(capsule) {
      const hits: Array<{ normal: Vector3; depth: number }> = [];
      for (const tree of [staticTree, world.dynamic, boundsTree]) {
        const h = tree ? tree.capsuleIntersect(capsule) : false;
        if (h) hits.push(h);
      }
      if (hits.length === 0) return null;
      if (hits.length === 1) return { normal: hits[0]!.normal.clone(), depth: hits[0]!.depth };
      const n = new Vector3();
      for (const h of hits) n.addScaledVector(h.normal, h.depth);
      const depth = n.length();
      return depth > 0 ? { normal: n.normalize(), depth } : null;
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

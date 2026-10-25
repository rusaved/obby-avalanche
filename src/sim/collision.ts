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
    const todo: Array<[BoundsOctree, number]> = [[this, level]];
    let next: [BoundsOctree, number] | undefined;
    while ((next = todo.pop())) next[0].splitOnce(next[1], todo);
    return this;
  }

  /** M6: one node of the split; its children to split go to `todo` (any order of nodes gives the same tree). */
  splitOnce(level: number, todo: Array<[BoundsOctree, number]>): void {
    const self = this as unknown as OctreeInner;
    const box = self.box;
    if (!box) return;
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
      if (len > self.trianglesPerLeaf && level < self.maxLevel) todo.push([sub, level + 1]);
      if (len !== 0) self.subTrees.push(sub);
    }
  }
}

function countLeafTriangles(tree: Octree, seen = new Set<Triangle>()): number {
  const t = tree as unknown as { triangles: Triangle[]; subTrees: Octree[] };
  for (const tri of t.triangles) seen.add(tri);
  for (const sub of t.subTrees) countLeafTriangles(sub, seen);
  return seen.size;
}

/** M6: a build of the tree cut into slices between frames — the same split, so the same tree as octreeFromTriangles. */
export interface OctreeJob {
  /** Works until `deadline` (performance.now()); true once the tree is ready. */
  step(deadline: number): boolean;
  readonly tree: Octree | null;
}

export function octreeJob(tris: Float32Array | number[]): OctreeJob {
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
  let pad = 0;
  let tree: BoundsOctree | null = null;
  let todo: Array<[BoundsOctree, number]> = [];
  let done: Octree | null = null;
  return {
    get tree() {
      return done;
    },
    step(deadline) {
      while (!done) {
        if (!tree) {
          if (pad >= OCTREE_PADDINGS.length) throw new Error('octreeFromTriangles: triangles lost on split boundaries');
          // As Octree.build: the bounds, then calcBox, then the split from level 0.
          tree = new BoundsOctree();
          for (const t of triangles) tree.addTriangle(t);
          if (triangles.length > 0) (tree as unknown as { bounds: { expandByScalar(s: number): void } }).bounds.expandByScalar(OCTREE_PADDINGS[pad]!);
          tree.calcBox();
          todo = [[tree, 0]];
        }
        let next: [BoundsOctree, number] | undefined;
        while ((next = todo.pop())) {
          next[0].splitOnce(next[1], todo);
          if (todo.length > 0 && performance.now() >= deadline) return false;
        }
        if (countLeafTriangles(tree) === triangles.length) done = tree;
        else {
          tree = null;
          pad++;
        }
      }
      return true;
    },
  };
}

export function octreeFromTriangles(tris: Float32Array | number[]): Octree {
  const job = octreeJob(tris);
  job.step(Infinity);
  return job.tree!;
}

/** The triangles of a level as a key: equal arrays give equal trees (the build is deterministic). */
function trianglesKey(tris: Float32Array | number[] | undefined): string {
  if (!tris || tris.length === 0) return '0';
  const f = tris instanceof Float32Array ? tris : Float32Array.from(tris);
  const u = new Uint32Array(f.buffer, f.byteOffset, f.length);
  let h = 2166136261;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 16777619);
  return `${f.length}:${(h >>> 0).toString(36)}`;
}

/**
 * M6 (docs/02-tech.md 9.5: a switch of mountains ≤ 1 s at CPU ×4): the trees of the next mountain built ahead, in slices
 * (the base calls step each frame). One at a time: a new prebuild drops the old, createCollisionWorld takes it once
 * (finishing it there if it is not done) and lets it go — never two mountains' trees held for long.
 */
interface Prebuild {
  key: string;
  jobs: [OctreeJob, OctreeJob | null];
}
let prebuild: Prebuild | null = null;

export function prebuildCollision(staticTriangles: Float32Array | number[], boundsTriangles?: Float32Array | number[]): void {
  const key = `${trianglesKey(staticTriangles)}|${trianglesKey(boundsTriangles)}`;
  if (prebuild?.key === key) return;
  prebuild = { key, jobs: [octreeJob(staticTriangles), boundsTriangles && boundsTriangles.length > 0 ? octreeJob(boundsTriangles) : null] };
}

/** One slice of the prebuild until `deadline`; true when there is none or it is ready. */
export function prebuildStep(deadline: number): boolean {
  if (!prebuild) return true;
  for (const j of prebuild.jobs) if (j && !j.step(deadline)) return false;
  return true;
}

export function prebuildReady(): boolean {
  return !!prebuild && prebuild.jobs.every((j) => !j || j.tree !== null);
}

function takePrebuilt(staticTriangles: Float32Array | number[], boundsTriangles?: Float32Array | number[]): { s: Octree; b: Octree | null } | null {
  const p = prebuild;
  if (!p) return null;
  prebuild = null;
  if (p.key !== `${trianglesKey(staticTriangles)}|${trianglesKey(boundsTriangles)}`) return null;
  for (const j of p.jobs) j?.step(Infinity);
  return { s: p.jobs[0].tree!, b: p.jobs[1]?.tree ?? null };
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
  const pre = takePrebuilt(staticTriangles, boundsTriangles);
  const staticTree = pre ? pre.s : octreeFromTriangles(staticTriangles);
  const boundsTree = pre ? pre.b : boundsTriangles && boundsTriangles.length > 0 ? octreeFromTriangles(boundsTriangles) : null;
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

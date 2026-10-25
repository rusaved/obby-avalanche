// What: Static Octree from triangle arrays plus a small dynamic Octree for gates and the invisible-wall Octree; capsule and sphere hit queries for the controller.
// Called by: sim/controller.ts, sim/world.ts, render/blob.ts, render/camera.ts; tests/sim/collision.test.ts, controller.test.ts, gates.test.ts, steps.test.ts
// Keep: From three only the math whitelist plus Capsule/Octree addons (architecture test); keep the padded Octree retry; the bounds tree answers capsules only, never spheres (camera).

/** Static Octree from triangle arrays (docs/02-tech.md 6.1); gates and other movers live in a second small Octree. */
import { Box3, Triangle, Vector3, Sphere, type Ray } from 'three';
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
/** three's Octree.maxLevel. */
const MAX_LEVEL = 16;
const _box = new Box3();

/** A growable typed array (the node count of a tree is known only once it is built). */
function grown<T extends Float64Array | Int32Array>(a: T, need: number): T {
  if (need <= a.length) return a;
  const b = new (a.constructor as new (n: number) => T)(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

/**
 * M6 polish (the risk of M6: ~130–420 MB a mountain): three's Octree with the very same split and leaves, kept in flat
 * typed arrays — a node is 6 doubles of its box and 4 ints instead of ~800 bytes of objects (two Box3, Layers, two
 * arrays). The queries walk the children in the same order and gather the same triangles in the same order, so every
 * hit three's tree gives, this one gives (tests/sim/octree-prebuild.test.ts compares them with three's own build).
 */
export class FlatOctree extends Octree {
  /** Node i: box min xyz, max xyz at 6i; children first[i]…first[i] + count[i] − 1; a leaf when triCount[i] > 0. */
  boxes = new Float64Array(6 * 1024);
  first = new Int32Array(1024);
  count = new Int32Array(1024);
  triStart = new Int32Array(1024);
  triCount = new Int32Array(1024);
  refs = new Int32Array(4096);
  nodes = 0;
  refN = 0;

  readonly tris: Triangle[];

  constructor(tris: Triangle[]) {
    super();
    this.tris = tris;
  }

  /** A new node with the box at `b[o…o + 5]`. */
  add(b: Float64Array, o: number): number {
    const i = this.nodes++;
    if (i >= this.first.length) {
      const n = i + 1;
      this.first = grown(this.first, n);
      this.count = grown(this.count, n);
      this.triStart = grown(this.triStart, n);
      this.triCount = grown(this.triCount, n);
    }
    this.boxes = grown(this.boxes, 6 * (i + 1));
    for (let k = 0; k < 6; k++) this.boxes[6 * i + k] = b[o + k]!;
    this.first[i] = 0;
    this.count[i] = 0;
    this.triCount[i] = 0;
    return i;
  }

  leaf(i: number, list: number[]): void {
    this.refs = grown(this.refs, this.refN + list.length);
    this.triStart[i] = this.refN;
    this.triCount[i] = list.length;
    for (const t of list) this.refs[this.refN++] = t;
  }

  /** Trims the arrays to the built size. */
  finish(): this {
    this.boxes = this.boxes.slice(0, 6 * this.nodes);
    this.first = this.first.slice(0, this.nodes);
    this.count = this.count.slice(0, this.nodes);
    this.triStart = this.triStart.slice(0, this.nodes);
    this.triCount = this.triCount.slice(0, this.nodes);
    this.refs = this.refs.slice(0, this.refN);
    return this;
  }

  /** The node's box into the shared Box3 (each test is done before the walk goes deeper). */
  private boxOf(i: number): Box3 {
    const b = this.boxes;
    _box.min.set(b[6 * i]!, b[6 * i + 1]!, b[6 * i + 2]!);
    _box.max.set(b[6 * i + 3]!, b[6 * i + 4]!, b[6 * i + 5]!);
    return _box;
  }

  /** As three's get*Triangles from node `node`: children in order, a leaf's triangles once each. */
  private gather(node: number, q: { intersectsBox(b: Box3): boolean }, out: Triangle[]): void {
    const f = this.first[node]!;
    const end = f + this.count[node]!;
    for (let i = f; i < end; i++) {
      if (!q.intersectsBox(this.boxOf(i))) continue;
      const n = this.triCount[i]!;
      if (n > 0) {
        const s = this.triStart[i]!;
        for (let j = 0; j < n; j++) {
          const t = this.tris[this.refs[s + j]!]!;
          if (out.indexOf(t) === -1) out.push(t);
        }
      } else this.gather(i, q, out);
    }
  }

  override getRayTriangles(ray: Ray, triangles: Triangle[]): Triangle[] {
    if (this.nodes > 0) this.gather(0, ray, triangles);
    return triangles;
  }
  override getSphereTriangles(sphere: Sphere, triangles: Triangle[]): Triangle[] {
    if (this.nodes > 0) this.gather(0, sphere, triangles);
    return triangles;
  }
  override getCapsuleTriangles(capsule: Capsule, triangles: Triangle[]): Triangle[] {
    if (this.nodes > 0) this.gather(0, capsule, triangles);
    return triangles;
  }
  override getBoxTriangles(box: Box3, triangles: Triangle[]): Triangle[] {
    if (this.nodes > 0) this.gather(0, box, triangles);
    return triangles;
  }
}

/** M6: a build of the tree cut into slices between frames — the same split, so the same tree as octreeFromTriangles. */
export interface OctreeJob {
  /** Works until `deadline` (performance.now()); true once the tree is ready. */
  step(deadline: number): boolean;
  readonly tree: Octree | null;
}

function trianglesOf(tris: Float32Array | number[]): Triangle[] {
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
  return triangles;
}

export function octreeJob(tris: Float32Array | number[]): OctreeJob {
  const triangles = trianglesOf(tris);
  const n = triangles.length;
  // M5-06 (a switch of mountains ≤ 1 s at CPU ×4): the bounds of each triangle, made once per build. A triangle is first
  // checked by them against the child box: apart — not in it, inside — in it; only the rest goes to the exact box–triangle
  // test (which the bounds checks never contradict), so every leaf holds the same triangles as three's split.
  const tb = new Float64Array(6 * n);
  const tv = new Float64Array(9 * n);
  triangles.forEach(({ a, b, c }, i) => {
    tb.set([Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z), Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z)], 6 * i);
    tv.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 9 * i);
  });
  // M6 polish (ready() at CPU ×4: the exact test was ~1.2 s of the boot, its arrays made anew on every call): three's
  // Box3.intersectsTriangle, the same arithmetic in the same order on plain numbers — the same answer to the last bit.
  const ax = new Float64Array(39);
  const boxHits = (q: number, ti: number): boolean => {
    const mnx = sub[q]!, mny = sub[q + 1]!, mnz = sub[q + 2]!, mxx = sub[q + 3]!, mxy = sub[q + 4]!, mxz = sub[q + 5]!;
    if (mxx < mnx || mxy < mny || mxz < mnz) return false;
    const cx = (mnx + mxx) * 0.5, cy = (mny + mxy) * 0.5, cz = (mnz + mxz) * 0.5;
    const ex = mxx - cx, ey = mxy - cy, ez = mxz - cz;
    const o = 9 * ti;
    const v0x = tv[o]! - cx, v0y = tv[o + 1]! - cy, v0z = tv[o + 2]! - cz;
    const v1x = tv[o + 3]! - cx, v1y = tv[o + 4]! - cy, v1z = tv[o + 5]! - cz;
    const v2x = tv[o + 6]! - cx, v2y = tv[o + 7]! - cy, v2z = tv[o + 8]! - cz;
    const f0x = v1x - v0x, f0y = v1y - v0y, f0z = v1z - v0z;
    const f1x = v2x - v1x, f1y = v2y - v1y, f1z = v2z - v1z;
    const f2x = v0x - v2x, f2y = v0y - v2y, f2z = v0z - v2z;
    // three's axes in its order: the 9 edge cross products, the 3 box normals, the triangle normal.
    ax[0] = 0;
    ax[1] = -f0z;
    ax[2] = f0y;
    ax[3] = 0;
    ax[4] = -f1z;
    ax[5] = f1y;
    ax[6] = 0;
    ax[7] = -f2z;
    ax[8] = f2y;
    ax[9] = f0z;
    ax[10] = 0;
    ax[11] = -f0x;
    ax[12] = f1z;
    ax[13] = 0;
    ax[14] = -f1x;
    ax[15] = f2z;
    ax[16] = 0;
    ax[17] = -f2x;
    ax[18] = -f0y;
    ax[19] = f0x;
    ax[20] = 0;
    ax[21] = -f1y;
    ax[22] = f1x;
    ax[23] = 0;
    ax[24] = -f2y;
    ax[25] = f2x;
    ax[26] = 0;
    ax[27] = 1;
    ax[28] = 0;
    ax[29] = 0;
    ax[30] = 0;
    ax[31] = 1;
    ax[32] = 0;
    ax[33] = 0;
    ax[34] = 0;
    ax[35] = 1;
    ax[36] = f0y * f1z - f0z * f1y;
    ax[37] = f0z * f1x - f0x * f1z;
    ax[38] = f0x * f1y - f0y * f1x;
    for (let i = 0; i < 39; i += 3) {
      const x = ax[i]!, y = ax[i + 1]!, z = ax[i + 2]!;
      const r = ex * Math.abs(x) + ey * Math.abs(y) + ez * Math.abs(z);
      const p0 = v0x * x + v0y * y + v0z * z;
      const p1 = v1x * x + v1y * y + v1z * z;
      const p2 = v2x * x + v2y * y + v2z * z;
      if (Math.max(-Math.max(p0, p1, p2), Math.min(p0, p1, p2)) > r) return false;
    }
    return true;
  };
  const sub = new Float64Array(48);
  const lists: number[][] = [[], [], [], [], [], [], [], []];
  let pad = 0;
  let tree: FlatOctree | null = null;
  let seen = new Uint8Array(n);
  let covered = 0;
  let todo: Array<[number, number, number[]]> = [];
  let done: Octree | null = null;

  /** One node of three's split (Octree.split): 8 child boxes x, y, z; the node's triangles from the last; the non-empty
   * children in that order; one with more than LEAF_TRIANGLES under MAX_LEVEL is split in turn (any order of nodes gives
   * the same tree). */
  const splitOnce = (t: FlatOctree, node: number, level: number, list: number[]): void => {
    const b = t.boxes;
    const o = 6 * node;
    const hx = (b[o + 3]! - b[o]!) * 0.5;
    const hy = (b[o + 4]! - b[o + 1]!) * 0.5;
    const hz = (b[o + 5]! - b[o + 2]!) * 0.5;
    let k = 0;
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 2; z++, k++) {
          const mnx = b[o]! + x * hx;
          const mny = b[o + 1]! + y * hy;
          const mnz = b[o + 2]! + z * hz;
          sub.set([mnx, mny, mnz, mnx + hx, mny + hy, mnz + hz], 6 * k);
          lists[k]!.length = 0;
        }
    for (let j = list.length - 1; j >= 0; j--) {
      const ti = list[j]!;
      const p = 6 * ti;
      for (let c = 0; c < 8; c++) {
        const q = 6 * c;
        if (tb[p + 3]! < sub[q]! || tb[p]! > sub[q + 3]! || tb[p + 4]! < sub[q + 1]! || tb[p + 1]! > sub[q + 4]! || tb[p + 5]! < sub[q + 2]! || tb[p + 2]! > sub[q + 5]!) continue;
        const inside = tb[p]! >= sub[q]! && tb[p + 3]! <= sub[q + 3]! && tb[p + 1]! >= sub[q + 1]! && tb[p + 4]! <= sub[q + 4]! && tb[p + 2]! >= sub[q + 2]! && tb[p + 5]! <= sub[q + 5]!;
        if (!inside && !boxHits(q, ti)) continue;
        lists[c]!.push(ti);
      }
    }
    let first = -1;
    let count = 0;
    for (let c = 0; c < 8; c++) {
      const l = lists[c]!;
      if (l.length === 0) continue;
      const i = t.add(sub, 6 * c);
      if (first < 0) first = i;
      count++;
      if (l.length > LEAF_TRIANGLES && level < MAX_LEVEL) todo.push([i, level + 1, l.slice()]);
      else {
        t.leaf(i, l);
        for (const ti of l) if (!seen[ti]) {
          seen[ti] = 1;
          covered++;
        }
      }
    }
    t.first[node] = Math.max(0, first);
    t.count[node] = count;
  };

  return {
    get tree() {
      return done;
    },
    step(deadline) {
      while (!done) {
        if (!tree) {
          if (pad >= OCTREE_PADDINGS.length) throw new Error('octreeFromTriangles: triangles lost on split boundaries');
          // As Octree.build: the bounds, then calcBox, then the split from level 0.
          tree = new FlatOctree(triangles);
          for (const t of triangles) tree.bounds.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
          if (n > 0) tree.bounds.expandByScalar(OCTREE_PADDINGS[pad]!);
          tree.calcBox();
          const bx = (tree as unknown as { box: Box3 }).box;
          tree.add(new Float64Array([bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z]), 0);
          seen = new Uint8Array(n);
          covered = 0;
          todo = [[0, 0, triangles.map((_, i) => i)]];
        }
        let next: [number, number, number[]] | undefined;
        while ((next = todo.pop())) {
          splitOnce(tree, next[0], next[1], next[2]);
          if (todo.length > 0 && performance.now() >= deadline) return false;
        }
        if (covered === n) done = tree.finish();
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
 * (the base calls step each frame). A slot per kind of switch (M6 polish: 0 — the own mountain, 1 — a run again or the
 * next mountain straight from a summit); a new prebuild in a slot drops its old one, createCollisionWorld takes the one
 * of its triangles (finishing it there if it is not done) and lets all go — the flat trees are ~15–30 MB a mountain.
 */
interface Prebuild {
  key: string;
  jobs: [OctreeJob, OctreeJob | null];
}
let prebuilds: Array<Prebuild | null> = [];
const keyOf = (staticTriangles: Float32Array | number[], boundsTriangles?: Float32Array | number[]): string =>
  `${trianglesKey(staticTriangles)}|${trianglesKey(boundsTriangles)}`;

export function prebuildCollision(staticTriangles: Float32Array | number[], boundsTriangles?: Float32Array | number[], slot = 0): void {
  const key = keyOf(staticTriangles, boundsTriangles);
  if (prebuilds[slot]?.key === key) return;
  if (prebuilds.some((p, i) => i !== slot && p?.key === key)) return;
  prebuilds[slot] = { key, jobs: [octreeJob(staticTriangles), boundsTriangles && boundsTriangles.length > 0 ? octreeJob(boundsTriangles) : null] };
}

/** One slice of the prebuilds (slot 0 first) until `deadline`; true when there is none or all are ready. */
export function prebuildStep(deadline: number): boolean {
  for (const p of prebuilds) if (p) for (const j of p.jobs) if (j && !j.step(deadline)) return false;
  return true;
}

export function prebuildReady(): boolean {
  return prebuilds.some((p) => p) && prebuilds.every((p) => !p || p.jobs.every((j) => !j || j.tree !== null));
}

function takePrebuilt(staticTriangles: Float32Array | number[], boundsTriangles?: Float32Array | number[]): { s: Octree; b: Octree | null } | null {
  const key = keyOf(staticTriangles, boundsTriangles);
  const p = prebuilds.find((x) => x?.key === key) ?? null;
  prebuilds = [];
  if (!p) return null;
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

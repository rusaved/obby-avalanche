// What: The winter decor of a mountain from the Kenney models picked in decor.json: where each stands (field edges, stage finishes, the camp) and its geometry with baked palette colours and ground AO, to merge into the chunks; the points of the warm glows.
// Called by: render/level-mesh.ts (createLevelMeshes merges the geometries per chunk and draws the glows as one InstancedMesh); tests/render/winter-decor.test.ts.
// Keep: Render only, nothing in the sim; never on grottos, pads, gates or the run line (the clear checks); deterministic by the level; numbers and colours from decor.json.

/**
 * Z-06 (producer 26.10, «Lavina 19 · Winter look»): the slopes of a top obby are not empty. Pines, rocks and drifts
 * line both edges of the field, lanterns with a garland of warm-gold bulbs stand at each stage finish, tents, a campfire,
 * a sled, crates and a bench make the camp. The models come from content/<pack>/decor-models.json (npm run gen:decor:
 * triangles and the colormap baked into a palette), so they merge into the chunks like boxes — +0 draw calls, +0
 * programs, +0 textures. No New Year: no decorated trees, presents or greetings (a December update may add them).
 */
import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Matrix4, Vector3 } from 'three';
import type { DecorJson, DecorModelsJson } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import { createRng } from '../core/rng.ts';

export interface DecorPiece {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface WinterDecor {
  pieces: DecorPiece[];
  /** Warm glows (x, y, z, radius): lantern lamps, garland bulbs, the campfire. */
  glows: Array<[number, number, number, number]>;
  /** D-03: the flags that mark the run line (x, y, z, side −1 / 1: the cloth to the outside). */
  marks: Array<[number, number, number, number]>;
  /** D-03: the strips of the ski track up the axis (x, y, z0, z1). */
  trail: Array<[number, number, number, number]>;
}

/** Where the decor stands on `level`: pure, deterministic (seeded by the world index). */
export function winterDecorPlan(level: LevelData, spec: DecorJson, models: DecorModelsJson): WinterDecor {
  const rng = createRng(0x5eed + level.worldIndex * 7919);
  const pieces: DecorPiece[] = [];
  const glows: WinterDecor['glows'] = [];
  const marks: WinterDecor['marks'] = [];
  const trail: WinterDecor['trail'] = [];
  const size = (id: string): number => {
    const m = models.models[id];
    if (!m) return 0;
    let r = 0;
    for (let i = 0; i < m.pos.length; i += 3) r = Math.max(r, Math.abs(m.pos[i]!), Math.abs(m.pos[i + 2]!));
    return (r / 100) * (spec.scale[id] ?? 1);
  };
  const solidKinds = new Set(spec.clear.boxKinds);
  const pads = new Set(spec.clear.points);
  const solids = level.boxes.filter((b) => solidKinds.has(b.kind));
  const padPoints = level.points.filter((p) => pads.has(p.type));
  /** Nothing of the game within `r` + clear of (x, z): grottos, gates, pads, walls; the ground under it whole. */
  const free = (x: number, z: number, r: number, clear: number, near: number): number | null => {
    const c = r + clear;
    if (level.niches.some((n) => x + c > n.box.min[0] && x - c < n.box.max[0] && z + c > n.box.min[2] && z - c < n.box.max[2])) return null;
    if (level.gates.some((g) => Math.abs(g.z - z) < c)) return null;
    if (padPoints.some((p) => Math.hypot(p.x - x, p.z - z) < c + near)) return null;
    if (solids.some((b) => x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2])) return null;
    if ((level.shapes ?? []).some((s) => s.z1 > z - c && s.z0 < z + c)) return null;
    // On ground under its whole foot: set at the lowest corner (sunk into a rise, never over a pit or off a step).
    let y = level.floorAt(x, z);
    if (!Number.isFinite(y)) return null;
    for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
      const g = level.floorAt(x + dx, z + dz);
      if (!Number.isFinite(g) || Math.abs(g - y) > spec.clear.step) return null;
      y = Math.min(y, g);
    }
    return y;
  };
  const place = (id: string, x: number, z: number, yaw: number, clear: number, lift = 0, near = spec.clear.near, k = 1): boolean => {
    if (!models.models[id]) return false;
    const r = size(id) * k;
    const y = free(x, z, r, clear, near);
    if (y === null) return false;
    const scale = (spec.scale[id] ?? 1) * k;
    pieces.push({ id, x, y: y + lift, z, yaw, scale });
    for (const [gx, gy, gz, gr] of spec.glow[id] ?? []) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      glows.push([x + (gx * c + gz * s) * scale, y + lift + gy * scale, z + (-gx * s + gz * c) * scale, gr * scale]);
    }
    return true;
  };
  const safe = level.safeZones;
  const camp = safe[0];
  const top = safe[safe.length - 1];
  // Both edges of the field: a pick every `every` units, `inset` from the border, off the camp and the summit; a stage
  // (one chunk) keeps at most `perStage` of them — a long one spreads them wider (the chunk is drawn whole).
  const e = spec.edge;
  const z0 = (camp?.[1] ?? 0) + e.every / 2;
  const z1 = (top?.[0] ?? level.length) - e.every / 2;
  const spans: Array<[number, number]> = level.stages?.length ? level.stages.map((st) => [Math.max(z0, st.z0), Math.min(z1, st.finish[1])]) : [[z0, z1]];
  for (const [a, b] of spans) {
    const step = Math.max(e.every, ((b - a) * 2) / e.perStage);
    for (let z = a + step / 2; z < b; z += step)
      for (const side of [-1, 1]) {
        const zz = z + (rng.next() - 0.5) * e.jitter;
        const half = level.halfAt(zz);
        const x = side * (half - e.inset[0] - rng.next() * (e.inset[1] - e.inset[0]));
        place(rng.pick(e.pick), x, zz, rng.next() * Math.PI * 2, e.clear);
      }
  }
  // D-03 (headquarters 27.10: the middle of the slope was white on white): drifts and stones between the run line and
  // the edge, and the flags of the run line — the way ahead read at a glance; merged into the chunks like the rest.
  const mid = spec.mid;
  if (mid?.worlds.includes(level.worldIndex))
    for (const [a, b] of spans) {
      const step = Math.max(mid.every, ((b - a) * 2) / mid.perStage);
      for (let z = a + step / 2; z < b; z += step)
        for (const side of [-1, 1]) {
          const zz = z + (rng.next() - 0.5) * mid.jitter;
          const far = level.halfAt(zz) - mid.inset;
          if (far <= mid.axis) continue;
          const id = rng.pick(mid.pick);
          place(id, side * (mid.axis + rng.next() * (far - mid.axis)), zz, rng.next() * Math.PI * 2, mid.clear, 0, spec.clear.near, mid.scale?.[id] ?? 1);
        }
    }
  const mk = spec.marks;
  if (mk?.worlds.includes(level.worldIndex))
    for (const [a, b] of spans)
      for (let z = a + mk.every / 2; z < b; z += mk.every)
        for (const side of [-1, 1]) {
          const y = free(side * mk.x, z, 0.3, mk.clear, 0);
          if (y !== null) marks.push([side * mk.x, y, z, side]);
          // The track between this pair and the next where the ground runs flat (no dip, pit or step under it).
          const tx = side * (mk.trail ?? 0);
          if (!mk.trail || z + mk.every > b) continue;
          const g0 = level.floorAt(tx, z);
          let flat = Number.isFinite(g0) && !level.niches.some((n) => tx > n.box.min[0] - 1 && tx < n.box.max[0] + 1 && z + mk.every > n.box.min[2] && z < n.box.max[2]);
          for (let t = 2; flat && t <= mk.every; t += 2) flat = Math.abs(level.floorAt(tx, z + t) - g0) < 0.05;
          if (flat && !level.gates.some((g) => g.z > z - 1 && g.z < z + mk.every + 1)) trail.push([tx, g0, z, z + mk.every]);
        }
  // Stage finishes: by the trophy pad's edge a lantern pair with a garland between before it, crates and a barrel past it
  // (the treadmill takes the other edge).
  for (const st of level.stages ?? []) {
    const f = spec.finish;
    const side = st.pad.x > 0 ? 1 : -1;
    const x = side * (level.halfAt(st.finish[0]) - f.inset);
    const z0 = st.finish[0] + f.from;
    if (place(f.post, x, z0, 0, f.clear, 0, 0) && place(f.post, x, z0 + f.span, 0, f.clear, 0, 0) && f.garland) place(f.garland, x, z0 + f.span / 2, Math.PI / 2, 0, f.garlandLift, 0);
    for (const [k, id] of f.props.entries()) place(id, side * (level.halfAt(st.finish[1]) - f.inset - 1 - k * 3), st.finish[1] - 2.5, rng.next() * Math.PI * 2, f.clear, 0, 0);
  }
  // The camp: its own layout, x as a share of the half width (sign — the side), z from the camp start.
  if (camp)
    for (const c of spec.camp) {
      const z = camp[0] + c.z;
      place(c.id, c.x * level.halfAt(z), z, c.yaw ?? rng.next() * Math.PI * 2, spec.campClear, c.lift ?? 0);
    }
  return { pieces, glows, marks, trail };
}

const _m = new Matrix4();
const _r = new Matrix4();
const _c = new Color();
const _v = new Vector3();
const _n = new Vector3();
const _nm = new Matrix3();
const WHITE = new Color(1, 1, 1);
const paletteCache = new WeakMap<DecorModelsJson, Color[]>();
/** A model at its scale, once a load: positions, flat normals, palette colours with AO at its foot. */
const baseCache = new WeakMap<DecorModelsJson, Map<string, { pos: Float32Array; nor: Float32Array; col: Float32Array }>>();
function baseOf(id: string, scale: number, models: DecorModelsJson, ao: number, foot: number): { pos: Float32Array; nor: Float32Array; col: Float32Array } | null {
  let cache = baseCache.get(models);
  if (!cache) baseCache.set(models, (cache = new Map()));
  const key = `${id}|${scale}|${ao}|${foot}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = models.models[id];
  if (!m) return null;
  let pal = paletteCache.get(models);
  if (!pal) paletteCache.set(models, (pal = models.palette.map((h) => new Color(h))));
  const n = m.idx.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const i = m.idx[k]!;
    const y = (m.pos[i * 3 + 1]! / 100) * scale;
    pos[k * 3] = (m.pos[i * 3]! / 100) * scale;
    pos[k * 3 + 1] = y;
    pos[k * 3 + 2] = (m.pos[i * 3 + 2]! / 100) * scale;
    _c.copy(pal[m.col[i]!] ?? WHITE);
    const f = ao + (1 - ao) * Math.min(1, Math.max(0, y / foot));
    col[k * 3] = _c.r * f;
    col[k * 3 + 1] = _c.g * f;
    col[k * 3 + 2] = _c.b * f;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const nor = (g.getAttribute('normal').array as Float32Array).slice();
  g.dispose();
  const base = { pos, nor, col };
  cache.set(key, base);
  return base;
}

/** D-02 (a switch of mountains ≤ 1 s at CPU ×4): the plan and the geometry of every piece made ahead (the prebuild of the
 * next mountain), for createLevelMeshes to merge as is. */
export interface WinterDecorBuilt {
  plan: WinterDecor;
  geometries: Array<BufferGeometry | null>;
  /** V22: the finished pieces of the track (render/track-props.ts), made ahead with the rest. */
  props?: import('./track-props.ts').TrackProps;
}

export function buildWinterDecor(level: LevelData, spec: DecorJson, models: DecorModelsJson): WinterDecorBuilt {
  const plan = winterDecorPlan(level, spec, models);
  return { plan, geometries: plan.pieces.map((p) => pieceGeometry(p, models, spec.ao, spec.foot)) };
}

/** The geometry of a piece in world space: non-indexed, flat normals, palette colours with AO at its foot, an empty UV
 * and texture layer 0 (the attributes of the chunks). */
export function pieceGeometry(piece: DecorPiece, models: DecorModelsJson, ao: number, foot: number): BufferGeometry | null {
  const base = baseOf(piece.id, piece.scale, models, ao, foot);
  if (!base) return null;
  const n = base.pos.length / 3;
  _m.makeTranslation(piece.x, piece.y, piece.z).multiply(_r.makeRotationY(piece.yaw));
  _nm.getNormalMatrix(_m);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _v.fromArray(base.pos, i * 3).applyMatrix4(_m).toArray(pos, i * 3);
    _n.fromArray(base.nor, i * 3).applyMatrix3(_nm).toArray(nor, i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(base.col.slice(), 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('layer', new Float32BufferAttribute(new Float32Array(n), 1));
  return g;
}

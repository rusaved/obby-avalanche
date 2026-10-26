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
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4 } from 'three';
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
}

/** Where the decor stands on `level`: pure, deterministic (seeded by the world index). */
export function winterDecorPlan(level: LevelData, spec: DecorJson, models: DecorModelsJson): WinterDecor {
  const rng = createRng(0x5eed + level.worldIndex * 7919);
  const pieces: DecorPiece[] = [];
  const glows: WinterDecor['glows'] = [];
  const size = (id: string): number => {
    const m = models.models[id];
    if (!m) return 0;
    let r = 0;
    for (let i = 0; i < m.pos.length; i += 3) r = Math.max(r, Math.abs(m.pos[i]!), Math.abs(m.pos[i + 2]!));
    return (r / 100) * (spec.scale[id] ?? 1);
  };
  const solidKinds = new Set(spec.clear.boxKinds);
  const pads = new Set(spec.clear.points);
  /** Nothing of the game within `r` + clear of (x, z): grottos, gates, pads, walls; the ground under it whole. */
  const free = (x: number, z: number, r: number, clear: number, near: number): number | null => {
    const c = r + clear;
    if (level.niches.some((n) => x + c > n.box.min[0] && x - c < n.box.max[0] && z + c > n.box.min[2] && z - c < n.box.max[2])) return null;
    if (level.gates.some((g) => Math.abs(g.z - z) < c)) return null;
    if (level.points.some((p) => pads.has(p.type) && Math.hypot(p.x - x, p.z - z) < c + near)) return null;
    if (level.boxes.some((b) => solidKinds.has(b.kind) && x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2])) return null;
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
  const place = (id: string, x: number, z: number, yaw: number, clear: number, lift = 0, near = spec.clear.near): boolean => {
    if (!models.models[id]) return false;
    const r = size(id);
    const y = free(x, z, r, clear, near);
    if (y === null) return false;
    const scale = spec.scale[id] ?? 1;
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
  return { pieces, glows };
}

const _m = new Matrix4();
const _r = new Matrix4();
const _c = new Color();

/** The geometry of a piece in world space: non-indexed, flat normals, palette colours with AO at its foot, an empty UV
 * and texture layer 0 (the attributes of the chunks). */
export function pieceGeometry(piece: DecorPiece, models: DecorModelsJson, ao: number, foot: number): BufferGeometry | null {
  const m = models.models[piece.id];
  if (!m) return null;
  const n = m.idx.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const i = m.idx[k]!;
    const y = m.pos[i * 3 + 1]! / 100;
    pos[k * 3] = m.pos[i * 3]! / 100;
    pos[k * 3 + 1] = y;
    pos[k * 3 + 2] = m.pos[i * 3 + 2]! / 100;
    _c.set(models.palette[m.col[i]!] ?? '#ffffff');
    const f = ao + (1 - ao) * Math.min(1, Math.max(0, (y * piece.scale) / foot));
    col[k * 3] = _c.r * f;
    col[k * 3 + 1] = _c.g * f;
    col[k * 3 + 2] = _c.b * f;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('layer', new Float32BufferAttribute(new Float32Array(n), 1));
  _m.makeTranslation(piece.x, piece.y, piece.z).multiply(_r.makeRotationY(piece.yaw)).multiply(new Matrix4().makeScale(piece.scale, piece.scale, piece.scale));
  g.applyMatrix4(_m);
  g.computeVertexNormals();
  return g;
}

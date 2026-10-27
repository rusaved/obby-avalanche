// What: The finished look of the game pieces of the track over their colliders — the maze exit arch, the canopies of the finish belts, the rock grottos, the caves in drifts, the trophy pedestal, the belts with their frame and moving stripes, the summit chest, the camp teleport, the egg stand, the camp fence, the decor landmarks — built from boxes, cylinders, lathes and the Kenney models of decor-models.json.
// Called by: render/level-mesh.ts (createLevelMeshes merges `pieces` into its chunks, adds `cut` to the cave cut parts, draws `stripes` and the glows).
// Keep: Render only — nothing here is a collider or reaches the sim; colours only from theme.json; every box or point it draws is skipped by level-mesh (`drawsBox`, `drawsPoint`), the colliders and the shelter volumes stay as they are.

/**
 * V22 (staff 27.10, «Lavina 22 · Track look»): no stub on the track — no bare cube where a thing stands, nothing hanging in
 * the air, every piece of simple shapes but finished (posts, trims, texture), like a top cartoon obby. One function a
 * kind of piece draws it on every mountain; the pieces merge into the chunks (+0 draw calls), the belt stripes are one
 * InstancedMesh a mountain (+1), the cold glows of the grottos one more.
 */
import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, LatheGeometry, Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import type { DecorModelsJson, ThemeJson } from '../content/types.ts';
import type { LevelBox, LevelData, LevelNiche, LevelPoint } from '../level/types.ts';
import { NICHE_HEIGHT, NICHE_WALL } from '../level/builder.ts';
import { layerOf } from './block-tex.ts';

/** Box kinds this module draws instead of level-mesh (their colliders stay). */
const OWN_BOXES = new Set(['cover', 'iceRock', 'trophyPad', 'campTeleport', 'beacon']);
/** Decor kinds of points this module draws (the rest — level-mesh). */
const OWN_DECOR = new Set(['tree', 'pine', 'cairn', 'spire', 'crystal', 'icefall', 'tent', 'lantern', 'arrow']);
/** The belt: its top over the floor, the frame rails (width, height), the rollers, the stripes (width along, step). */
const BELT_TOP = 0.12;
const RAIL_W = 0.3;
const RAIL_H = 0.3;
const ROLLER_R = 0.32;
const STRIPE_D = 0.35;
const STRIPE_STEP = 1.4;
/** The stripes move down the belt (to the start) this fast at ×1 and this much more a doubling of the multiplier. */
const STRIPE_SPEED = 1.2;
const STRIPE_PER_DOUBLE = 0.5;
const STRIPE_MAX = 6;
/** The summit chest beside the portal (x off the axis, z before the portal) and its pedestal. */
const CHEST_SIDE = 10;
const CHEST_BEFORE = 6;
const CHEST_SCALE = 11;

export interface PropPiece {
  z: number;
  geo: BufferGeometry;
}

/** A part drawn in the cave cut mesh (hidden with the roof or back of its niche in the wide avalanche frame). */
export interface PropCut {
  niche: number;
  part: 'roof' | 'back';
  box: LevelBox;
  /** Turn about the Z axis (rad) of a tilted board of a gable roof. */
  tilt?: number;
}

/** One stripe of a belt: its centre at the start of the cycle, width across, the length of its belt and its speed. */
export interface PropStripe {
  x: number;
  y: number;
  z0: number;
  len: number;
  w: number;
  phase: number;
  speed: number;
}

export interface TrackProps {
  pieces: PropPiece[];
  cut: PropCut[];
  /** Warm (lamps) and cold (grottos, the teleport) glows: x, y, z, radius. */
  glows: Array<[number, number, number, number]>;
  coldGlows: Array<[number, number, number, number]>;
  stripes: PropStripe[];
  /** Roofs of the canopies drawn as a gable here: their flat collider boxes are not drawn. */
  hidden: Set<LevelBox>;
  /** Where the summit chest stands (the coin burst of the summit), null — none. */
  chest: [number, number, number] | null;
}

export function drawsBox(b: LevelBox): boolean {
  return OWN_BOXES.has(b.kind);
}

export function drawsPoint(p: LevelPoint): boolean {
  return p.type === 'treadmill' || p.type === 'chest' || p.type === 'eggStand' || (p.type === 'decor' && OWN_DECOR.has(p['kind'] as string));
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Theme colour of `key` (else of `fallback`, else grey) times `k`. */
function tone(theme: ThemeJson, key: string, k = 1, fallback?: string): Color {
  const m = theme.materials[key] ?? (fallback ? theme.materials[fallback] : undefined);
  return new Color(m ? m.color : '#cccccc').multiplyScalar(k);
}

function texLayer(theme: ThemeJson, key: string, fallback?: string): number {
  return layerOf((theme.materials[key] ?? (fallback ? theme.materials[fallback] : undefined))?.tex);
}

/** Non-indexed, flat normals, the colour baked with the face shading of the chunks (top 1, sides 0.9, under 0.78), a layer. */
function bake(geo: BufferGeometry, color: Color, layer: number): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  const nor = g.getAttribute('normal');
  const n = nor.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ny = nor.getY(i);
    const f = ny > 0.5 ? 1 : ny < -0.5 ? 0.78 : 0.9;
    col[i * 3] = color.r * f;
    col[i * 3 + 1] = color.g * f;
    col[i * 3 + 2] = color.b * f;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('layer', new Float32BufferAttribute(new Float32Array(n).fill(layer), 1));
  return g;
}

/** The kit of shapes of one mountain: each call adds a baked piece at its z. */
function kit(theme: ThemeJson, models: DecorModelsJson | undefined) {
  const pieces: PropPiece[] = [];
  const add = (z: number, geo: BufferGeometry, key: string, k = 1, fallback?: string): void => {
    pieces.push({ z, geo: bake(geo, tone(theme, key, k, fallback), texLayer(theme, key, fallback)) });
  };
  const k = {
    pieces,
    /** Any shape already placed in world space. */
    shape(z: number, geo: BufferGeometry, key: string, shade = 1, fallback?: string): void {
      add(z, geo, key, shade, fallback);
    },
    /** An axis-aligned box from (x0, y0, z0) to (x1, y1, z1). */
    box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, key: string, shade = 1, fallback?: string): void {
      const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      add((z0 + z1) / 2, g, key, shade, fallback);
    },
    /** A box of size (w, h, d) at its centre, turned by Euler (x, y, z) rad. */
    turned(cx: number, cy: number, cz: number, w: number, h: number, d: number, rx: number, ry: number, rz: number, key: string, shade = 1, fallback?: string): void {
      const g = new BoxGeometry(w, h, d);
      g.applyMatrix4(new Matrix4().makeRotationX(rx));
      g.applyMatrix4(new Matrix4().makeRotationZ(rz));
      g.applyMatrix4(new Matrix4().makeRotationY(ry));
      g.translate(cx, cy, cz);
      add(cz, g, key, shade, fallback);
    },
    /** An upright cylinder (radii at the bottom and the top, `seg` sides) standing on (x, y, z). */
    post(x: number, y: number, z: number, r0: number, r1: number, h: number, seg: number, key: string, shade = 1, fallback?: string): void {
      const g = new CylinderGeometry(r1, r0, h, seg);
      g.translate(x, y + h / 2, z);
      add(z, g, key, shade, fallback);
    },
    /** A cylinder lying along X from x0 to x1 at (y, z). */
    beamX(x0: number, x1: number, y: number, z: number, r: number, seg: number, key: string, shade = 1): void {
      const g = new CylinderGeometry(r, r, x1 - x0, seg);
      g.rotateZ(Math.PI / 2);
      g.translate((x0 + x1) / 2, y, z);
      add(z, g, key, shade);
    },
    /** A cylinder lying along Z from z0 to z1 at (x, y). */
    beamZ(x: number, y: number, z0: number, z1: number, r: number, seg: number, key: string, shade = 1): void {
      const g = new CylinderGeometry(r, r, z1 - z0, seg);
      g.rotateX(Math.PI / 2);
      g.translate(x, y, (z0 + z1) / 2);
      add((z0 + z1) / 2, g, key, shade);
    },
    /** An icicle hanging from (x, y, z): a cone of length `len`. */
    icicle(x: number, y: number, z: number, r: number, len: number): void {
      const g = new ConeGeometry(r, len, 4);
      g.rotateX(Math.PI);
      g.translate(x, y - len / 2, z);
      add(z, g, 'ice', 1.08);
    },
    /** A turned shape (profile of [radius, height] from the bottom) standing on (x, y, z). */
    lathe(x: number, y: number, z: number, profile: Array<[number, number]>, seg: number, key: string, shade = 1, fallback?: string): void {
      const g = new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), seg);
      g.translate(x, y, z);
      add(z, g, key, shade, fallback);
    },
    /** A Kenney model of decor-models.json at (x, y, z) turned by `yaw`, scaled by (sx, sy, sz) of its 1-unit size;
     * `tint` — every colour turned to this theme colour by its brightness (an ice rock out of a stone one). */
    model(id: string, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tint?: string): boolean {
      const m = models?.models[id];
      if (!m || !models) return false;
      const pal = models.palette.map((h) => new Color(h));
      const t = tint ? tone(theme, tint) : null;
      _m.compose(_v.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(sx / 100, sy / 100, sz / 100));
      const n = m.idx.length;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const c = new Color();
      for (let i = 0; i < n; i++) {
        const v = m.idx[i]!;
        _v.set(m.pos[v * 3]!, m.pos[v * 3 + 1]!, m.pos[v * 3 + 2]!).applyMatrix4(_m).toArray(pos, i * 3);
        c.copy(pal[m.col[v]!] ?? new Color(1, 1, 1));
        if (t) {
          const l = 0.35 + 0.9 * (0.3 * c.r + 0.59 * c.g + 0.11 * c.b);
          c.copy(t).multiplyScalar(Math.min(1.25, l));
        }
        c.toArray(col, i * 3);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      g.setAttribute('color', new Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
      g.setAttribute('layer', new Float32BufferAttribute(new Float32Array(n), 1));
      pieces.push({ z, geo: g });
      return true;
    },
    /** The size of a model (x, y, z extents at scale 1, units) — to fit it to a collider. */
    size(id: string): [number, number, number] | null {
      const m = models?.models[id];
      if (!m) return null;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < m.pos.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3]!, m.pos[i]! / 100);
        hi[i % 3] = Math.max(hi[i % 3]!, m.pos[i]! / 100);
      }
      return [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
    },
  };
  return k;
}
type Kit = ReturnType<typeof kit>;

/** The flag of a stage: the rarity colour of the zone where it stands (the checkpoint below `z`), else the run flags'. */
function stageColor(level: LevelData, theme: ThemeJson, z: number): string {
  let best: string | null = null;
  let bz = -Infinity;
  for (const c of level.checkpoints) if (c.z <= z && c.z > bz) ((bz = c.z), (best = c.rarity));
  return (best && theme.rarity[best]) ?? theme.materials['markFlag']?.color ?? '#ff7a00';
}

export function buildTrackProps(level: LevelData, theme: ThemeJson, models?: DecorModelsJson): TrackProps {
  const k = kit(theme, models);
  const cut: PropCut[] = [];
  const glows: TrackProps['glows'] = [];
  const coldGlows: TrackProps['coldGlows'] = [];
  const stripes: PropStripe[] = [];
  const hidden = new Set<LevelBox>();
  let chest: TrackProps['chest'] = null;

  // V-01: the arch over the real way out of a maze (LV-12: read over the walls from the way in) — two ice pillars with
  // log bands on the wall ends, a log beam over the walls with a snow cap, the flag of the stage and a warm lamp.
  for (const st of level.stages ?? []) {
    const mz = st.maze;
    if (!mz) continue;
    const real = mz.exits.find((e) => e.real && e.side === 'top');
    if (!real) continue;
    const cx = mz.x0 + (real.col + 0.5) * mz.cell;
    const z = mz.z0 + mz.rows * mz.cell;
    const walls = level.boxes.filter((b) => b.kind === 'throatWall' && b.min[2] >= mz.z0 - 2 && b.max[2] <= z + 2);
    const y = st.y;
    const top = walls.reduce((h, b) => Math.max(h, b.max[1]), y + 8);
    const H = Math.max(top + 2, y + 14);
    // The pillars wrap the wall ends from the ground (over the walls' colliders), log bands on them.
    for (const side of [-1, 1]) {
      const px = cx + (side * mz.cell) / 2;
      k.box(px - 0.9, y, z - 0.9, px + 0.9, H, z + 0.9, 'ice', 1.05);
      for (const by of [y + 2.6, top - 0.4, H - 0.9]) k.box(px - 1.05, by, z - 1.05, px + 1.05, by + 0.45, z + 1.05, 'pole');
      k.box(px - 1.1, H, z - 1.1, px + 1.1, H + 0.35, z + 1.1, 'track');
    }
    const x0 = cx - mz.cell / 2 - 1.2;
    const x1 = cx + mz.cell / 2 + 1.2;
    k.beamX(x0, x1, H + 0.9, z, 0.55, 7, 'pole');
    k.box(x0 + 0.2, H + 1.35, z - 0.55, x1 - 0.2, H + 1.75, z + 0.55, 'track');
    // The flag on a pole over the middle of the beam, its cloth across the run (seen from the way in).
    k.post(cx, H + 1.4, z, 0.1, 0.1, 4.2, 5, 'pole');
    const cloth = new BoxGeometry(2.6, 1.5, 0.1);
    cloth.translate(cx + 1.4, H + 4.7, z);
    k.pieces.push({ z, geo: bake(cloth, new Color(stageColor(level, theme, z)), 0) });
    // The lamp under the beam and the soft light over the arch.
    k.post(cx, H - 0.2, z, 0.35, 0.45, 0.8, 6, 'portalLight', 1.1);
    glows.push([cx, H + 0.2, z, 1.4], [cx, H + 3.5, z, 4.5]);
  }

  // V-12: the maze walls from inside — a snow cap along their tops, a dark plinth at the foot, a few stones jutting out
  // (render only; the walls, their height and the passages stay).
  for (const st of level.stages ?? []) {
    const mz = st.maze;
    if (!mz) continue;
    const xa = mz.x0 - 1;
    const xb = mz.x0 + mz.cols * mz.cell + 1;
    const za = mz.z0 - 1;
    const zb = mz.z0 + mz.rows * mz.cell + 1;
    let n = 0;
    for (const w of level.boxes) {
      if (w.kind !== 'throatWall' || w.min[0] < xa || w.max[0] > xb || w.min[2] < za || w.max[2] > zb) continue;
      k.box(w.min[0] - 0.25, w.max[1], w.min[2] - 0.25, w.max[0] + 0.25, w.max[1] + 0.5, w.max[2] + 0.25, 'track');
      k.box(w.min[0] - 0.14, st.y, w.min[2] - 0.14, w.max[0] + 0.14, st.y + 0.9, w.max[2] + 0.14, 'grottoRock', 0.62, 'rock');
      const along = w.max[2] - w.min[2] > w.max[0] - w.min[0];
      const L = along ? w.max[2] - w.min[2] : w.max[0] - w.min[0];
      for (let t = 4 + (n++ % 3) * 2; t < L - 3; t += 9) {
        const hy = st.y + 3 + ((t * 7 + n * 3) % 5);
        if (along) k.box(w.min[0] - 0.35, hy, w.min[2] + t - 0.8, w.max[0] + 0.35, hy + 1.1, w.min[2] + t + 0.8, 'throatWall', 0.9);
        else k.box(w.min[0] + t - 0.8, hy, w.min[2] - 0.35, w.min[0] + t + 0.8, hy + 1.1, w.max[2] + 0.35, 'throatWall', 0.9);
      }
    }
  }

  // V-02: the rocks of the giant's zone — a Kenney rock over the collider box; the ice rocks of the ice stage — the same
  // rock in ice. The model covers the box (a little over it): the hero meets the rock where he sees it.
  for (const b of level.boxes) {
    if (b.kind !== 'cover' && b.kind !== 'iceRock') continue;
    const id = b.kind === 'cover' ? 'rocksL' : 'rocksM';
    const sz = k.size(id);
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    if (!sz || !k.model(id, cx, b.min[1], cz, (Math.abs(cx * 7 + cz * 3) % 6.28), (w * 1.15) / sz[0], (h * 1.12) / sz[1], (d * 1.15) / sz[2], b.kind === 'iceRock' ? 'ice' : undefined)) {
      k.box(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], b.kind === 'cover' ? 'rock' : 'ice');
      continue;
    }
    // A snow cap on the stone rock (the ice one is all ice).
    if (b.kind === 'cover') k.lathe(cx, b.max[1] - 0.15, cz, [[0, 0], [w * 0.42, 0], [w * 0.38, 0.45], [w * 0.2, 0.75], [0, 0.8]], 7, 'track');
  }

  // V-10: the trophy pad — a low octagon pedestal over its collider (it covers the 6 × 6 box), a gold trim, a cup over it
  // and a light ring.
  for (const b of level.boxes) {
    if (b.kind !== 'trophyPad') continue;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const r = ((b.max[0] - b.min[0]) / 2) * 1.42;
    k.lathe(cx, b.min[1], cz, [[0, 0], [r, 0], [r, b.max[1] - b.min[1] - 0.12], [r - 0.35, b.max[1] - b.min[1]], [0, b.max[1] - b.min[1]]], 8, 'rock', 1.15, 'border');
    k.lathe(cx, b.max[1] - 0.5, cz, [[r + 0.05, 0], [r + 0.12, 0.25], [r - 0.3, 0.5], [r - 0.4, 0.5]], 8, 'trophyPad');
    k.lathe(cx, b.max[1], cz, [[r * 0.62, 0], [r * 0.7, 0], [r * 0.7, 0.04], [r * 0.62, 0.04]], 16, 'portalLight', 1.15);
    // The cup over the middle (above the hero's head, he steps on the pad under it).
    k.lathe(cx, b.max[1] + 3.2, cz, [[0, 0], [0.55, 0], [0.5, 0.15], [0.14, 0.3], [0.12, 0.7], [0.5, 0.95], [0.75, 1.5], [0.7, 1.55], [0, 1.2]], 10, 'trophyPad', 1.1);
    glows.push([cx, b.max[1] + 4, cz, 1.6]);
  }

  // V-13: the camp teleport — a round ice platform with a ring of runes and a cold light over it.
  for (const b of level.boxes) {
    if (b.kind !== 'campTeleport') continue;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    const r = ((b.max[0] - b.min[0]) / 2) * 1.42;
    const hgt = b.max[1] - b.min[1];
    k.lathe(cx, b.min[1], cz, [[0, 0], [r, 0], [r, hgt - 0.1], [r - 0.3, hgt], [0, hgt]], 12, 'ice', 1.05);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.turned(cx + Math.cos(a) * r * 0.72, b.max[1] + 0.03, cz + Math.sin(a) * r * 0.72, 0.9, 0.06, 0.35, 0, -a, 0, 'portal', 1.1);
    }
    for (const a of [0.4, 2.5, 4.6]) k.post(cx + Math.cos(a) * (r - 0.4), b.max[1], cz + Math.sin(a) * (r - 0.4), 0.28, 0.12, 1.6, 5, 'portal', 1.05);
    coldGlows.push([cx, b.max[1] + 1.2, cz, 2.4]);
  }

  // Niches: V-04 the canopies, V-06 the rock grottos, V-11 the caves in the edge drifts.
  level.niches.forEach((n, i) => {
    if (n.kind === 'island' && n.canopy) canopy(k, level, n, i, cut, hidden, glows);
    else if (n.kind === 'island') grotto(k, level, n, i, cut, coldGlows);
    else if (n.kind !== 'ledge') drift(k, level, n, i, cut);
  });

  for (const p of level.points) {
    if (p.type === 'treadmill') belt(k, p, stripes);
    else if (p.type === 'eggStand') {
      // V-13: the egg stand — an ice pedestal with a trim.
      k.lathe(p.x, p.y, p.z, [[0, 0], [1.05, 0], [1.05, 0.2], [0.7, 0.35], [0.6, 1.0], [0.95, 1.1], [0.95, 1.25], [0, 1.25]], 8, 'eggStand', 1.04);
      k.lathe(p.x, p.y + 1.05, p.z, [[0.98, 0], [1.0, 0.05], [1.0, 0.22], [0.98, 0.25]], 8, 'trophyPad');
    } else if (p.type === 'chest') {
      // V-05: off the run line — beside the portal on a snow pedestal with a glow; the coins come with the summit.
      const portal = level.points.find((q) => q.type === 'portal');
      const cx = (portal?.x ?? p.x) + CHEST_SIDE;
      const cz = (portal?.z ?? p.z) - CHEST_BEFORE;
      const cy = level.floorAt(cx, cz);
      const y = Number.isFinite(cy) ? cy : p.y;
      k.lathe(cx, y, cz, [[0, 0], [2.6, 0], [2.4, 0.5], [1.9, 0.9], [0, 0.95]], 9, 'track');
      if (!k.model('chest', cx, y + 0.85, cz, -Math.PI / 2 + 0.35, CHEST_SCALE, CHEST_SCALE, CHEST_SCALE)) k.box(cx - 1.4, y + 0.85, cz - 1, cx + 1.4, y + 2.6, cz + 1, 'chest');
      glows.push([cx, y + 3.4, cz, 3]);
      chest = [cx, y + 3.4, cz];
    } else if (p.type === 'decor') decorPiece(k, level, p, glows);
  }

  // V-13: the back edge of the camp — a log fence across the slope and pines at its ends, no edge into white nothing.
  const camp = level.safeZones[0];
  if (camp && camp[0] <= 0.5 && level.points.some((p) => p.type === 'eggStand')) {
    const half = level.halfAt(1);
    const z = camp[0] + 0.6;
    for (let x = -half + 1; x <= half - 1 + 1e-6; x += 4) k.post(x, 0, z, 0.22, 0.2, 1.7, 5, 'pole');
    for (const y of [0.65, 1.3]) k.box(-half + 0.8, y, z - 0.12, half - 0.8, y + 0.2, z + 0.12, 'pole', 0.95);
    for (const [x, id] of [[-half + 4, 'pineA'], [half - 4, 'pineC'], [-half + 9, 'pineB'], [half - 10, 'pineA']] as const) k.model(id, x, 0, z - 2.5, x, 6, 6.5, 6);
  }

  return { pieces: k.pieces, cut, glows, coldGlows, stripes, hidden, chest };
}

/** V-03: a treadmill — dark rubber between two rails, rollers at the ends, chevrons up the slope on the top plate; the
 * white stripes (one InstancedMesh a mountain) slide down it at the speed of its multiplier. */
function belt(k: Kit, p: LevelPoint, stripes: PropStripe[]): void {
  const len = (p['length'] as number | undefined) ?? 10;
  const wid = (p['width'] as number | undefined) ?? 6;
  const mult = (p['mult'] as number | undefined) ?? 1;
  const x0 = p.x - wid / 2;
  const x1 = p.x + wid / 2;
  const z0 = p.z - len / 2;
  const z1 = p.z + len / 2;
  const y = p.y;
  k.box(x0, y + 0.02, z0, x1, y + BELT_TOP, z1, 'treadmillBelt', 1, 'pit');
  for (const x of [x0 - RAIL_W, x1]) k.box(x, y, z0 - 0.4, x + RAIL_W, y + RAIL_H, z1 + 0.4, 'treadmillFrame', 1, 'rock');
  for (const z of [z0 - 0.05, z1 + 0.05]) k.beamX(x0, x1, y + ROLLER_R * 0.5, z, ROLLER_R, 8, 'treadmillFrame', 1.2);
  // The chevrons «^» up the slope on the belt's head plate.
  const arm = Math.min(1.2, wid * 0.22);
  for (const dz of [0.5, 1.4])
    for (const side of [-1, 1]) k.turned(p.x + (side * arm) / 2.6, y + BELT_TOP + 0.01, z1 - 0.3 - dz * Math.min(1, len / 10) - 0.6, 0.22, 0.03, arm, 0, (side * Math.PI) / 4, 0, 'wayArrow', 1.1, 'treadmill');
  const speed = Math.min(STRIPE_MAX, STRIPE_SPEED + STRIPE_PER_DOUBLE * Math.log2(Math.max(1, mult)));
  const usable = len - 3.2;
  for (let s = 0; s * STRIPE_STEP < usable; s++) stripes.push({ x: p.x, y: y + BELT_TOP + 0.015, z0, len: usable, w: wid - 0.15, phase: s * STRIPE_STEP, speed });
}

/** V-04: a canopy of a finish belt — four log posts to the snow, beams along under a gable roof of boards with a snow cap
 * and an overhang, icicles along the eaves; the flat collider of the roof stays, not drawn. */
function canopy(k: Kit, level: LevelData, n: LevelNiche, i: number, cut: PropCut[], hidden: Set<LevelBox>, glows: TrackProps['glows']): void {
  const roof = level.boxes.find((b) => b.kind === 'islandRoof' && b.min[1] >= n.box.max[1] - 0.01 && b.min[0] <= n.box.min[0] + 1e-6 && b.max[0] >= n.box.max[0] - 1e-6 && b.min[2] < n.box.max[2] && b.max[2] > n.box.min[2]);
  if (!roof) return;
  hidden.add(roof);
  const y = n.y;
  const top = roof.min[1];
  const a = (roof.max[0] - roof.min[0]) / 2;
  const cx = (roof.min[0] + roof.max[0]) / 2;
  const z0 = roof.min[2];
  const z1 = roof.max[2];
  const inset = 0.6;
  for (const sx of [-1, 1])
    for (const z of [z0 + inset, z1 - inset]) {
      const x = cx + sx * (a - inset);
      const g = level.floorAt(x, z);
      const yb = Number.isFinite(g) ? Math.min(g, y) : y;
      k.post(x, yb - 0.3, z, 0.42, 0.36, top - yb + 0.3, 7, 'pole');
    }
  for (const sx of [-1, 1]) k.box(cx + sx * (a - inset) - 0.35, top - 0.7, z0, cx + sx * (a - inset) + 0.35, top, z1, 'pole', 0.92);
  for (const z of [z0 + inset, z1 - inset]) k.box(cx - a, top - 0.55, z - 0.3, cx + a, top, z + 0.3, 'pole', 0.85);
  // The gable: two boards from the eaves (a little past the posts) up to the ridge along the run, a snow cap on each.
  const over = 1.2;
  const run = a + over;
  const rise = Math.min(4, a * 0.45);
  const tilt = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise);
  for (const sx of [-1, 1]) {
    const mx = cx + (sx * run) / 2;
    const my = top + rise / 2 + 0.3;
    cut.push({ niche: i, part: 'roof', box: box(mx - slope / 2, my - 0.25, z0 - over, mx + slope / 2, my + 0.25, z1 + over, 'roofPlank'), tilt: sx * -tilt });
    cut.push({ niche: i, part: 'roof', box: box(mx - slope / 2 + 0.1, my + 0.25, z0 - over + 0.15, mx + slope / 2 - 0.3, my + 0.6, z1 + over - 0.15, 'track'), tilt: sx * -tilt });
    // Icicles under the eaves.
    for (let z = z0 - over + 0.8; z < z1 + over - 0.5; z += 1.7) k.icicle(cx + sx * (run - 0.3), top + 0.2, z, 0.18, 0.7 + ((z * 13) % 1) * 0.6);
  }
  // A ridge beam and the lamp at the front.
  cut.push({ niche: i, part: 'roof', box: box(cx - 0.35, top + rise + 0.2, z0 - over, cx + 0.35, top + rise + 0.75, z1 + over, 'pole') });
  k.post(cx, top - 1.4, z0 + inset, 0.25, 0.3, 0.7, 6, 'portalLight', 1.1);
  glows.push([cx, top - 1, z0 + inset, 0.9]);
}

/** V-06: a grotto in a rock — rock blocks of different heights round its walls, a snow cap over the roof, a stepped arch
 * at the mouth with icicles, a cold light inside; the walls, the roof and the shelter volume stay. */
function grotto(k: Kit, level: LevelData, n: LevelNiche, i: number, cut: PropCut[], cold: TrackProps['coldGlows']): void {
  const x0 = n.box.min[0] - NICHE_WALL;
  const x1 = n.box.max[0] + NICHE_WALL;
  const z0 = n.box.min[2];
  const z1 = n.box.max[2] + NICHE_WALL;
  const y = n.y;
  const top = y + NICHE_HEIGHT + NICHE_WALL;
  const len = z1 - z0;
  // Side masses: a Kenney rock a side over the wall, as tall as the roof and a bit more, a smaller one on the back corner
  // — the grotto is a cave in a rock (the rock of the giant's zone), not a frame of three slabs.
  const big = k.size('rocksL');
  const mid = k.size('rocksM');
  for (const [xc, sgn] of [[x0 + 0.2, -1], [x1 - 0.2, 1]] as const) {
    if (!big || !k.model('rocksL', xc + sgn * 0.9, y - 0.4, z0 + len * 0.5, sgn > 0 ? 0 : Math.PI, 4.2 / big[0], (top + 1.6 - y) / big[1], (len + 1.6) / big[2])) {
      k.box(xc + (sgn < 0 ? -1.6 : 0), y - 0.3, z0 + 0.4, xc + (sgn < 0 ? 0 : 1.6), top + 1.4, z1 + 0.6, 'grottoRock', 0.92, 'rock');
      continue;
    }
    if (mid) k.model('rocksM', xc + sgn * 1.4, top - 1.2, z1 - 0.6, sgn * 0.8, 3.4 / mid[0], 3.2 / mid[1], 3.4 / mid[2]);
  }
  // The roof: a rock slab and a snow cap over it (hidden with the roof in the wide frame).
  cut.push({ niche: i, part: 'roof', box: box(x0 - 0.4, top, z0 - 0.3, x1 + 0.4, top + 0.9, z1 + 0.3, 'grottoRock') });
  cut.push({ niche: i, part: 'roof', box: box(x0 - 0.1, top + 0.9, z0, x1 + 0.1, top + 1.4, z1, 'track') });
  // The stepped arch: two steps in each top corner of the mouth and a lintel over it, icicles under the lintel.
  const ma = n.box.min[0];
  const mb = n.box.max[0];
  k.box(x0 - 0.3, top - 1.3, z0 - 0.6, x1 + 0.3, top, z0 + 0.3, 'grottoRock', 1.05, 'rock');
  for (const [xs, dir] of [[ma, 1], [mb, -1]] as const) {
    k.box(Math.min(xs, xs + dir * 1.4), top - 2.3, z0 - 0.5, Math.max(xs, xs + dir * 1.4), top - 1.3, z0 + 0.25, 'grottoRock', 0.96, 'rock');
    k.box(Math.min(xs, xs + dir * 0.7), top - 3.1, z0 - 0.45, Math.max(xs, xs + dir * 0.7), top - 2.3, z0 + 0.2, 'grottoRock', 0.92, 'rock');
  }
  for (let x = ma + 2; x < mb - 1.6; x += 1.6) k.icicle(x, top - 1.3, z0 - 0.15, 0.2, 0.8 + ((x * 7.3) % 1) * 0.7);
  cold.push([(ma + mb) / 2, y + 3, (n.box.min[2] + n.box.max[2]) / 2, 3.2]);
}

/** V-11: a cave of the field edge — a snow drift over its roof, icicles on the lintel, a dark inside, an ice trim of the
 * mouth (the mouth faces the field). */
function drift(k: Kit, level: LevelData, n: LevelNiche, i: number, cut: PropCut[]): void {
  const lo = n.box.min[0];
  const hi = n.box.max[0];
  const zA = n.box.min[2];
  const zB = n.box.max[2];
  const y = n.y;
  const top = y + NICHE_HEIGHT;
  const w = NICHE_WALL;
  // Snow over the roof, two layers narrowing up (the cave becomes a drift).
  cut.push({ niche: i, part: 'roof', box: box(lo - 0.6, top + 1, zA - w - 0.6, hi + 0.6, top + 1.9, zB + w + 0.6, 'track') });
  cut.push({ niche: i, part: 'roof', box: box(lo + 0.6, top + 1.9, zA - w + 0.6, hi - 0.6, top + 2.6, zB + w - 0.6, 'track') });
  // The dark inside: the inner face of the back wall.
  const left = n.side === 'left';
  const back = left ? lo : hi;
  cut.push({ niche: i, part: 'back', box: box(left ? back : back - 0.12, y, zA, left ? back + 0.12 : back, top - 0.2, zB, 'caveInside') });
  // The ice trim of the mouth (at the field edge) and icicles on its lintel.
  const mouth = left ? hi : lo;
  const xa = left ? mouth - 0.5 : mouth;
  const xb = left ? mouth : mouth + 0.5;
  for (const z of [zA - 0.25, zB - 0.35]) k.box(xa - 0.1, y, z, xb + 0.1, top, z + 0.6, 'ice', 1.1);
  k.box(xa - 0.1, top - 0.6, zA - 0.25, xb + 0.1, top + 0.2, zB + 0.25, 'ice', 1.1);
  for (let z = zA + 1; z < zB - 0.5; z += 1.5) k.icicle((xa + xb) / 2, top - 0.6, z, 0.17, 0.6 + ((z * 5.7) % 1) * 0.6);
  // Drifts heaped at the two front corners of the mouth, over the border (beside the roof: the wide frame looks past them).
  const pile = k.size('pile');
  if (pile) for (const z of [zA - w - 1.4, zB + w + 1.4]) k.model('pile', left ? hi - 1.2 : lo + 1.2, y + 0.2, z, z * 0.7, 5 / pile[0], 2.4 / pile[1], 4.2 / pile[2]);
  void level;
}

/** V-08: the decor kinds of points — Kenney models for trees, pines, cairns, tents and lanterns; rock spires, crystals
 * and ice falls turned with snow caps; the camp arrows as chevrons. */
function decorPiece(k: Kit, level: LevelData, p: LevelPoint, glows: TrackProps['glows']): void {
  const kind = p['kind'] as string;
  const size = typeof p['size'] === 'number' ? (p['size'] as number) : 1;
  const yaw = (Math.abs(p.x * 3.1 + p.z * 1.7) % 6.28);
  switch (kind) {
    case 'tree':
      k.model('pineB', p.x, p.y, p.z, yaw, 6.5, 6.5, 6.5) || k.post(p.x, p.y, p.z, 1.8, 0, 6, 6, 'tree');
      break;
    case 'pine': {
      const ids = ['pineA', 'pineB', 'pineC'];
      k.model(ids[Math.floor(Math.abs(p.z)) % 3]!, p.x, p.y, p.z, yaw, 7 * size, 7 * size, 7 * size) || k.post(p.x, p.y, p.z, 1.5 * size, 0, 6.8 * size, 6, 'tree');
      break;
    }
    case 'cairn': {
      // Stones of Kenney with a small flag on top.
      const s = size;
      k.model('rocksM', p.x, p.y, p.z, yaw, 2.6 * s, 2.2 * s, 2.6 * s) || k.box(p.x - s, p.y, p.z - s, p.x + s, p.y + 1.6 * s, p.z + s, 'rock');
      k.post(p.x, p.y + 1.4 * s, p.z, 0.08 * s, 0.08 * s, 2 * s, 5, 'pole');
      k.box(p.x + 0.08 * s, p.y + 2.6 * s, p.z - 0.04 * s, p.x + 0.95 * s, p.y + 3.3 * s, p.z + 0.04 * s, 'markFlag', 1, 'tent');
      break;
    }
    case 'spire': {
      // A rock spire turned in 6 faces, a snow cap on its shoulder and its tip.
      const s = size;
      k.lathe(p.x, p.y, p.z, [[0, 0], [1.6 * s, 0], [1.3 * s, 2 * s], [0.95 * s, 2.4 * s], [0.75 * s, 4.6 * s], [0.4 * s, 6 * s], [0, 6.6 * s]], 6, 'rock');
      k.lathe(p.x, p.y + 2 * s, p.z, [[1.38 * s, 0], [1.42 * s, 0.1], [1.0 * s, 0.6 * s], [0, 0.65 * s]], 6, 'track');
      k.lathe(p.x, p.y + 5.6 * s, p.z, [[0.5 * s, 0], [0.55 * s, 0.1], [0, 1.1 * s]], 6, 'track');
      break;
    }
    case 'crystal': {
      // Ice crystals: six-sided columns with points, leaning out of a snowy rock.
      const s = size;
      k.lathe(p.x, p.y, p.z, [[0, 0], [1.7 * s, 0], [1.4 * s, 0.5 * s], [0, 0.6 * s]], 7, 'rock');
      for (const [dx, dz, h, lean, r] of [[0, 0, 4.4, 0, 0.55], [0.75, 0.2, 2.8, -0.35, 0.4], [-0.8, -0.3, 2.2, 0.4, 0.38]] as const) {
        const g = new LatheGeometry([new Vector2(0, 0), new Vector2(r * s, 0), new Vector2(r * s, h * 0.78 * s), new Vector2(0, h * s)], 6);
        g.applyMatrix4(new Matrix4().makeRotationZ(lean));
        g.translate(p.x + dx * s, p.y + 0.2 * s, p.z + dz * s);
        k.shape(p.z, g, 'ice', 1.06);
      }
      break;
    }
    case 'icefall': {
      // A frozen fall: a rock ledge, ice columns of a few heights down its face, a snow cap on the ledge.
      const s = size;
      k.box(p.x - 2.2 * s, p.y, p.z - 1.2 * s, p.x + 2.2 * s, p.y + 6.4 * s, p.z + 0.2 * s, 'rock', 0.95);
      k.box(p.x - 2.35 * s, p.y + 6.4 * s, p.z - 1.3 * s, p.x + 2.35 * s, p.y + 6.9 * s, p.z + 0.3 * s, 'track');
      for (const [dx, h] of [[-1.5, 5.2], [-0.6, 6.4], [0.4, 4.6], [1.4, 5.8]] as const) k.lathe(p.x + dx * s, p.y + (6.4 - h) * s, p.z + 0.55 * s, [[0, 0], [0.32 * s, 0.6 * s], [0.42 * s, h * s], [0, h * s]], 5, 'ice', 1.05);
      k.lathe(p.x, p.y, p.z + 0.8 * s, [[0, 0], [2.6 * s, 0], [1.8 * s, 0.5 * s], [0, 0.6 * s]], 7, 'ice', 1.1);
      break;
    }
    case 'tent':
      k.model('tent', p.x, p.y, p.z, yaw, 14, 14, 14) || k.box(p.x - 2.5, p.y, p.z - 2.5, p.x + 2.5, p.y + 3, p.z + 2.5, 'tent');
      break;
    case 'lantern':
      if (k.model('lantern', p.x, p.y, p.z, 0, 3.4, 3.4, 3.4)) glows.push([p.x, p.y + 1.42 * 3.4, p.z, 0.32 * 3.4]);
      break;
    case 'arrow': {
      // A chevron «^» up the slope in the way-mark colour.
      for (const side of [-1, 1]) k.turned(p.x + side * 0.55, p.y + 0.04, p.z, 0.4, 0.05, 1.7, 0, (side * Math.PI) / 4, 0, 'wayArrow', 1, 'arrow');
      break;
    }
  }
  void level;
}

/** A plain box of the cut parts. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: string): LevelBox {
  return { min: [x0, y0, z0], max: [x1, y1, z1], material, kind: 'prop', solid: false };
}

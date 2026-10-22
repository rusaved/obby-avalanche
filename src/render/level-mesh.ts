// What: Level meshes: boxes and ramps merged per 120-unit chunk (per section on the open slope) with baked vertex colours; gates, gifts, fun parts and cave walls as InstancedMeshes; gate signs.
// Called by: main.ts; app/banner-signs.ts, fun-view.ts, handles.ts, wave-view.ts.
// Keep: Draw-call budget (chunks plus a few instanced meshes); colours only from theme.json; instance indices follow LevelData order (gates, points, fun.pads).

/**
 * Level meshes (docs/02-tech.md 9.1): static boxes and ramps merged per 120-unit chunk with baked vertex colours
 * (one Lambert material) — on the open slope one chunk a section, the camp and the summit straight (docs/01-gdd.md 17.10), gates and gifts as InstancedMeshes, gate numbers from the digit atlas. Grey/flat at M1,
 * themed details at M5. The back walls and roofs of the caves are one InstancedMesh of their own: the wide frame of an
 * avalanche (PR-07) looks into its cave from above the back wall, the roof (or the back wall) is not drawn meanwhile.
 * Trampolines and ice slides (PR-04) are one InstancedMesh more.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelBox, LevelData, LevelPrism, LevelRamp } from '../level/types.ts';
import { CAMERA_THROUGH, PORTAL_WIDTH, prismTriangles } from '../level/builder.ts';
import { gateSlab, levelLips, ridgePartBox, ridgeParts as ridgePartsOf } from '../level/surface-lines.ts';
import { createWayMarks, PORTAL_HEIGHT, type WayMarks } from './way-marks.ts';
import type { ThemeJson } from '../content/types.ts';
import { createDigitLabels, type DigitLabels } from './digits.ts';
import { createWordLabels } from './word-label.ts';
import { formatNumber } from '../ui/format.ts';
import { GIFT_HALF, GIFT_HEIGHT } from '../sim/gifts.ts';

export const CHUNK_LENGTH = 120;
/** Gate sign: glyph size, plaque width at least and its margin around the text (world units). */
const SIGN_TEXT = 2.2;
const SIGN_MIN_WIDTH = 6;
const SIGN_PAD = 2;
/** Ridge of the open slope (docs/01-gdd.md 17.3): its number in glyphs this tall, read from the ridge below; the
 * plaque height; the crest over the carniz is see-through (its plugs and crest — level/surface-lines.ts). */
const RIDGE_TEXT = 5;
const CHEST_GIFT_SCALE = 1.8;
const RIDGE_PLAQUE = 6.5;
const RIDGE_CREST_OPACITY = 0.22;
/** MU-03 (l2-gate): the stage sign — the word this share of the digits tall and this far over the centre, the number
 * this far under it, the plaque this many digit heights tall. */
const STAGE_WORD = 0.42;
const STAGE_WORD_UP = 0.62;
const STAGE_NUM_DOWN = 0.18;
const STAGE_PLAQUE = 1.7;
/** Round of fixes MU (staff 19.10, l2-gate: the sign stood over the run line and showed through the stage strip and the
 * slot): a smaller sign (this share of the ridge digits) on a low post right of the middle pass on the screen (−X) —
 * this far off the pass, its bottom this high over the ground; the post this thick. The phone camera puts all the slope
 * farther than ~12 units into the top band of the HUD (strip, slot), so the sign reads near the ridge, where the hero
 * stops, and hides under the HUD further off (docs/07-mobile-ui.md, rule 19); the slot plaque carries the number. */
const STAGE_SIGN_K = 0.35;
const STAGE_SIDE_GAP = 5.5;
const STAGE_POST = 0.6;
const STAGE_POST_W = 0.3;
/** The glyph height of a gate's number: a ridge's own from the data (SP-04: larger on the field), else the defaults. */
function signText(g: LevelData['gates'][number]): number {
  return g.kind === 'ridge' ? (g.digits ?? RIDGE_TEXT) : SIGN_TEXT;
}
/** Fun parts (docs/01-gdd.md 16.4): plate and ribbon thickness, the pattern bars, chevrons a slide, the plate's spring. */
const PAD_THICK = 0.25;
const SLIDE_THICK = 0.1;
const MARK_THICK = 0.04;
const MARK_WIDTH = 0.22;
const CHEVRONS = 4;
const PAD_SPRING_SEC = 0.45;
const PAD_SPRING_LIFT = 0.9;

export interface LevelMeshes {
  group: Group;
  chunks: Mesh[];
  gates: InstancedMesh;
  signs: InstancedMesh;
  digits: DigitLabels;
  /** The portal light and the arrows on the snow of the open slope (docs/01-gdd.md 19.8). */
  wayMarks: WayMarks;
  /** Scale a gate slab (1 = closed, 0 = gone); M2 melts gates with this. */
  setGateOpen(index: number, openness: number): void;
  /** How far gate `index` has melted (0 — whole, 1 — gone; tests). */
  gateOpenness(index: number): number;
  /** Sign text («15/20» while closed, the requirement when open) and colour by state (docs/01-gdd.md 3.3). */
  setGateSign(index: number, text: string, open: boolean): void;
  /** What a sign currently shows (test API). */
  gateSign(index: number): { text: string; open: boolean };
  /** The sign plaque of a gate as a box (centre, size; world units) and hiding it (docs/01-gdd.md 16.7: the avalanche
   * banner is never under a sign — a sign under the banner is not drawn while the banner shows). */
  signBox(index: number): { center: [number, number, number]; size: [number, number, number] };
  setSignHidden(index: number, hidden: boolean): void;
  signHidden(index: number): boolean;
  /** MU round of fixes 2 (staff: the board in perspective, 5 px words): false — the stage ridge signs keep only their
   * post, the board is a plaque of the phone HUD hung at `signAnchor` (the post top; null — no stage board there). */
  setStageBoards(on: boolean): void;
  signAnchor(index: number): [number, number, number] | null;
  /** These parts of cave `niche` are not drawn (−1 or no parts — all drawn); the boxes of the hidden ones (test API). */
  setCaveCut(niche: number, parts: readonly CavePart[]): void;
  cutBoxes(): Array<{ min: readonly number[]; max: readonly number[] }>;
  /** Gifts of the mountain in `level.points` order (M2-04). */
  gifts: InstancedMesh;
  /** Trampolines and ice slides (docs/01-gdd.md 16.4): one InstancedMesh; a launched plate (`fun.pads` order) springs up. */
  fun: InstancedMesh;
  pressPad(index: number, timeSec: number): void;
  /** Every frame: the springing plates. */
  update(timeSec: number): void;
  setGiftShown(index: number, shown: boolean): void;
  giftShown(index: number): boolean;
  /** RL-09 (docs/01-gdd.md 21.9): the tall walls (builder CAMERA_THROUGH), drawn apart; a faded one see-through at `fade`. */
  seeThrough: readonly LevelBox[];
  setSeeThrough(index: number, faded: boolean): void;
  seeFaded(index: number): boolean;
  cullByDistance(z: number, far: number): void;
  dispose(): void;
}

/** Parts of a cave the wide avalanche frame can look through (src/level/builder.ts: the far wall and the roof). */
export type CavePart = 'back' | 'roof';

function materialColor(theme: ThemeJson, key: string): Color {
  const m = theme.materials[key];
  return new Color(m ? m.color : '#cccccc');
}

function colorGeometry(geo: BufferGeometry, color: Color, shadeBottom = 0.78, shadeSide = 0.9): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    const f = ny > 0.5 ? 1 : ny < -0.5 ? shadeBottom : shadeSide;
    colors[i * 3] = color.r * f;
    colors[i * 3 + 1] = color.g * f;
    colors[i * 3 + 2] = color.b * f;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
}

function boxGeometry(b: LevelBox, theme: ThemeJson): BufferGeometry {
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  const d = b.max[2] - b.min[2];
  const geo = new BoxGeometry(w, h, d).toNonIndexed();
  geo.translate(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
  colorGeometry(geo, materialColor(theme, b.material));
  return geo;
}

/** SD-09: the dots along a catapult strip this far apart. */
const STRIP_DOT_STEP = 6;

function rampGeometry(r: LevelRamp, theme: ThemeJson): BufferGeometry {
  const { x0, x1, z0, z1, y0, y1, thickness: t } = r;
  const v: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    v.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  quad([x0, y0, z0], [x0, y1, z1], [x1, y1, z1], [x1, y0, z0]);
  quad([x0, y0 - t, z0], [x1, y0 - t, z0], [x1, y1 - t, z1], [x0, y1 - t, z1]);
  quad([x0, y1 - t, z1], [x1, y1 - t, z1], [x1, y1, z1], [x0, y1, z1]);
  quad([x0, y0 - t, z0], [x0, y0, z0], [x1, y0, z0], [x1, y0 - t, z0]);
  quad([x1, y0 - t, z0], [x1, y0, z0], [x1, y1, z1], [x1, y1 - t, z1]);
  quad([x0, y0 - t, z0], [x0, y1 - t, z1], [x0, y1, z1], [x0, y0, z0]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(v, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(new Array((v.length / 3) * 2).fill(0), 2));
  geo.computeVertexNormals();
  colorGeometry(geo, materialColor(theme, r.material));
  return geo;
}

/** A solid at an angle (the summit funnel, docs/01-gdd.md 20.2): the collider's own triangles, flat-shaded. */
function prismGeometry(p: LevelPrism, theme: ThemeJson): BufferGeometry {
  const v: number[] = [];
  prismTriangles(v, p);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(v, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(new Array((v.length / 3) * 2).fill(0), 2));
  geo.computeVertexNormals();
  colorGeometry(geo, materialColor(theme, p.material));
  return geo;
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

export function createLevelMeshes(level: LevelData, theme: ThemeJson, suffix: (k: string) => string, fade = 1, levelWord?: string): LevelMeshes {
  const group = new Group();
  group.name = `level-${level.worldId}`;
  const material = new MeshLambertMaterial({ vertexColors: true });

  // Static geometry per chunk along Z: edges every CHUNK_LENGTH, or the edges of the sections of the open slope.
  const edges =
    level.sections.length > 0
      ? [...new Set([0, ...level.sections.flatMap((s) => [s.z0, s.z1]), level.length])].sort((a, b) => a - b)
      : Array.from({ length: Math.ceil(level.length / CHUNK_LENGTH) + 1 }, (_, i) => Math.min(level.length, i * CHUNK_LENGTH));
  const chunkCount = edges.length - 1;
  const buckets: BufferGeometry[][] = Array.from({ length: chunkCount }, () => []);
  const bucketOf = (z: number): BufferGeometry[] => {
    let i = 0;
    while (i < chunkCount - 1 && z >= edges[i + 1]!) i++;
    return buckets[i]!;
  };
  // The back wall of a cave is a cave wall outside the cave box on its far side, the roof lies over it (src/level/builder.ts).
  const partOf = (b: LevelBox): { niche: number; part: CavePart } | null => {
    // A grotto in a rock (SP-04): its roof over it, its back wall past its far (uphill) end; the side walls stay drawn.
    if (b.kind === 'islandRoof' || b.kind === 'islandWall') {
      const roof = b.kind === 'islandRoof';
      const niche = level.niches.findIndex(
        (n) => n.kind === 'island' && b.min[0] < n.box.max[0] && b.max[0] > n.box.min[0] && (roof ? b.min[2] < n.box.max[2] && b.max[2] > n.box.min[2] : b.min[2] >= n.box.max[2] - 1e-6 && b.min[2] <= n.box.max[2] + 1e-6),
      );
      return niche >= 0 ? { niche, part: roof ? 'roof' : 'back' } : null;
    }
    if (b.kind !== 'nicheWall' && b.kind !== 'nicheRoof') return null;
    const niche = level.niches.findIndex(
      (n) =>
        b.min[2] < n.box.max[2] &&
        b.max[2] > n.box.min[2] &&
        (b.kind === 'nicheRoof' ? b.min[0] < n.box.max[0] && b.max[0] > n.box.min[0] : n.side === 'left' ? b.max[0] <= n.box.min[0] + 1e-6 : b.min[0] >= n.box.max[0] - 1e-6),
    );
    return niche >= 0 ? { niche, part: b.kind === 'nicheRoof' ? 'roof' : 'back' } : null;
  };
  const cutParts: Array<{ niche: number; part: CavePart; box: LevelBox }> = [];
  // RL-09: with `fade` < 1 the tall walls are drawn apart, solid or see-through (the camera passes them, builder cameraThrough).
  const throughKinds = level.cameraThrough ?? CAMERA_THROUGH;
  const seeThrough = fade < 1 ? level.boxes.filter((b) => throughKinds.has(b.kind)) : [];
  for (const b of level.boxes) {
    if (fade < 1 && throughKinds.has(b.kind)) continue;
    const cut = partOf(b);
    if (cut) cutParts.push({ ...cut, box: b });
    else bucketOf((b.min[2] + b.max[2]) / 2).push(boxGeometry(b, theme));
  }
  // SD-07 (docs/01-gdd.md 23.7): a coloured lip on every floor edge over a drop (a pit, a gap, the end of a plate or a
  // bridge) — white over white no more; only with theme.materials.edge, merged into the chunk (no extra draw call).
  // The lips themselves — level/surface-lines.ts (the validator checks the same boxes lie on the surface, MU-13).
  if (theme.materials['edge']) for (const g of levelLips(level)) bucketOf((g.min[2] + g.max[2]) / 2).push(boxGeometry(g, theme));
  for (const r of level.ramps) bucketOf((r.z0 + r.z1) / 2).push(rampGeometry(r, theme));
  for (const p of level.prisms ?? []) bucketOf(p.pts.reduce((z, q) => z + q[1], 0) / p.pts.length).push(prismGeometry(p, theme));
  // Checkpoint flags and simple decor as boxes (grey slope at M1).
  for (const c of level.checkpoints) {
    const e = level.halfAt(c.z);
    const pole: LevelBox = { min: [-e + 1.5, c.y, c.z - 0.15], max: [-e + 1.8, c.y + 4, c.z + 0.15], material: 'pole', kind: 'flagPole', solid: false };
    const flag: LevelBox = { min: [-e + 1.8, c.y + 3, c.z - 0.1], max: [-e + 3.6, c.y + 4, c.z + 0.1], material: 'flag', kind: 'flag', solid: false };
    const g1 = boxGeometry(pole, theme);
    const g2 = boxGeometry(flag, theme);
    colorGeometry(g2, new Color(theme.rarity[c.rarity] ?? '#ffffff'));
    bucketOf(c.z).push(g1, g2);
  }
  for (const p of level.points) {
    if (p.type === 'decor' && p['kind'] === 'tree') {
      const trunk: LevelBox = { min: [p.x - 0.4, p.y, p.z - 0.4], max: [p.x + 0.4, p.y + 2, p.z + 0.4], material: 'trunk', kind: 'decor', solid: false };
      const crown: LevelBox = { min: [p.x - 1.8, p.y + 1.5, p.z - 1.8], max: [p.x + 1.8, p.y + 6, p.z + 1.8], material: 'tree', kind: 'decor', solid: false };
      bucketOf(p.z).push(boxGeometry(trunk, theme), boxGeometry(crown, theme));
    } else if (p.type === 'decor' && p['kind'] === 'pine') {
      // ST-04 (mountain 2): a pine — a trunk and three tiers narrowing up; `size` — the landmark by the summit.
      const k = typeof p['size'] === 'number' ? (p['size'] as number) : 1;
      const parts: LevelBox[] = [{ min: [p.x - 0.35 * k, p.y, p.z - 0.35 * k], max: [p.x + 0.35 * k, p.y + 2.2 * k, p.z + 0.35 * k], material: 'trunk', kind: 'decor', solid: false }];
      for (const [w, y0, y1] of [[1.5, 1.4, 3.4], [1.1, 3.1, 5.1], [0.65, 4.8, 6.8]] as const)
        parts.push({ min: [p.x - w * k, p.y + y0 * k, p.z - w * k], max: [p.x + w * k, p.y + y1 * k, p.z + w * k], material: 'tree', kind: 'decor', solid: false });
      bucketOf(p.z).push(...parts.map((b) => boxGeometry(b, theme)));
    } else if (p.type === 'decor' && p['kind'] === 'cairn') {
      // ST-04 (mountain 1): a cairn of stones with a small flag on top; `size` — the landmark by the summit.
      const k = typeof p['size'] === 'number' ? (p['size'] as number) : 1;
      const parts: LevelBox[] = [];
      for (const [w, y0, y1] of [[1.1, 0, 0.8], [0.8, 0.8, 1.5], [0.5, 1.5, 2.1]] as const)
        parts.push({ min: [p.x - w * k, p.y + y0 * k, p.z - w * k], max: [p.x + w * k, p.y + y1 * k, p.z + w * k], material: 'rock', kind: 'decor', solid: false });
      parts.push({ min: [p.x - 0.08 * k, p.y + 2.1 * k, p.z - 0.08 * k], max: [p.x + 0.08 * k, p.y + 3.4 * k, p.z + 0.08 * k], material: 'pole', kind: 'decor', solid: false });
      parts.push({ min: [p.x + 0.08 * k, p.y + 2.8 * k, p.z - 0.04 * k], max: [p.x + 0.9 * k, p.y + 3.35 * k, p.z + 0.04 * k], material: 'tent', kind: 'decor', solid: false });
      bucketOf(p.z).push(...parts.map((b) => boxGeometry(b, theme)));
    } else if (p.type === 'decor' && p['kind'] === 'tent') {
      const tent: LevelBox = { min: [p.x - 2.5, p.y, p.z - 2.5], max: [p.x + 2.5, p.y + 3, p.z + 2.5], material: 'tent', kind: 'decor', solid: false };
      bucketOf(p.z).push(boxGeometry(tent, theme));
    } else if (p.type === 'decor' && p['kind'] === 'lantern') {
      // SP-08 (docs/01a-content.md 19.6): a lantern of the base — a post with a lit box on top.
      const post: LevelBox = { min: [p.x - 0.15, p.y, p.z - 0.15], max: [p.x + 0.15, p.y + 3.2, p.z + 0.15], material: 'pole', kind: 'decor', solid: false };
      const lamp: LevelBox = { min: [p.x - 0.45, p.y + 3.2, p.z - 0.45], max: [p.x + 0.45, p.y + 4.1, p.z + 0.45], material: 'portalLight', kind: 'decor', solid: false };
      bucketOf(p.z).push(boxGeometry(post, theme), boxGeometry(lamp, theme));
    } else if (p.type === 'decor' && p['kind'] === 'flag') {
      // A flag of a base stand: a pole and its cloth in the colour of the tents.
      const pole: LevelBox = { min: [p.x - 0.12, p.y, p.z - 0.12], max: [p.x + 0.12, p.y + 4.5, p.z + 0.12], material: 'pole', kind: 'decor', solid: false };
      const cloth: LevelBox = { min: [p.x + 0.12, p.y + 3.3, p.z - 0.06], max: [p.x + 1.9, p.y + 4.4, p.z + 0.06], material: 'tent', kind: 'decor', solid: false };
      bucketOf(p.z).push(boxGeometry(pole, theme), boxGeometry(cloth, theme));
    } else if (p.type === 'decor' && p['kind'] === 'arrow') {
      const arrow: LevelBox = { min: [p.x - 0.6, p.y + 0.02, p.z - 1.5], max: [p.x + 0.6, p.y + 0.08, p.z + 1.5], material: 'arrow', kind: 'decor', solid: false };
      bucketOf(p.z).push(boxGeometry(arrow, theme));
    } else if (p.type === 'treadmill') {
      const len = (p['length'] as number | undefined) ?? 10;
      const wid = (p['width'] as number | undefined) ?? 6;
      const tm: LevelBox = { min: [p.x - wid / 2, p.y + 0.02, p.z - len / 2], max: [p.x + wid / 2, p.y + 0.12, p.z + len / 2], material: 'treadmill', kind: 'treadmill', solid: false };
      bucketOf(p.z).push(boxGeometry(tm, theme));
    } else if (p.type === 'chest') {
      const ch: LevelBox = { min: [p.x - 2, p.y, p.z - 1.5], max: [p.x + 2, p.y + 2.5, p.z + 1.5], material: 'chest', kind: 'chest', solid: false };
      bucketOf(p.z).push(boxGeometry(ch, theme));
    } else if (p.type === 'portal') {
      // As wide as its data (docs/01-gdd.md 19.8), 1-unit pillars; the light inside it — render/way-marks.ts.
      const hw = (typeof p['width'] === 'number' ? (p['width'] as number) : PORTAL_WIDTH) / 2;
      const l: LevelBox = { min: [p.x - hw, p.y, p.z - 0.5], max: [p.x - hw + 1, p.y + PORTAL_HEIGHT, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      const r: LevelBox = { min: [p.x + hw - 1, p.y, p.z - 0.5], max: [p.x + hw, p.y + PORTAL_HEIGHT, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      const top: LevelBox = { min: [p.x - hw, p.y + PORTAL_HEIGHT - 1, p.z - 0.5], max: [p.x + hw, p.y + PORTAL_HEIGHT, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      bucketOf(p.z).push(boxGeometry(l, theme), boxGeometry(r, theme), boxGeometry(top, theme));
    } else if (p.type === 'eggStand') {
      const st: LevelBox = { min: [p.x - 0.8, p.y, p.z - 0.8], max: [p.x + 0.8, p.y + 1.2, p.z + 0.8], material: 'eggStand', kind: 'eggStand', solid: false };
      bucketOf(p.z).push(boxGeometry(st, theme));
    }
  }
  const chunks: Mesh[] = [];
  buckets.forEach((list, i) => {
    if (list.length === 0) return;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) return;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, material);
    mesh.name = `chunk-${i}`;
    mesh.userData['z0'] = edges[i];
    mesh.userData['z1'] = edges[i + 1];
    group.add(mesh);
    chunks.push(mesh);
  });

  // Cave back walls and roofs: unit boxes with the face shading baked, the material colour per instance.
  const backGeo = new BoxGeometry(1, 1, 1).toNonIndexed();
  colorGeometry(backGeo, new Color(1, 1, 1));
  const backMesh = new InstancedMesh(backGeo, material, Math.max(1, cutParts.length));
  backMesh.count = cutParts.length;
  backMesh.name = 'cave-cut-parts';
  const backDummy = new Object3D();
  const placeBack = (i: number, shown: boolean): void => {
    const w = cutParts[i];
    if (!w) return;
    const b = w.box;
    backDummy.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    backDummy.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]).multiplyScalar(shown ? 1 : 1e-4);
    backDummy.updateMatrix();
    backMesh.setMatrixAt(i, backDummy.matrix);
    backMesh.instanceMatrix.needsUpdate = true;
  };
  cutParts.forEach((w, i) => {
    placeBack(i, true);
    backMesh.setColorAt(i, materialColor(theme, w.box.material));
  });
  if (backMesh.instanceColor) backMesh.instanceColor.needsUpdate = true;
  backMesh.computeBoundingSphere();
  group.add(backMesh);
  const cutHidden = cutParts.map(() => false);

  // The tall walls (RL-09): two InstancedMeshes of unit boxes, solid and see-through; a wall is in one of them.
  const seeMat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: fade, depthWrite: false });
  const seeSolid = new InstancedMesh(backGeo, material, Math.max(1, seeThrough.length));
  const seeFadedMesh = new InstancedMesh(backGeo, seeMat, Math.max(1, seeThrough.length));
  seeSolid.count = seeFadedMesh.count = seeThrough.length;
  seeSolid.name = 'see-through-solid';
  seeFadedMesh.name = 'see-through-faded';
  const faded = seeThrough.map(() => false);
  const placeSee = (i: number): void => {
    const b = seeThrough[i]!;
    backDummy.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    for (const [mesh, on] of [[seeSolid, !faded[i]], [seeFadedMesh, faded[i]]] as const) {
      backDummy.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]).multiplyScalar(on ? 1 : 1e-4);
      backDummy.updateMatrix();
      mesh.setMatrixAt(i, backDummy.matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  seeThrough.forEach((b, i) => {
    placeSee(i);
    seeSolid.setColorAt(i, materialColor(theme, b.material));
    seeFadedMesh.setColorAt(i, materialColor(theme, b.material));
  });
  for (const m of [seeSolid, seeFadedMesh]) {
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.visible = seeThrough.length > 0;
  }
  seeFadedMesh.visible = false;
  seeFadedMesh.renderOrder = 2;
  group.add(seeSolid, seeFadedMesh);

  // Gates: one InstancedMesh of unit boxes scaled to each slab; signs as a second instanced quad set.
  const gateGeo = new BoxGeometry(1, 1, 1);
  const gateMat = new MeshLambertMaterial({ color: materialColor(theme, 'gateClosed') });
  const gates = new InstancedMesh(gateGeo, gateMat, Math.max(1, level.gates.length));
  gates.instanceMatrix.setUsage(DynamicDrawUsage);
  const signGeo = new BoxGeometry(1, 1, 1);
  // White base: the per-instance colour (red closed / green open from theme.json) is the sign colour.
  const signMat = new MeshLambertMaterial({ color: 0xffffff });
  // Round of fixes MU: the instances past the gates are the posts of the stage signs (none — scaled to nothing).
  const signs = new InstancedMesh(signGeo, signMat, Math.max(1, level.gates.length * 2));
  const dummy = new Object3D();
  level.gates.forEach((g, i) => {
    // A ridge is drawn by its plugs and crest below; the giant's line has no slab at all (level/surface-lines.ts gateSlab:
    // MU round 3 — a flattened slab hung as a light-blue line in the air over every rise).
    const b = gateSlab(g);
    if (b) {
      dummy.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      dummy.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    } else {
      dummy.position.set(0, g.y, g.z);
      dummy.scale.set(0, 0, 0);
    }
    dummy.updateMatrix();
    gates.setMatrixAt(i, dummy.matrix);
  });
  gates.instanceMatrix.needsUpdate = true;
  dummy.position.set(0, 0, 0);
  dummy.scale.setScalar(1e-4);
  dummy.updateMatrix();
  level.gates.forEach((_, i) => signs.setMatrixAt(level.gates.length + i, dummy.matrix));
  signs.instanceMatrix.needsUpdate = true;
  group.add(gates, signs);

  // Ridges (docs/01-gdd.md 17.3): ice plugs fill the passages up the step, a see-through crest over the carniz up to the
  // top of the collider (no invisible wall); both melt with the gate. Two draw calls for all ridges of the mountain.
  const ridgeParts = ridgePartsOf(level);
  const crestMat = new MeshLambertMaterial({ color: materialColor(theme, 'gateClosed'), transparent: true, opacity: RIDGE_CREST_OPACITY, depthWrite: false });
  const plugCount = ridgeParts.filter((p) => !p.crest).length;
  const ridgePlugs = new InstancedMesh(gateGeo, gateMat, Math.max(1, plugCount));
  const ridgeCrests = new InstancedMesh(gateGeo, crestMat, Math.max(1, ridgeParts.length - plugCount));
  ridgePlugs.count = plugCount;
  ridgeCrests.count = ridgeParts.length - plugCount;
  const ridgeSlot: number[] = [];
  const melted: number[] = level.gates.map(() => 0);
  const placeRidge = (k: number, openness: number): void => {
    const p = ridgeParts[k]!;
    // MU-13: melted — nothing left (a sliver of the crest hung as a blue line over the passage ramps).
    const b = ridgePartBox(p, openness);
    dummy.position.set(p.x, b ? (b.min[1] + b.max[1]) / 2 : p.y0, p.z);
    dummy.rotation.set(0, 0, 0);
    if (b) dummy.scale.set(p.w, b.max[1] - b.min[1], p.d);
    else dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    (p.crest ? ridgeCrests : ridgePlugs).setMatrixAt(ridgeSlot[k]!, dummy.matrix);
  };
  let plugN = 0;
  let crestN = 0;
  ridgeParts.forEach((p, k) => {
    ridgeSlot[k] = p.crest ? crestN++ : plugN++;
    placeRidge(k, 0);
  });
  ridgePlugs.instanceMatrix.setUsage(DynamicDrawUsage);
  ridgeCrests.instanceMatrix.setUsage(DynamicDrawUsage);
  ridgePlugs.instanceMatrix.needsUpdate = true;
  ridgeCrests.instanceMatrix.needsUpdate = true;
  if (plugCount > 0) group.add(ridgePlugs, ridgeCrests);

  const digits = createDigitLabels(level.gates.length * 10 + 8);
  // Stages pace (docs/01-gdd.md 22.3): «LEVEL NEEDED» over the level of every ridge.
  const words = levelWord && level.stages ? createWordLabels(levelWord, level.gates.length) : null;
  const signState = level.gates.map((g) => ({ text: formatNumber(g.requires, suffix), open: false, hidden: false }));
  let boards = true;
  const signColor = new Color();
  const signOpenColor = materialColor(theme, 'gateSignOpen');
  const signClosedColor = materialColor(theme, 'gateSign');
  // MU-03 (l2-gate): the stage ridge sign is a dark plaque, «LEVEL NEEDED» over the number in gold.
  const stageSign = !!words && !!theme.materials['stageSign'];
  const stageSignColor = materialColor(theme, 'stageSign');
  const stageDigits = theme.materials['stageSignDigits']?.color ?? '#ffffff';
  const stagePostColor = materialColor(theme, 'stageSignPost');
  /** Where the stage sign of gate i stands (centre, size): on its post right of the middle pass. */
  const stagePlace = (i: number): { x: number; y: number; z: number; w: number; h: number } => {
    const g = level.gates[i]!;
    const size = signText(g) * STAGE_SIGN_K;
    const w = Math.max(words!.aspect * size * STAGE_WORD, digits.measure(signState[i]!.text, size)) + SIGN_PAD * 2 * STAGE_SIGN_K;
    const h = size * STAGE_PLAQUE;
    const pass = (g.passes ?? [0]).reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
    return { x: pass - (g.passWidth ?? 0) / 2 - STAGE_SIDE_GAP - w / 2, y: g.y + STAGE_POST + h / 2, z: g.z - (g.box.max[2] - g.box.min[2]) / 2 - 0.3, w, h };
  };
  const placePost = (i: number, on: boolean): void => {
    if (on) {
      const p = stagePlace(i);
      dummy.position.set(p.x, level.gates[i]!.y + STAGE_POST / 2, p.z + 0.4);
      dummy.scale.set(STAGE_POST_W, STAGE_POST, STAGE_POST_W);
    } else dummy.scale.setScalar(1e-4);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    signs.setMatrixAt(level.gates.length + i, dummy.matrix);
    if (on) signs.setColorAt(level.gates.length + i, signColor.copy(stagePostColor));
  };
  const applySign = (i: number): void => {
    const g = level.gates[i];
    const st = signState[i];
    if (!g || !st) return;
    const d = g.box.max[2] - g.box.min[2];
    if (st.hidden) {
      words?.hide(i);
      digits.clear(i);
      if (stageSign) placePost(i, false);
      dummy.position.set(0, g.y + g.signHeight, g.z - d / 2 - 0.3);
      dummy.scale.setScalar(1e-4);
      dummy.updateMatrix();
      signs.setMatrixAt(i, dummy.matrix);
      signs.instanceMatrix.needsUpdate = true;
      return;
    }
    const ridge = g.kind === 'ridge';
    const size = signText(g) * (stageSign && ridge ? STAGE_SIGN_K : 1);
    if (stageSign && ridge) {
      // Two lines on the dark plaque: the word over the number (MU-03), the number in gold.
      const wh = size * STAGE_WORD;
      const p = stagePlace(i);
      if (boards) {
        digits.setLabel(i, st.text, p.x, p.y - size * STAGE_NUM_DOWN, g.z - d / 2 - 0.52, size, stageDigits);
        words!.set(i, p.x, p.y + size * STAGE_WORD_UP, g.z - d / 2 - 0.55, wh);
      } else {
        words!.hide(i);
        digits.clear(i);
      }
      // MU round 3 (A58: a stub of the post peeked under the flat plaque of the phone): no board in the world — no post.
      placePost(i, boards);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      if (boards) dummy.scale.set(p.w, p.h, 0.4);
      else dummy.scale.setScalar(1e-4);
      dummy.updateMatrix();
      signs.setMatrixAt(i, dummy.matrix);
      signs.instanceMatrix.needsUpdate = true;
      signs.setColorAt(i, signColor.copy(stageSignColor));
      if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
      return;
    }
    digits.setLabel(i, st.text, 0, g.y + g.signHeight, g.z - d / 2 - 0.52, size, '#ffffff');
    // One line «LEVEL NEEDED 7»: the word left of the number, as tall as half the digits (LV-12: over the number it stood
    // in the top HUD band on a phone).
    if (words && ridge) {
      const wh = size * 0.5;
      // The camera looks up +Z: +X is the left of the screen.
      words.set(i, digits.measure(st.text, size) / 2 + SIGN_PAD + (words.aspect * wh) / 2, g.y + g.signHeight, g.z - d / 2 - 0.55, wh);
    }
    // The plaque fits the text it shows now, «4,2K/12K» included (playtest M2: the text ran past it).
    dummy.position.set(0, g.y + g.signHeight, g.z - d / 2 - 0.3);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(Math.max(SIGN_MIN_WIDTH, digits.measure(st.text, size) + SIGN_PAD * (ridge ? 2 : 1)), ridge ? (size * RIDGE_PLAQUE) / RIDGE_TEXT : 3, 0.4);
    dummy.updateMatrix();
    signs.setMatrixAt(i, dummy.matrix);
    signs.instanceMatrix.needsUpdate = true;
    signs.setColorAt(i, signColor.set(st.open ? signOpenColor : signClosedColor));
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
  };
  level.gates.forEach((g, i) => {
    // The giant's line carries no number plaque (its sign comes with the giant, docs/01-gdd.md 17.6).
    if (g.kind === 'boss') signState[i]!.hidden = true;
    applySign(i);
  });
  group.add(digits.mesh);
  if (words) group.add(words.mesh);

  // Gifts (M2-04): one InstancedMesh in zone rarity colours; a taken gift scales to zero until the respawn.
  const giftPoints = level.points.filter((p) => p.type === 'gift');
  const giftGeo = new BoxGeometry(GIFT_HALF * 2, GIFT_HEIGHT, GIFT_HALF * 2);
  giftGeo.translate(0, GIFT_HEIGHT / 2, 0);
  const giftMat = new MeshLambertMaterial({ color: 0xffffff });
  const gifts = new InstancedMesh(giftGeo, giftMat, Math.max(1, giftPoints.length));
  gifts.count = giftPoints.length;
  gifts.instanceMatrix.setUsage(DynamicDrawUsage);
  const giftColor = new Color();
  const placeGift = (i: number, shown: boolean): void => {
    const p = giftPoints[i];
    if (!p) return;
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, 0, 0);
    // The chest of a grotto (docs/01-gdd.md 17.7) is a bigger gift in the chest colour.
    dummy.scale.setScalar(shown ? (p['chest'] === true ? CHEST_GIFT_SCALE : 1) : 0.0001);
    dummy.updateMatrix();
    gifts.setMatrixAt(i, dummy.matrix);
    gifts.instanceMatrix.needsUpdate = true;
  };
  giftPoints.forEach((p, i) => {
    placeGift(i, true);
    const color = p['chest'] === true ? materialColor(theme, 'chest') : giftColor.set(theme.rarity[(p['rarity'] as string) ?? 'common'] ?? '#ffffff');
    gifts.setColorAt(i, color);
  });
  if (gifts.instanceColor) gifts.instanceColor.needsUpdate = true;
  gifts.computeBoundingSphere();
  group.add(gifts);
  const giftShown = giftPoints.map(() => true);

  // Fun (docs/01-gdd.md 16.4): the trampoline — an ice plate with a spring pattern of two square rings and a dot; the
  // ice slide — a ribbon with chevrons up the track. Unit boxes with the face shading baked, colour and turn per instance.
  type FunPart = { x: number; y: number; z: number; w: number; h: number; d: number; turn: number; color: string; pad: number };
  const funParts: FunPart[] = [];
  const mat = (key: string): string => theme.materials[key]?.color ?? '#cccccc';
  level.points
    .filter((p) => p.type === 'jumpPad')
    .forEach((p, pad) => {
      const size = (p['width'] as number | undefined) ?? 4;
      const top = p.y + PAD_THICK + MARK_THICK / 2;
      // SD-09 (review: a 96 × 96 blue plate hung over the finish of stage 6): a strip across the slope (the catapult, its
      // own `length`) is drawn as long as it is — a row of dots on it, not the square rings of a plate.
      const len = p['length'] as number | undefined;
      if (len !== undefined && Math.abs(len - size) > 1e-6) {
        funParts.push({ x: p.x, y: p.y + PAD_THICK / 2, z: p.z, w: size, h: PAD_THICK, d: len, turn: 0, color: mat('jumpPad'), pad });
        for (let x = -size / 2 + STRIP_DOT_STEP / 2; x < size / 2; x += STRIP_DOT_STEP) funParts.push({ x: p.x + x, y: top, z: p.z, w: MARK_WIDTH * 2, h: MARK_THICK, d: MARK_WIDTH * 2, turn: 0, color: mat('jumpPadMark'), pad });
        return;
      }
      funParts.push({ x: p.x, y: p.y + PAD_THICK / 2, z: p.z, w: size, h: PAD_THICK, d: size, turn: 0, color: mat('jumpPad'), pad });
      for (const ring of [0.75, 0.42]) {
        const r = (size / 2) * ring;
        funParts.push({ x: p.x, y: top, z: p.z - r, w: 2 * r + MARK_WIDTH, h: MARK_THICK, d: MARK_WIDTH, turn: 0, color: mat('jumpPadMark'), pad });
        funParts.push({ x: p.x, y: top, z: p.z + r, w: 2 * r + MARK_WIDTH, h: MARK_THICK, d: MARK_WIDTH, turn: 0, color: mat('jumpPadMark'), pad });
        funParts.push({ x: p.x - r, y: top, z: p.z, w: MARK_WIDTH, h: MARK_THICK, d: 2 * r, turn: 0, color: mat('jumpPadMark'), pad });
        funParts.push({ x: p.x + r, y: top, z: p.z, w: MARK_WIDTH, h: MARK_THICK, d: 2 * r, turn: 0, color: mat('jumpPadMark'), pad });
      }
      funParts.push({ x: p.x, y: top, z: p.z, w: MARK_WIDTH * 2, h: MARK_THICK, d: MARK_WIDTH * 2, turn: 0, color: mat('jumpPadMark'), pad });
    });
  for (const p of level.points.filter((q) => q.type === 'slide')) {
    const w = (p['width'] as number | undefined) ?? 4;
    const len = (p['length'] as number | undefined) ?? 16;
    funParts.push({ x: p.x, y: p.y + SLIDE_THICK / 2, z: p.z, w, h: SLIDE_THICK, d: len, turn: 0, color: mat('slide'), pad: -1 });
    // Chevrons «^» pointing up the track (+Z): two bars at ±45° meeting on the axis.
    const arm = w * 0.32;
    for (let k = 0; k < CHEVRONS; k++) {
      const cz = p.z - len / 2 + ((k + 0.5) * len) / CHEVRONS;
      for (const side of [-1, 1]) {
        funParts.push({ x: p.x + (side * arm) / 2, y: p.y + SLIDE_THICK + MARK_THICK / 2, z: cz - arm / 2, w: MARK_WIDTH * 1.6, h: MARK_THICK, d: arm * Math.SQRT2, turn: (-side * Math.PI) / 4, color: mat('slideMark'), pad: -1 });
      }
    }
  }
  const funGeo = new BoxGeometry(1, 1, 1).toNonIndexed();
  colorGeometry(funGeo, new Color(1, 1, 1));
  const fun = new InstancedMesh(funGeo, material, Math.max(1, funParts.length));
  fun.count = funParts.length;
  fun.name = 'fun';
  const funColor = new Color();
  const placeFun = (i: number, lift: number): void => {
    const f = funParts[i]!;
    dummy.position.set(f.x, f.y + lift, f.z);
    dummy.rotation.set(0, f.turn, 0);
    dummy.scale.set(f.w, f.h, f.d);
    dummy.updateMatrix();
    fun.setMatrixAt(i, dummy.matrix);
  };
  funParts.forEach((f, i) => {
    placeFun(i, 0);
    fun.setColorAt(i, funColor.set(f.color));
  });
  fun.instanceMatrix.needsUpdate = true;
  if (fun.instanceColor) fun.instanceColor.needsUpdate = true;
  fun.computeBoundingSphere();
  // A mountain without fun (classic) draws nothing for it.
  fun.visible = funParts.length > 0;
  group.add(fun);
  const pressedAt = new Map<number, number>();
  const wayMarks = createWayMarks(level, theme);
  group.add(wayMarks.group);

  return {
    group,
    chunks,
    gates,
    signs,
    digits,
    wayMarks,
    setGateSign(index, text, open) {
      const st = signState[index];
      if (!st || (st.text === text && st.open === open)) return;
      st.text = text;
      st.open = open;
      applySign(index);
    },
    gifts,
    setGiftShown(index, shown) {
      if (giftShown[index] === undefined || giftShown[index] === shown) return;
      giftShown[index] = shown;
      placeGift(index, shown);
    },
    giftShown: (index) => giftShown[index] ?? false,
    fun,
    pressPad(index, timeSec) {
      pressedAt.set(index, timeSec);
    },
    update(timeSec) {
      for (const [pad, at] of pressedAt) {
        // The plate springs up and settles (a damped half wave over PAD_SPRING_SEC).
        const k = Math.min(1, (timeSec - at) / PAD_SPRING_SEC);
        const lift = PAD_SPRING_LIFT * Math.sin(Math.PI * k) * (1 - k);
        funParts.forEach((f, i) => {
          if (f.pad === pad) placeFun(i, lift);
        });
        fun.instanceMatrix.needsUpdate = true;
        if (k >= 1) pressedAt.delete(pad);
      }
    },
    gateSign(index) {
      const st = signState[index];
      return st ? { text: st.text, open: st.open } : { text: '', open: false };
    },
    signBox(index) {
      const g = level.gates[index];
      const st = signState[index];
      if (!g || !st) return { center: [0, 0, 0], size: [0, 0, 0] };
      const d = g.box.max[2] - g.box.min[2];
      const ridge = g.kind === 'ridge';
      const size = signText(g);
      if (stageSign && ridge) {
        const p = stagePlace(index);
        return { center: [p.x, p.y, p.z], size: [p.w, p.h, 0.4] };
      }
      const width = Math.max(SIGN_MIN_WIDTH, digits.measure(st.text, size) + SIGN_PAD * (ridge ? 2 : 1));
      return { center: [0, g.y + g.signHeight, g.z - d / 2 - 0.3], size: [width, ridge ? (size * RIDGE_PLAQUE) / RIDGE_TEXT : 3, 0.4] };
    },
    setSignHidden(index, hidden) {
      const st = signState[index];
      if (!st || st.hidden === hidden) return;
      st.hidden = hidden;
      applySign(index);
    },
    // A ridge board of the phone is a plaque of the HUD (setStageBoards(false)): nothing of it is drawn in the world.
    signHidden: (index) => (signState[index]?.hidden ?? false) || (stageSign && !boards && level.gates[index]?.kind === 'ridge'),
    setStageBoards(on) {
      if (boards === on) return;
      boards = on;
      level.gates.forEach((_, i) => applySign(i));
    },
    signAnchor(index) {
      const g = level.gates[index];
      if (!stageSign || !g || g.kind !== 'ridge') return null;
      const p = stagePlace(index);
      return [p.x, g.y + STAGE_POST, p.z];
    },
    setCaveCut(niche, parts) {
      cutParts.forEach((w, i) => {
        const hide = w.niche === niche && parts.includes(w.part);
        if (hide === cutHidden[i]) return;
        cutHidden[i] = hide;
        placeBack(i, !hide);
      });
    },
    cutBoxes: () => cutParts.filter((_, i) => cutHidden[i]).map((w) => ({ min: w.box.min, max: w.box.max })),
    gateOpenness: (index) => melted[index] ?? 0,
    setGateOpen(index, openness) {
      const g = level.gates[index];
      if (!g) return;
      melted[index] = openness;
      if (g.kind === 'ridge') {
        // Every passage of the ridge and its crest melt at once (docs/01-gdd.md 17.3).
        ridgeParts.forEach((p, k) => p.gate === index && placeRidge(k, openness));
        ridgePlugs.instanceMatrix.needsUpdate = true;
        ridgeCrests.instanceMatrix.needsUpdate = true;
        return;
      }
      gates.getMatrixAt(index, _m);
      _m.decompose(_p, _q, _s);
      const h = g.height * Math.max(0.001, 1 - openness);
      _p.y = g.y + h / 2;
      _s.y = h;
      _m.compose(_p, _q, _s);
      gates.setMatrixAt(index, _m);
      gates.instanceMatrix.needsUpdate = true;
    },
    cullByDistance(z, far) {
      // Half a chunk of margin each way (a 120-unit chunk shows while its centre is within far + 120).
      for (const c of chunks) c.visible = c.userData['z1'] > z - far - CHUNK_LENGTH / 2 && c.userData['z0'] < z + far + CHUNK_LENGTH / 2;
    },
    seeThrough,
    setSeeThrough(i, f) {
      if (faded[i] === undefined || faded[i] === f) return;
      faded[i] = f;
      placeSee(i);
      seeSolid.computeBoundingSphere();
      seeFadedMesh.computeBoundingSphere();
      seeFadedMesh.visible = faded.some(Boolean);
    },
    seeFaded: (i) => faded[i] === true,
    dispose() {
      for (const c of chunks) c.geometry.dispose();
      material.dispose();
      seeMat.dispose();
      gateGeo.dispose();
      gateMat.dispose();
      crestMat.dispose();
      signGeo.dispose();
      signMat.dispose();
      backGeo.dispose();
      giftGeo.dispose();
      giftMat.dispose();
      funGeo.dispose();
      digits.dispose();
      words?.dispose();
      wayMarks.dispose();
    },
  };
}

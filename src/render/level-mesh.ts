// What: Level meshes: boxes and ramps merged per 120-unit chunk (per section on the open slope) with baked vertex colours, a texture layer and ground AO per vertex; gates, gifts, fun parts and cave walls as InstancedMeshes; gate signs.
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
  ConeGeometry,
  PlaneGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
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
import { createBlockTexture, layerOf, useBlockTexture } from './block-tex.ts';
import { pieceGeometry, winterDecorPlan, type WinterDecorBuilt } from './winter-decor.ts';
import type { DecorJson, DecorModelsJson } from '../content/types.ts';
import { AdditiveBlending, IcosahedronGeometry, MeshBasicMaterial } from 'three';
import { buildTrackProps, CHUNK_LENGTH, chunkEdges, drawsBox, drawsPoint } from './track-props.ts';
import type { DataArrayTexture } from 'three';

export { CHUNK_LENGTH };
/** Gate sign: glyph size, plaque width at least and its margin around the text (world units). */
/** D-03: the run line's flag — its pole and cloth (units). */
const MARK_POLE = 3;
const MARK_CLOTH = 1.6;
const TRAIL_HALF = 0.3;
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
const CHEVRON_ARM = 2;
const CHEVRON_LANE = 24;
const CHEVRON_ROW = 28;
const PAD_SPRING_SEC = 0.45;
const PAD_SPRING_LIFT = 0.9;
/** V-09: a present turns this fast (rad/s) and bobs this high (units) once in GIFT_BOB_SEC. */
const GIFT_TURN = 0.7;
const GIFT_BOB = 0.12;
const GIFT_BOB_SEC = 2.4;
const GIFT_NEAR = 200;
/** V-03: a belt stripe this long along the belt. */
const STRIPE_DEPTH = 0.35;

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
  /** V-04, V2-01: the camera at (x, y, z) every frame — a canopy roof (boards, snow, ridge, beams, icicles at once) is not
   * drawn while the camera is over its footprint above its lower edge (the boards filled the frame). */
  cameraAt(x: number, y: number, z: number): void;
  /** V2-02 (test API): the ice wall of ridge `index` — its parts (wall, snow cap, rime, cracks), how many are drawn now and
   * the texture layer of the wall. */
  ridgeLook(index: number): { parts: number; shown: number; layer: number };
  /** V2-01 (test API): the canopy roofs — their hide volume and whether each is drawn whole now. */
  canopyRoofs(): Array<{ min: readonly number[]; max: readonly number[]; drawn: boolean }>;
  /** V-05: where the summit chest stands beside the portal (its coins flash there), null — none. */
  chestAt: readonly [number, number, number] | null;
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

/** Z-05: `layer` — the texture layer of the block (block-tex.ts, 0 plain); `ao` — the share of light left at the foot of
 * its sides (vertex AO: a dark seam at the ground, 1 — none), `foot` — the height of that foot. */
function colorGeometry(geo: BufferGeometry, color: Color, shadeBottom = 0.78, shadeSide = 0.9, layer = 0, ao = 1, foot = -Infinity): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    let f = ny > 0.5 ? 1 : ny < -0.5 ? shadeBottom : shadeSide;
    if (ny <= 0.5 && ny >= -0.5 && pos.getY(i) <= foot + 1e-4) f *= ao;
    colors[i * 3] = color.r * f;
    colors[i * 3 + 1] = color.g * f;
    colors[i * 3 + 2] = color.b * f;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('layer', new Float32BufferAttribute(new Float32Array(pos.count).fill(layer), 1));
}

/** The texture layer and ground AO of a theme material (Z-05). */
function texOf(theme: ThemeJson, key: string): number {
  return layerOf(theme.materials[key]?.tex);
}

/** V22: the render material of a box — the walls of a rock grotto in rock, of an edge cave in snow (theme `grottoRock`,
 * `drift`; the colliders keep their kinds). */
function lookOf(b: LevelBox, theme: ThemeJson): string {
  if ((b.kind === 'islandWall' || b.kind === 'islandRoof') && theme.materials['grottoRock']) return 'grottoRock';
  if ((b.kind === 'nicheWall' || b.kind === 'nicheRoof') && theme.materials['drift']) return 'drift';
  return b.material;
}

function boxGeometry(b: LevelBox, theme: ThemeJson): BufferGeometry {
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  const d = b.max[2] - b.min[2];
  const geo = new BoxGeometry(w, h, d).toNonIndexed();
  geo.translate(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
  // Z-05: walls, borders and decor stand on the ground — the foot of their sides darker (the floors' sides hang into pits).
  const standing = h > 0.6 && b.kind !== 'floor' && b.kind !== 'pitFloor';
  const look = lookOf(b, theme);
  colorGeometry(geo, materialColor(theme, look), 0.78, 0.9, texOf(theme, look), standing ? (theme.blockTex?.ao ?? 1) : 1, b.min[1]);
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
  colorGeometry(geo, materialColor(theme, r.material), 0.78, 0.9, texOf(theme, r.material));
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
  colorGeometry(geo, materialColor(theme, p.material), 0.78, 0.9, texOf(theme, p.material));
  return geo;
}

function giftBob(i: number, t: number): number {
  return GIFT_BOB * (1 + Math.sin(((t + i * 0.37) / GIFT_BOB_SEC) * Math.PI * 2));
}

/** V-09: the present of a gift — the box (white: the instance colour paints it), two ribbons across its sides and top and
 * a bow of two loops, the ribbon kept in `ribbon` (attribute `keep`). Its foot at y 0, as the old cube. */
function giftGeometry(ribbon: Color): BufferGeometry {
  const w = GIFT_HALF * 2;
  const h = GIFT_HEIGHT * 0.86;
  const parts: Array<{ g: BufferGeometry; keep: boolean }> = [];
  const add = (g: BufferGeometry, x: number, y: number, z: number, keep: boolean, rz = 0, ry = 0): void => {
    g.rotateZ(rz);
    g.rotateY(ry);
    g.translate(x, y, z);
    parts.push({ g: g.toNonIndexed(), keep });
  };
  add(new BoxGeometry(w, h, w), 0, h / 2, 0, false);
  // The ribbon: a cross on the lid and a band down the middle of each side (quads just off the faces — the triangles of the
  // mountain, D-02).
  const rw = w * 0.2;
  const off = 0.015;
  for (const turn of [0, Math.PI / 2]) add(new PlaneGeometry(rw, w).rotateX(-Math.PI / 2), 0, h + off, 0, true, 0, turn);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    add(new PlaneGeometry(rw, h).translate(0, 0, w / 2 + off), 0, h / 2, 0, true, 0, a);
  }
  // The bow (V2-04, staff 28.10: bigger, reads from the run): two loops leaning out over the lid and a knot between them.
  for (const side of [-1, 1]) add(new ConeGeometry(w * 0.2, w * 0.5, 4), side * w * 0.2, h + w * 0.2, 0, true, side * 1.05);
  add(new BoxGeometry(w * 0.2, w * 0.2, w * 0.24), 0, h + w * 0.1, 0, true);
  const merged = mergeGeometries(
    parts.map(({ g, keep }) => {
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      const nor = g.getAttribute('normal');
      for (let i = 0; i < n; i++) {
        const f = nor.getY(i) > 0.5 ? 1 : nor.getY(i) < -0.5 ? 0.78 : 0.9;
        const c = keep ? ribbon : WHITE;
        col.set([c.r * f, c.g * f, c.b * f], i * 3);
      }
      g.setAttribute('color', new BufferAttribute(col, 3));
      g.setAttribute('keep', new Float32BufferAttribute(new Float32Array(n).fill(keep ? 1 : 0), 1));
      return g;
    }),
    false,
  )!;
  return merged;
}
const WHITE = new Color(1, 1, 1);

/** The block texture is drawn once a load and shared by the meshes of every mountain (Z-05). */
let sharedBlockTex: DataArrayTexture | null = null;
function blockTexture(): DataArrayTexture {
  return (sharedBlockTex ??= createBlockTexture());
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

export function createLevelMeshes(level: LevelData, theme: ThemeJson, suffix: (k: string) => string, fade = 1, levelWord?: string, decor?: { spec: DecorJson; models: DecorModelsJson; built?: WinterDecorBuilt | undefined }): LevelMeshes {
  const group = new Group();
  group.name = `level-${level.worldId}`;
  const material = new MeshLambertMaterial({ vertexColors: true });
  // Z-05: the chunks under the block texture (one program more, compiled before ready() with the scene).
  const chunkMat = new MeshLambertMaterial({ vertexColors: true });
  if (theme.blockTex) useBlockTexture(chunkMat, blockTexture(), theme.blockTex.scale);

  // Static geometry per chunk along Z: edges every CHUNK_LENGTH, or the edges of the sections of the open slope.
  const edges = chunkEdges(level);
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
  // V22: the finished pieces of the track over their colliders (render/track-props.ts).
  const props = decor?.built?.props ?? buildTrackProps(level, theme, decor?.models);
  const cutParts: Array<{ niche: number; part: CavePart; box: LevelBox; tilt?: number; yaw?: number }> = [];
  // RL-09: with `fade` < 1 the tall walls are drawn apart, solid or see-through (the camera passes them, builder cameraThrough).
  const throughKinds = level.cameraThrough ?? CAMERA_THROUGH;
  const seeThrough = fade < 1 ? level.boxes.filter((b) => throughKinds.has(b.kind)) : [];
  for (const b of level.boxes) {
    if (fade < 1 && throughKinds.has(b.kind)) continue;
    if (drawsBox(b) || props.hidden.has(b)) continue;
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
    if (drawsPoint(p)) continue;
    if (p.type === 'decor' && p['kind'] === 'flag') {
      // A flag of a base stand: a pole and its cloth in the colour of the tents.
      const pole: LevelBox = { min: [p.x - 0.12, p.y, p.z - 0.12], max: [p.x + 0.12, p.y + 4.5, p.z + 0.12], material: 'pole', kind: 'decor', solid: false };
      const cloth: LevelBox = { min: [p.x + 0.12, p.y + 3.3, p.z - 0.06], max: [p.x + 1.9, p.y + 4.4, p.z + 0.06], material: 'tent', kind: 'decor', solid: false };
      bucketOf(p.z).push(boxGeometry(pole, theme), boxGeometry(cloth, theme));
    } else if (p.type === 'portal') {
      // As wide as its data (docs/01-gdd.md 19.8), 1-unit pillars; the light inside it — render/way-marks.ts.
      const hw = (typeof p['width'] === 'number' ? (p['width'] as number) : PORTAL_WIDTH) / 2;
      const l: LevelBox = { min: [p.x - hw, p.y, p.z - 0.5], max: [p.x - hw + 1, p.y + PORTAL_HEIGHT, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      const r: LevelBox = { min: [p.x + hw - 1, p.y, p.z - 0.5], max: [p.x + hw, p.y + PORTAL_HEIGHT, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      const top: LevelBox = { min: [p.x - hw, p.y + PORTAL_HEIGHT - 1, p.z - 0.5], max: [p.x + hw, p.y + PORTAL_HEIGHT, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      bucketOf(p.z).push(boxGeometry(l, theme), boxGeometry(r, theme), boxGeometry(top, theme));
    }
  }
  // Z-06: the winter decor merged into the chunks like the boxes; its warm glows as one additive InstancedMesh.
  // D-02: the plan and the pieces made ahead with the prebuild of the mountain, when it gives them.
  const plan = decor ? (decor.built?.plan ?? winterDecorPlan(level, decor.spec, decor.models)) : null;
  if (plan && decor)
    plan.pieces.forEach((piece, i) => {
      const g = decor.built ? decor.built.geometries[i] ?? null : pieceGeometry(piece, decor.models, decor.spec.ao, decor.spec.foot);
      if (g) bucketOf(piece.z).push(g);
    });
  for (const piece of props.pieces) bucketOf(piece.z).push(piece.geo);
  for (const c of props.cut) cutParts.push(c);
  // D-03: the run line's flags — a thin pole and its cloth in theme markFlag.
  for (const [x, y, z, side] of plan?.marks ?? []) {
    const pole: LevelBox = { min: [x - 0.1, y, z - 0.1], max: [x + 0.1, y + MARK_POLE, z + 0.1], material: 'pole', kind: 'decor', solid: false };
    // The cloth across the run to the outside, its face to the camera (artist D20: edge-on it read as a stick); under 0.6
    // tall — no foot AO on it.
    const c0 = side > 0 ? x + 0.1 : x - 0.1 - MARK_CLOTH;
    const cloth: LevelBox = { min: [c0, y + MARK_POLE - 0.6, z - 0.05], max: [c0 + MARK_CLOTH, y + MARK_POLE - 0.05, z + 0.05], material: 'markFlag', kind: 'decor', solid: false };
    bucketOf(z).push(boxGeometry(pole, theme), boxGeometry(cloth, theme));
  }
  // D-03: the ski track up the axis between the flags — two strips a shade darker than the snow, where the ground is flat.
  for (const [x, y, z0, z1] of plan?.trail ?? []) {
    const strip: LevelBox = { min: [x - TRAIL_HALF, y + 0.01, z0], max: [x + TRAIL_HALF, y + 0.04, z1], material: 'trail', kind: 'decor', solid: false };
    bucketOf(z0).push(boxGeometry(strip, theme));
  }
  const glowGeo = new IcosahedronGeometry(1, 0);
  // V22: the cold light of the grottos and the camp teleport in the same mesh, its colour per instance (+0 draw calls).
  const glowMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: decor?.spec.glowOpacity ?? 0, blending: AdditiveBlending, depthWrite: false });
  const warmList = [...(plan?.glows ?? []), ...props.glows];
  const glowList = [...warmList, ...props.coldGlows];
  const glows = new InstancedMesh(glowGeo, glowMat, Math.max(1, glowList.length));
  glows.count = glowList.length;
  glows.name = 'decor-glows';
  const warm = new Color(decor?.spec.glowColor ?? '#ffffff');
  const cold = materialColor(theme, theme.materials['coldGlow'] ? 'coldGlow' : 'ice');
  glowList.forEach(([x, y, z, r], i) => {
    glows.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, r, r)));
    glows.setColorAt(i, i < warmList.length ? warm : cold);
  });
  if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
  glows.computeBoundingSphere();
  glows.visible = glowList.length > 0;
  group.add(glows);
 const chunks: Mesh[] = [];
  buckets.forEach((list, i) => {
    if (list.length === 0) return;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) return;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, chunkMat);
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
    backDummy.rotation.set(0, w.yaw ?? 0, w.tilt ?? 0);
    backDummy.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]).multiplyScalar(shown ? 1 : 1e-4);
    backDummy.updateMatrix();
    backMesh.setMatrixAt(i, backDummy.matrix);
    backMesh.instanceMatrix.needsUpdate = true;
  };
  cutParts.forEach((w, i) => {
    placeBack(i, true);
    backMesh.setColorAt(i, materialColor(theme, lookOf(w.box, theme)));
  });
  if (backMesh.instanceColor) backMesh.instanceColor.needsUpdate = true;
  backMesh.computeBoundingSphere();
  group.add(backMesh);
  const cutHidden = cutParts.map(() => false);
  const camHidden = cutParts.map(() => false);
  const canopyParts = props.canopies.map((c) => cutParts.flatMap((w, i) => (w.niche === c.niche && w.part === 'roof' && w.box.kind === 'prop' ? [i] : [])));

  // The tall walls (RL-09): two InstancedMeshes of unit boxes, solid and see-through; a wall is in one of them.
  const seeMat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: fade, depthWrite: false });
  // V-12 (staff 27.10: the maze walls were smooth dark slabs from inside): the walls drawn apart keep the texture of their
  // material (a layer per instance) — the snow bricks of the maze, the rock of a cliff.
  // V-12: a maze wall carries a snow cap on its top and a dark plinth at its foot — parts of the same instance set, faded
  // with their wall (in the chunks they stood as blocks in the air when the wall faded for the camera).
  type SeePart = { owner: number; box: LevelBox; color: Color; layer: number };
  const seeParts: SeePart[] = seeThrough.map((b, i) => ({ owner: i, box: b, color: materialColor(theme, lookOf(b, theme)), layer: texOf(theme, lookOf(b, theme)) }));
  const mazes = (level.stages ?? []).flatMap((st) => (st.maze ? [{ y: st.y, x0: st.maze.x0 - 1, x1: st.maze.x0 + st.maze.cols * st.maze.cell + 1, z0: st.maze.z0 - 1, z1: st.maze.z0 + st.maze.rows * st.maze.cell + 1 }] : []));
  const plinth = materialColor(theme, theme.materials['grottoRock'] ? 'grottoRock' : 'rock').multiplyScalar(0.62);
  // V2-04 (staff 28.10): a maze wall in the camera's way is not a pale ghost slab over the path — it hides whole, its cap and
  // plinth with it (a cliff still fades at `fade`).
  const mazeWall = seeThrough.map(() => false);
  seeThrough.forEach((w, i) => {
    const mz = w.kind === 'throatWall' ? mazes.find((m) => w.min[0] >= m.x0 && w.max[0] <= m.x1 && w.min[2] >= m.z0 && w.max[2] <= m.z1) : undefined;
    if (!mz) return;
    mazeWall[i] = true;
    seeParts.push({ owner: i, box: { min: [w.min[0] - 0.25, w.max[1], w.min[2] - 0.25], max: [w.max[0] + 0.25, w.max[1] + 0.5, w.max[2] + 0.25], material: 'track', kind: 'prop', solid: false }, color: materialColor(theme, 'track'), layer: texOf(theme, 'track') });
    seeParts.push({ owner: i, box: { min: [w.min[0] - 0.14, mz.y, w.min[2] - 0.14], max: [w.max[0] + 0.14, mz.y + 0.9, w.max[2] + 0.14], material: 'grottoRock', kind: 'prop', solid: false }, color: plinth, layer: texOf(theme, 'rock') });
  });
  const partsOf = seeThrough.map(() => [] as number[]);
  seeParts.forEach((p, k) => partsOf[p.owner]!.push(k));
  const seeGeo = backGeo.clone();
  seeGeo.setAttribute('layer', new InstancedBufferAttribute(new Float32Array(Math.max(1, seeParts.length)).map((_, k) => seeParts[k]?.layer ?? 0), 1));
  const seeSolidMat = new MeshLambertMaterial({ vertexColors: true });
  if (theme.blockTex) {
    useBlockTexture(seeSolidMat, blockTexture(), theme.blockTex.scale);
    useBlockTexture(seeMat, blockTexture(), theme.blockTex.scale);
  }
  const seeSolid = new InstancedMesh(seeGeo, seeSolidMat, Math.max(1, seeParts.length));
  const seeFadedMesh = new InstancedMesh(seeGeo, seeMat, Math.max(1, seeParts.length));
  seeSolid.count = seeFadedMesh.count = seeParts.length;
  seeSolid.name = 'see-through-solid';
  seeFadedMesh.name = 'see-through-faded';
  const faded = seeThrough.map(() => false);
  const placeSee = (i: number): void => {
    for (const k of partsOf[i] ?? []) {
      const b = seeParts[k]!.box;
      backDummy.rotation.set(0, 0, 0);
      backDummy.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      for (const [mesh, on] of [[seeSolid, !faded[i]], [seeFadedMesh, faded[i] && !mazeWall[i]]] as const) {
        backDummy.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]).multiplyScalar(on ? 1 : 1e-4);
        backDummy.updateMatrix();
        mesh.setMatrixAt(k, backDummy.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  };
  seeThrough.forEach((_, i) => placeSee(i));
  seeParts.forEach((p, k) => {
    seeSolid.setColorAt(k, p.color);
    seeFadedMesh.setColorAt(k, p.color);
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
  // V2-02 (staff 28.10, producer: «some cubes here and there are still plain»): a plug is an ice wall laid in bricks like
  // the maze walls (theme `gateWall`), with a snow cap on its top, rime at its foot and cracks over its face — parts of the
  // same instance set that melt with it; its frame of stone and log stands in the chunks (render/track-props.ts).
  const ridgeParts = ridgePartsOf(level);
  const crestMat = new MeshLambertMaterial({ color: materialColor(theme, 'gateClosed'), transparent: true, opacity: RIDGE_CREST_OPACITY, depthWrite: false });
  const plugCount = ridgeParts.filter((p) => !p.crest).length;
  const wallKey = theme.materials['gateWall'] ? 'gateWall' : 'gateClosed';
  type PlugBit = { part: number; kind: 'body' | 'cap' | 'rime' | 'crack'; at: number; tilt: number; color: Color; layer: number };
  const plugBits: PlugBit[] = [];
  const crackColor = theme.materials['gateCrack'] ? materialColor(theme, 'gateCrack') : materialColor(theme, 'gateClosed').multiplyScalar(0.6);
  ridgeParts.forEach((p, k) => {
    if (p.crest) return;
    plugBits.push({ part: k, kind: 'body', at: 0, tilt: 0, color: materialColor(theme, wallKey), layer: texOf(theme, wallKey) });
    plugBits.push({ part: k, kind: 'cap', at: 0, tilt: 0, color: materialColor(theme, 'track'), layer: texOf(theme, 'track') });
    plugBits.push({ part: k, kind: 'rime', at: 0, tilt: 0, color: materialColor(theme, 'track'), layer: texOf(theme, 'track') });
    // Two cracks a face, zigzag, off the middle (the run line).
    for (const [at, tilt] of [[-0.3, 0.45], [0.28, -0.6]] as const) plugBits.push({ part: k, kind: 'crack', at, tilt, color: crackColor, layer: 0 });
  });
  const plugGeo = backGeo.clone();
  plugGeo.setAttribute('layer', new InstancedBufferAttribute(new Float32Array(Math.max(1, plugBits.length)).map((_, i) => plugBits[i]?.layer ?? 0), 1));
  const plugMat = new MeshLambertMaterial({ vertexColors: true });
  if (theme.blockTex) useBlockTexture(plugMat, blockTexture(), theme.blockTex.scale);
  const ridgePlugs = new InstancedMesh(plugGeo, plugMat, Math.max(1, plugBits.length));
  ridgePlugs.name = 'ridge-plugs';
  const ridgeCrests = new InstancedMesh(gateGeo, crestMat, Math.max(1, ridgeParts.length - plugCount));
  ridgePlugs.count = plugBits.length;
  ridgeCrests.count = ridgeParts.length - plugCount;
  plugBits.forEach((b, i) => ridgePlugs.setColorAt(i, b.color));
  if (ridgePlugs.instanceColor) ridgePlugs.instanceColor.needsUpdate = true;
  const bitsOf = ridgeParts.map(() => [] as number[]);
  plugBits.forEach((b, i) => bitsOf[b.part]!.push(i));
  const ridgeSlot: number[] = [];
  const melted: number[] = level.gates.map(() => 0);
  const placeBit = (i: number, b: { min: readonly number[]; max: readonly number[] } | null): void => {
    const bit = plugBits[i]!;
    const p = ridgeParts[bit.part]!;
    dummy.rotation.set(0, 0, 0);
    if (!b) {
      dummy.position.set(p.x, p.y0, p.z);
      dummy.scale.set(0, 0, 0);
    } else {
      const h = b.max[1]! - b.min[1]!;
      const front = p.z - p.d / 2;
      if (bit.kind === 'body') {
        dummy.position.set(p.x, b.min[1]! + h / 2, p.z);
        dummy.scale.set(p.w, h, p.d);
      } else if (bit.kind === 'cap') {
        dummy.position.set(p.x, b.max[1]! + 0.15, p.z);
        dummy.scale.set(p.w + 0.3, 0.3, p.d + 0.3);
      } else if (bit.kind === 'rime') {
        const r = Math.min(0.7, h);
        dummy.position.set(p.x, b.min[1]! + r / 2, p.z);
        dummy.scale.set(p.w + 0.2, r, p.d + 0.2);
      } else {
        dummy.position.set(p.x + bit.at * p.w, b.min[1]! + h * 0.55, front - 0.02);
        dummy.rotation.set(0, 0, bit.tilt);
        dummy.scale.set(0.14, h * 0.45, 0.08);
      }
    }
    dummy.updateMatrix();
    ridgePlugs.setMatrixAt(i, dummy.matrix);
  };
  const placeRidge = (k: number, openness: number): void => {
    const p = ridgeParts[k]!;
    // MU-13: melted — nothing left (a sliver of the crest hung as a blue line over the passage ramps).
    const b = ridgePartBox(p, openness);
    if (!p.crest) {
      for (const i of bitsOf[k]!) placeBit(i, b);
      return;
    }
    dummy.position.set(p.x, b ? (b.min[1] + b.max[1]) / 2 : p.y0, p.z);
    dummy.rotation.set(0, 0, 0);
    if (b) dummy.scale.set(p.w, b.max[1] - b.min[1], p.d);
    else dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    ridgeCrests.setMatrixAt(ridgeSlot[k]!, dummy.matrix);
  };
  let crestN = 0;
  ridgeParts.forEach((p, k) => {
    if (p.crest) ridgeSlot[k] = crestN++;
    placeRidge(k, 0);
  });
  ridgePlugs.instanceMatrix.setUsage(DynamicDrawUsage);
  ridgeCrests.instanceMatrix.setUsage(DynamicDrawUsage);
  ridgePlugs.instanceMatrix.needsUpdate = true;
  ridgeCrests.instanceMatrix.needsUpdate = true;
  ridgePlugs.computeBoundingSphere();
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
  // V-09 (staff 27.10: plain cubes): a present — the box in the rarity colour, a cross of ribbon and a bow on top in the
  // ribbon colour of the theme (kept from the instance colour), turning slowly and bobbing (update()).
  const giftGeo = giftGeometry(materialColor(theme, theme.materials['giftRibbon'] ? 'giftRibbon' : 'treadmillStripe'));
  const giftMat = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  giftMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float keep;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = mix(vColor.xyz, color.xyz, keep);\n#endif');
  };
  giftMat.customProgramCacheKey = () => 'gift-ribbon';
  const gifts = new InstancedMesh(giftGeo, giftMat, Math.max(1, giftPoints.length));
  gifts.count = giftPoints.length;
  gifts.instanceMatrix.setUsage(DynamicDrawUsage);
  let giftTime = 0;
  /** V-09: the gifts drawn are those within GIFT_NEAR of the hero (cullByDistance), in the first slots of the mesh — a
   * present has more triangles than the old cube (the budget of the mountain, D-02); before the first cull — all. */
  let giftZ: number | null = null;
  const giftShown = giftPoints.map(() => true);
  const giftColors = giftPoints.map((p) => (p['chest'] === true ? materialColor(theme, 'chest') : new Color(theme.rarity[(p['rarity'] as string) ?? 'common'] ?? '#ffffff')));
  const placeGifts = (): void => {
    let slot = 0;
    giftPoints.forEach((p, i) => {
      if (!giftShown[i] || (giftZ !== null && Math.abs(p.z - giftZ) > GIFT_NEAR)) return;
      dummy.position.set(p.x, p.y + giftBob(i, giftTime), p.z);
      dummy.rotation.set(0, giftTime * GIFT_TURN + i * 1.7, 0);
      // The chest of a grotto (docs/01-gdd.md 17.7) is a bigger gift in the chest colour.
      dummy.scale.setScalar(p['chest'] === true ? CHEST_GIFT_SCALE : 1);
      dummy.updateMatrix();
      gifts.setMatrixAt(slot, dummy.matrix);
      gifts.setColorAt(slot, giftColors[i]!);
      slot++;
    });
    gifts.count = slot;
    gifts.instanceMatrix.needsUpdate = true;
    if (gifts.instanceColor) gifts.instanceColor.needsUpdate = true;
  };
  placeGifts();
  gifts.frustumCulled = false;
  group.add(gifts);

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
    // Chevrons «^» pointing up the track (+Z): two bars at ±45° meeting on the axis. V-14 (staff 27.10: on a 96-wide field
    // one chevron was 30 units of thin line): at most CHEVRON_ARM long, in lanes CHEVRON_LANE wide, rows CHEVRON_ROW apart.
    const lanes = Math.max(1, Math.floor(w / CHEVRON_LANE));
    const arm = Math.min(CHEVRON_ARM, (w / lanes) * 0.32);
    const rows = Math.max(CHEVRONS, Math.round(len / CHEVRON_ROW));
    for (let k = 0; k < rows; k++) {
      const cz = p.z - len / 2 + ((k + 0.5) * len) / rows;
      for (let l = 0; l < lanes; l++) {
        const cx = p.x - w / 2 + ((l + 0.5) * w) / lanes;
        for (const side of [-1, 1]) {
          funParts.push({ x: cx + (side * arm) / 2, y: p.y + SLIDE_THICK + MARK_THICK / 2, z: cz - arm / 2, w: MARK_WIDTH * 1.6, h: MARK_THICK, d: arm * Math.SQRT2, turn: (-side * Math.PI) / 4, color: mat('slideMark'), pad: -1 });
        }
      }
    }
  }
  const funGeo = new BoxGeometry(1, 1, 1).toNonIndexed();
  colorGeometry(funGeo, new Color(1, 1, 1));
  // V-03: the stripes of every belt of the mountain ride in the same mesh past the fun parts (+0 draw calls), sliding down
  // their belts (update()).
  const fun = new InstancedMesh(funGeo, material, Math.max(1, funParts.length + props.stripes.length));
  fun.count = funParts.length + props.stripes.length;
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
  const stripeColor = materialColor(theme, 'treadmillStripe');
  const placeStripes = (t: number): void => {
    props.stripes.forEach((st, i) => {
      const off = (((st.phase - t * st.speed) % st.len) + st.len) % st.len;
      fun.setMatrixAt(funParts.length + i, _m.compose(_p.set(st.x, st.y, st.z0 + 1.6 + off), _q.identity(), _s.set(st.w, 0.03, STRIPE_DEPTH)));
    });
    fun.instanceMatrix.needsUpdate = true;
  };
  props.stripes.forEach((_, i) => fun.setColorAt(funParts.length + i, stripeColor));
  placeStripes(0);
  fun.instanceMatrix.needsUpdate = true;
  if (fun.instanceColor) fun.instanceColor.needsUpdate = true;
  fun.computeBoundingSphere();
  // A mountain without fun (classic) and belts draws nothing for it.
  fun.visible = fun.count > 0;
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
    chestAt: props.chest,
    setGiftShown(index, shown) {
      if (giftShown[index] === undefined || giftShown[index] === shown) return;
      giftShown[index] = shown;
      placeGifts();
    },
    giftShown: (index) => giftShown[index] ?? false,
    fun,
    pressPad(index, timeSec) {
      pressedAt.set(index, timeSec);
    },
    update(timeSec) {
      if (props.stripes.length > 0) placeStripes(timeSec);
      giftTime = timeSec;
      placeGifts();
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
        placeBack(i, !hide && !camHidden[i]);
      });
    },
    cameraAt(x, y, z) {
      props.canopies.forEach((c, n) => {
        const inside = x > c.min[0] && x < c.max[0] && y > c.min[1] && y < c.max[1] && z > c.min[2] && z < c.max[2];
        for (const i of canopyParts[n]!) {
          if (camHidden[i] === inside) continue;
          camHidden[i] = inside;
          placeBack(i, !inside && !cutHidden[i]);
        }
      });
    },
    ridgeLook(index) {
      const list = plugBits.flatMap((b, i) => (ridgeParts[b.part]!.gate === index ? [i] : []));
      const shown = list.filter((i) => {
        // Column lengths: decompose() reads a zero matrix as scale 1.
        ridgePlugs.getMatrixAt(i, _m);
        const e = _m.elements;
        return Math.hypot(e[0]!, e[1]!, e[2]!) > 1e-3 && Math.hypot(e[4]!, e[5]!, e[6]!) > 1e-3;
      }).length;
      return { parts: list.length, shown, layer: list.length ? plugBits[list[0]!]!.layer : -1 };
    },
    canopyRoofs: () => props.canopies.map((c, n) => ({ min: c.min, max: c.max, drawn: canopyParts[n]!.every((i) => !cutHidden[i] && !camHidden[i]) })),
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
      giftZ = z;
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
      chunkMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      seeMat.dispose();
      seeSolidMat.dispose();
      seeGeo.dispose();
      gateGeo.dispose();
      gateMat.dispose();
      crestMat.dispose();
      plugGeo.dispose();
      plugMat.dispose();
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

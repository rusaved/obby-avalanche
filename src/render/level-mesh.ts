/**
 * Level meshes (docs/02-tech.md 9.1): static boxes and ramps merged per 120-unit chunk with baked vertex colours
 * (one Lambert material), gates and gifts as InstancedMeshes, gate numbers from the digit atlas. Grey/flat at M1,
 * themed details at M5. The back walls and roofs of the caves are one InstancedMesh of their own: the wide frame of an
 * avalanche (PR-07) looks into its cave from above the back wall, the roof (or the back wall) is not drawn meanwhile.
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
import type { LevelBox, LevelData, LevelRamp } from '../level/types.ts';
import type { ThemeJson } from '../content/types.ts';
import { createDigitLabels, type DigitLabels } from './digits.ts';
import { formatNumber } from '../ui/format.ts';
import { GIFT_HALF, GIFT_HEIGHT } from '../sim/gifts.ts';

export const CHUNK_LENGTH = 120;
/** Gate sign: glyph size, plaque width at least and its margin around the text (world units). */
const SIGN_TEXT = 2.2;
const SIGN_MIN_WIDTH = 6;
const SIGN_PAD = 2;

export interface LevelMeshes {
  group: Group;
  chunks: Mesh[];
  gates: InstancedMesh;
  signs: InstancedMesh;
  digits: DigitLabels;
  /** Scale a gate slab (1 = closed, 0 = gone); M2 melts gates with this. */
  setGateOpen(index: number, openness: number): void;
  /** Sign text («15/20» while closed, the requirement when open) and colour by state (docs/01-gdd.md 3.3). */
  setGateSign(index: number, text: string, open: boolean): void;
  /** What a sign currently shows (test API). */
  gateSign(index: number): { text: string; open: boolean };
  /** The sign plaque of a gate as a box (centre, size; world units) and hiding it (docs/01-gdd.md 16.7: the avalanche
   * banner is never under a sign — a sign under the banner is not drawn while the banner shows). */
  signBox(index: number): { center: [number, number, number]; size: [number, number, number] };
  setSignHidden(index: number, hidden: boolean): void;
  signHidden(index: number): boolean;
  /** These parts of cave `niche` are not drawn (−1 or no parts — all drawn); the boxes of the hidden ones (test API). */
  setCaveCut(niche: number, parts: readonly CavePart[]): void;
  cutBoxes(): Array<{ min: readonly number[]; max: readonly number[] }>;
  /** Gifts of the mountain in `level.points` order (M2-04). */
  gifts: InstancedMesh;
  setGiftShown(index: number, shown: boolean): void;
  giftShown(index: number): boolean;
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

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

export function createLevelMeshes(level: LevelData, theme: ThemeJson, suffix: (k: string) => string): LevelMeshes {
  const group = new Group();
  group.name = `level-${level.worldId}`;
  const material = new MeshLambertMaterial({ vertexColors: true });

  // Static geometry per chunk along Z.
  const chunkCount = Math.ceil(level.length / CHUNK_LENGTH);
  const buckets: BufferGeometry[][] = Array.from({ length: chunkCount }, () => []);
  const bucketOf = (z: number): BufferGeometry[] => buckets[Math.min(chunkCount - 1, Math.max(0, Math.floor(z / CHUNK_LENGTH)))] as BufferGeometry[];
  // The back wall of a cave is a cave wall outside the cave box on its far side, the roof lies over it (src/level/builder.ts).
  const partOf = (b: LevelBox): { niche: number; part: CavePart } | null => {
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
  for (const b of level.boxes) {
    const cut = partOf(b);
    if (cut) cutParts.push({ ...cut, box: b });
    else bucketOf((b.min[2] + b.max[2]) / 2).push(boxGeometry(b, theme));
  }
  for (const r of level.ramps) bucketOf((r.z0 + r.z1) / 2).push(rampGeometry(r, theme));
  // Checkpoint flags and simple decor as boxes (grey slope at M1).
  for (const c of level.checkpoints) {
    const pole: LevelBox = { min: [-level.width / 2 + 1.5, c.y, c.z - 0.15], max: [-level.width / 2 + 1.8, c.y + 4, c.z + 0.15], material: 'pole', kind: 'flagPole', solid: false };
    const flag: LevelBox = { min: [-level.width / 2 + 1.8, c.y + 3, c.z - 0.1], max: [-level.width / 2 + 3.6, c.y + 4, c.z + 0.1], material: 'flag', kind: 'flag', solid: false };
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
    } else if (p.type === 'decor' && p['kind'] === 'tent') {
      const tent: LevelBox = { min: [p.x - 2.5, p.y, p.z - 2.5], max: [p.x + 2.5, p.y + 3, p.z + 2.5], material: 'tent', kind: 'decor', solid: false };
      bucketOf(p.z).push(boxGeometry(tent, theme));
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
      const l: LevelBox = { min: [p.x - 5, p.y, p.z - 0.5], max: [p.x - 4, p.y + 10, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      const r: LevelBox = { min: [p.x + 4, p.y, p.z - 0.5], max: [p.x + 5, p.y + 10, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
      const top: LevelBox = { min: [p.x - 5, p.y + 9, p.z - 0.5], max: [p.x + 5, p.y + 10, p.z + 0.5], material: 'portal', kind: 'portal', solid: false };
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
    mesh.userData['z'] = (i + 0.5) * CHUNK_LENGTH;
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

  // Gates: one InstancedMesh of unit boxes scaled to each slab; signs as a second instanced quad set.
  const gateGeo = new BoxGeometry(1, 1, 1);
  const gateMat = new MeshLambertMaterial({ color: materialColor(theme, 'gateClosed') });
  const gates = new InstancedMesh(gateGeo, gateMat, Math.max(1, level.gates.length));
  gates.instanceMatrix.setUsage(DynamicDrawUsage);
  const signGeo = new BoxGeometry(1, 1, 1);
  // White base: the per-instance colour (red closed / green open from theme.json) is the sign colour.
  const signMat = new MeshLambertMaterial({ color: 0xffffff });
  const signs = new InstancedMesh(signGeo, signMat, Math.max(1, level.gates.length));
  const dummy = new Object3D();
  level.gates.forEach((g, i) => {
    const w = g.box.max[0] - g.box.min[0];
    const d = g.box.max[2] - g.box.min[2];
    dummy.position.set(0, g.y + g.height / 2, g.z);
    dummy.scale.set(w, g.height, d);
    dummy.updateMatrix();
    gates.setMatrixAt(i, dummy.matrix);
  });
  gates.instanceMatrix.needsUpdate = true;
  signs.instanceMatrix.needsUpdate = true;
  group.add(gates, signs);

  const digits = createDigitLabels(level.gates.length * 10 + 8);
  const signState = level.gates.map((g) => ({ text: formatNumber(g.requires, suffix), open: false, hidden: false }));
  const signColor = new Color();
  const signOpenColor = materialColor(theme, 'gateSignOpen');
  const signClosedColor = materialColor(theme, 'gateSign');
  const applySign = (i: number): void => {
    const g = level.gates[i];
    const st = signState[i];
    if (!g || !st) return;
    const d = g.box.max[2] - g.box.min[2];
    if (st.hidden) {
      digits.clear(i);
      dummy.position.set(0, g.y + g.signHeight, g.z - d / 2 - 0.3);
      dummy.scale.setScalar(1e-4);
      dummy.updateMatrix();
      signs.setMatrixAt(i, dummy.matrix);
      signs.instanceMatrix.needsUpdate = true;
      return;
    }
    digits.setLabel(i, st.text, 0, g.y + g.signHeight, g.z - d / 2 - 0.52, SIGN_TEXT, '#ffffff');
    // The plaque fits the text it shows now, «4,2K/12K» included (playtest M2: the text ran past it).
    dummy.position.set(0, g.y + g.signHeight, g.z - d / 2 - 0.3);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(Math.max(SIGN_MIN_WIDTH, digits.measure(st.text, SIGN_TEXT) + SIGN_PAD), 3, 0.4);
    dummy.updateMatrix();
    signs.setMatrixAt(i, dummy.matrix);
    signs.instanceMatrix.needsUpdate = true;
    signs.setColorAt(i, signColor.set(st.open ? signOpenColor : signClosedColor));
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
  };
  level.gates.forEach((_, i) => applySign(i));
  group.add(digits.mesh);

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
    dummy.scale.setScalar(shown ? 1 : 0.0001);
    dummy.updateMatrix();
    gifts.setMatrixAt(i, dummy.matrix);
    gifts.instanceMatrix.needsUpdate = true;
  };
  giftPoints.forEach((p, i) => {
    placeGift(i, true);
    gifts.setColorAt(i, giftColor.set(theme.rarity[(p['rarity'] as string) ?? 'common'] ?? '#ffffff'));
  });
  if (gifts.instanceColor) gifts.instanceColor.needsUpdate = true;
  gifts.computeBoundingSphere();
  group.add(gifts);
  const giftShown = giftPoints.map(() => true);

  return {
    group,
    chunks,
    gates,
    signs,
    digits,
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
    gateSign(index) {
      const st = signState[index];
      return st ? { text: st.text, open: st.open } : { text: '', open: false };
    },
    signBox(index) {
      const g = level.gates[index];
      const st = signState[index];
      if (!g || !st) return { center: [0, 0, 0], size: [0, 0, 0] };
      const d = g.box.max[2] - g.box.min[2];
      return { center: [0, g.y + g.signHeight, g.z - d / 2 - 0.3], size: [Math.max(SIGN_MIN_WIDTH, digits.measure(st.text, SIGN_TEXT) + SIGN_PAD), 3, 0.4] };
    },
    setSignHidden(index, hidden) {
      const st = signState[index];
      if (!st || st.hidden === hidden) return;
      st.hidden = hidden;
      applySign(index);
    },
    signHidden: (index) => signState[index]?.hidden ?? false,
    setCaveCut(niche, parts) {
      cutParts.forEach((w, i) => {
        const hide = w.niche === niche && parts.includes(w.part);
        if (hide === cutHidden[i]) return;
        cutHidden[i] = hide;
        placeBack(i, !hide);
      });
    },
    cutBoxes: () => cutParts.filter((_, i) => cutHidden[i]).map((w) => ({ min: w.box.min, max: w.box.max })),
    setGateOpen(index, openness) {
      const g = level.gates[index];
      if (!g) return;
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
      for (const c of chunks) {
        const cz = c.userData['z'] as number;
        c.visible = Math.abs(cz - z) < far + CHUNK_LENGTH;
      }
    },
    dispose() {
      for (const c of chunks) c.geometry.dispose();
      material.dispose();
      gateGeo.dispose();
      gateMat.dispose();
      signGeo.dispose();
      signMat.dispose();
      backGeo.dispose();
      giftGeo.dispose();
      giftMat.dispose();
      digits.dispose();
    },
  };
}

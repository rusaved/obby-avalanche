// What: How the base looks (docs/01-gdd.md 19.2–19.3): the arches of the mountains by state (passed — open with a flag and a cup, own — filled with light under a pillar, locked — iced with a lock), their signs and the «×N» of the base treadmill in one atlas, the arrows on the snow to the own portal, the shop counter with sneakers and an egg, the gift of the day (lit while it waits), the «My records» board, the snowmen; an arch in the way of the camera not drawn (setArchHidden).
// Called by: main.ts (createBaseView; set on every entry to the base, clear on a mountain); app/banner-signs.ts (guardBaseArches); test-api (drawn).
// Keep: Render only, nothing in the sim (the ice of a locked arch is a hero collider of the level); at most 6 draw calls; colours from theme.json, texts through the caller's t().

import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, SphereGeometry, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemeJson } from '../content/types.ts';
import type { LevelData } from '../level/types.ts';
import type { BasePortal } from '../level/base-layout.ts';
import { chevronGeometry, portalGlowGeometry } from './way-marks.ts';

/** Sign over an arch: its size (units) and how far over the arch; atlas row height (px). */
const SIGN_W = 7;
const SIGN_H = 2.2;
const SIGN_OVER = 1.2;
const ROW_PX = 96;
const ATLAS_W = 512;
/** Arrows on the snow from the spawn to the own portal: how many (base.json arrows, SP-08) and the gap from both ends (units). */
const ARROWS = 3;
const ARROW_GAP = 4;
const FILL_OPACITY = 0.6;
/** The sign of the base treadmill: its height and how far before the front of its belts (units). */
const TREAD_SIGN_Y = 3;
const TREAD_SIGN_BACK = 1;
/** The records board: its width, the height of a line, its top, how far out from its point towards the fence (units). */
const BOARD_W = 8;
const BOARD_ROW = 1.3;
const BOARD_TOP = 8;
const BOARD_OUT = 1.5;
/** The gift of the day: the height of its stand and the size of its box (units). */
const GIFT_STAND = 0.8;
const GIFT_BOX = 1.1;
/** The shop counter: width, height, depth (units). */
const COUNTER: [number, number, number] = [3, 1.2, 1.4];

export interface BaseView {
  group: Group;
  /** The base of `level` with its portals (a new entry: the states may have changed); `t` — the game's texts; `tread` —
   * the sign over the base treadmill («×6»); `board` — the lines of the «My records» board (FM-12). */
  set(level: LevelData, portals: readonly BasePortal[], t: (key: string, p?: Record<string, string | number>) => string, tread?: string, board?: readonly string[]): void;
  /** The lines on the records board now. */
  readonly board: readonly string[];
  /** Off the base: nothing drawn. */
  clear(): void;
  readonly drawn: boolean;
  /** The text on the sign of the base treadmill now; null — none. */
  readonly treadSign: string | null;
  /** The gift of the day waits (docs/01-gdd.md 19.3): its box lit; closed otherwise. */
  setGiftReady(ready: boolean): void;
  /** Its box is lit now. */
  readonly giftReady: boolean;
  /** Q-066: each arch as the camera may meet it — its middle on the snow, yaw, width and top (the sign included). */
  readonly arches: ReadonlyArray<{ x: number; z: number; yaw: number; width: number; top: number }>;
  /** Arch `i` with its light or ice, sign, flag, cup and lock not drawn (back when false); draw calls stay. */
  setArchHidden(i: number, hide: boolean): void;
  archHidden(i: number): boolean;
  dispose(): void;
}

/** Instances and vertices of one arch, to hide it and bring it back. */
type ArchParts = { matrix: Matrix4; fill: [number, number] | null; sign: [number, number]; marks: Array<[number, Matrix4]>; hidden: boolean };
const ZERO = new Matrix4().makeScale(0, 0, 0);

export function createBaseView(theme: ThemeJson, arrowCount = ARROWS): BaseView {
  const group = new Group();
  group.name = 'base';
  const color = (key: string): Color => new Color(theme.materials[key]?.color ?? '#ffffff');
  const lit = (key: string): Color => new Color(theme.materials[key]?.emissive ?? theme.materials[key]?.color ?? '#ffffff');
  const parts: Array<{ dispose(): void }> = [];
  const dummy = new Object3D();
  let drawn = false;
  let treadSign: string | null = null;
  let board: readonly string[] = [];
  /** The box of the gift of the day: its instance in the marks, its two colours, the state shown. */
  let gift: { mesh: InstancedMesh; index: number; lit: Color; closed: Color; ready: boolean | null } | null = null;
  let arches: Array<{ x: number; z: number; yaw: number; width: number; top: number }> = [];
  let archParts: ArchParts[] = [];
  let meshes: { arches: InstancedMesh; fill: Mesh | null; fillPos: Float32Array | null; signs: Mesh; signPos: Float32Array; marks: InstancedMesh } | null = null;
  /** Vertices [from, to) of a geometry folded into one point (hidden) or back from the copy. */
  const fold = (m: Mesh, orig: Float32Array, [from, to]: [number, number], hide: boolean): void => {
    const a = m.geometry.getAttribute('position') as Float32BufferAttribute;
    const arr = a.array as Float32Array;
    for (let k = from * 3; k < to * 3; k++) arr[k] = hide ? orig[from * 3 + (k % 3)]! : orig[k]!;
    a.needsUpdate = true;
  };

  const clear = (): void => {
    for (const p of parts) p.dispose();
    parts.length = 0;
    group.clear();
    drawn = false;
    treadSign = null;
    gift = null;
    board = [];
    arches = [];
    archParts = [];
    meshes = null;
  };

  const view: BaseView = {
    group,
    get drawn() {
      return drawn;
    },
    get treadSign() {
      return treadSign;
    },
    get board() {
      return board;
    },
    get giftReady() {
      return gift?.ready === true;
    },
    get arches() {
      return arches;
    },
    archHidden: (i) => archParts[i]?.hidden === true,
    setArchHidden(i, hide) {
      const a = archParts[i];
      if (!a || !meshes || a.hidden === hide) return;
      a.hidden = hide;
      meshes.arches.setMatrixAt(i, hide ? ZERO : a.matrix);
      meshes.arches.instanceMatrix.needsUpdate = true;
      for (const [k, m] of a.marks) meshes.marks.setMatrixAt(k, hide ? ZERO : m);
      if (a.marks.length) meshes.marks.instanceMatrix.needsUpdate = true;
      if (a.fill && meshes.fill && meshes.fillPos) fold(meshes.fill, meshes.fillPos, a.fill, hide);
      fold(meshes.signs, meshes.signPos, a.sign, hide);
    },
    clear,
    set(level, portals, t, tread, boardLines) {
      clear();
      if (portals.length === 0) return;
      drawn = true;
      const w = portals[0]!.width;
      const h = portals[0]!.height;
      // Arches: two pillars and a lintel, one instance a portal, coloured by state.
      const pillar = new BoxGeometry(1, h, 1);
      const left = pillar.clone().translate(-w / 2 + 0.5, h / 2, 0);
      const right = pillar.clone().translate(w / 2 - 0.5, h / 2, 0);
      const lintel = new BoxGeometry(w, 1, 1).translate(0, h - 0.5, 0);
      const archGeo = mergeGeometries([left, right, lintel])!;
      for (const g of [pillar, left, right, lintel]) g.dispose();
      const archMat = new MeshLambertMaterial({ color: 0xffffff });
      const archMesh = new InstancedMesh(archGeo, archMat, portals.length);
      archMesh.name = 'base-arches';
      const stateColor = { passed: color('portal'), own: lit('portalLight'), locked: color('ice') };
      archParts = portals.map((p, i) => {
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.updateMatrix();
        archMesh.setMatrixAt(i, dummy.matrix);
        archMesh.setColorAt(i, stateColor[p.state]);
        return { matrix: dummy.matrix.clone(), fill: null, sign: [i * 6, i * 6 + 6], marks: [], hidden: false };
      });
      arches = portals.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw, width: p.width, top: p.height + SIGN_OVER + SIGN_H }));
      group.add(archMesh);
      parts.push(archGeo, archMat);

      // Light of the own arch with its pillar, ice over the locked ones: one geometry, vertex colours.
      const pos: number[] = [];
      const col: number[] = [];
      portals.forEach((p, i) => {
        if (p.state === 'passed') return;
        const from = pos.length / 3;
        const local = portalGlowGeometry(0, 0, 0, p.width, p.state === 'own' ? (theme.fx.portal?.pillar ?? 0) : 0, p.state === 'own' ? lit('portal') : color('ice'), lit('portalLight'));
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        for (let k = 0; k < local.pos.length; k += 3) {
          const x = local.pos[k]!;
          const z = local.pos[k + 2]!;
          pos.push(p.x + x * c + z * s, local.pos[k + 1]!, p.z - x * s + z * c);
        }
        col.push(...local.col);
        archParts[i]!.fill = [from, pos.length / 3];
      });
      let fill: Mesh | null = null;
      if (pos.length) {
        const fillGeo = new BufferGeometry();
        fillGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
        fillGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
        fillGeo.computeBoundingSphere();
        const fillMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: FILL_OPACITY, depthWrite: false, side: DoubleSide, fog: false });
        fill = new Mesh(fillGeo, fillMat);
        fill.name = 'base-portal-fill';
        fill.renderOrder = 3;
        group.add(fill);
        parts.push(fillGeo, fillMat);
      }

      // Signs: the name of the mountain, under it «ridge b/c» on the own one begun or «Clear mountain N» on a locked one;
      // the step of the base treadmill over its belts (docs/01-gdd.md 19.3), facing the spawn. One atlas, one mesh.
      const rows: Array<{ x: number; z: number; yaw: number; y: number; text: string; sub: string; w?: number; h?: number }> = portals.map((p) => ({
        x: p.x,
        z: p.z,
        yaw: p.yaw,
        y: p.height + SIGN_OVER,
        text: t(`world.${p.id}`),
        sub: p.state === 'own' && p.ridge ? t('base.portalRidge', { b: p.ridge.b, c: p.ridge.c }) : p.state === 'locked' ? t('base.portalLocked', { n: p.world - 1 }) : '',
      }));
      const belts = level.points.filter((p) => p.type === 'treadmill');
      if (tread && belts.length) {
        const x = belts.reduce((a, b) => a + b.x, 0) / belts.length;
        const len = Number(belts[0]!['length'] ?? 0);
        treadSign = tread;
        rows.push({ x, z: Math.min(...belts.map((b) => b.z)) - len / 2 - TREAD_SIGN_BACK, yaw: 0, y: TREAD_SIGN_Y, text: tread, sub: '' });
      }
      // The «My records» board by the east fence, facing the field (docs/01-gdd.md 19.3): its lines top down.
      const rec = level.points.find((p) => p.type === 'stand' && p['kind'] === 'records');
      if (rec && boardLines?.length) {
        board = [...boardLines];
        boardLines.forEach((line, i) => rows.push({ x: rec.x + BOARD_OUT, z: rec.z, yaw: Math.PI / 2, y: BOARD_TOP - (i + 1) * BOARD_ROW, text: line, sub: '', w: BOARD_W, h: BOARD_ROW }));
      }
      const canvas = document.createElement('canvas');
      canvas.width = ATLAS_W;
      canvas.height = ROW_PX * rows.length;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        rows.forEach((g, i) => {
          const y0 = i * ROW_PX;
          ctx.fillStyle = theme.ui.plaque;
          ctx.globalAlpha = theme.ui.plaqueAlpha;
          ctx.fillRect(4, y0 + 4, ATLAS_W - 8, ROW_PX - 8);
          ctx.globalAlpha = 1;
          ctx.fillStyle = theme.ui.plaqueText;
          ctx.font = `800 ${g.sub ? 36 : 44}px Rubik, sans-serif`;
          ctx.fillText(g.text, ATLAS_W / 2, y0 + (g.sub ? ROW_PX * 0.34 : ROW_PX / 2), ATLAS_W - 24);
          if (g.sub) {
            ctx.font = '700 28px Rubik, sans-serif';
            ctx.fillText(g.sub, ATLAS_W / 2, y0 + ROW_PX * 0.74, ATLAS_W - 24);
          }
        });
      }
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const sPos: number[] = [];
      const sUv: number[] = [];
      rows.forEach((g, i) => {
        const v0 = 1 - (i + 1) / rows.length;
        const v1 = 1 - i / rows.length;
        const c = Math.cos(g.yaw);
        const s = Math.sin(g.yaw);
        // Facing the field (back to the way in): screen left of the reader is +across of the arch.
        const corner = (u: number, yy: number): number[] => [g.x - u * c - 0.6 * s, yy, g.z + u * s - 0.6 * c];
        const w = g.w ?? SIGN_W;
        const hh = g.h ?? SIGN_H;
        const a = corner(-w / 2, g.y);
        const b = corner(w / 2, g.y);
        const cc = corner(w / 2, g.y + hh);
        const d = corner(-w / 2, g.y + hh);
        sPos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
        sUv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
      });
      const signGeo = new BufferGeometry();
      signGeo.setAttribute('position', new Float32BufferAttribute(sPos, 3));
      signGeo.setAttribute('uv', new Float32BufferAttribute(sUv, 2));
      signGeo.computeBoundingSphere();
      const signMat = new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide });
      const signs = new Mesh(signGeo, signMat);
      signs.name = 'base-signs';
      group.add(signs);
      parts.push(signGeo, signMat, tex);

      // Arrows on the snow from the spawn to the own portal (docs/01-gdd.md 19.2; 5 across the base of SP-08).
      const own = portals.find((p) => p.state === 'own');
      const arrowGeo = chevronGeometry();
      const arrowMat = new MeshBasicMaterial({ color: color('wayArrow'), side: DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
      const arrows = new InstancedMesh(arrowGeo, arrowMat, Math.max(1, arrowCount));
      arrows.name = 'base-arrows';
      arrows.count = 0;
      if (own) {
        const [sx, , sz] = level.spawn;
        const dx = own.x - sx;
        const dz = own.z - sz;
        const len = Math.hypot(dx, dz);
        const usable = len - 2 * ARROW_GAP;
        if (usable > 0) {
          for (let i = 0; i < arrowCount; i++) {
            const d = ARROW_GAP + (usable * (i + 0.5)) / arrowCount;
            dummy.position.set(sx + (dx / len) * d, 0.08, sz + (dz / len) * d);
            dummy.rotation.set(0, Math.atan2(dx, dz), 0);
            dummy.updateMatrix();
            arrows.setMatrixAt(i, dummy.matrix);
          }
          arrows.count = arrowCount;
        }
      }
      group.add(arrows);
      parts.push(arrowGeo, arrowMat);

      // A flag and a cup on every passed arch (the flag in a colour of its own, by the mountain), a lock on every locked
      // one on the field side of its ice: boxes of one mesh.
      const passed = portals.filter((p) => p.state === 'passed');
      const locked = portals.filter((p) => p.state === 'locked');
      const flagColors = Object.values(theme.rarity);
      const boxGeo = new BoxGeometry(1, 1, 1);
      const boxMat = new MeshLambertMaterial({ color: 0xffffff });
      // The shop counter (docs/01-gdd.md 19.3): the counter and a pair of sneakers on its showcase (the egg — a ball below).
      const shop = level.points.find((p) => p.type === 'stand' && p['kind'] === 'shop');
      // The gift of the day by the spawn: a box on a stand, lit while the reward waits (setGiftReady).
      const daily = level.points.find((p) => p.type === 'stand' && p['kind'] === 'daily');
      const recs = boardLines?.length ? level.points.find((p) => p.type === 'stand' && p['kind'] === 'records') : undefined;
      const count = passed.length * 3 + locked.length * 2 + (shop ? 2 : 0) + (daily ? 2 : 0) + (recs ? 2 : 0);
      const marks = new InstancedMesh(boxGeo, boxMat, Math.max(1, count));
      marks.name = 'base-marks';
      marks.count = count;
      let k = 0;
      const place = (p: BasePortal, x: number, y: number, d: number, sx: number, sy: number, sz: number, c: Color): void => {
        const cs = Math.cos(p.yaw);
        const sn = Math.sin(p.yaw);
        dummy.position.set(p.x + x * cs + d * sn, y, p.z - x * sn + d * cs);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        marks.setMatrixAt(k, dummy.matrix);
        marks.setColorAt(k, c);
        // A flag, a cup or a lock of an arch hides with it.
        const own = portals.indexOf(p);
        if (own >= 0) archParts[own]!.marks.push([k, dummy.matrix.clone()]);
        k++;
      };
      for (const p of passed) {
        const top = p.height;
        place(p, -p.width / 2 + 0.5, top + 1.5, 0, 0.2, 3, 0.2, color('pole'));
        place(p, -p.width / 2 + 1.4, top + 2.4, 0, 1.6, 1, 0.1, new Color(flagColors[(p.world - 1) % Math.max(1, flagColors.length)] ?? theme.ui.trophies));
        place(p, 0, top + 0.6, 0, 1, 1.2, 1, new Color(theme.ui.trophies));
      }
      if (shop) {
        const at = { world: 0, id: '', x: shop.x, z: shop.z, yaw: 0, width: 0, height: 0, state: 'passed', ridge: null } as BasePortal;
        place(at, 0, COUNTER[1] / 2, 0, COUNTER[0], COUNTER[1], COUNTER[2], color('eggStand'));
        place(at, -COUNTER[0] / 4, COUNTER[1] + 0.25, 0, 0.9, 0.45, 0.45, new Color(theme.ui.stat));
      }
      if (daily) {
        const at = { world: 0, id: '', x: daily.x, z: daily.z, yaw: 0, width: 0, height: 0, state: 'passed', ridge: null } as BasePortal;
        place(at, 0, GIFT_STAND / 2, 0, 1.4, GIFT_STAND, 1.4, color('eggStand'));
        gift = { mesh: marks, index: k, lit: lit('portalLight'), closed: color('chest'), ready: null };
        place(at, 0, GIFT_STAND + GIFT_BOX / 2, 0, GIFT_BOX, GIFT_BOX, GIFT_BOX, gift.closed);
      }
      if (recs) {
        // Two posts under the records board.
        const at = { world: 0, id: '', x: recs.x + BOARD_OUT + 0.3, z: recs.z, yaw: Math.PI / 2, width: 0, height: 0, state: 'passed', ridge: null } as BasePortal;
        const top = BOARD_TOP - (boardLines?.length ?? 0) * BOARD_ROW;
        for (const u of [-BOARD_W / 2 + 0.3, BOARD_W / 2 - 0.3]) place(at, u, top / 2, 0, 0.3, top, 0.3, color('pole'));
      }
      for (const p of locked) {
        place(p, 0, p.height * 0.45, -0.6, 1.4, 1.2, 0.4, new Color(theme.ui.plaque));
        place(p, 0, p.height * 0.45 + 0.9, -0.6, 0.9, 0.7, 0.25, color('pole'));
      }
      dummy.scale.set(1, 1, 1);
      group.add(marks);
      parts.push(boxGeo, boxMat);
      meshes = {
        arches: archMesh,
        fill,
        fillPos: fill ? Float32Array.from(fill.geometry.getAttribute('position').array) : null,
        signs,
        signPos: Float32Array.from(signGeo.getAttribute('position').array),
        marks,
      };
      // Balls: the snowmen of the decor and the egg on the shop counter, one mesh.
      const balls: Array<{ x: number; y: number; z: number; r: number; c: Color }> = [];
      for (const snow of level.points.filter((p) => p.type === 'decor' && p['kind'] === 'snowman'))
        balls.push({ x: snow.x, y: 1.3, z: snow.z, r: 1.4, c: color('snowman') }, { x: snow.x, y: 3.3, z: snow.z, r: 0.9, c: color('snowman') });
      if (shop) balls.push({ x: shop.x + COUNTER[0] / 4, y: COUNTER[1] + 0.5, z: shop.z, r: 0.5, c: color('giftEgg') });
      if (balls.length) {
        const ballGeo = new SphereGeometry(1, 14, 10);
        const ballMat = new MeshLambertMaterial({ color: 0xffffff });
        const mesh = new InstancedMesh(ballGeo, ballMat, balls.length);
        mesh.name = 'base-balls';
        balls.forEach((b, i) => {
          dummy.position.set(b.x, b.y, b.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(b.r, b.r * (b.r < 0.6 ? 1.3 : 1), b.r);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, b.c);
        });
        dummy.scale.set(1, 1, 1);
        group.add(mesh);
        parts.push(ballGeo, ballMat);
      }
    },
    setGiftReady(ready) {
      if (!gift || gift.ready === ready) return;
      gift.ready = ready;
      gift.mesh.setColorAt(gift.index, ready ? gift.lit : gift.closed);
      if (gift.mesh.instanceColor) gift.mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      clear();
    },
  };
  return view;
}

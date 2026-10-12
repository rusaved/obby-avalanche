// What: How the base looks (docs/01-gdd.md 19.2–19.3): the arches of the mountains by state (passed — open with a flag and a cup, own — filled with light under a pillar, locked — iced with a lock), their signs in one atlas, 3 arrows on the snow to the own portal, the snowman.
// Called by: main.ts (createBaseView; set on every entry to the base, clear on a mountain); test-api (drawn).
// Keep: Render only, nothing in the sim (the ice of a locked arch is a hero collider of the level); at most 6 draw calls; colours from theme.json, texts through the caller's t().

import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, SphereGeometry, SRGBColorSpace } from 'three';
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
/** Arrows on the snow from the spawn to the own portal: how many and the gap from both ends (units). */
const ARROWS = 3;
const ARROW_GAP = 4;
const FILL_OPACITY = 0.6;

export interface BaseView {
  group: Group;
  /** The base of `level` with its portals (a new entry: the states may have changed); `t` — the game's texts. */
  set(level: LevelData, portals: readonly BasePortal[], t: (key: string, p?: Record<string, string | number>) => string): void;
  /** Off the base: nothing drawn. */
  clear(): void;
  readonly drawn: boolean;
  dispose(): void;
}

export function createBaseView(theme: ThemeJson): BaseView {
  const group = new Group();
  group.name = 'base';
  const color = (key: string): Color => new Color(theme.materials[key]?.color ?? '#ffffff');
  const lit = (key: string): Color => new Color(theme.materials[key]?.emissive ?? theme.materials[key]?.color ?? '#ffffff');
  const parts: Array<{ dispose(): void }> = [];
  const dummy = new Object3D();
  let drawn = false;

  const clear = (): void => {
    for (const p of parts) p.dispose();
    parts.length = 0;
    group.clear();
    drawn = false;
  };

  const view: BaseView = {
    group,
    get drawn() {
      return drawn;
    },
    clear,
    set(level, portals, t) {
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
      const arches = new InstancedMesh(archGeo, archMat, portals.length);
      arches.name = 'base-arches';
      const stateColor = { passed: color('portal'), own: lit('portalLight'), locked: color('ice') };
      portals.forEach((p, i) => {
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.updateMatrix();
        arches.setMatrixAt(i, dummy.matrix);
        arches.setColorAt(i, stateColor[p.state]);
      });
      group.add(arches);
      parts.push(archGeo, archMat);

      // Light of the own arch with its pillar, ice over the locked ones: one geometry, vertex colours.
      const pos: number[] = [];
      const col: number[] = [];
      for (const p of portals) {
        if (p.state === 'passed') continue;
        const local = portalGlowGeometry(0, 0, 0, p.width, p.state === 'own' ? (theme.fx.portal?.pillar ?? 0) : 0, p.state === 'own' ? lit('portal') : color('ice'), lit('portalLight'));
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        for (let k = 0; k < local.pos.length; k += 3) {
          const x = local.pos[k]!;
          const z = local.pos[k + 2]!;
          pos.push(p.x + x * c + z * s, local.pos[k + 1]!, p.z - x * s + z * c);
        }
        col.push(...local.col);
      }
      if (pos.length) {
        const fillGeo = new BufferGeometry();
        fillGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
        fillGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
        fillGeo.computeBoundingSphere();
        const fillMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: FILL_OPACITY, depthWrite: false, side: DoubleSide, fog: false });
        const fill = new Mesh(fillGeo, fillMat);
        fill.name = 'base-portal-fill';
        fill.renderOrder = 3;
        group.add(fill);
        parts.push(fillGeo, fillMat);
      }

      // Signs: the name of the mountain, under it «ridge b/c» on the own one begun or «Clear mountain N» on a locked one.
      const canvas = document.createElement('canvas');
      canvas.width = ATLAS_W;
      canvas.height = ROW_PX * portals.length;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        portals.forEach((p, i) => {
          const y0 = i * ROW_PX;
          ctx.fillStyle = theme.ui.plaque;
          ctx.globalAlpha = theme.ui.plaqueAlpha;
          ctx.fillRect(4, y0 + 4, ATLAS_W - 8, ROW_PX - 8);
          ctx.globalAlpha = 1;
          ctx.fillStyle = theme.ui.plaqueText;
          const sub = p.state === 'own' && p.ridge ? t('base.portalRidge', { b: p.ridge.b, c: p.ridge.c }) : p.state === 'locked' ? t('base.portalLocked', { n: p.world - 1 }) : '';
          ctx.font = `800 ${sub ? 36 : 44}px Rubik, sans-serif`;
          ctx.fillText(t(`world.${p.id}`), ATLAS_W / 2, y0 + (sub ? ROW_PX * 0.34 : ROW_PX / 2), ATLAS_W - 24);
          if (sub) {
            ctx.font = '700 28px Rubik, sans-serif';
            ctx.fillText(sub, ATLAS_W / 2, y0 + ROW_PX * 0.74, ATLAS_W - 24);
          }
        });
      }
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      const sPos: number[] = [];
      const sUv: number[] = [];
      portals.forEach((p, i) => {
        const v0 = 1 - (i + 1) / portals.length;
        const v1 = 1 - i / portals.length;
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        const y = p.height + SIGN_OVER;
        // Facing the field (back to the way in): screen left of the reader is +across of the arch.
        const corner = (u: number, yy: number): number[] => [p.x - u * c - 0.6 * s, yy, p.z + u * s - 0.6 * c];
        const a = corner(-SIGN_W / 2, y);
        const b = corner(SIGN_W / 2, y);
        const cc = corner(SIGN_W / 2, y + SIGN_H);
        const d = corner(-SIGN_W / 2, y + SIGN_H);
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

      // 3 arrows on the snow from the spawn to the own portal (docs/01-gdd.md 19.2).
      const own = portals.find((p) => p.state === 'own');
      const arrowGeo = chevronGeometry();
      const arrowMat = new MeshBasicMaterial({ color: color('wayArrow'), side: DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
      const arrows = new InstancedMesh(arrowGeo, arrowMat, ARROWS);
      arrows.name = 'base-arrows';
      arrows.count = 0;
      if (own) {
        const [sx, , sz] = level.spawn;
        const dx = own.x - sx;
        const dz = own.z - sz;
        const len = Math.hypot(dx, dz);
        const usable = len - 2 * ARROW_GAP;
        if (usable > 0) {
          for (let i = 0; i < ARROWS; i++) {
            const d = ARROW_GAP + (usable * (i + 0.5)) / ARROWS;
            dummy.position.set(sx + (dx / len) * d, 0.08, sz + (dz / len) * d);
            dummy.rotation.set(0, Math.atan2(dx, dz), 0);
            dummy.updateMatrix();
            arrows.setMatrixAt(i, dummy.matrix);
          }
          arrows.count = ARROWS;
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
      const count = passed.length * 3 + locked.length * 2;
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
        k++;
      };
      for (const p of passed) {
        const top = p.height;
        place(p, -p.width / 2 + 0.5, top + 1.5, 0, 0.2, 3, 0.2, color('pole'));
        place(p, -p.width / 2 + 1.4, top + 2.4, 0, 1.6, 1, 0.1, new Color(flagColors[(p.world - 1) % Math.max(1, flagColors.length)] ?? theme.ui.trophies));
        place(p, 0, top + 0.6, 0, 1, 1.2, 1, new Color(theme.ui.trophies));
      }
      for (const p of locked) {
        place(p, 0, p.height * 0.45, -0.6, 1.4, 1.2, 0.4, new Color(theme.ui.plaque));
        place(p, 0, p.height * 0.45 + 0.9, -0.6, 0.9, 0.7, 0.25, color('pole'));
      }
      dummy.scale.set(1, 1, 1);
      group.add(marks);
      parts.push(boxGeo, boxMat);
      const snow = level.points.find((p) => p.type === 'decor' && p['kind'] === 'snowman');
      if (snow) {
        const ballGeo = new SphereGeometry(1, 14, 10);
        const ballMat = new MeshLambertMaterial({ color: color('snowman') });
        const balls = new InstancedMesh(ballGeo, ballMat, 2);
        balls.name = 'base-snowman';
        [
          [1.4, 1.3],
          [0.9, 3.3],
        ].forEach(([r, y], i) => {
          dummy.position.set(snow.x, y!, snow.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(r!);
          dummy.updateMatrix();
          balls.setMatrixAt(i, dummy.matrix);
        });
        dummy.scale.set(1, 1, 1);
        group.add(balls);
        parts.push(ballGeo, ballMat);
      }
    },
    dispose() {
      clear();
    },
  };
  return view;
}

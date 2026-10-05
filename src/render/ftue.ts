/**
 * First-minute visuals (docs/01-gdd.md 6.2, 6.5): the free egg «Mountain Gift» on its stand (glows, wobbles and
 * cracks on the touch), white arrows on the snow towards the cave entrance on the warning. The pet that jumps out
 * lives in src/render/pets.ts with the others (M3-03). Primitives only, 3 draw calls at most (egg, stand, arrows).
 */
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import type { GiftEggState } from '../sim/gift-egg.ts';
import type { ThemeJson } from '../content/types.ts';

/** Arrows on the snow: how many, their size and the gap from the hero and from the entrance (units). */
const ARROWS = 3;
const ARROW_LEN = 2.6;
const ARROW_WIDTH = 2.4;
/** Thickness of the chevron strokes. */
const ARROW_STROKE = 0.8;
const ARROW_END_GAP = 2;

export interface FtueVisual {
  group: Group;
  /** Egg on its stand; null hides it (the player already has it, or another mountain). */
  setEgg(egg: GiftEggState | null, timeSec: number): void;
  /** Arrows from `from` towards `to` on the snow (y from the floor function); null hides them. */
  setArrows(path: { from: Vector3; to: Vector3; floorY: (z: number) => number } | null): void;
  readonly arrowsShown: boolean;
  dispose(): void;
}

export function createFtueVisual(theme: ThemeJson): FtueVisual {
  const mat = (key: string, fallback: string): string => theme.materials[key]?.color ?? fallback;
  const group = new Group();
  group.name = 'ftue';

  // Egg: a glowing ellipsoid; stand: a short pillar.
  const eggGeo = new SphereGeometry(0.55, 16, 12);
  eggGeo.scale(1, 1.3, 1);
  eggGeo.translate(0, 0.7, 0);
  const eggMat = new MeshLambertMaterial({ color: mat('giftEgg', '#ffffff'), emissive: theme.materials['giftEgg']?.emissive ?? '#000000', emissiveIntensity: 0.45 });
  const egg = new Mesh(eggGeo, eggMat);
  const standGeo = new CylinderGeometry(0.7, 0.85, 0.6, 12);
  standGeo.translate(0, 0.3, 0);
  const standMat = new MeshLambertMaterial({ color: mat('eggStand', '#ffffff') });
  const stand = new Mesh(standGeo, standMat);
  const eggRoot = new Group();
  eggRoot.add(stand);
  egg.position.y = 0.6;
  eggRoot.add(egg);
  eggRoot.visible = false;
  group.add(eggRoot);

  // Arrows: one flat chevron per instance, white, slightly above the snow.
  const shape = new BufferGeometry();
  const L = ARROW_LEN;
  const W = ARROW_WIDTH / 2;
  // Chevron pointing +z: two quads meeting at the tip.
  const T = ARROW_STROKE;
  const v = [-W, 0, -L / 2, -W + T, 0, -L / 2, 0, 0, L / 2 - T, -W, 0, -L / 2, 0, 0, L / 2 - T, 0, 0, L / 2,
    W, 0, -L / 2, 0, 0, L / 2, 0, 0, L / 2 - T, W, 0, -L / 2, 0, 0, L / 2 - T, W - T, 0, -L / 2];
  shape.setAttribute('position', new Float32BufferAttribute(v, 3));
  shape.computeVertexNormals();
  const arrowMat = new MeshBasicMaterial({ color: mat('arrow', '#ffffff'), side: DoubleSide, transparent: true, opacity: 0.92, depthWrite: false });
  const arrows = new InstancedMesh(shape, arrowMat, ARROWS);
  arrows.count = 0;
  arrows.frustumCulled = false;
  arrows.renderOrder = 2;
  group.add(arrows);
  const dummy = new Object3D();
  const dir = new Vector3();

  const visual: FtueVisual & { arrowsShown: boolean } = {
    group,
    arrowsShown: false,
    setEgg(state, timeSec) {
      if (!state || state.phase === 'done') {
        eggRoot.visible = false;
        return;
      }
      eggRoot.visible = true;
      eggRoot.position.set(state.x, state.y, state.z);
      if (state.phase === 'hatching') {
        // Wobble faster and faster, then a crack (squash) right before the pet jumps out.
        const k = Math.min(1, state.t / state.hatchSec);
        egg.rotation.z = Math.sin(state.t * (14 + 20 * k)) * 0.35 * (0.4 + k);
        const squash = k > 0.8 ? 1 - (k - 0.8) * 1.5 : 1;
        egg.scale.set(2 - squash, squash, 2 - squash);
        eggMat.emissiveIntensity = 0.45 + k * 0.8;
      } else {
        egg.rotation.z = Math.sin(timeSec * 2) * 0.05;
        egg.scale.set(1, 1, 1);
        eggMat.emissiveIntensity = 0.35 + 0.15 * Math.sin(timeSec * 3);
      }
    },
    setArrows(path) {
      if (!path) {
        arrows.count = 0;
        visual.arrowsShown = false;
        return;
      }
      dir.subVectors(path.to, path.from).setY(0);
      const len = dir.length();
      const usable = len - 2 * ARROW_END_GAP;
      if (usable < ARROW_LEN) {
        arrows.count = 0;
        visual.arrowsShown = false;
        return;
      }
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      for (let i = 0; i < ARROWS; i++) {
        const d = ARROW_END_GAP + (usable * (i + 0.5)) / ARROWS;
        const x = path.from.x + dir.x * d;
        const z = path.from.z + dir.z * d;
        dummy.position.set(x, path.floorY(z) + 0.08, z);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        arrows.setMatrixAt(i, dummy.matrix);
      }
      arrows.count = ARROWS;
      arrows.instanceMatrix.needsUpdate = true;
      visual.arrowsShown = true;
    },
    dispose() {
      eggGeo.dispose();
      eggMat.dispose();
      standGeo.dispose();
      standMat.dispose();
      shape.dispose();
      arrowMat.dispose();
    },
  };
  return visual;
}

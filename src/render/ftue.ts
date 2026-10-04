/**
 * First-minute visuals (docs/01-gdd.md 6.2, 6.5): the free egg «Mountain Gift» on its stand (glows, wobbles and
 * cracks on the touch), the pet that jumps out and follows the hero, white arrows on the snow towards the cave
 * entrance on the warning. Primitives only, 4 draw calls at most (egg, stand, pet, arrows).
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GiftEggState } from '../sim/gift-egg.ts';
import type { ThemeJson } from '../content/types.ts';

/** Arrows on the snow: how many, their size and the gap from the hero and from the entrance (units). */
const ARROWS = 3;
const ARROW_LEN = 2.6;
const ARROW_WIDTH = 2.4;
/** Thickness of the chevron strokes. */
const ARROW_STROKE = 0.8;
const ARROW_END_GAP = 2;
/** Pet: cube size, place behind the hero, follow stiffness, hop height while the hero runs. */
const PET_SIZE = 1.2;
const PET_BEHIND = 2.2;
const PET_SIDE = 1.6;
const PET_FOLLOW = 6;
const PET_HOP = 0.35;

export interface PetColors {
  color: string;
  accent: string;
}

export interface FtueVisual {
  group: Group;
  /** Egg on its stand; null hides it (the player already has it, or another mountain). */
  setEgg(egg: GiftEggState | null, timeSec: number): void;
  /** The pet next to the hero; null hides it. `from` — where it jumps out (the egg) the first time. */
  setPet(colors: PetColors | null, from?: Vector3): void;
  updatePet(hero: Vector3, heroYaw: number, running: boolean, dt: number, timeSec: number): void;
  /** Arrows from `from` towards `to` on the snow (y from the floor function); null hides them. */
  setArrows(path: { from: Vector3; to: Vector3; floorY: (z: number) => number } | null): void;
  readonly petShown: boolean;
  readonly arrowsShown: boolean;
  dispose(): void;
}

function colored(geo: BufferGeometry, color: Color): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: Color): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colored(g, color);
}

/** Bunny-like block pet (docs/01a-content.md 6): cube body, two long ears, nose, eyes; feet at y = 0, faces +z. */
function petGeometry(colors: PetColors, eyeColor: string): BufferGeometry {
  const body = new Color(colors.color);
  const accent = new Color(colors.accent);
  const eye = new Color(eyeColor);
  const s = PET_SIZE;
  const parts = [
    box(s, s, s, 0, s / 2, 0, body),
    box(0.22, 0.8, 0.18, -0.28, s + 0.38, -0.1, body),
    box(0.22, 0.8, 0.18, 0.28, s + 0.38, -0.1, body),
    box(0.12, 0.55, 0.04, -0.28, s + 0.4, -0.0, accent),
    box(0.12, 0.55, 0.04, 0.28, s + 0.4, -0.0, accent),
    box(0.2, 0.14, 0.08, 0, s * 0.42, s / 2 + 0.03, accent),
    box(0.12, 0.16, 0.06, -0.24, s * 0.66, s / 2 + 0.02, eye),
    box(0.12, 0.16, 0.06, 0.24, s * 0.66, s / 2 + 0.02, eye),
  ];
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
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

  // Pet.
  const petMat = new MeshLambertMaterial({ vertexColors: true });
  let pet: Mesh | null = null;
  const petPos = new Vector3();
  let petYaw = 0;
  let jumpT = -1;
  const jumpFrom = new Vector3();

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

  const visual: FtueVisual & { petShown: boolean; arrowsShown: boolean } = {
    group,
    petShown: false,
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
    setPet(colors, from) {
      if (pet) {
        group.remove(pet);
        pet.geometry.dispose();
        pet = null;
      }
      visual.petShown = colors !== null;
      if (!colors) return;
      pet = new Mesh(petGeometry(colors, mat('petEye', '#000000')), petMat);
      pet.castShadow = false;
      group.add(pet);
      if (from) {
        jumpFrom.copy(from);
        petPos.copy(from);
        jumpT = 0;
      } else jumpT = -1;
    },
    updatePet(hero, heroYaw, running, dt, timeSec) {
      if (!pet) return;
      // Behind the hero and a bit to the side, turned the way he runs.
      const tx = hero.x - Math.sin(heroYaw) * PET_BEHIND + Math.cos(heroYaw) * PET_SIDE;
      const tz = hero.z - Math.cos(heroYaw) * PET_BEHIND - Math.sin(heroYaw) * PET_SIDE;
      if (jumpT >= 0) {
        // Out of the egg: an arc to its place in 0.5 s.
        jumpT += dt;
        const k = Math.min(1, jumpT / 0.5);
        petPos.set(jumpFrom.x + (tx - jumpFrom.x) * k, jumpFrom.y + (hero.y - jumpFrom.y) * k + Math.sin(k * Math.PI) * 2, jumpFrom.z + (tz - jumpFrom.z) * k);
        if (k >= 1) jumpT = -1;
      } else {
        const f = 1 - Math.exp(-PET_FOLLOW * dt);
        petPos.x += (tx - petPos.x) * f;
        petPos.z += (tz - petPos.z) * f;
        petPos.y += (hero.y - petPos.y) * f;
      }
      if (Math.hypot(tx - petPos.x, tz - petPos.z) > 30) petPos.set(tx, hero.y, tz);
      petYaw = heroYaw;
      pet.position.copy(petPos);
      if (running && jumpT < 0) pet.position.y += Math.abs(Math.sin(timeSec * 9)) * PET_HOP;
      pet.rotation.y = petYaw;
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
      pet?.geometry.dispose();
      petMat.dispose();
      shape.dispose();
      arrowMat.dispose();
    },
  };
  return visual;
}

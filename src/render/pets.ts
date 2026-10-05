/**
 * Pets next to the hero and eggs on their stands (docs/01-gdd.md 7.2; docs/01a-content.md 6): block pets of 1.2 u
 * (body with ears and eyes, accent nose and inner ears) hop 2–3 u behind the hero and hide in the cave with him;
 * eggs sit on the stands of the mountain, the one bought wobbles 1 s, cracks and the pet jumps out. Instanced:
 * 3 draw calls for every pet and every egg (pet body, pet accent, eggs).
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemeJson } from '../content/types.ts';

const PET_SIZE = 1.2;
/** Places of the 3 pets around the hero: [behind, side] in units (2–3 u away). */
const PLACES: ReadonlyArray<[number, number]> = [
  [2.2, 1.6],
  [2.2, -1.6],
  [3.4, 0],
];
const PET_FOLLOW = 6;
const PET_HOP = 0.35;
/** A pet farther than this from its place (portal, «Snowed in!» roll) jumps straight to it. */
const PET_SNAP = 30;
const JUMP_SEC = 0.5;
const MAX_PETS = 3;
const MAX_EGGS = 4;
/** The egg sits on the stand top (the stand box is 1.2 u high, src/render/level-mesh.ts). */
const STAND_TOP = 1.2;

export interface PetLook {
  color: string;
  accent: string;
}

export interface PetsVisual {
  group: Group;
  /** The pets on, in slot order; a new list keeps the places of the pets that stay. */
  setPets(looks: readonly PetLook[]): void;
  /** Pet in `slot` jumps out of `from` to its place (the egg of a stand, the free egg). */
  jumpOut(slot: number, from: Vector3): void;
  /** Stands of this mountain (their foot points). */
  setStands(stands: ReadonlyArray<{ x: number; y: number; z: number }>): void;
  /** Per frame: the hero (render position, yaw, running), the egg being hatched (stand index, 0–1) or null. */
  update(hero: Vector3, heroYaw: number, running: boolean, dt: number, timeSec: number, hatch: { stand: number; k: number } | null): void;
  /** Pets drawn now. */
  readonly shown: number;
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

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

export function createPetsVisual(theme: ThemeJson): PetsVisual {
  const group = new Group();
  group.name = 'pets';
  const white = new Color('#ffffff');
  const eye = new Color(theme.materials['petEye']?.color ?? '#000000');
  const s = PET_SIZE;
  // Body: white vertices take the instance colour (pet colour), the eyes stay dark. Feet at y = 0, faces +z.
  const bodyGeo = merge([
    box(s, s, s, 0, s / 2, 0, white),
    box(0.26, 0.42, 0.2, -0.32, s + 0.2, -0.1, white),
    box(0.26, 0.42, 0.2, 0.32, s + 0.2, -0.1, white),
    box(0.12, 0.16, 0.06, -0.24, s * 0.66, s / 2 + 0.02, eye),
    box(0.12, 0.16, 0.06, 0.24, s * 0.66, s / 2 + 0.02, eye),
  ]);
  // Accent: nose, inner ears, a tail (instance colour: pet accent).
  const accentGeo = merge([
    box(0.22, 0.14, 0.08, 0, s * 0.42, s / 2 + 0.03, white),
    box(0.14, 0.28, 0.04, -0.32, s + 0.2, 0.0, white),
    box(0.14, 0.28, 0.04, 0.32, s + 0.2, 0.0, white),
    box(0.3, 0.3, 0.3, 0, s * 0.35, -s / 2 - 0.12, white),
  ]);
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const body = new InstancedMesh(bodyGeo, mat, MAX_PETS);
  const accent = new InstancedMesh(accentGeo, mat, MAX_PETS);
  for (const m of [body, accent]) {
    m.count = 0;
    m.frustumCulled = false;
    group.add(m);
  }

  const eggGeo = new SphereGeometry(0.55, 14, 10);
  eggGeo.scale(1, 1.3, 1);
  eggGeo.translate(0, 0.7, 0);
  const eggMat = new MeshLambertMaterial({ color: theme.materials['giftEgg']?.color ?? '#ffffff', emissive: theme.materials['giftEgg']?.emissive ?? '#000000', emissiveIntensity: 0.4 });
  const eggs = new InstancedMesh(eggGeo, eggMat, MAX_EGGS);
  eggs.count = 0;
  eggs.frustumCulled = false;
  group.add(eggs);
  let stands: Array<{ x: number; y: number; z: number }> = [];

  const dummy = new Object3D();
  const tint = new Color();
  const pos = Array.from({ length: MAX_PETS }, () => new Vector3());
  const placed = [false, false, false];
  const jump = Array.from({ length: MAX_PETS }, () => ({ t: -1, from: new Vector3() }));
  let looks: PetLook[] = [];

  const visual: PetsVisual & { shown: number } = {
    group,
    shown: 0,
    setPets(next) {
      looks = next.slice(0, MAX_PETS);
      for (let i = looks.length; i < MAX_PETS; i++) placed[i] = false;
      looks.forEach((l, i) => {
        body.setColorAt(i, tint.set(l.color));
        accent.setColorAt(i, tint.set(l.accent));
      });
      body.count = accent.count = looks.length;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      if (accent.instanceColor) accent.instanceColor.needsUpdate = true;
      visual.shown = looks.length;
    },
    jumpOut(slot, from) {
      const j = jump[slot];
      if (!j) return;
      j.t = 0;
      j.from.copy(from);
      pos[slot]!.copy(from);
      placed[slot] = true;
    },
    setStands(list) {
      stands = list.slice(0, MAX_EGGS).map((p) => ({ x: p.x, y: p.y + STAND_TOP, z: p.z }));
      eggs.count = stands.length;
    },
    update(hero, heroYaw, running, dt, timeSec, hatch) {
      const sin = Math.sin(heroYaw);
      const cos = Math.cos(heroYaw);
      for (let i = 0; i < looks.length; i++) {
        const [behind, side] = PLACES[i]!;
        const tx = hero.x - sin * behind + cos * side;
        const tz = hero.z - cos * behind - sin * side;
        const p = pos[i]!;
        const j = jump[i]!;
        if (j.t >= 0) {
          // Out of the egg: an arc to its place in 0.5 s.
          j.t += dt;
          const k = Math.min(1, j.t / JUMP_SEC);
          p.set(j.from.x + (tx - j.from.x) * k, j.from.y + (hero.y - j.from.y) * k + Math.sin(k * Math.PI) * 2, j.from.z + (tz - j.from.z) * k);
          if (k >= 1) j.t = -1;
        } else if (!placed[i] || Math.hypot(tx - p.x, tz - p.z) > PET_SNAP) {
          p.set(tx, hero.y, tz);
          placed[i] = true;
        } else {
          const f = 1 - Math.exp(-PET_FOLLOW * dt);
          p.x += (tx - p.x) * f;
          p.z += (tz - p.z) * f;
          p.y += (hero.y - p.y) * f;
        }
        dummy.position.copy(p);
        // Hops while the hero runs, each pet out of step with the others.
        if (running && j.t < 0) dummy.position.y += Math.abs(Math.sin(timeSec * 9 + i * 1.3)) * PET_HOP;
        dummy.rotation.set(0, heroYaw, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        body.setMatrixAt(i, dummy.matrix);
        accent.setMatrixAt(i, dummy.matrix);
      }
      if (looks.length > 0) {
        body.instanceMatrix.needsUpdate = true;
        accent.instanceMatrix.needsUpdate = true;
      }
      stands.forEach((st, i) => {
        dummy.position.set(st.x, st.y, st.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        if (hatch && hatch.stand === i) {
          // Wobble faster and faster, then a crack (squash) right before the pet jumps out.
          const k = hatch.k;
          dummy.rotation.z = Math.sin(k * (14 + 20 * k) * 1.2) * 0.35 * (0.4 + k);
          const squash = k > 0.8 ? 1 - (k - 0.8) * 1.5 : 1;
          dummy.scale.set(2 - squash, squash, 2 - squash);
        } else dummy.rotation.z = Math.sin(timeSec * 2 + i) * 0.05;
        dummy.updateMatrix();
        eggs.setMatrixAt(i, dummy.matrix);
      });
      if (stands.length > 0) eggs.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      bodyGeo.dispose();
      accentGeo.dispose();
      mat.dispose();
      eggGeo.dispose();
      eggMat.dispose();
    },
  };
  return visual;
}

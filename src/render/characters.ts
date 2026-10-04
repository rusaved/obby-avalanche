/**
 * Blocky characters (docs/02-tech.md 9.2): 6 rounded-box parts, faces from a code-drawn atlas of 8 emotions,
 * procedural animations, instancing by part type with instanceColor — hero, bots and studio figures on at most
 * 8 draw calls. Accessories are instanced per primitive shape.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AccessoriesJson, SkinsJson } from '../content/types.ts';

export const FACES = ['neutral', 'happy', 'wow', 'scared', 'determined', 'laugh', 'wink', 'sleep'] as const;
export type FaceName = (typeof FACES)[number];

/** Proportions of every blocky character, one place (Q-019, Q-021, producer's reference 04.10): classic blocky avatar —
 * head 1.3, torso 2×2×1, arms and legs 1×2×1, arms right against the torso (gap 0.02) and tilted 4° outward from the
 * shoulder so they read as hanging, not glued. K scales the 5.3-unit figure to a ≈ 5-unit hero. */
const K = 0.95;
const P = { head: 1.3, torso: { w: 2.0, h: 2.0, d: 1.0 }, arm: { w: 1.0, h: 2.0, d: 1.0 }, leg: { w: 1.0, h: 2.0, d: 1.0 }, armGap: 0.02, legGap: 0.01, armTiltRad: 0.07 };
const box = (b: { w: number; h: number; d: number }) => ({ w: b.w * K, h: b.h * K, d: b.d * K });
export const PART = { head: P.head * K, torso: box(P.torso), arm: box(P.arm), leg: box(P.leg), armGap: P.armGap * K, legGap: P.legGap * K, armTiltRad: P.armTiltRad };
const FACE_CELL = 128;

/** In the snowball the figure shrinks and rises so the head pokes out of a 3-unit ball. */
const BALL_SCALE = 0.55;
const BALL_LIFT = 1.1;

export type CharacterPose = 'idle' | 'run' | 'jump' | 'fall' | 'land' | 'cover' | 'win' | 'ball';

export interface CharacterInstance {
  readonly index: number;
  position: Vector3;
  yaw: number;
  pose: CharacterPose;
  /** Run phase advance per frame from speed; 0–1 speed factor. */
  speedFactor: number;
  phase: number;
  face: number;
  /** Landing squash timer (seconds left). */
  squash: number;
  visible: boolean;
  skinId: string;
  hatId: string | null;
}

export interface Characters {
  group: Group;
  drawCalls: number;
  create(skinId: string): CharacterInstance;
  setSkin(ch: CharacterInstance, skinId: string): void;
  update(dt: number): void;
  faceAtlas: CanvasTexture;
  dispose(): void;
}

/** One face of the atlas on the head colour as a small picture (the hero mark on the HUD mountain bar). */
export function faceDataUrl(headColor: string, face: string, size = 48): string {
  const atlas = document.createElement('canvas');
  drawFaceAtlas(atlas);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = headColor;
  ctx.fillRect(0, 0, size, size);
  const i = Math.max(0, FACES.indexOf(face as FaceName));
  ctx.drawImage(atlas, i * FACE_CELL, 0, FACE_CELL, FACE_CELL, 0, 0, size, size);
  return out.toDataURL();
}

/** Draws the 8 faces into a 1024×256 atlas (transparent background, skin colour shows through). */
export function drawFaceAtlas(canvas: HTMLCanvasElement): void {
  canvas.width = FACE_CELL * 8;
  canvas.height = FACE_CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const ink = '#1d2230';
  const cheek = 'rgba(255,120,120,0.45)';
  FACES.forEach((face, i) => {
    const ox = i * FACE_CELL;
    const c = FACE_CELL;
    const eye = (x: number, y: number, r: number): void => {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(ox + x, y, r, r * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ox + x - r * 0.3, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    };
    const line = (x1: number, y1: number, x2: number, y2: number, w = 7): void => {
      ctx.strokeStyle = ink;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox + x1, y1);
      ctx.lineTo(ox + x2, y2);
      ctx.stroke();
    };
    const mouthArc = (y: number, r: number, from: number, to: number, w = 7): void => {
      ctx.strokeStyle = ink;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ox + c / 2, y, r, from, to);
      ctx.stroke();
    };
    const cheeks = (): void => {
      ctx.fillStyle = cheek;
      ctx.beginPath();
      ctx.arc(ox + c * 0.24, c * 0.6, 9, 0, Math.PI * 2);
      ctx.arc(ox + c * 0.76, c * 0.6, 9, 0, Math.PI * 2);
      ctx.fill();
    };
    switch (face) {
      case 'neutral':
        eye(c * 0.35, c * 0.42, 9);
        eye(c * 0.65, c * 0.42, 9);
        mouthArc(c * 0.62, 14, 0.15 * Math.PI, 0.85 * Math.PI);
        break;
      case 'happy':
        eye(c * 0.35, c * 0.42, 10);
        eye(c * 0.65, c * 0.42, 10);
        cheeks();
        mouthArc(c * 0.58, 20, 0.1 * Math.PI, 0.9 * Math.PI, 8);
        break;
      case 'wow':
        eye(c * 0.35, c * 0.4, 12);
        eye(c * 0.65, c * 0.4, 12);
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.ellipse(ox + c / 2, c * 0.7, 11, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'scared':
        eye(c * 0.35, c * 0.45, 11);
        eye(c * 0.65, c * 0.45, 11);
        line(c * 0.22, c * 0.28, c * 0.42, c * 0.33);
        line(c * 0.78, c * 0.28, c * 0.58, c * 0.33);
        mouthArc(c * 0.8, 12, 1.15 * Math.PI, 1.85 * Math.PI);
        break;
      case 'determined':
        eye(c * 0.35, c * 0.44, 9);
        eye(c * 0.65, c * 0.44, 9);
        line(c * 0.22, c * 0.3, c * 0.44, c * 0.36);
        line(c * 0.78, c * 0.3, c * 0.56, c * 0.36);
        line(c * 0.38, c * 0.68, c * 0.62, c * 0.68);
        break;
      case 'laugh':
        line(c * 0.26, c * 0.42, c * 0.44, c * 0.38);
        line(c * 0.26, c * 0.42, c * 0.44, c * 0.46);
        line(c * 0.74, c * 0.42, c * 0.56, c * 0.38);
        line(c * 0.74, c * 0.42, c * 0.56, c * 0.46);
        cheeks();
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(ox + c / 2, c * 0.62, 18, 0, Math.PI);
        ctx.fill();
        break;
      case 'wink':
        eye(c * 0.35, c * 0.42, 10);
        line(c * 0.56, c * 0.42, c * 0.74, c * 0.42);
        cheeks();
        mouthArc(c * 0.58, 18, 0.15 * Math.PI, 0.85 * Math.PI, 8);
        break;
      case 'sleep':
        line(c * 0.26, c * 0.44, c * 0.44, c * 0.44);
        line(c * 0.56, c * 0.44, c * 0.74, c * 0.44);
        mouthArc(c * 0.66, 8, 0.2 * Math.PI, 0.8 * Math.PI, 6);
        break;
    }
  });
}

interface PartSpec {
  name: 'head' | 'torso' | 'arm' | 'leg';
  geometry: () => RoundedBoxGeometry;
  perCharacter: number;
}

const PARTS: PartSpec[] = [
  { name: 'head', geometry: () => new RoundedBoxGeometry(PART.head, PART.head, PART.head, 2, 0.16), perCharacter: 1 },
  { name: 'torso', geometry: () => new RoundedBoxGeometry(PART.torso.w, PART.torso.h, PART.torso.d, 2, 0.1), perCharacter: 1 },
  { name: 'arm', geometry: () => new RoundedBoxGeometry(PART.arm.w, PART.arm.h, PART.arm.d, 2, 0.1), perCharacter: 2 },
  { name: 'leg', geometry: () => new RoundedBoxGeometry(PART.leg.w, PART.leg.h, PART.leg.d, 2, 0.1), perCharacter: 2 },
];

const _dummy = new Object3D();
const _mat = new Matrix4();
const _color = new Color();
const HIDDEN = new Matrix4().makeScale(0.0001, 0.0001, 0.0001);

export function createCharacters(skins: SkinsJson, accessories: AccessoriesJson, maxCharacters = 16): Characters {
  const group = new Group();
  group.name = 'characters';
  const canvas = document.createElement('canvas');
  drawFaceAtlas(canvas);
  const faceAtlas = new CanvasTexture(canvas);
  faceAtlas.colorSpace = SRGBColorSpace;
  faceAtlas.minFilter = LinearFilter;
  faceAtlas.magFilter = LinearFilter;
  faceAtlas.generateMipmaps = false;

  const meshes = new Map<string, InstancedMesh>();
  let faceIndexAttr: InstancedBufferAttribute | null = null;
  for (const spec of PARTS) {
    const geo = spec.geometry();
    const mat = new MeshLambertMaterial({ color: 0xffffff });
    const count = maxCharacters * spec.perCharacter;
    const mesh = new InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.name = `char-${spec.name}`;
    mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, HIDDEN);
      mesh.setColorAt(i, _color.set('#ffffff'));
    }
    if (spec.name === 'head') {
      faceIndexAttr = new InstancedBufferAttribute(new Float32Array(count), 1);
      geo.setAttribute('faceIndex', faceIndexAttr);
      mat.onBeforeCompile = (shader) => {
        shader.uniforms['faceAtlas'] = { value: faceAtlas };
        shader.uniforms['faceCount'] = { value: FACES.length };
        shader.uniforms['headSize'] = { value: PART.head };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float faceIndex;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nvarying float vFaceIndex;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;\nvFaceIndex = faceIndex;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D faceAtlas;\nuniform float faceCount;\nuniform float headSize;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nvarying float vFaceIndex;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
if (vObjNormal.z > 0.6) {
  vec2 fuv = vec2(vObjPos.x / headSize + 0.5, vObjPos.y / headSize + 0.5);
  fuv.x = (fuv.x + vFaceIndex) / faceCount;
  vec4 face = texture2D(faceAtlas, fuv);
  diffuseColor.rgb = mix(diffuseColor.rgb, face.rgb, face.a);
}`,
          );
      };
    }
    meshes.set(spec.name, mesh);
    group.add(mesh);
  }

  // Accessories: one InstancedMesh per primitive shape.
  const shapeMeshes = new Map<string, InstancedMesh>();
  const shapeGeo: Record<string, () => BoxGeometry | SphereGeometry | CylinderGeometry | ConeGeometry> = {
    box: () => new BoxGeometry(1, 1, 1),
    sphere: () => new SphereGeometry(0.5, 12, 10),
    cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 14),
    cone: () => new ConeGeometry(0.5, 1, 14),
  };
  const shapesUsed = new Set(accessories.accessories.flatMap((a) => a.parts.map((p) => p.shape)));
  const maxPartsPerShape = Math.max(1, ...accessories.accessories.map((a) => a.parts.length));
  for (const shape of shapesUsed) {
    const make = shapeGeo[shape];
    if (!make) continue;
    const mesh = new InstancedMesh(make(), new MeshLambertMaterial({ color: 0xffffff }), maxCharacters * maxPartsPerShape);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = `acc-${shape}`;
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, HIDDEN);
    shapeMeshes.set(shape, mesh);
    group.add(mesh);
  }
  const accessoryById = new Map(accessories.accessories.map((a) => [a.id, a]));
  const skinById = new Map(skins.skins.map((s) => [s.id, s]));

  const instances: CharacterInstance[] = [];

  const applySkin = (ch: CharacterInstance): void => {
    const skin = skinById.get(ch.skinId) ?? skinById.get(skins.default);
    if (!skin) return;
    const colors = skin.colors;
    const set = (part: string, slot: number, hex: string): void => {
      const mesh = meshes.get(part);
      if (!mesh) return;
      mesh.setColorAt(slot, _color.set(hex));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    set('head', ch.index, colors.head);
    set('torso', ch.index, colors.torso);
    set('arm', ch.index * 2, colors.armL);
    set('arm', ch.index * 2 + 1, colors.armR);
    set('leg', ch.index * 2, colors.legL);
    set('leg', ch.index * 2 + 1, colors.legR);
    ch.hatId = skin.hat;
    ch.face = Math.max(0, FACES.indexOf(skin.face as FaceName));
    const hat = skin.hat ? accessoryById.get(skin.hat) : undefined;
    if (hat) {
      hat.parts.forEach((p, pi) => {
        const mesh = shapeMeshes.get(p.shape);
        if (!mesh) return;
        mesh.setColorAt(ch.index * maxPartsPerShape + pi, _color.set(p.color));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    }
  };

  const writePart = (part: string, slot: number, local: Matrix4, world: Matrix4): void => {
    const mesh = meshes.get(part);
    if (!mesh) return;
    _mat.multiplyMatrices(world, local);
    mesh.setMatrixAt(slot, _mat);
  };

  const characters: Characters = {
    group,
    get drawCalls() {
      return meshes.size + shapeMeshes.size;
    },
    faceAtlas,
    create(skinId) {
      const index = instances.length;
      if (index >= maxCharacters) throw new Error('characters: pool exhausted');
      const ch: CharacterInstance = {
        index,
        position: new Vector3(),
        yaw: 0,
        pose: 'idle',
        speedFactor: 0,
        phase: 0,
        face: 0,
        squash: 0,
        visible: true,
        skinId,
        hatId: null,
      };
      instances.push(ch);
      applySkin(ch);
      return ch;
    },
    setSkin(ch, skinId) {
      ch.skinId = skinId;
      applySkin(ch);
    },
    update(dt) {
      const root = new Object3D();
      for (const ch of instances) {
        const headMesh = meshes.get('head');
        if (faceIndexAttr) {
          faceIndexAttr.setX(ch.index, ch.face);
          faceIndexAttr.needsUpdate = true;
        }
        if (!ch.visible) {
          for (const spec of PARTS) {
            const mesh = meshes.get(spec.name);
            if (!mesh) continue;
            for (let k = 0; k < spec.perCharacter; k++) mesh.setMatrixAt(ch.index * spec.perCharacter + k, HIDDEN);
          }
          for (const mesh of shapeMeshes.values()) for (let k = 0; k < maxPartsPerShape; k++) mesh.setMatrixAt(ch.index * maxPartsPerShape + k, HIDDEN);
          continue;
        }
        // Animation (docs/02-tech.md 9.2): sine-based run, breathing idle, jump/fall poses, landing squash.
        const running = ch.pose === 'run' && ch.speedFactor > 0.05;
        ch.phase += dt * (running ? 6 + 8 * ch.speedFactor : 1.2);
        if (ch.squash > 0) ch.squash = Math.max(0, ch.squash - dt);
        const sq = ch.squash > 0 ? 1 - 0.15 * (ch.squash / 0.1) : 1;
        const swing = running ? Math.sin(ch.phase) * (0.5 + 0.5 * ch.speedFactor) : 0;
        const breathe = ch.pose === 'idle' ? Math.sin(ch.phase) * 0.03 : 0;
        const lean = running ? -0.21 * ch.speedFactor : 0;
        let armL = swing;
        let armR = -swing;
        let legL = -swing;
        let legR = swing;
        let bodyRot = lean;
        if (ch.pose === 'jump') {
          armL = -2.4;
          armR = -2.4;
          legL = 0.4;
          legR = -0.3;
        } else if (ch.pose === 'fall') {
          armL = -1.4;
          armR = -1.4;
          legL = 0.2;
          legR = 0.2;
        } else if (ch.pose === 'cover') {
          armL = -2.9;
          armR = -2.9;
          bodyRot = 0.3;
        } else if (ch.pose === 'win') {
          armL = -3.0;
          armR = -3.0;
        } else if (ch.pose === 'ball') {
          // «Snowed in!» (docs/01-gdd.md 4.5): curled up and small, only the hat and the eyes stick out of the ball.
          armL = 0.3;
          armR = 0.3;
          legL = -1.2;
          legR = -1.2;
        }

        // Run bob: a light bounce twice per stride and a hint of side sway make the stride read as springy.
        const bob = running ? Math.abs(Math.sin(ch.phase)) * 0.12 * ch.speedFactor : 0;
        const sway = running ? Math.sin(ch.phase) * 0.04 * ch.speedFactor : 0;
        const ballK = ch.pose === 'ball' ? BALL_SCALE : 1;
        root.position.copy(ch.position);
        root.position.y += bob + (ch.pose === 'ball' ? BALL_LIFT : 0);
        root.rotation.set(0, ch.yaw, sway);
        root.scale.set(ballK / sq, ballK * sq, ballK / sq);
        root.updateMatrix();
        const world = root.matrix;
        const legTop = PART.leg.h;
        const torsoBase = legTop;
        const headBase = torsoBase + PART.torso.h;

        _dummy.position.set(0, torsoBase + PART.torso.h / 2 + breathe, 0);
        _dummy.rotation.set(bodyRot, 0, 0);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        writePart('torso', ch.index, _dummy.matrix, world);

        _dummy.position.set(0, headBase + PART.head / 2 + breathe * 1.5, 0);
        _dummy.rotation.set(bodyRot * 0.5, 0, 0);
        _dummy.updateMatrix();
        writePart('head', ch.index, _dummy.matrix, world);
        const headMatrix = _dummy.matrix.clone();

        const armPivotY = headBase - 0.15;
        for (const [k, rot, sx] of [
          [0, armL, -1],
          [1, armR, 1],
        ] as const) {
          _dummy.position.set(sx * (PART.torso.w / 2 + PART.arm.w / 2 + PART.armGap), armPivotY, 0);
          _dummy.rotation.set(rot, 0, -sx * PART.armTiltRad);
          _dummy.updateMatrix();
          const pivot = _dummy.matrix.clone();
          _dummy.position.set(0, -PART.arm.h / 2 + 0.1, 0);
          _dummy.rotation.set(0, 0, 0);
          _dummy.updateMatrix();
          pivot.multiply(_dummy.matrix);
          writePart('arm', ch.index * 2 + k, pivot, world);
        }
        for (const [k, rot, sx] of [
          [0, legL, -1],
          [1, legR, 1],
        ] as const) {
          _dummy.position.set(sx * (PART.leg.w / 2 + PART.legGap), legTop, 0);
          _dummy.rotation.set(rot, 0, 0);
          _dummy.updateMatrix();
          const pivot = _dummy.matrix.clone();
          _dummy.position.set(0, -PART.leg.h / 2 + 0.05, 0);
          _dummy.rotation.set(0, 0, 0);
          _dummy.updateMatrix();
          pivot.multiply(_dummy.matrix);
          writePart('leg', ch.index * 2 + k, pivot, world);
        }

        // Hat parts follow the head.
        const hat = ch.hatId ? accessoryById.get(ch.hatId) : undefined;
        for (const mesh of shapeMeshes.values()) for (let k = 0; k < maxPartsPerShape; k++) mesh.setMatrixAt(ch.index * maxPartsPerShape + k, HIDDEN);
        if (hat) {
          hat.parts.forEach((p, pi) => {
            const mesh = shapeMeshes.get(p.shape);
            if (!mesh) return;
            _dummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(p.size[0], p.size[1], p.size[2]);
            _dummy.updateMatrix();
            _mat.multiplyMatrices(world, headMatrix).multiply(_dummy.matrix);
            mesh.setMatrixAt(ch.index * maxPartsPerShape + pi, _mat);
          });
        }
        void headMesh;
      }
      // Draw only the live part of the pool: hidden instances cost vertices otherwise.
      for (const spec of PARTS) {
        const mesh = meshes.get(spec.name);
        if (mesh) mesh.count = Math.max(1, instances.length * spec.perCharacter);
      }
      for (const mesh of shapeMeshes.values()) mesh.count = Math.max(1, instances.length * maxPartsPerShape);
      for (const mesh of meshes.values()) mesh.instanceMatrix.needsUpdate = true;
      for (const mesh of shapeMeshes.values()) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshLambertMaterial).dispose();
      }
      for (const mesh of shapeMeshes.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshLambertMaterial).dispose();
      }
      faceAtlas.dispose();
    },
  };
  return characters;
}

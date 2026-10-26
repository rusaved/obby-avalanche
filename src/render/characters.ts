// What: Blocky characters (hero, bots, studio figures): a rounded-cylinder (or cube) head, 5 rounded-box parts dressed by a 512² clothes atlas, 9 canvas-drawn faces, hair of rounded boxes, procedural poses, accessories and wings, all instanced.
// Called by: main.ts; app/handles.ts, app/bots-view.ts, app/wave-view.ts; render/threat/snowball.ts.
// Keep: All characters stay within the draw-call budget (about 8); proportions live only in PART (camera.ts HEAD depends on it); skins and accessories come from content JSON.

/**
 * Blocky characters (docs/02-tech.md 9.2): a head and 5 rounded-box parts, faces from a code-drawn atlas of 9 emotions,
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
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AccessoriesJson, SkinsJson } from '../content/types.ts';


/** SP-03 (docs/01-gdd.md 20.3): the stride rate of a run at `speed` — √(speed / baseSpeed), 1…3, with the run share of
 * camera.speedPow on (the open pace); 1 without it (classic and fast as before). */
export function runCadence(tuning: { controller: { baseSpeed: number }; camera: { speedPow?: number } }, speed: number): number {
  if (tuning.camera.speedPow === undefined) return 1;
  return Math.max(1, Math.min(3, Math.sqrt(Math.max(0, speed) / Math.max(1, tuning.controller.baseSpeed))));
}
export const FACES = ['neutral', 'happy', 'wow', 'scared', 'determined', 'laugh', 'wink', 'sleep', 'smile'] as const;
export type FaceName = (typeof FACES)[number];

/** Proportions of every blocky character, one place (Q-019, Q-021, producer's reference 04.10; Z-03 — the canon of the
 * genre's top): torso 2×2×1, arms and legs 1×2×1, a head 1.3 across and 1.2 tall — 23 % of the figure — a rounded
 * cylinder (or a cube, skins.json headShape), arms right against the torso (gap 0.02) and tilted 4° outward from the
 * shoulder so they read as hanging, not glued. K scales the 5.2-unit figure to a ≈ 5-unit hero. */
const K = 0.95;
const P = { head: 1.3, headH: 1.2, torso: { w: 2.0, h: 2.0, d: 1.0 }, arm: { w: 1.0, h: 2.0, d: 1.0 }, leg: { w: 1.0, h: 2.0, d: 1.0 }, armGap: 0.02, legGap: 0.01, armTiltRad: 0.07 };
const box = (b: { w: number; h: number; d: number }) => ({ w: b.w * K, h: b.h * K, d: b.d * K });
export const PART = { head: P.head * K, headH: P.headH * K, torso: box(P.torso), arm: box(P.arm), leg: box(P.leg), armGap: P.armGap * K, legGap: P.legGap * K, armTiltRad: P.armTiltRad };
const FACE_CELL = 128;
/** Z-03: the clothes atlas — a 128² cell per character slot, 4 across (16 slots — 512²). */
const CLOTH_CELL = 128;
const CLOTH_COLS = 4;
/** Lathe segments round the head (16–24, Z-03) and the rounding of its rims. */
const HEAD_SEGMENTS = 16;
const HEAD_RIM = 0.2;
/** Head shapes of a skin: 0 — the rounded cylinder, 1 — the cube (other platforms' canon). */
const HEAD_SHAPES = ['cylinder', 'cube'] as const;
/** At most this many rounded boxes in a hairstyle (Z-03: 6–12). */
const HAIR_MAX = 12;

/** Wings (M3-04b): root of each half off the spine, angles of the swept-back pose at rest and open, flap amplitude. */
const WING_ROOT_X = 0.3;
const WING_REST = 0.25;
const WING_IDLE = 0.06;
const WING_OPEN = 0.35;
const WING_FLAP = 0.35;
const _wingRoot = new Matrix4();
const _wingTurn = new Matrix4();

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
  /** Strides a second × this (SP-03, docs/01-gdd.md 20.3: the legs go faster as the run does; 1 — as before). */
  cadence: number;
  phase: number;
  face: number;
  /** Landing squash timer (seconds left). */
  squash: number;
  visible: boolean;
  skinId: string;
  hatId: string | null;
  /** Wings on the back (accessories.json, attach «back»; M3-04b), flapping with the run and the jump. */
  wingsId: string | null;
  /** Hands up over the head (the golden gift, docs/01-gdd.md 4.9); legs keep the pose. */
  carry: boolean;
  /** Size of the figure (1 — the hero; the giant of the open slope is about 4, docs/01-gdd.md 17.6). */
  scale: number;
  /** See-through share (1 — solid; tuning camera.fadeAlpha — the giant between the camera and the hero, docs/01-gdd.md
   * 19.8): drawn as a screen-door dither of its body parts, no blending, no extra draw call. */
  fade: number;
}

export interface Characters {
  group: Group;
  drawCalls: number;
  create(skinId: string): CharacterInstance;
  setSkin(ch: CharacterInstance, skinId: string): void;
  /** Wings on the back, null — none (M3-04b). */
  setWings(ch: CharacterInstance, wingsId: string | null): void;
  /** Bots (docs/01-gdd.md 7.12): own colours per part, a hat accessory in its own colour, a face of the atlas. */
  paint(ch: CharacterInstance, look: { head: string; torso: string; arms: string; legs: string; hat: string | null; hatColor: string; face: string; cut?: OutfitLook['cut'] }): void;
  update(dt: number): void;
  /** G-08: the hero — his colours more saturated and a dark outline round his body (theme.json hero); null — none. */
  setHero(ch: CharacterInstance | null): void;
  /** G-08: the outline drawn or not (the base keeps its 30 draw calls of SP-08 — no outline there). */
  outlined: boolean;
  faceAtlas: CanvasTexture;
  dispose(): void;
}

/** One face of the atlas on the head colour as a small picture (the hero mark on the HUD mountain bar). `atlas` — the one
 * already drawn (M5-06: drawing the whole atlas again cost 0.3 s of the boot at CPU ×4). */
export function faceDataUrl(headColor: string, face: string, size = 48, atlas?: HTMLCanvasElement): string {
  if (!atlas) {
    atlas = document.createElement('canvas');
    drawFaceAtlas(atlas);
  }
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

/** Draws the 9 faces into a row atlas of 128² cells (transparent background, skin colour shows through). */
export function drawFaceAtlas(canvas: HTMLCanvasElement): void {
  canvas.width = FACE_CELL * FACES.length;
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
      case 'smile':
        // Z-02: the default face — two tall eyes and a wide closed smile, the canon of the genre.
        eye(c * 0.36, c * 0.4, 8);
        eye(c * 0.64, c * 0.4, 8);
        mouthArc(c * 0.5, 26, 0.22 * Math.PI, 0.78 * Math.PI, 7);
        break;
    }
  });
}

interface PartSpec {
  name: 'head' | 'torso' | 'arm' | 'leg';
  geometry: () => BufferGeometry;
  perCharacter: number;
}

/** Z-03: the head — a rounded cylinder turned on a lathe and a rounded cube in one geometry; the vertex attribute
 * `shape` (HEAD_SHAPES) tells them apart, an instance draws only its own (no draw call per shape). */
function headGeometry(): BufferGeometry {
  const r = PART.head / 2;
  const h = PART.headH / 2;
  const rim = HEAD_RIM * K;
  const pts: Vector2[] = [new Vector2(0, -h)];
  const arc = (cy: number, from: number, to: number): void => {
    for (let i = 0; i <= 3; i++) {
      const a = from + ((to - from) * i) / 3;
      pts.push(new Vector2(r - rim + Math.cos(a) * rim, cy + Math.sin(a) * rim));
    }
  };
  arc(-h + rim, -Math.PI / 2, 0);
  arc(h - rim, 0, Math.PI / 2);
  pts.push(new Vector2(0, h));
  // The seam of the lathe at the back of the head (its start is +z — the face side; π puts it behind).
  const lathe = new LatheGeometry(pts, HEAD_SEGMENTS, Math.PI);
  const cube = new RoundedBoxGeometry(PART.head, PART.headH, PART.head, 1, 0.16);
  const parts = [lathe.toNonIndexed(), cube.toNonIndexed()];
  parts.forEach((g, i) => {
    g.deleteAttribute('uv');
    g.setAttribute('shape', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(i), 1));
  });
  const geo = mergeGeometries(parts);
  lathe.dispose();
  cube.dispose();
  return geo;
}

const PARTS: PartSpec[] = [
  { name: 'head', geometry: headGeometry, perCharacter: 1 },
  { name: 'torso', geometry: () => new RoundedBoxGeometry(PART.torso.w, PART.torso.h, PART.torso.d, 2, 0.1), perCharacter: 1 },
  { name: 'arm', geometry: () => new RoundedBoxGeometry(PART.arm.w, PART.arm.h, PART.arm.d, 2, 0.1), perCharacter: 2 },
  { name: 'leg', geometry: () => new RoundedBoxGeometry(PART.leg.w, PART.leg.h, PART.leg.d, 2, 0.1), perCharacter: 2 },
];

/** Z-03: what a character wears — the colours of its parts and the cut (skins.json outfit; bots — a jacket). */
export interface OutfitLook {
  head: string;
  torso: string;
  armL: string;
  armR: string;
  legL: string;
  legR: string;
  cut: 'tee' | 'jacket';
}

const _shade = new Color();
/** A colour `k` lighter (k > 0) or darker (k < 0), as a CSS string. */
function shade(hex: string, k: number): string {
  _shade.set(hex);
  if (k < 0) _shade.multiplyScalar(1 + k);
  else _shade.lerp(new Color(1, 1, 1), k);
  return `#${_shade.getHexString()}`;
}

/** Z-03: one 128² cell of the clothes atlas: the torso front and back (64² each, top), the left arm and leg, the right arm
 * and leg (32 × 64 each, bottom). A T-shirt or an open jacket, trousers with a belt, white sneakers, hands of the skin. */
export function drawOutfit(ctx: CanvasRenderingContext2D, cx: number, cy: number, o: OutfitLook, kit: NonNullable<SkinsJson['outfit']>): void {
  const rect = (x: number, y: number, w: number, h: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(cx + x, cy + y, w, h);
  };
  const jacket = o.cut === 'jacket';
  for (const back of [false, true]) {
    const ox = back ? 64 : 0;
    rect(ox, 0, 64, 64, o.torso);
    // Shoulders lit, the hem in shadow: the box reads as cloth.
    rect(ox, 0, 64, 4, shade(o.torso, 0.12));
    rect(ox, 50, 64, 4, shade(o.torso, -0.22));
    // Trousers come up to the belt.
    rect(ox, 54, 64, 10, o.legL);
    rect(ox, 54, 64, 3, shade(o.legL, -0.35));
    if (!back && jacket) {
      // Open jacket: the shirt between the flaps, zip edges, lapels and pockets.
      rect(24, 0, 16, 50, kit.inner);
      rect(22, 0, 2, 50, shade(o.torso, -0.35));
      rect(40, 0, 2, 50, shade(o.torso, -0.35));
      ctx.fillStyle = shade(o.torso, -0.15);
      ctx.beginPath();
      ctx.moveTo(cx + 22, cy);
      ctx.lineTo(cx + 14, cy);
      ctx.lineTo(cx + 22, cy + 14);
      ctx.moveTo(cx + 42, cy);
      ctx.lineTo(cx + 50, cy);
      ctx.lineTo(cx + 42, cy + 14);
      ctx.fill();
      rect(6, 36, 12, 8, shade(o.torso, -0.2));
      rect(46, 36, 12, 8, shade(o.torso, -0.2));
    } else if (!back) {
      // T-shirt: a round collar of the skin and a light band across the chest.
      ctx.fillStyle = o.head;
      ctx.beginPath();
      ctx.arc(cx + 32, cy, 9, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = shade(o.torso, -0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + 32, cy, 10, 0, Math.PI);
      ctx.stroke();
      rect(0, 22, 64, 6, shade(o.torso, 0.35));
    } else if (jacket) rect(ox + 12, 0, 40, 8, shade(o.torso, -0.18));
  }
  const limbs: Array<[number, string, string]> = [
    [0, o.armL, o.legL],
    [64, o.armR, o.legR],
  ];
  for (const [ox, arm, leg] of limbs) {
    // Arm: a T-shirt sleeve over a sleeve of the arm colour (a jacket — the whole arm with a cuff), the hand at the bottom.
    rect(ox, 0 + 64, 32, 64, arm);
    if (jacket) rect(ox, 46 + 64, 32, 4, shade(arm, -0.3));
    else {
      rect(ox, 64, 32, 22, o.torso);
      rect(ox, 84, 32, 2, shade(o.torso, -0.3));
    }
    rect(ox, 50 + 64, 32, 14, o.head);
    // Leg: the trousers, a crease, the white sneaker with a sole, the laces and a stripe of the top colour.
    rect(ox + 32, 64, 32, 64, leg);
    rect(ox + 32 + 15, 64, 2, 46, shade(leg, -0.18));
    rect(ox + 32, 64 + 46, 32, 18, kit.shoe);
    rect(ox + 32, 64 + 60, 32, 4, kit.sole);
    rect(ox + 32, 64 + 48, 32, 3, kit.lace);
    rect(ox + 32, 64 + 54, 32, 3, o.torso);
  }
}

const _dummy = new Object3D();
const _mat = new Matrix4();
const _color = new Color();
const HIDDEN = new Matrix4().makeScale(0.0001, 0.0001, 0.0001);

/**
 * Screen-door see-through for a body part (docs/01-gdd.md 19.8): with its instance `fade` under 1 a pixel is dropped
 * by an interleaved-gradient threshold, so `fade` of the pixels stay — the hero shows through, depth and draw calls as before.
 */
function dither(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float fade;\nvarying float vFade;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = fade;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vFade;')
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vFade) discard;');
}

export function createCharacters(skins: SkinsJson, accessories: AccessoriesJson, maxCharacters = 16, heroLook?: { saturation: number; outline: string; outlineWidth: number }): Characters {
  const group = new Group();
  group.name = 'characters';
  const canvas = document.createElement('canvas');
  drawFaceAtlas(canvas);
  const faceAtlas = new CanvasTexture(canvas);
  faceAtlas.colorSpace = SRGBColorSpace;
  faceAtlas.minFilter = LinearFilter;
  faceAtlas.magFilter = LinearFilter;
  faceAtlas.generateMipmaps = false;

  // Z-03: the clothes atlas, a cell per character slot, drawn on setSkin and paint.
  const kit = skins.outfit ?? { shoe: '#ffffff', sole: '#ffffff', lace: '#ffffff', inner: '#ffffff' };
  const clothCanvas = document.createElement('canvas');
  const clothRows = Math.ceil(maxCharacters / CLOTH_COLS);
  clothCanvas.width = CLOTH_CELL * CLOTH_COLS;
  clothCanvas.height = CLOTH_CELL * clothRows;
  const clothCtx = clothCanvas.getContext('2d');
  const clothAtlas = new CanvasTexture(clothCanvas);
  clothAtlas.colorSpace = SRGBColorSpace;
  clothAtlas.minFilter = LinearFilter;
  clothAtlas.magFilter = LinearFilter;
  clothAtlas.generateMipmaps = false;

  const meshes = new Map<string, InstancedMesh>();
  const fadeAttrs = new Map<string, InstancedBufferAttribute>();
  let faceIndexAttr: InstancedBufferAttribute | null = null;
  let headShapeAttr: InstancedBufferAttribute | null = null;
  for (const spec of PARTS) {
    const geo = spec.geometry();
    const mat = new MeshLambertMaterial({ color: 0xffffff });
    // The head keeps one slot past the pool for the hero's outline (a bigger head turned inside out, G-08).
    const count = maxCharacters * spec.perCharacter + (spec.name === 'head' ? 1 : 0);
    const fadeAttr = new InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    geo.setAttribute('fade', fadeAttr);
    fadeAttrs.set(spec.name, fadeAttr);
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
      headShapeAttr = new InstancedBufferAttribute(new Float32Array(count), 1);
      geo.setAttribute('headShape', headShapeAttr);
      mat.onBeforeCompile = (shader) => {
        shader.uniforms['faceAtlas'] = { value: faceAtlas };
        shader.uniforms['faceCount'] = { value: FACES.length };
        shader.uniforms['headSize'] = { value: new Vector2(PART.head, PART.headH) };
        // Z-03: a vertex of the other head shape folds into the centre (its triangles vanish); the face is a picture
        // projected onto the front half of the head, the same on the cylinder and on the cube.
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float faceIndex;\nattribute float headShape;\nattribute float shape;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nvarying float vFaceIndex;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(shape - headShape) > 0.5) transformed = vec3(0.0);\nvObjPos = position;\nvObjNormal = normal;\nvFaceIndex = faceIndex;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D faceAtlas;\nuniform float faceCount;\nuniform vec2 headSize;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nvarying float vFaceIndex;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
if (vObjNormal.z > 0.3 && vObjPos.z > 0.0) {
  vec2 fuv = vec2(vObjPos.x / headSize.x + 0.5, vObjPos.y / headSize.y + 0.5);
  fuv.x = (clamp(fuv.x, 0.0, 1.0) + vFaceIndex) / faceCount;
  vec4 face = texture2D(faceAtlas, fuv);
  diffuseColor.rgb = mix(diffuseColor.rgb, face.rgb, face.a);
}`,
          );
        dither(shader);
      };
    } else {
      // Z-03: the clothes — the part samples its region of the character's cell, mapped by its own box coordinates.
      const cloth = new InstancedBufferAttribute(new Float32Array(count), 1);
      for (let i = 0; i < count; i++) cloth.setX(i, spec.perCharacter === 2 ? i : i * 2);
      geo.setAttribute('cloth', cloth);
      const size = spec.name === 'torso' ? PART.torso : spec.name === 'arm' ? PART.arm : PART.leg;
      const region = spec.name === 'torso' ? 0 : spec.name === 'arm' ? 1 : 2;
      // The three parts differ only by the numbers baked into the source: a key of their own, or they share one program.
      mat.customProgramCacheKey = () => `char-cloth-${region}`;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms['clothAtlas'] = { value: clothAtlas };
        shader.uniforms['clothGrid'] = { value: new Vector2(CLOTH_COLS, clothRows) };
        shader.uniforms['partSize'] = { value: new Vector3(size.w, size.h, size.d) };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float cloth;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nvarying float vCloth;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;\nvCloth = cloth;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D clothAtlas;\nuniform vec2 clothGrid;\nuniform vec3 partSize;\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nvarying float vCloth;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
{
  float cell = floor(vCloth * 0.5 + 0.01);
  float side = vCloth - cell * 2.0;
  vec2 org = vec2(mod(cell, clothGrid.x), floor(cell / clothGrid.x + 0.01));
  vec2 lp = vec2(vObjPos.x / partSize.x + 0.5, vObjPos.y / partSize.y + 0.5);
  vec4 reg;
  ${region === 0 ? `reg = vec4(0.0, 0.5, 0.5, 0.5);
  if (vObjNormal.z < -0.5) { reg.x = 0.5; lp.x = 1.0 - lp.x; }` : `if (abs(vObjNormal.x) > 0.5) lp.x = vObjPos.z / partSize.z + 0.5;
  reg = vec4(${region === 1 ? '0.0' : '0.25'} + side * 0.5, 0.0, 0.25, 0.5);`}
  lp = clamp(lp, 0.03, 0.97);
  vec2 cuv = reg.xy + lp * reg.zw;
  diffuseColor.rgb *= texture2D(clothAtlas, vec2((org.x + cuv.x) / clothGrid.x, 1.0 - (org.y + 1.0 - cuv.y) / clothGrid.y)).rgb;
}`,
          );
        dither(shader);
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
  // G-08: the outline of the hero rides on the box mesh — no draw call of its own (all characters ≤ 8, docs/02 9.2).
  const OUTLINE_SLOTS = 6;
  const lineOn = !!heroLook && heroLook.outlineWidth > 0;
  if (lineOn) shapesUsed.add('box');
  // Slots per character: the hat's parts first, the wings' parts after them (M3-04b).
  const partsOf = (back: boolean): number => Math.max(0, ...accessories.accessories.filter((a) => (a.attach === 'back') === back).map((a) => a.parts.length));
  const wingBase = Math.max(1, partsOf(false));
  const maxPartsPerShape = wingBase + partsOf(true);
  for (const shape of shapesUsed) {
    const make = shapeGeo[shape];
    if (!make) continue;
    const mesh = new InstancedMesh(make(), new MeshLambertMaterial({ color: 0xffffff }), maxCharacters * maxPartsPerShape + (lineOn && shape === 'box' ? OUTLINE_SLOTS : 0));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = `acc-${shape}`;
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, HIDDEN);
    shapeMeshes.set(shape, mesh);
    group.add(mesh);
  }
  const accessoryById = new Map(accessories.accessories.map((a) => [a.id, a]));
  const skinById = new Map(skins.skins.map((s) => [s.id, s]));
  // Z-03: hair — rounded boxes of the styles of accessories.json `hair`, HAIR_MAX slots a character, one draw call.
  const hairById = new Map((accessories.hair ?? []).map((h) => [h.id, h]));
  const hairMesh = hairById.size > 0 ? new InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 1, 0.22), new MeshLambertMaterial({ color: 0xffffff }), maxCharacters * HAIR_MAX) : null;
  if (hairMesh) {
    hairMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    hairMesh.frustumCulled = false;
    hairMesh.name = 'char-hair';
    for (let i = 0; i < hairMesh.count; i++) {
      hairMesh.setMatrixAt(i, HIDDEN);
      hairMesh.setColorAt(i, _color.set('#ffffff'));
    }
    group.add(hairMesh);
  }
  const hairOf = new Map<number, { id: string; color: string }>();
  const drawCell = (index: number, o: OutfitLook): void => {
    if (!clothCtx) return;
    drawOutfit(clothCtx, (index % CLOTH_COLS) * CLOTH_CELL, Math.floor(index / CLOTH_COLS) * CLOTH_CELL, o, kit);
    clothAtlas.needsUpdate = true;
  };
  const setShape = (index: number, shape: string | undefined): void => {
    headShapeAttr?.setX(index, Math.max(0, HEAD_SHAPES.indexOf((shape ?? 'cylinder') as (typeof HEAD_SHAPES)[number])));
    if (headShapeAttr) headShapeAttr.needsUpdate = true;
  };
  const SMILE = FACES.indexOf('smile');
  const faceOf = (name: string): number => {
    const i = FACES.indexOf(name as FaceName);
    return i >= 0 ? i : SMILE;
  };

  const instances: CharacterInstance[] = [];
  // G-08 (producer 26.10: «the hero and his actions brighter and more colourful»): the six body parts of the hero as
  // boxes a little bigger and turned inside out (a mirrored scale shows their back faces) in the outline colour, on the
  // box mesh of the accessories after its pool.
  let hero: CharacterInstance | null = null;
  const outline = lineOn ? (shapeMeshes.get('box') ?? null) : null;
  const LINE0 = maxCharacters * maxPartsPerShape;
  if (outline && heroLook) for (let i = 0; i < OUTLINE_SLOTS; i++) {
    outline.setMatrixAt(LINE0 + i, HIDDEN);
    outline.setColorAt(LINE0 + i, _color.set(heroLook.outline));
  }
  if (outline?.instanceColor) outline.instanceColor.needsUpdate = true;
  const _hsl = { h: 0, s: 0, l: 0 };
  /** The colour of a part: the hero's more saturated. */
  const tone = (ch: CharacterInstance, hex: string): Color => {
    _color.set(hex);
    if (ch !== hero || !heroLook) return _color;
    _color.getHSL(_hsl);
    return _color.setHSL(_hsl.h, Math.min(1, _hsl.s * heroLook.saturation), _hsl.l);
  };
  const _outline = new Matrix4();
  const writeOutline = (slot: number, local: Matrix4, world: Matrix4, w: number, h: number, d: number): void => {
    if (!outline || !heroLook) return;
    const t = heroLook.outlineWidth * 2;
    _mat.multiplyMatrices(world, local).multiply(_outline.makeScale(-(w + t), h + t, d + t));
    outline.setMatrixAt(LINE0 + slot, _mat);
  };

  const applySkin = (ch: CharacterInstance): void => {
    const skin = skinById.get(ch.skinId) ?? skinById.get(skins.default);
    if (!skin) return;
    const colors = skin.colors;
    const set = (part: string, slot: number, hex: string): void => {
      const mesh = meshes.get(part);
      if (!mesh) return;
      mesh.setColorAt(slot, tone(ch, hex));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    const hx = (hex: string): string => `#${tone(ch, hex).getHexString()}`;
    set('head', ch.index, colors.head);
    // The clothes carry the colours of the body (Z-03): its parts stay white under the atlas.
    for (const [part, n] of [['torso', 1], ['arm', 2], ['leg', 2]] as const) for (let k = 0; k < n; k++) set(part, ch.index * n + k, '#ffffff');
    drawCell(ch.index, { head: hx(colors.head), torso: hx(colors.torso), armL: hx(colors.armL), armR: hx(colors.armR), legL: hx(colors.legL), legR: hx(colors.legR), cut: skin.outfit ?? 'tee' });
    setShape(ch.index, skin.headShape);
    if (skin.hair && hairById.has(skin.hair.style)) hairOf.set(ch.index, { id: skin.hair.style, color: skin.hair.color });
    else hairOf.delete(ch.index);
    paintHair(ch);
    ch.hatId = skin.hat;
    ch.face = faceOf(skin.face);
    const hat = skin.hat ? accessoryById.get(skin.hat) : undefined;
    if (hat) {
      hat.parts.forEach((p, pi) => {
        const mesh = shapeMeshes.get(p.shape);
        if (!mesh) return;
        mesh.setColorAt(ch.index * maxPartsPerShape + pi, tone(ch, p.color));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    }
  };
  const paintHair = (ch: CharacterInstance): void => {
    const hair = hairOf.get(ch.index);
    if (!hairMesh || !hair) return;
    for (let k = 0; k < HAIR_MAX; k++) hairMesh.setColorAt(ch.index * HAIR_MAX + k, tone(ch, hair.color));
    if (hairMesh.instanceColor) hairMesh.instanceColor.needsUpdate = true;
  };
  const applyWings = (ch: CharacterInstance): void => {
    const wings = ch.wingsId ? accessoryById.get(ch.wingsId) : undefined;
    wings?.parts.forEach((p, pi) => {
      const mesh = shapeMeshes.get(p.shape);
      if (!mesh) return;
      mesh.setColorAt(ch.index * maxPartsPerShape + wingBase + pi, tone(ch, p.color));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
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
      return meshes.size + shapeMeshes.size + (hairMesh ? 1 : 0);
    },
    outlined: true,
    setHero(ch) {
      const was = hero;
      hero = ch;
      if (was) {
        applySkin(was);
        applyWings(was);
      }
      if (ch) {
        applySkin(ch);
        applyWings(ch);
      }
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
        cadence: 1,
        phase: 0,
        face: 0,
        squash: 0,
        visible: true,
        skinId,
        hatId: null,
        wingsId: null,
        carry: false,
        scale: 1,
        fade: 1,
      };
      instances.push(ch);
      applySkin(ch);
      return ch;
    },
    setSkin(ch, skinId) {
      ch.skinId = skinId;
      applySkin(ch);
    },
    setWings(ch, wingsId) {
      ch.wingsId = wingsId && accessoryById.get(wingsId)?.attach === 'back' ? wingsId : null;
      applyWings(ch);
    },
    paint(ch, look) {
      const set = (part: string, slot: number, hex: string): void => {
        const mesh = meshes.get(part);
        if (!mesh) return;
        mesh.setColorAt(slot, _color.set(hex));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      };
      set('head', ch.index, look.head);
      for (const [part, n] of [['torso', 1], ['arm', 2], ['leg', 2]] as const) for (let k = 0; k < n; k++) set(part, ch.index * n + k, '#ffffff');
      drawCell(ch.index, { head: look.head, torso: look.torso, armL: look.arms, armR: look.arms, legL: look.legs, legR: look.legs, cut: look.cut ?? 'tee' });
      setShape(ch.index, undefined);
      hairOf.delete(ch.index);
      ch.hatId = look.hat;
      ch.face = faceOf(look.face);
      const hat = look.hat ? accessoryById.get(look.hat) : undefined;
      // The first part of the hat takes the bot's colour, the rest (pompom) keep their own.
      hat?.parts.forEach((p, pi) => {
        const mesh = shapeMeshes.get(p.shape);
        if (!mesh) return;
        mesh.setColorAt(ch.index * maxPartsPerShape + pi, _color.set(pi === 0 ? look.hatColor : p.color));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    },
    update(dt) {
      const root = new Object3D();
      let headOutlined = false;
      for (const ch of instances) {
        const headMesh = meshes.get('head');
        if (faceIndexAttr) {
          faceIndexAttr.setX(ch.index, ch.face);
          faceIndexAttr.needsUpdate = true;
        }
        for (const spec of PARTS) {
          const attr = fadeAttrs.get(spec.name);
          if (!attr) continue;
          for (let k = 0; k < spec.perCharacter; k++) {
            const i = ch.index * spec.perCharacter + k;
            if (attr.getX(i) === ch.fade) continue;
            attr.setX(i, ch.fade);
            attr.needsUpdate = true;
          }
        }
        const lined = ch === hero && outline !== null && characters.outlined && ch.visible && ch.fade >= 0.999;
        if (ch === hero && outline && !lined) for (let i = 0; i < OUTLINE_SLOTS; i++) outline.setMatrixAt(LINE0 + i, HIDDEN);
        if (!ch.visible) {
          for (const spec of PARTS) {
            const mesh = meshes.get(spec.name);
            if (!mesh) continue;
            for (let k = 0; k < spec.perCharacter; k++) mesh.setMatrixAt(ch.index * spec.perCharacter + k, HIDDEN);
          }
          for (const mesh of shapeMeshes.values()) for (let k = 0; k < maxPartsPerShape; k++) mesh.setMatrixAt(ch.index * maxPartsPerShape + k, HIDDEN);
          if (hairMesh) for (let k = 0; k < HAIR_MAX; k++) hairMesh.setMatrixAt(ch.index * HAIR_MAX + k, HIDDEN);
          continue;
        }
        // Animation (docs/02-tech.md 9.2): sine-based run, breathing idle, jump/fall poses, landing squash.
        const running = ch.pose === 'run' && ch.speedFactor > 0.05;
        ch.phase += dt * (running ? (6 + 8 * ch.speedFactor) * ch.cadence : 1.2);
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
        if (ch.carry && ch.pose !== 'ball') {
          armL = -3.0;
          armR = -3.0;
        }

        // Run bob: a light bounce twice per stride and a hint of side sway make the stride read as springy.
        const bob = running ? Math.abs(Math.sin(ch.phase)) * 0.12 * ch.speedFactor : 0;
        const sway = running ? Math.sin(ch.phase) * 0.04 * ch.speedFactor : 0;
        const ballK = ch.pose === 'ball' ? BALL_SCALE : 1;
        root.position.copy(ch.position);
        root.position.y += bob + (ch.pose === 'ball' ? BALL_LIFT : 0);
        root.rotation.set(0, ch.yaw, sway);
        const size = ch.scale;
        root.scale.set((ballK / sq) * size, ballK * sq * size, (ballK / sq) * size);
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
        if (lined) writeOutline(0, _dummy.matrix, world, PART.torso.w, PART.torso.h, PART.torso.d);
        const torsoMatrix = _dummy.matrix.clone();

        _dummy.position.set(0, headBase + PART.headH / 2 + breathe * 1.5, 0);
        _dummy.rotation.set(bodyRot * 0.5, 0, 0);
        _dummy.updateMatrix();
        writePart('head', ch.index, _dummy.matrix, world);
        const headMatrix = _dummy.matrix.clone();
        // The outline of the head: the head itself a little bigger and turned inside out, in the slot past the live pool.
        if (lined && heroLook && headMesh && headShapeAttr && faceIndexAttr) {
          const t = heroLook.outlineWidth * 2;
          const o = instances.length;
          _mat.multiplyMatrices(world, headMatrix).multiply(_outline.makeScale(-(1 + t / PART.head), 1 + t / PART.headH, 1 + t / PART.head));
          headMesh.setMatrixAt(o, _mat);
          headMesh.setColorAt(o, _color.set(heroLook.outline));
          if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
          headShapeAttr.setX(o, headShapeAttr.getX(ch.index));
          headShapeAttr.needsUpdate = true;
          faceIndexAttr.setX(o, SMILE);
          headOutlined = true;
        }

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
          if (lined) writeOutline(2 + k, pivot, world, PART.arm.w, PART.arm.h, PART.arm.d);
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
          if (lined) writeOutline(4 + k, pivot, world, PART.leg.w, PART.leg.h, PART.leg.d);
        }

        // Hair follows the head (Z-03).
        if (hairMesh) {
          const hair = hairOf.get(ch.index);
          const style = hair ? hairById.get(hair.id) : undefined;
          for (let k = 0; k < HAIR_MAX; k++) {
            const p = style?.parts[k];
            if (!p) {
              hairMesh.setMatrixAt(ch.index * HAIR_MAX + k, HIDDEN);
              continue;
            }
            _dummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
            _dummy.rotation.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
            _dummy.scale.set(p.size[0], p.size[1], p.size[2]);
            _dummy.updateMatrix();
            _mat.multiplyMatrices(world, headMatrix).multiply(_dummy.matrix);
            hairMesh.setMatrixAt(ch.index * HAIR_MAX + k, _mat);
          }
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
        // Wings follow the torso and flap: each half turns about its root at the back, harder in the run and the air.
        const wings = ch.wingsId ? accessoryById.get(ch.wingsId) : undefined;
        if (wings) {
          const air = ch.pose === 'jump' || ch.pose === 'fall';
          const flap = running || air ? WING_OPEN + WING_FLAP * Math.sin(ch.phase * (air ? 1.6 : 1)) : WING_REST + WING_IDLE * Math.sin(ch.phase);
          wings.parts.forEach((p, pi) => {
            const mesh = shapeMeshes.get(p.shape);
            if (!mesh) return;
            const side = p.pos[0] < 0 ? -1 : 1;
            _wingRoot.makeTranslation(side * WING_ROOT_X, 0, p.pos[2]);
            _wingTurn.makeRotationY(side * flap);
            _dummy.position.set(p.pos[0] - side * WING_ROOT_X, p.pos[1], 0);
            _dummy.rotation.set(0, 0, 0);
            _dummy.scale.set(p.size[0], p.size[1], p.size[2]);
            _dummy.updateMatrix();
            _mat.multiplyMatrices(world, torsoMatrix).multiply(_wingRoot).multiply(_wingTurn).multiply(_dummy.matrix);
            mesh.setMatrixAt(ch.index * maxPartsPerShape + wingBase + pi, _mat);
          });
        }
        void headMesh;
      }
      // Draw only the live part of the pool: hidden instances cost vertices otherwise.
      for (const spec of PARTS) {
        const mesh = meshes.get(spec.name);
        if (mesh) mesh.count = Math.max(1, instances.length * spec.perCharacter + (spec.name === 'head' && headOutlined ? 1 : 0));
      }
      if (hairMesh) {
        // Only up to the last character with hair (bots wear hats): hidden slots cost vertices too.
        hairMesh.count = Math.max(1, (Math.max(-1, ...hairOf.keys()) + 1) * HAIR_MAX);
        hairMesh.instanceMatrix.needsUpdate = true;
      }
      for (const mesh of shapeMeshes.values()) mesh.count = Math.max(1, instances.length * maxPartsPerShape);
      for (const mesh of meshes.values()) mesh.instanceMatrix.needsUpdate = true;
      for (const mesh of shapeMeshes.values()) mesh.instanceMatrix.needsUpdate = true;
      if (outline && hero && characters.outlined) outline.count = LINE0 + OUTLINE_SLOTS;
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
      clothAtlas.dispose();
      if (hairMesh) {
        hairMesh.geometry.dispose();
        (hairMesh.material as MeshLambertMaterial).dispose();
      }
    },
  };
  return characters;
}

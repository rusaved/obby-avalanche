// What: One word plaque drawn once to a CanvasTexture and placed many times as instanced quads (one draw call): «LEVEL NEEDED» over the level of each stage ridge.
// Called by: render/level-mesh.ts (stage ridges, docs/01-gdd.md 22.3).
// Keep: The text comes from the caller (i18n), never from here; one mesh and one texture; hidden instances scale to zero.

import { CanvasTexture, DoubleSide, InstancedMesh, LinearFilter, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace } from 'three';

export interface WordLabels {
  mesh: InstancedMesh;
  /** Puts label i centred at (x, y, z), `height` world units tall (the width follows the text). */
  set(i: number, x: number, y: number, z: number, height: number): void;
  hide(i: number): void;
  dispose(): void;
}

const FONT_PX = 72;
/** A hidden label sits this far below the world at a near-zero scale. */
const FAR = 99999;
const TINY = 0.0001;

export function createWordLabels(text: string, count: number): WordLabels {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `800 ${FONT_PX}px Rubik, system-ui, sans-serif`;
  let w = 512;
  if (ctx) {
    ctx.font = font;
    w = Math.ceil(ctx.measureText(text).width + FONT_PX * 0.6);
  }
  canvas.width = w;
  canvas.height = Math.ceil(FONT_PX * 1.4);
  if (ctx) {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = FONT_PX * 0.18;
    ctx.strokeStyle = '#1b2a3a';
    ctx.strokeText(text, w / 2, canvas.height / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, canvas.height / 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  const aspect = canvas.width / canvas.height;
  const geo = new PlaneGeometry(aspect, 1);
  const mat = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.1, side: DoubleSide, depthWrite: false });
  const mesh = new InstancedMesh(geo, mat, Math.max(1, count));
  mesh.frustumCulled = false;
  const dummy = new Object3D();
  const place = (i: number, x: number, y: number, z: number, s: number): void => {
    dummy.position.set(x, y, z);
    // Read from below the slope (the camera looks up +Z): the quad faces −Z.
    dummy.rotation.set(0, Math.PI, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  };
  for (let i = 0; i < count; i++) place(i, 0, -FAR, 0, TINY);
  return {
    mesh,
    set: (i, x, y, z, height) => place(i, x, y, z, height),
    hide: (i) => place(i, 0, -FAR, 0, TINY),
    dispose() {
      geo.dispose();
      mat.dispose();
      texture.dispose();
    },
  };
}

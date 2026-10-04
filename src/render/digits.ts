/**
 * Digit atlas (docs/02-tech.md 9.1): one canvas texture with 0–9, suffix letters and signs; every label is a run
 * of instanced quads on a single InstancedMesh — one draw call and one texture for all gate numbers.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';

export const ATLAS_CHARS = '0123456789.KMBTQaixpOcNoD+×/';
const CELL = 64;
const COLS = 8;

export interface DigitLabels {
  mesh: InstancedMesh;
  setLabel(slot: number, text: string, x: number, y: number, z: number, size: number, color: string): void;
  clear(slot: number): void;
  dispose(): void;
}

export function createDigitAtlas(): { texture: CanvasTexture; cols: number; rows: number } {
  const rows = Math.ceil(ATLAS_CHARS.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = CELL * COLS;
  canvas.height = CELL * rows;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${CELL * 0.82}px Rubik, system-ui, sans-serif`;
    for (let i = 0; i < ATLAS_CHARS.length; i++) {
      const cx = (i % COLS) * CELL + CELL / 2;
      const cy = Math.floor(i / COLS) * CELL + CELL / 2;
      ctx.fillText(ATLAS_CHARS[i] as string, cx, cy + CELL * 0.04);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return { texture, cols: COLS, rows };
}

const CHARS_PER_LABEL = 10; // «1.2K/2K»-style progress fits (docs/01-gdd.md 3.3)

export function createDigitLabels(maxChars: number): DigitLabels {
  const { texture, cols, rows } = createDigitAtlas();
  const geo = new PlaneGeometry(1, 1);
  const mat = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.1, side: DoubleSide, depthWrite: false });
  const count = Math.max(CHARS_PER_LABEL, maxChars);
  const mesh = new InstancedMesh(geo, mat, count);
  const uvOffset = new InstancedBufferAttribute(new Float32Array(count * 2), 2);
  geo.setAttribute('uvOffset', uvOffset);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['atlasGrid'] = { value: [cols, rows] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvOffset;\nuniform vec2 atlasGrid;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (uv + uvOffset) / atlasGrid;');
  };
  const dummy = new Object3D();
  const colorTmp = new Color();
  for (let i = 0; i < count; i++) {
    dummy.scale.set(0.0001, 0.0001, 0.0001);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, colorTmp.set('#ffffff'));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;

  const cellOf = (ch: string): number => Math.max(0, ATLAS_CHARS.indexOf(ch));
  return {
    mesh,
    setLabel(slot, text, x, y, z, size, color) {
      const base = slot * CHARS_PER_LABEL;
      const chars = text.slice(0, CHARS_PER_LABEL);
      const advance = size * 0.62;
      const total = (chars.length - 1) * advance;
      colorTmp.set(color);
      for (let i = 0; i < CHARS_PER_LABEL; i++) {
        const idx = base + i;
        if (idx >= count) break;
        if (i < chars.length) {
          const cell = cellOf(chars[i] as string);
          uvOffset.setXY(idx, cell % cols, rows - 1 - Math.floor(cell / cols));
          // Quads face −Z (towards the hero running up the slope), so characters go right to left in +X.
          dummy.position.set(x + total / 2 - i * advance, y, z);
          dummy.scale.set(size, size, 1);
          dummy.rotation.set(0, Math.PI, 0);
          mesh.setColorAt(idx, colorTmp);
        } else {
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
      }
      uvOffset.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    clear(slot) {
      const base = slot * CHARS_PER_LABEL;
      for (let i = 0; i < CHARS_PER_LABEL && base + i < count; i++) {
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(base + i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      texture.dispose();
    },
  };
}

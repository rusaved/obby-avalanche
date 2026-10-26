// What: The textures of the blocks: 8 layers of 64² drawn by code at start into one DataArrayTexture, and the chunk shader that picks a layer per vertex and maps it by world coordinates.
// Called by: render/level-mesh.ts (the chunk material and the `layer` attribute of merged geometry).
// Keep: One texture, no files; the texture is a brightness pattern (×1 at 200 of 255) over the theme colours baked into the vertices; layer 0 is plain.

/**
 * Z-05 (producer 26.10, «Lavina 19 · Winter look»): the blocks of a top obby are not flat — snow with sparkles, a crust,
 * ice with cracks, wood, rock, snow bricks and planks. Each layer is a 64² greyscale pattern drawn on a canvas at start
 * (seeded, the same every load) and multiplies the vertex colour, so the colours of every mountain stay in theme.json.
 * The chunk shader takes the layer from a vertex attribute and the UV from the world position on the face's plane
 * (top — x, z; sides — the larger of x, z with y), so merged boxes need no UVs of their own; nearest up close.
 */
import { DataArrayTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, type MeshLambertMaterial } from 'three';

/** Layers in the texture, by the name a theme material gives in `tex` (0 — none). */
export const BLOCK_LAYERS = ['plain', 'snow', 'crust', 'ice', 'wood', 'rock', 'bricks', 'planks'] as const;
export type BlockLayer = (typeof BLOCK_LAYERS)[number];
const SIZE = 64;
/** The texel value that leaves the colour as it is: brighter above, darker below. */
const UNIT = 200;

/** The layer index of a theme material's `tex` (0 — plain, unknown names too). */
export function layerOf(tex: string | undefined): number {
  const i = BLOCK_LAYERS.indexOf((tex ?? 'plain') as BlockLayer);
  return i < 0 ? 0 : i;
}

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws one layer as brightness values (UNIT — as is) into `out` (SIZE² bytes). */
function drawLayer(name: BlockLayer, out: Uint8Array, rnd: () => number): void {
  const set = (x: number, y: number, v: number): void => {
    out[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)] = Math.max(0, Math.min(255, Math.round(v)));
  };
  const fill = (v: number, jitter: number): void => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, v + (rnd() - 0.5) * jitter);
  };
  const box = (x0: number, y0: number, w: number, h: number, v: number): void => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, v);
  };
  switch (name) {
    case 'plain':
      fill(UNIT, 0);
      break;
    case 'snow':
      // Soft drifts of a few shades and bright sparkles.
      fill(UNIT, 6);
      for (let i = 0; i < 26; i++) {
        const cx = Math.floor(rnd() * SIZE);
        const cy = Math.floor(rnd() * SIZE);
        const r = 3 + Math.floor(rnd() * 6);
        const dv = (rnd() - 0.5) * 14;
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) set(cx + x, cy + y, UNIT + dv + (rnd() - 0.5) * 4);
      }
      for (let i = 0; i < 40; i++) set(Math.floor(rnd() * SIZE), Math.floor(rnd() * SIZE), 250);
      break;
    case 'crust':
      // Packed snow: a grain and short wind lines.
      fill(UNIT - 6, 16);
      for (let i = 0; i < 18; i++) {
        const y = Math.floor(rnd() * SIZE);
        const x0 = Math.floor(rnd() * SIZE);
        const len = 6 + Math.floor(rnd() * 12);
        for (let x = 0; x < len; x++) set(x0 + x, y, UNIT - 26);
      }
      break;
    case 'ice':
      // Clear ice: light bands and thin white cracks.
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, UNIT + 10 * Math.sin((x + y) * 0.2) + (rnd() - 0.5) * 6);
      for (let i = 0; i < 5; i++) {
        let x = rnd() * SIZE;
        let y = rnd() * SIZE;
        let a = rnd() * Math.PI * 2;
        for (let s = 0; s < 22; s++) {
          set(Math.floor(x), Math.floor(y), 246);
          a += (rnd() - 0.5) * 0.9;
          x += Math.cos(a);
          y += Math.sin(a);
        }
      }
      break;
    case 'wood':
      // Grain along the length, a knot or two.
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) set(x, y, UNIT - 8 + 16 * Math.sin(x * 0.55 + Math.sin(y * 0.15) * 2) + (rnd() - 0.5) * 8);
      for (let i = 0; i < 2; i++) {
        const cx = Math.floor(rnd() * SIZE);
        const cy = Math.floor(rnd() * SIZE);
        for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) set(cx + x, cy + y, UNIT - 50);
      }
      break;
    case 'rock':
      // Facets of a few tones with dark seams.
      fill(UNIT - 10, 22);
      for (let i = 0; i < 14; i++) {
        const cx = Math.floor(rnd() * SIZE);
        const cy = Math.floor(rnd() * SIZE);
        const w = 6 + Math.floor(rnd() * 12);
        const h = 4 + Math.floor(rnd() * 8);
        box(cx, cy, w, h, UNIT - 10 + (rnd() - 0.5) * 40);
        for (let x = 0; x < w; x++) set(cx + x, cy + h, UNIT - 70);
        for (let y = 0; y <= h; y++) set(cx + w, cy + y, UNIT - 60);
      }
      break;
    case 'bricks':
      // Blocks of packed snow, offset every row.
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 2; col++) {
          const x0 = col * 32 + (row % 2) * 16;
          box(x0, row * 16, 32, 16, UNIT + (rnd() - 0.5) * 18);
          for (let x = 0; x < 32; x++) set(x0 + x, row * 16, UNIT - 46);
          for (let y = 0; y < 16; y++) set(x0, row * 16 + y, UNIT - 40);
        }
      break;
    case 'planks':
      // Boards across, a dark gap between them and nail heads.
      for (let b = 0; b < 4; b++) {
        const v = UNIT - 4 + (rnd() - 0.5) * 22;
        for (let y = 0; y < 16; y++) for (let x = 0; x < SIZE; x++) set(x, b * 16 + y, v + 8 * Math.sin(x * 0.4 + b) + (rnd() - 0.5) * 6);
        for (let x = 0; x < SIZE; x++) set(x, b * 16, UNIT - 80);
        set(4, b * 16 + 8, UNIT - 70);
        set(SIZE - 5, b * 16 + 8, UNIT - 70);
      }
      break;
  }
}

/** The 8 layers in one DataArrayTexture (RGBA, the pattern in all channels). */
export function createBlockTexture(seed = 7): DataArrayTexture {
  const rnd = rand(seed);
  const n = BLOCK_LAYERS.length;
  const data = new Uint8Array(SIZE * SIZE * 4 * n);
  const layer = new Uint8Array(SIZE * SIZE);
  BLOCK_LAYERS.forEach((name, li) => {
    drawLayer(name, layer, rnd);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const o = (li * SIZE * SIZE + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = layer[i]!;
      data[o + 3] = 255;
    }
  });
  const tex = new DataArrayTexture(data, SIZE, SIZE, n);
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Patches a vertex-coloured Lambert material of chunks: the layer of a vertex, the UV by the world position (`scale`
 * world units a tile). */
export function useBlockTexture(material: MeshLambertMaterial, tex: DataArrayTexture, scale: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['blockTex'] = { value: tex };
    shader.uniforms['blockScale'] = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float layer;\nvarying float vLayer;\nvarying vec3 vBlockPos;\nvarying vec3 vBlockNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayer = layer;\nvBlockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBlockNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform highp sampler2DArray blockTex;\nuniform float blockScale;\nvarying float vLayer;\nvarying vec3 vBlockPos;\nvarying vec3 vBlockNormal;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (vLayer > 0.5) {
  vec3 bn = abs(vBlockNormal);
  vec2 buv = bn.y > 0.6 ? vBlockPos.xz : (bn.x > bn.z ? vBlockPos.zy : vBlockPos.xy);
  diffuseColor.rgb *= texture(blockTex, vec3(buv / blockScale, floor(vLayer + 0.5))).rgb * ${(255 / UNIT).toFixed(4)};
}`,
      );
  };
  material.customProgramCacheKey = () => 'block-tex';
}

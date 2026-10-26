// `npm run gen:decor`: the winter decor models picked in content/<pack>/decor.json (`models`, files under assets/models/)
// → content/<pack>/decor-models.json: indexed triangles with positions in hundredths of a unit and the colour of every
// vertex sampled from the kit's colormap (one palette), so the game merges them into its chunks with no textures or
// loaders (Z-06, docs/01-gdd.md 28). Only the picked models reach the build. Deterministic; the output is committed.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { inflateSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');

/** A PNG of 8 bits a channel (palette, RGB or RGBA), not interlaced: width, height and RGBA bytes. */
function readPng(file) {
  const b = readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  let palette = null;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const kind = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: only 8-bit non-interlaced PNG`);
      type = data[9];
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : type === 3 ? 1 : 0;
  if (!bpp) throw new Error(`${file}: PNG colour type ${type} not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bpp ? px[(y - 1) * stride + x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = up;
      else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[y * stride + x] = (v + p) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (type === 3) palette.copy(rgba, i * 4, px[i] * 3, px[i] * 3 + 3);
    else px.copy(rgba, i * 4, i * bpp, i * bpp + 3);
  }
  return { width, height, rgba };
}

/** Column-major 4×4 helpers for the node transforms of a glTF. */
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Triangles of a GLB with the colour of each vertex from the colormap at its UV. */
function readGlb(file, colormaps) {
  const b = readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  const gltf = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  const view = (acc) => {
    const a = gltf.accessors[acc];
    const bv = gltf.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const start = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = [];
    const size = a.componentType === 5126 ? 4 : a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? size * n;
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < n; k++) {
        const o = start + i * stride + k * size;
        out.push(a.componentType === 5126 ? b.readFloatLE(o) : a.componentType === 5125 ? b.readUInt32LE(o) : a.componentType === 5123 ? b.readUInt16LE(o) : b[o]);
      }
    return out;
  };
  const img = gltf.images?.[0]?.uri ? resolve(dirname(file), gltf.images[0].uri) : null;
  if (img && !colormaps.has(img)) colormaps.set(img, readPng(img));
  const cm = img ? colormaps.get(img) : null;
  const tris = [];
  const walk = (ni, parent) => {
    const n = gltf.nodes[ni];
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined)
      for (const p of gltf.meshes[n.mesh].primitives) {
        const pos = view(p.attributes.POSITION);
        const uv = p.attributes.TEXCOORD_0 !== undefined ? view(p.attributes.TEXCOORD_0) : null;
        const idx = p.indices !== undefined ? view(p.indices) : pos.map((_, i) => i).filter((i) => i < pos.length / 3);
        for (const i of idx) {
          const x = pos[i * 3];
          const y = pos[i * 3 + 1];
          const z = pos[i * 3 + 2];
          const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
          let rgb = [255, 255, 255];
          if (cm && uv) {
            const u = Math.min(cm.width - 1, Math.max(0, Math.floor((uv[i * 2] - Math.floor(uv[i * 2])) * cm.width)));
            const v = Math.min(cm.height - 1, Math.max(0, Math.floor((uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1])) * cm.height)));
            const o = (v * cm.width + u) * 4;
            rgb = [cm.rgba[o], cm.rgba[o + 1], cm.rgba[o + 2]];
          }
          tris.push({ p: w, c: rgb });
        }
      }
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const ni of gltf.scenes[gltf.scene ?? 0].nodes) walk(ni, ident());
  return tris;
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

let changed = 0;
for (const pack of readdirSync(resolve(root, 'content'))) {
  const specFile = resolve(root, 'content', pack, 'decor.json');
  if (!existsSync(specFile)) continue;
  const spec = JSON.parse(readFileSync(specFile, 'utf8'));
  const colormaps = new Map();
  const palette = [];
  const models = {};
  for (const m of spec.models) {
    const tris = readGlb(resolve(root, m.file), colormaps);
    const key = new Map();
    const pos = [];
    const col = [];
    const idx = [];
    for (const t of tris) {
      // A colour of the kit replaced by a colour of the theme (the bulbs of a garland in warm gold, `recolor`).
      const h0 = hex(t.c);
      const h = m.recolor?.[h0] ?? spec.recolor?.[h0] ?? h0;
      let pi = palette.indexOf(h);
      if (pi < 0) pi = palette.push(h) - 1;
      const q = t.p.map((v) => Math.round(v * 100));
      const k = `${q.join(',')}|${pi}`;
      let vi = key.get(k);
      if (vi === undefined) {
        vi = pos.length / 3;
        key.set(k, vi);
        pos.push(...q);
        col.push(pi);
      }
      idx.push(vi);
    }
    models[m.id] = { pos, col, idx };
  }
  const out = `${JSON.stringify({ note: 'generated by npm run gen:decor from decor.json — do not edit', palette, models })}\n`;
  const file = resolve(root, 'content', pack, 'decor-models.json');
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (old !== out) {
    changed++;
    if (check) console.error(`gen:decor: ${pack}/decor-models.json is stale`);
    else writeFileSync(file, out);
  }
  const verts = Object.values(models).reduce((s, m) => s + m.col.length, 0);
  const tris = Object.values(models).reduce((s, m) => s + m.idx.length / 3, 0);
  console.log(`gen:decor: ${pack} — ${Object.keys(models).length} models, ${verts} vertices, ${tris} triangles, ${palette.length} colours, ${(out.length / 1024).toFixed(0)} KB`);
}
if (check && changed) process.exit(1);

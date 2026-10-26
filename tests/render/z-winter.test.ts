import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Color } from 'three';
import { buildLevel } from '../../src/level/builder.ts';
import { decorPlan } from '../../src/render/decor.ts';
import { FACES, PART } from '../../src/render/characters.ts';
import { BLOCK_LAYERS, createBlockTexture, layerOf } from '../../src/render/block-tex.ts';
import { winterDecorPlan } from '../../src/render/winter-decor.ts';
import type { AccessoriesJson, DecorJson, DecorModelsJson, SkinsJson, ThemeJson, WorldsJson } from '../../src/content/types.ts';

// Z-02…Z-07 (producer 26.10, «Lavina 19 · Winter look»): the hero of the genre's canon, the block texture, the winter
// decor and the animals on every stage.
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const skins = read<SkinsJson>('skins.json');
const accessories = read<AccessoriesJson>('accessories.json');
const theme = read<ThemeJson>('theme.json');
const decor = read<DecorJson>('decor.json');
const models = read<DecorModelsJson>('decor-models.json');
const worlds = read<WorldsJson>('pace/stages/worlds.json').worlds;

describe('Z-02, Z-03: the hero', () => {
  it('the starting skin: the pompom hat upright, the smile — a face of the atlas and the default one', () => {
    const start = skins.skins.find((s) => s.id === skins.default)!;
    expect(start.hat).toBe('hat_pompom_red');
    expect(accessories.accessories.find((a) => a.id === 'hat_pompom_red')!.parts[0]!.size).toEqual([1.25, 0.5, 1.25]);
    expect(start.face).toBe('smile');
    expect(FACES).toContain('smile');
  });

  it('proportions of the canon: torso 2×2×1, arms and legs 1×2×1, the head ≈ 23 % of the figure', () => {
    expect(PART.torso.w / PART.torso.h).toBeCloseTo(1);
    expect(PART.torso.d / PART.torso.h).toBeCloseTo(0.5);
    for (const b of [PART.arm, PART.leg]) {
      expect(b.w / b.h).toBeCloseTo(0.5);
      expect(b.d / b.h).toBeCloseTo(0.5);
    }
    const share = PART.headH / (PART.leg.h + PART.torso.h + PART.headH);
    expect(share).toBeGreaterThan(0.22);
    expect(share).toBeLessThan(0.24);
  });

  it('hairstyles of 6–12 rounded boxes, 3–5 of them; every skin hair, cut and head shape known', () => {
    const hair = accessories.hair ?? [];
    expect(hair.length).toBeGreaterThanOrEqual(3);
    expect(hair.length).toBeLessThanOrEqual(5);
    for (const h of hair) {
      expect(h.parts.length).toBeGreaterThanOrEqual(6);
      expect(h.parts.length).toBeLessThanOrEqual(12);
    }
    const ids = new Set(hair.map((h) => h.id));
    for (const s of skins.skins) {
      if (s.hair) expect(ids.has(s.hair.style), s.id).toBe(true);
      expect(['tee', 'jacket', undefined]).toContain(s.outfit);
      expect(['cylinder', 'cube', undefined]).toContain(s.headShape);
    }
    expect(skins.skins.some((s) => s.hair)).toBe(true);
  });

  it('no skin in the colours of the default avatar of other platforms (yellow head, blue torso, green legs)', () => {
    const hue = (hex: string): number => new Color(hex).getHSL({ h: 0, s: 0, l: 0 }).h * 360;
    for (const s of skins.skins) {
      const yellow = hue(s.colors.head) > 40 && hue(s.colors.head) < 65;
      const blue = hue(s.colors.torso) > 190 && hue(s.colors.torso) < 250;
      const green = hue(s.colors.legL) > 80 && hue(s.colors.legL) < 160;
      expect(yellow && blue && green, s.id).toBe(false);
    }
  });
});

describe('Z-05: the block texture', () => {
  it('8 layers of 64² drawn by code, the same every load; plain is ×1; the theme maps its materials to layers', () => {
    const a = createBlockTexture();
    const b = createBlockTexture();
    expect(BLOCK_LAYERS.length).toBe(8);
    expect(a.image.width).toBe(64);
    expect(a.image.height).toBe(64);
    expect(a.image.depth).toBe(8);
    expect(Buffer.from(a.image.data as Uint8Array).equals(Buffer.from(b.image.data as Uint8Array))).toBe(true);
    const data = a.image.data as Uint8Array;
    for (let i = 0; i < 64 * 64; i++) expect(data[i * 4]).toBe(200);
    expect(layerOf(theme.materials['track']?.tex)).toBe(BLOCK_LAYERS.indexOf('snow'));
    expect(layerOf(undefined)).toBe(0);
    expect(layerOf('unknown')).toBe(0);
  });
});

describe('Z-06: the winter decor', () => {
  const NEW_YEAR = /decorated|present|wreath|candy|gingerbread|sock|nutcracker|reindeer|menorah|kinara|dreidel|festivus/;
  it('10–20 models picked, none of the New Year; the generated file is up to date', () => {
    expect(decor.models.length).toBeGreaterThanOrEqual(10);
    expect(decor.models.length).toBeLessThanOrEqual(20);
    for (const m of decor.models) expect(m.file, m.id).not.toMatch(NEW_YEAR);
    expect(Object.keys(models.models).sort()).toEqual(decor.models.map((m) => m.id).sort());
    const r = spawnSync(process.execPath, ['scripts/gen-decor.mjs', '--check'], { cwd: root, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });

  it('every mountain dressed, deterministic, never on a grotto, a gate or a pad; lanterns with glows at the finishes', () => {
    for (const w of worlds) {
      const level = buildLevel(w);
      const p = winterDecorPlan(level, decor, models);
      expect(p).toEqual(winterDecorPlan(buildLevel(w), decor, models));
      expect(p.pieces.length, w.id).toBeGreaterThan(40);
      expect(p.glows.length, w.id).toBeGreaterThanOrEqual(level.stages!.length);
      for (const q of p.pieces) {
        expect(decor.scale[q.id], q.id).toBeGreaterThan(0);
        for (const n of level.niches) expect(q.x > n.box.min[0] && q.x < n.box.max[0] && q.z > n.box.min[2] && q.z < n.box.max[2], `${w.id} ${q.id} in a grotto`).toBe(false);
        for (const g of level.gates) expect(Math.abs(g.z - q.z), `${w.id} ${q.id} at a gate`).toBeGreaterThan(0.5);
        expect(Math.abs(q.x)).toBeLessThanOrEqual(level.halfAt(q.z));
      }
    }
  });
});

describe('Z-07: animals on every mountain', () => {
  it('penguins and birds on each of the 10 mountains of the stages pace', () => {
    const cfg = theme.decor!;
    for (const [i, w] of worlds.entries()) {
      const level = buildLevel(w);
      const p = decorPlan(level, w.look ?? w.id, cfg, 11 + i, { top: 7.8, half: 9 });
      expect(p.walkers.length, w.id).toBeGreaterThan(0);
      expect(p.bird, w.id).not.toBeNull();
    }
  });
});

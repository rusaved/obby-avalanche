import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACK_FILES, validatePack, type PackFiles } from '../../src/level/validate.ts';
import { generateWorlds, ceilToSeries, stringifyWorlds } from '../../src/level/generate.ts';
import type { WorldsSpecJson } from '../../src/content/types.ts';

const root = resolve(__dirname, '../..');
const packs = readdirSync(resolve(root, 'content'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

function loadPack(name: string): PackFiles {
  const files: Partial<PackFiles> = {};
  for (const f of PACK_FILES) files[f] = JSON.parse(readFileSync(resolve(root, 'content', name, f), 'utf8'));
  return files as PackFiles;
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('validate:content (docs/02-tech.md 5.4)', () => {
  it('every pack in content/ is valid', () => {
    expect(packs).toContain('avalanche');
    expect(packs).toContain('_sample');
    for (const p of packs) {
      const res = validatePack(loadPack(p));
      expect(res.errors, p).toEqual([]);
      expect(res.ok).toBe(true);
    }
  });

  it('a broken copy fails with the file and the field named', () => {
    const files = loadPack('avalanche');
    const broken = clone(files);
    (broken['balance.json'] as { stepLength: unknown }).stepLength = 'four';
    const res = validatePack(broken);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.startsWith('balance.json: stepLength'))).toBe(true);

    const noKey = clone(files);
    delete (noKey['i18n/en.json'] as Record<string, string>)['wave.warn'];
    const r2 = validatePack(noKey);
    expect(r2.errors).toContain('i18n/en.json: wave.warn — missing key (present in ru)');

    const badHat = clone(files);
    (badHat['skins.json'] as { skins: Array<{ hat: string }> }).skins[0]!.hat = 'crown';
    expect(validatePack(badHat).errors.some((e) => e.includes('skins[0].hat'))).toBe(true);

    const badFx = clone(files);
    (badFx['theme.json'] as { fx: { weather: string } }).fx.weather = 'rain';
    expect(validatePack(badFx).errors.some((e) => e.startsWith('theme.json: fx.weather'))).toBe(true);

    const badGate = clone(files);
    const w = (badGate['worlds.json'] as { worlds: Array<{ segments: Array<{ type: string; requires?: number }> }> }).worlds[0]!;
    const gate = w.segments.find((s) => s.type === 'gate' && s.requires === 40)!;
    gate.requires = 10;
    expect(validatePack(badGate).errors.some((e) => e.includes('requires 10 must grow'))).toBe(true);

    const badFlag = clone(files);
    (badFlag['game.json'] as { flags: Record<string, { path: string }> }).flags['w1_warnSec']!.path = 'worlds.9.threat.warnSec';
    expect(validatePack(badFlag).errors.some((e) => e.includes('flags.w1_warnSec.path'))).toBe(true);
  });

  it('gen:worlds is deterministic and worlds.json is up to date', () => {
    for (const p of packs) {
      const spec = JSON.parse(readFileSync(resolve(root, 'content', p, 'worlds-spec.json'), 'utf8')) as WorldsSpecJson;
      const balance = JSON.parse(readFileSync(resolve(root, 'content', p, 'balance.json'), 'utf8')) as { coins: { gatePass: number; chest: number } };
      const a = stringifyWorlds(generateWorlds({ spec, balance }));
      const b = stringifyWorlds(generateWorlds({ spec, balance }));
      expect(a).toBe(b);
      expect(readFileSync(resolve(root, 'content', p, 'worlds.json'), 'utf8')).toBe(a);
    }
  });

  it('avalanche worlds match the tables of docs/01a-content.md, sections 2–4', () => {
    const worlds = (loadPack('avalanche')['worlds.json'] as { worlds: Array<Record<string, unknown> & { segments: Array<Record<string, unknown>> }> }).worlds;
    expect(worlds.map((w) => w.length)).toEqual([1180, 1300, 1420, 1540, 1660]);
    expect(worlds.map((w) => w.id)).toEqual(['slope', 'pass', 'canyon', 'blizzard', 'aurora']);
    const treadmills = (w: (typeof worlds)[number]) => w.segments.filter((s) => s.type === 'treadmill').map((s) => s.mult);
    expect(worlds.map((w) => treadmills(w)[0])).toEqual([5, 15, 50, 150, 800]);
    expect(worlds.map((w) => treadmills(w).at(-1))).toEqual([25, 60, 250, 1000, 4000]);
    expect(worlds.map((w) => w.segments.find((s) => s.type === 'chest')!.coins)).toEqual([3750, 250000, 15000000, 1000000000, 62500000000]);
    const slopeGates = worlds[0]!.segments.filter((s) => s.type === 'gate');
    expect(slopeGates.map((g) => g.requires)).toEqual([20, 40, 80, 2000, 4000, 12000, 15000, 20000, 30000, 40000, 80000, 100000]);
    expect(slopeGates.map((g) => (g.reward as { coins: number }).coins)).toEqual([10, 10, 20, 20, 40, 40, 80, 80, 160, 160, 300, 300]);
    expect(slopeGates.map((g) => g.z)).toEqual([130, 220, 310, 400, 490, 580, 670, 760, 850, 940, 1030, 1120]);
    expect(worlds[0]!.segments.filter((s) => s.type === 'gift')).toHaveLength(36);
    expect(worlds[0]!.segments.filter((s) => s.type === 'niche').map((s) => s.side)).toEqual(
      ['left', 'right', 'left', 'right', 'left', 'right', 'left', 'right', 'left', 'right', 'left', 'right'],
    );
  });

  it('_sample world follows docs/01a-content.md 14.3', () => {
    const w = (loadPack('_sample')['worlds.json'] as { worlds: Array<{ length: number; segments: Array<Record<string, unknown>> }> }).worlds[0]!;
    expect(w.length).toBe(280);
    expect(w.segments.filter((s) => s.type === 'niche').map((s) => [s.z, s.side])).toEqual([[82, 'left'], [142, 'right'], [202, 'left']]);
    expect(w.segments.filter((s) => s.type === 'gate').map((s) => s.z)).toEqual([100, 160, 220]);
    expect(w.segments.find((s) => s.type === 'chest')!.coins).toBe(250);
    expect(w.segments.filter((s) => s.type === 'treadmill').map((s) => s.mult)).toEqual([2, 3]);
  });

  it('ceilToSeries rounds up along 1; 1.2; 1.5; 2; 2.5; 3; 4; 5; 6; 8 × 10^k', () => {
    expect(ceilToSeries(22.5)).toBe(25);
    expect(ceilToSeries(60)).toBe(60);
    expect(ceilToSeries(225)).toBe(250);
    expect(ceilToSeries(900)).toBe(1000);
    expect(ceilToSeries(3750)).toBe(4000);
    expect(ceilToSeries(3)).toBe(3);
    expect(ceilToSeries(8.1)).toBe(10);
  });
});

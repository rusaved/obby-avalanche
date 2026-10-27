// `npm run validate:content`: every pack in content/* and every pace of it (content/<pack>/pace/<pace>/, docs/01-gdd.md 16.1)
// against src/level/validate.ts. Exit 1 with "file: path — problem".
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACK_FILES, validatePack } from '../src/level/validate.ts';
import { mergePatch } from '../src/content/pace.ts';

const root = resolve(import.meta.dirname, '..');
const contentDir = resolve(root, 'content');
const only = process.argv.slice(2);

export function loadPack(dir) {
  const files = {};
  for (const name of PACK_FILES) {
    const file = resolve(dir, name);
    if (!existsSync(file)) continue;
    try {
      files[name] = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`${name}: invalid JSON — ${err.message}`);
    }
  }
  return files;
}

/** Pace folders of a pack (docs/01-gdd.md 16.1): content/<pack>/pace/<pace>/. */
export function paceNames(dir) {
  const paceDir = resolve(dir, 'pace');
  if (!existsSync(paceDir)) return [];
  return readdirSync(paceDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** The pack as a pace plays it: its worlds.json, worlds-spec.json and base.json, the shared balance.json, tuning.json and bots.json with its patches merged in. */
export function pacePack(files, dir, pace) {
  const read = (name) => {
    const file = resolve(dir, 'pace', pace, name);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`pace/${pace}/${name}: invalid JSON — ${err.message}`);
    }
  };
  const patch = read('balance.json');
  const feel = read('tuning.json');
  // The crowd of a pace (SP-04: its lanes on sections 100–220 wide).
  const crowd = read('bots.json');
  return {
    ...files,
    'balance.json': patch === undefined ? files['balance.json'] : mergePatch(files['balance.json'], patch),
    'tuning.json': feel === undefined ? files['tuning.json'] : mergePatch(files['tuning.json'], feel),
    'bots.json': crowd === undefined ? files['bots.json'] : mergePatch(files['bots.json'], crowd),
    'worlds.json': read('worlds.json'),
    'worlds-spec.json': read('worlds-spec.json'),
    // The base between the mountains (docs/01a-content.md 18.1), absent for most paces.
    ...(read('base.json') === undefined ? {} : { 'base.json': read('base.json') }),
  };
}

const report = (name, run) => {
  let result;
  try {
    result = run();
  } catch (err) {
    result = { ok: false, errors: [err.message] };
  }
  if (result.ok) {
    console.log(`validate:content: ${name} — ok`);
    return true;
  }
  console.error(`validate:content: ${name} — ${result.errors.length} problem(s)`);
  for (const e of result.errors) console.error(`  ${e}`);
  return false;
};

export function validateVk(vk) {
  const errors = [];
  for (const k of ['appId', 'vkGroupId', 'okGroupId']) if (typeof vk[k] !== 'number' || vk[k] < 0) errors.push(`${k}: a number ≥ 0`);
  const t = vk.texts ?? {};
  const keys = (o) => Object.keys(o ?? {}).sort().join(',');
  if (keys(t.vk) !== keys(t.ok)) errors.push('texts.vk and texts.ok: different keys');
  const all = (site) => [...Object.values(t.common ?? {}), ...Object.values(t[site] ?? {})].join(' ');
  if (/вконтакт/i.test(all('ok'))) errors.push('texts.ok names VK');
  if (/одноклассник/i.test(all('vk'))) errors.push('texts.vk names OK');
  if (/https?:|www\.|яндекс|yandex|telegram/i.test(all('vk') + all('ok'))) errors.push('texts: a link or another platform');
  const ru = JSON.parse(readFileSync(resolve(contentDir, 'avalanche/i18n/ru.json'), 'utf8'));
  for (const k of Object.keys(vk.i18n ?? {})) if (!(k in ru)) errors.push(`i18n.${k}: no such key in ru.json`);
  if (!Array.isArray(vk.ads?.interstitial) || vk.ads.interstitial.includes('menu')) errors.push('ads.interstitial: transitions only (no menu)');
  if (!(vk.ads?.interstitialCooldownSec >= 30)) errors.push('ads.interstitialCooldownSec: at least 30');
  if (!(vk.save?.chunkChars > 0 && vk.save.chunkChars <= 4096)) errors.push('save.chunkChars: 1…4096');
  if (!(vk.save?.gapSec >= 30 && vk.save.gapSec <= 60)) errors.push('save.gapSec: 30…60');
  return { ok: errors.length === 0, errors };
}

// Run as a script (gen-worlds imports paceNames and pacePack): every pack, then every pace of it.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  let failed = 0;
  let count = 0;
  for (const entry of readdirSync(contentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (only.length && !only.includes(entry.name)) continue;
    count++;
    const dir = resolve(contentDir, entry.name);
    const paces = paceNames(dir);
    if (!report(entry.name, () => validatePack(loadPack(dir), { paces }))) failed++;
    for (const pace of paces) if (!report(`${entry.name}/pace/${pace}`, () => validatePack(pacePack(loadPack(dir), dir, pace), { paces }))) failed++;
  }
  if (count === 0) {
    console.error('validate:content: no packs found in content/');
    process.exit(1);
  }
  // K-03 («Лавина 21»): the VK and OK build's config — ids are numbers, both sites have the same text keys, a text of one
  // site never names the other, the dictionary keys it overrides exist.
  const vkFile = resolve(contentDir, 'vk.json');
  if (existsSync(vkFile) && !report('vk.json', () => validateVk(JSON.parse(readFileSync(vkFile, 'utf8'))))) failed++;
  process.exit(failed ? 1 : 0);
}

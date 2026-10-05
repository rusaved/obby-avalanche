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

/** The pack as a pace plays it: its worlds.json and worlds-spec.json, the shared balance.json with its patch merged in. */
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
  return { ...files, 'balance.json': patch === undefined ? files['balance.json'] : mergePatch(files['balance.json'], patch), 'worlds.json': read('worlds.json'), 'worlds-spec.json': read('worlds-spec.json') };
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
  process.exit(failed ? 1 : 0);
}

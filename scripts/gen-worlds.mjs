// `npm run gen:worlds`: content/<pack>/worlds-spec.json + balance.json → content/<pack>/worlds.json for every pack, and
// the same for every pace folder content/<pack>/pace/<pace>/ with the pace balance (shared + patch, docs/01-gdd.md 16.1);
// then validate:content. Deterministic; worlds.json is committed and never edited by hand (docs/02-tech.md, section 3).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateWorlds, stringifyWorlds } from '../src/level/generate.ts';
import { mergePatch } from '../src/content/pace.ts';
import { paceNames } from './validate-content.mjs';

const root = resolve(import.meta.dirname, '..');
const contentDir = resolve(root, 'content');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const check = process.argv.includes('--check');
let changed = 0;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Writes (or checks) worlds.json of `dir` from its worlds-spec.json and the given balance. */
function generate(name, dir, balance) {
  const specFile = resolve(dir, 'worlds-spec.json');
  if (!existsSync(specFile)) return;
  const text = stringifyWorlds(generateWorlds({ spec: readJson(specFile), balance }));
  const out = resolve(dir, 'worlds.json');
  const prev = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (prev !== text) {
    changed++;
    if (check) {
      console.error(`gen:worlds: ${name}/worlds.json is out of date`);
    } else {
      writeFileSync(out, text);
      console.log(`gen:worlds: wrote ${name}/worlds.json (${text.length} bytes)`);
    }
  } else {
    console.log(`gen:worlds: ${name}/worlds.json up to date`);
  }
}

for (const pack of readdirSync(contentDir, { withFileTypes: true })) {
  if (!pack.isDirectory()) continue;
  if (only.length && !only.includes(pack.name)) continue;
  const dir = resolve(contentDir, pack.name);
  const balance = readJson(resolve(dir, 'balance.json'));
  generate(pack.name, dir, balance);
  for (const pace of paceNames(dir)) {
    const paceDir = resolve(dir, 'pace', pace);
    const patchFile = resolve(paceDir, 'balance.json');
    generate(`${pack.name}/pace/${pace}`, paceDir, existsSync(patchFile) ? mergePatch(balance, readJson(patchFile)) : balance);
  }
}
if (check && changed) process.exit(1);
const res = spawnSync(process.execPath, [resolve(root, 'scripts/validate-content.mjs')], { stdio: 'inherit' });
process.exit(res.status ?? 1);

// `npm run gen:worlds`: content/<pack>/worlds-spec.json + balance.json → content/<pack>/worlds.json for every pack,
// then validate:content. Deterministic; worlds.json is committed and never edited by hand (docs/02-tech.md, section 3).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateWorlds, stringifyWorlds } from '../src/level/generate.ts';

const root = resolve(import.meta.dirname, '..');
const contentDir = resolve(root, 'content');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const check = process.argv.includes('--check');
let changed = 0;

for (const pack of readdirSync(contentDir, { withFileTypes: true })) {
  if (!pack.isDirectory()) continue;
  if (only.length && !only.includes(pack.name)) continue;
  const dir = resolve(contentDir, pack.name);
  const specFile = resolve(dir, 'worlds-spec.json');
  if (!existsSync(specFile)) continue;
  const spec = JSON.parse(readFileSync(specFile, 'utf8'));
  const balance = JSON.parse(readFileSync(resolve(dir, 'balance.json'), 'utf8'));
  const text = stringifyWorlds(generateWorlds({ spec, balance }));
  const out = resolve(dir, 'worlds.json');
  const prev = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (prev !== text) {
    changed++;
    if (check) {
      console.error(`gen:worlds: ${pack.name}/worlds.json is out of date`);
    } else {
      writeFileSync(out, text);
      console.log(`gen:worlds: wrote ${pack.name}/worlds.json (${text.length} bytes)`);
    }
  } else {
    console.log(`gen:worlds: ${pack.name}/worlds.json up to date`);
  }
}
if (check && changed) process.exit(1);
const res = spawnSync(process.execPath, [resolve(root, 'scripts/validate-content.mjs')], { stdio: 'inherit' });
process.exit(res.status ?? 1);

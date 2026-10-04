// `npm run validate:content`: every pack in content/* against src/level/validate.ts. Exit 1 with "file: path — problem".
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PACK_FILES, validatePack } from '../src/level/validate.ts';

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

let failed = 0;
let count = 0;
for (const entry of readdirSync(contentDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (only.length && !only.includes(entry.name)) continue;
  count++;
  let result;
  try {
    result = validatePack(loadPack(resolve(contentDir, entry.name)));
  } catch (err) {
    result = { ok: false, errors: [err.message] };
  }
  if (result.ok) {
    console.log(`validate:content: ${entry.name} — ok`);
  } else {
    failed++;
    console.error(`validate:content: ${entry.name} — ${result.errors.length} problem(s)`);
    for (const e of result.errors) console.error(`  ${e}`);
  }
}
if (count === 0) {
  console.error('validate:content: no packs found in content/');
  process.exit(1);
}
process.exit(failed ? 1 : 0);

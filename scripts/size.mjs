// `npm run size`: weight of dist/ and gzip of all JS against the budgets of docs/02-tech.md 9.5.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = { jsGzipTarget: 500 * 1024, jsGzipLimit: 800 * 1024, totalTarget: 4 * 1024 * 1024, totalLimit: 10 * 1024 * 1024 };
const dirArg = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'dist';
const dir = resolve(dirArg);

function walk(d, acc = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const files = walk(dir);
let total = 0;
let jsGzip = 0;
let jsRaw = 0;
const rows = [];
for (const f of files) {
  const size = statSync(f).size;
  total += size;
  let gz = '';
  if (extname(f) === '.js') {
    const g = gzipSync(readFileSync(f), { level: 9 }).length;
    jsGzip += g;
    jsRaw += size;
    gz = kb(g);
  }
  rows.push([relative(dir, f), kb(size), gz]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
console.log(`size: ${relative(process.cwd(), dir) || '.'}`);
for (const [name, size, gz] of rows) console.log(`  ${name.padEnd(48)} ${size.padStart(10)} ${gz ? `gzip ${gz}` : ''}`);
console.log(`  total ${kb(total)} (target ${kb(BUDGET.totalTarget)}, limit ${kb(BUDGET.totalLimit)})`);
console.log(`  js ${kb(jsRaw)} → gzip ${kb(jsGzip)} (target ${kb(BUDGET.jsGzipTarget)}, limit ${kb(BUDGET.jsGzipLimit)})`);
let code = 0;
if (jsGzip > BUDGET.jsGzipLimit) {
  console.error('size: JS gzip above the hard limit');
  code = 1;
} else if (jsGzip > BUDGET.jsGzipTarget) console.warn('size: JS gzip above the target');
if (total > BUDGET.totalLimit) {
  console.error('size: total above the hard limit');
  code = 1;
} else if (total > BUDGET.totalTarget) console.warn('size: total above the target');
process.exit(code);

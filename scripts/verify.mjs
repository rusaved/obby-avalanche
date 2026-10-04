// `npm run verify` (docs/02-tech.md, section 3): the full chain, each stage named before and timed after.
// Exit 0 = milestone M0–M5 ready; `--full` adds e2e:full (M6 and submission).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const full = process.argv.includes('--full');
const stages = [
  'typecheck',
  'test',
  'validate:content',
  'build:e2e',
  'e2e',
  'e2e:sample',
  'build',
  'size',
  'pack',
  'check-release',
  'e2e:release',
];
if (full) stages.push('e2e:full');
const started = Date.now();
for (const stage of stages) {
  console.log(`\n== verify: ${stage}`);
  const t0 = Date.now();
  const res = spawnSync('npm', ['run', '--silent', stage], { cwd: root, stdio: 'inherit', env: process.env });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status !== 0) {
    console.error(`-- verify: ${stage} FAILED after ${sec} s (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
  console.log(`-- verify: ${stage} ok, ${sec} s`);
}
console.log(`\n== verify: all ${stages.length} stages green in ${((Date.now() - started) / 1000).toFixed(0)} s`);

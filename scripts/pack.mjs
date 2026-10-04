// `npm run pack` (docs/02-tech.md 16.2): dist/ → release/<pack>-<version>.zip, deflate 9, latin file names only,
// no maps or junk. `--dir dist-playtest --suffix playtest` packs the playtest build (check-release must reject it).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const dir = resolve(root, opt('dir', 'dist'));
const suffix = opt('suffix', '');
const pack = process.env.VITE_CONTENT || 'avalanche';
const game = JSON.parse(readFileSync(resolve(root, 'content', pack, 'game.json'), 'utf8'));
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const name = `${game.id.replace(/^_/, '')}-${version}${suffix ? `-${suffix}` : ''}.zip`;
const out = resolve(root, opt('out', join('release', name)));

if (!existsSync(join(dir, 'index.html'))) {
  console.error(`pack: ${relative(root, dir)}/index.html not found — run the build first`);
  process.exit(1);
}
const SKIP = /(\.map$|\.DS_Store$|Thumbs\.db$|\.nojekyll$)/;
const files = {};
let raw = 0;
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const rel = relative(dir, p).split('\\').join('/');
      if (SKIP.test(rel)) continue;
      if (!/^[A-Za-z0-9._/-]+$/.test(rel)) {
        console.error(`pack: forbidden characters in path "${rel}" (docs/02-tech.md 16.2)`);
        process.exit(1);
      }
      const data = readFileSync(p);
      raw += data.length;
      files[rel] = [new Uint8Array(data), { level: 9 }];
    }
  }
};
walk(dir);
const zip = zipSync(files, { level: 9 });
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, zip);
console.log(`pack: ${Object.keys(files).length} files, ${(raw / 1024).toFixed(1)} KB → ${relative(root, out)} ${(zip.length / 1024).toFixed(1)} KB`);

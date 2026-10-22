// `npm run build:pages` (docs/05, section 2): playtest build on the SDK mock for GitHub Pages in dist-pages/:
// debug tools and studio on, test API off, mock as a file next to index.html, relative sdk.js, milestone label.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist-pages');
const res = spawnSync('npx', ['vite', 'build', '--mode', 'pages', '--outDir', 'dist-pages', '--emptyOutDir'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (res.status !== 0) process.exit(res.status ?? 1);
// M4-00 (producer 22.10, the truthful stand): the copy on the link shows ads for 3 s and the sticky banner on the right.
writeFileSync(resolve(out, 'sdk.js'), `self.__YA_MOCK_PAGES__ = true;\n${readFileSync(resolve(root, 'dev/yasdk-mock/sdk.js'), 'utf8')}`);
writeFileSync(resolve(out, '.nojekyll'), '');
const html = readFileSync(resolve(out, 'index.html'), 'utf8');
if (!html.includes('<script src="sdk.js"></script>') || html.includes('src="/sdk.js"')) {
  console.error('build:pages: index.html must load sdk.js by a relative path');
  process.exit(1);
}
if (!existsSync(resolve(out, 'sdk.js'))) {
  console.error('build:pages: sdk.js missing');
  process.exit(1);
}
console.log('build:pages: dist-pages ready (sdk.js relative, mock copied)');

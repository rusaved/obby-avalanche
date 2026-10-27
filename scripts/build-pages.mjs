// `npm run build:pages` (docs/05, section 2): playtest build on the SDK mock for GitHub Pages in dist-pages/ (and the VK build in dist-pages/vk/, K-09):
// debug tools and studio on, test API off, mock as a file next to index.html, relative sdk.js, milestone label.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
// K-09 («Лавина 21»): the VK and OK build next to it — https://rusaved.github.io/obby-avalanche/vk/ (?mock=vk — the bridge
// stand-in in a plain tab); check:vk passes it (no Yandex, no link outside, VKWebAppInit in).
{
  const vk = spawnSync('npx', ['vite', 'build', '--mode', 'vk', '--outDir', 'dist-pages/vk', '--emptyOutDir'], { cwd: root, stdio: 'inherit', env: process.env });
  if (vk.status !== 0) process.exit(vk.status ?? 1);
  const chk = spawnSync('node', ['scripts/check-vk.mjs', 'dist-pages/vk'], { cwd: root, stdio: 'inherit', env: process.env });
  if (chk.status !== 0) process.exit(chk.status ?? 1);
}
// M6-09 (docs/05, section 2): the release archive and the playtest one for the producer in dist-pages/downloads/ with
// a page listing them; the release is the one to load into the Console draft (check-release passes it, rejects playtest).
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const downloads = resolve(out, 'downloads');
mkdirSync(downloads, { recursive: true });
const game = JSON.parse(readFileSync(resolve(root, 'content/avalanche/game.json'), 'utf8'));
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const base = `${game.id.replace(/^_/, '')}-${version}`;
run('npx', ['vite', 'build', '--outDir', 'dist', '--emptyOutDir']);
run('node', ['scripts/pack.mjs', '--out', `dist-pages/downloads/${base}.zip`]);
// G-10 (producer 26.10): the release without purchases too — in case the contract for them is not ready by submission.
{
  const r = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-noiap', '--emptyOutDir'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_NO_PAYMENTS: '1' } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
run('node', ['scripts/pack.mjs', '--dir', 'dist-noiap', '--out', `dist-pages/downloads/${base}-no-iap.zip`]);
run('npx', ['vite', 'build', '--mode', 'playtest', '--outDir', 'dist-playtest', '--emptyOutDir']);
run('node', ['scripts/pack.mjs', '--dir', 'dist-playtest', '--suffix', 'playtest', '--out', `dist-pages/downloads/${base}-playtest.zip`]);
const sha = (process.env.BUILD_SHA || '').slice(0, 7);
const rows = readdirSync(downloads)
  .filter((f) => f.endsWith('.zip'))
  .sort()
  .map((f) => {
    const what = f.includes('-playtest')
      ? 'playtest: with ?debug=1, for checks — not for the Console'
      : f.includes('-no-iap')
        ? 'release without purchases: for the Console draft if the contract for purchases is not ready'
        : 'release with purchases (4 items): load this one into the Console draft';
    return `<li><a href="${f}">${f}</a> · ${(statSync(resolve(downloads, f)).size / 1024 / 1024).toFixed(2)} MB · ${what}</li>`;
  });
writeFileSync(
  resolve(downloads, 'index.html'),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>downloads</title><body style="font:16px/1.5 sans-serif;margin:16px"><h1>${base}</h1><p>${sha ? `commit ${sha}` : ''}</p><ul>${rows.join('')}</ul></body>\n`,
);
console.log(`build:pages: dist-pages ready (sdk.js relative, mock copied), downloads: ${rows.length} archives`);

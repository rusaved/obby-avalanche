// `npm run e2e:release` (mode release): unpack the newest release/*.zip and run e2e/smoke-release.spec.ts on it.
// `node scripts/e2e-static.mjs pages`: run e2e/pages.spec.ts over dist-pages (M0-10).
// `npm run e2e:vk` (mode vk, K-09): e2e/vk-k21.spec.ts over the VK build at vk/.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const mode = process.argv[2] || 'release';
let dir;
let spec;
let port;

if (mode === 'release') {
  const zipArg = process.argv.slice(3).find((a) => a.endsWith('.zip'));
  const releaseDir = resolve(root, 'release');
  const zips = zipArg
    ? [resolve(zipArg)]
    : existsSync(releaseDir)
      ? readdirSync(releaseDir)
          .filter((f) => f.endsWith('.zip') && !f.includes('-playtest'))
          .map((f) => join(releaseDir, f))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      : [];
  if (!zips.length) {
    console.error('e2e:release: no release/*.zip — run npm run pack first');
    process.exit(1);
  }
  const zip = zips[0];
  dir = resolve(root, '.cache/release-unpacked');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const files = unzipSync(new Uint8Array(readFileSync(zip)));
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const out = join(dir, name);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  console.log(`e2e:release: unpacked ${zip} (${Object.keys(files).length} entries) to ${dir}`);
  spec = 'smoke-release.spec.ts';
  port = 4180;
} else if (mode === 'pages') {
  dir = resolve(root, 'dist-pages');
  if (!existsSync(join(dir, 'index.html'))) {
    console.error('e2e pages: dist-pages/index.html missing — run npm run build:pages first');
    process.exit(1);
  }
  spec = 'pages.spec.ts';
  port = 4181;
} else if (mode === 'vk') {
  // K-09 («Лавина 21»): the VK build at vk/ as on the Pages link — dist-pages if build:pages made it, else dist-vk copied
  // into .cache/vk-site/vk (npm run build:vk).
  if (existsSync(join(root, 'dist-pages/vk/index.html')) && !process.argv.includes('--dist-vk')) dir = resolve(root, 'dist-pages');
  else {
    if (!existsSync(join(root, 'dist-vk/index.html'))) {
      console.error('e2e:vk: dist-vk/index.html missing — run npm run build:vk first');
      process.exit(1);
    }
    dir = resolve(root, '.cache/vk-site');
    rmSync(dir, { recursive: true, force: true });
    cpSync(resolve(root, 'dist-vk'), join(dir, 'vk'), { recursive: true });
    // The server is up once the root answers.
    writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>vk-site</title>\n');
  }
  spec = 'vk-k21.spec.ts';
  port = 4182;
} else {
  console.error(`e2e-static: unknown mode ${mode}`);
  process.exit(2);
}

const res = spawnSync('npx', ['playwright', 'test', '--config', 'playwright.static.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, E2E_STATIC_DIR: dir, E2E_STATIC_PORT: String(port), E2E_SPEC: spec },
});
process.exit(res.status ?? 1);

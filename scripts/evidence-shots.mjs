// Evidence screenshots (docs/05, 4.4): serves a built folder statically with the SDK mock and shoots
// 640×360, 844×390 and 1920×1080 into docs/evidence/<milestone>/<screen>_<w>x<h>_<lang>.png.
// usage: node scripts/evidence-shots.mjs --milestone M0 --screen spawn [--dir dist-pages] [--query "mock_lang=ru"] [--lang ru] [--wait-selector '[data-role="build-label"]']
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const milestone = opt('milestone', 'M0');
const screen = opt('screen', 'spawn');
const dir = opt('dir', 'dist-pages');
const query = opt('query', '');
const lang = opt('lang', 'ru');
const waitSelector = opt('wait-selector', '');
const port = Number(opt('port', '4190'));
const sizes = (opt('sizes', '640x360,844x390,1920x1080')).split(',').map((s) => s.split('x').map(Number));
const outDir = resolve(root, 'docs/evidence', milestone);
mkdirSync(outDir, { recursive: true });

const markerFile = resolve(root, '.cache/chromium-path');
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : undefined);
const server = spawn(process.execPath, ['scripts/serve-static.mjs', dir, String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = 0;
try {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const params = new URLSearchParams(query);
    if (!params.has('mock_lang')) params.set('mock_lang', lang);
    await page.goto(`http://127.0.0.1:${port}/?${params.toString()}`);
    if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 30000 });
    else await page.waitForFunction(() => window.__YA_MOCK__?.calls.some((c) => c.name === 'LoadingAPI.ready'), undefined, { timeout: 30000 });
    await page.waitForTimeout(800);
    const file = resolve(outDir, `${screen}_${w}x${h}_${lang}.png`);
    await page.screenshot({ path: file });
    console.log(`${file}  errors=${errors.length}${errors.length ? ` → ${errors.join(" | ")}` : ""}`);
    if (errors.length) failed++;
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);

// V22 (staff 27.10, «Lavina 22 · Track look»): frames of the track for the before/after pairs of the look review — a
// build with the test API (dist-e2e) served statically, the hero put at (x, z) of a mountain, the camera turned to a
// point, 880 × 405, quality high and low; a pair 0.5 s apart where the thing moves (`pair`).
// usage: node scripts/look-shots.mjs --points docs/evidence/V22/points.json --tag before [--dir dist-e2e] [--only V-01]
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
const points = JSON.parse(readFileSync(resolve(root, opt('points', 'docs/evidence/V22/points.json')), 'utf8'));
const tag = opt('tag', 'after');
const only = opt('only', '');
const dir = opt('dir', 'dist-e2e');
const port = Number(opt('port', '4191'));
const qualities = opt('quality', 'high,low').split(',');
const [w, h] = opt('size', '880x405').split('x').map(Number);
const outDir = resolve(root, 'docs/evidence/V22', tag);
mkdirSync(outDir, { recursive: true });

const markerFile = resolve(root, '.cache/chromium-path');
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : undefined);
const server = spawn(process.execPath, ['scripts/serve-static.mjs', dir, String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/mc.yandex.ru/**', (route) => route.fulfill({ status: 200, body: '' }));
await page.goto(`http://127.0.0.1:${port}/?pace=stages&mock_device=mobile&mock_lang=ru&seed=42`);
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60000 });
const ticks = (n) => page.evaluate((k) => window.__TEST__.stepFrames(k), n);
let world = 1;
try {
  for (const p of points) {
    if (only && !p.name.startsWith(only)) continue;
    if ((p.world ?? 1) !== world) {
      world = p.world ?? 1;
      await page.evaluate((k) => window.__TEST__.gotoWorld(k), world);
      await page.waitForTimeout(1500);
      await ticks(30);
    }
    for (const q of qualities) {
      await page.evaluate(
        ([pt, q]) => {
          const T = window.__TEST__;
          T.setQuality(q);
          T.setStat(pt.stat ?? 1e12);
          T.holdWave(9999);
          T.teleport(pt.z, pt.x, pt.y);
          const dx = (pt.look?.[0] ?? pt.x) - pt.x;
          const dz = (pt.look?.[1] ?? pt.z + 10) - pt.z;
          T.setCamera({ yaw: pt.yaw ?? Math.atan2(dx, dz), pitch: pt.pitch ?? 0.3, dist: pt.dist ?? 9 });
        },
        [p, q],
      );
      await ticks(40);
      await page.waitForTimeout(300);
      const base = resolve(outDir, `${p.name}_${q}`);
      await page.screenshot({ path: `${base}.jpg`, type: 'jpeg', quality: 80 });
      if (p.pair) {
        await page.waitForTimeout(500);
        await ticks(15);
        await page.screenshot({ path: `${base}_b.jpg`, type: 'jpeg', quality: 80 });
      }
      console.log(`${p.name}_${q}`);
    }
  }
} finally {
  console.log(`errors=${errors.length}${errors.length ? ` → ${errors.slice(0, 5).join(' | ')}` : ''}`);
  await browser.close();
  server.kill();
}

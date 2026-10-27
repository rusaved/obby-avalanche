// V-15 (staff 27.10, «Lavina 22 · Track look»): a «forward only» bot up mountain 1 with a frame every 6 game seconds, for the
// look review — no bare cube where a thing stands, nothing in the air, nothing on the run line the hero runs through.
// The bot holds up the axis and jumps at edges, its Speed past every ridge, no avalanche; stuck 12 s (the maze) — a hop
// 20 units ahead (written in the report). A build with the test API (dist-e2e) served statically, 880 × 405.
// usage: node scripts/look-bot.mjs [--dir dist-e2e] [--every 6] [--max 420] [--quality high]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const dir = opt('dir', 'dist-e2e');
const every = Number(opt('every', '6'));
const maxSec = Number(opt('max', '420'));
const quality = opt('quality', 'high');
const port = Number(opt('port', '4193'));
const outDir = resolve(root, 'docs/evidence/V22/bot');
mkdirSync(outDir, { recursive: true });

const markerFile = resolve(root, '.cache/chromium-path');
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : undefined);
const server = spawn(process.execPath, ['scripts/serve-static.mjs', dir, String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 880, height: 405 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/mc.yandex.ru/**', (route) => route.fulfill({ status: 200, body: '' }));
await page.goto(`http://127.0.0.1:${port}/?pace=stages&mock_device=mobile&mock_lang=ru&seed=7&quality=${quality}`);
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60000 });
const far = await page.evaluate(() => {
  const T = window.__TEST__;
  T.setPlaySec(400);
  T.setFlag('firstWaveDone', true);
  T.setTutor(9);
  T.noWaves(true);
  T.setStat(1e12);
  T.botJump(true);
  const st = T.stages();
  const far = st[st.length - 1].finish[1] + 80;
  T.botPath([[0, far]]);
  return far;
});
const report = [];
let lastZ = -1;
let stuck = 0;
let hops = 0;
try {
  for (let n = 0; n * every <= maxSec; n++) {
    const t0 = await page.evaluate(() => window.__TEST__.state().simTick);
    await page.waitForFunction((t) => window.__TEST__.state().simTick >= t, t0 + every * 60, { timeout: every * 1000 * 20 });
    const s = await page.evaluate(() => {
      const st = window.__TEST__.state();
      return { x: st.hero.x, y: st.hero.y, z: st.hero.z, stage: st.stage, info: window.__TEST__.renderInfo() };
    });
    const name = `bot-${String(n).padStart(3, '0')}.jpg`;
    await page.screenshot({ path: resolve(outDir, name), type: 'jpeg', quality: 70 });
    report.push({ frame: name, sec: (n + 1) * every, x: Math.round(s.x), z: Math.round(s.z), stage: s.stage, calls: s.info?.calls, triangles: s.info?.triangles });
    console.log(name, Math.round(s.x), Math.round(s.z), s.stage);
    if (s.z >= far - 60) break;
    stuck = Math.abs(s.z - lastZ) < 5 ? stuck + every : 0;
    lastZ = s.z;
    if (stuck >= 12) {
      hops++;
      stuck = 0;
      await page.evaluate((z) => window.__TEST__.teleport(z + 20, 0), s.z);
      report[report.length - 1].hop = true;
    }
  }
} finally {
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify({ hops, errors: errors.length, frames: report }, null, 1) + '\n');
  console.log(`frames=${report.length} hops=${hops} errors=${errors.length}${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  server.kill();
}

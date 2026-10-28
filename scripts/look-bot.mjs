// V-15 (staff 27.10, «Lavina 22 · Track look»): a «forward only» bot up mountain 1 with a frame every few game seconds, for the
// look review — no bare cube where a thing stands, nothing in the air, nothing on the run line the hero runs through.
// The bot holds up the axis and jumps at edges, its Speed past every ridge, no avalanche; it starts at the start, the
// middle and the finish of every stage (a forward-only bot is rolled back off the trials) and runs `every` s to a frame. A build with the test API (dist-e2e) served statically, 880 × 405.
// usage: node scripts/look-bot.mjs [--dir dist-e2e] [--every 2] [--max 600] [--quality high] [--out docs/evidence/V24/bot]
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
const every = Number(opt('every', '2'));
const maxSec = Number(opt('max', '600'));
const quality = opt('quality', 'high');
const port = Number(opt('port', '4193'));
const outDir = resolve(root, opt('out', 'docs/evidence/V22/bot'));
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
  T.setStat(1e9);
  T.botJump(true);
  const st = T.stages();
  const far = st[st.length - 1].finish[1] + 80;
  T.botPath([[0, far]]);
  return far;
});
const report = [];
let hops = 0;
try {
  // Every stage of the mountain: the bot is put at its start, its middle and its finish (a hop — the run itself rolls
  // a «forward only» bot back off the trials) and runs forward `every` game seconds; a frame then.
  const spots = await page.evaluate(() =>
    window.__TEST__.stages().flatMap((st) => [st.start + 2, (st.start + st.end) / 2, st.finish[0] + 2].map((z) => ({ z, y: st.y, stage: st.n }))),
  );
  for (const [n, spot] of spots.entries()) {
    if (n * every > maxSec) break;
    hops++;
    await page.evaluate(([z, y, far]) => {
      window.__TEST__.teleport(z, 0, y + 0.05);
      window.__TEST__.botPath([[0, far]]);
    }, [spot.z, spot.y, far]);
    const t0 = await page.evaluate(() => window.__TEST__.state().simTick);
    // A window that stops the game (a summit, a gift) leaves the frame as it is.
    await page.waitForFunction((t) => window.__TEST__.state().simTick >= t, t0 + every * 60, { timeout: every * 1000 * 20 }).catch(() => {});
    const s = await page.evaluate(() => {
      const st = window.__TEST__.state();
      return { x: st.hero.x, z: st.hero.z, stage: st.stage, info: window.__TEST__.renderInfo() };
    });
    const name = `bot-${String(n).padStart(3, '0')}.jpg`;
    await page.screenshot({ path: resolve(outDir, name), type: 'jpeg', quality: 70 });
    report.push({ frame: name, from: Math.round(spot.z), x: Math.round(s.x), z: Math.round(s.z), stage: s.stage, calls: s.info?.calls, triangles: s.info?.triangles });
    console.log(name, Math.round(spot.z), '→', Math.round(s.z), s.stage);
  }
} finally {
  writeFileSync(resolve(outDir, 'report.json'), JSON.stringify({ hops, errors: errors.length, frames: report }, null, 1) + '\n');
  console.log(`frames=${report.length} hops=${hops} errors=${errors.length}${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  server.kill();
}

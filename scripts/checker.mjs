// M6-04 (docs/03-yandex-compliance.md 7.1.3): the unofficial checker debugcheck.js on the playtest build. Serves
// dist-playtest with the SDK mock on /sdk.js, puts debugcheck.js right after /sdk.js (as its README asks; the file
// itself stays out of the repository and the archives), plays a minute, opens the pause, and writes the checker's report.
// Usage: node scripts/checker.mjs <path to debugcheck.js> [out.txt]
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const [file, outArg] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/checker.mjs <debugcheck.js> [out.txt]');
  process.exit(2);
}
const dist = resolve(root, 'dist-playtest');
if (!existsSync(resolve(dist, 'index.html'))) {
  console.error('checker: no dist-playtest — run npm run build:playtest first');
  process.exit(2);
}
// The report lives in the checker's closure: one line hands it out (in memory only, the file on disk is untouched).
const code = readFileSync(file, 'utf8').replace('})();\n// === DEBUGCHECK_SELF_END', 'window.__dcReport=function(){return _lastReport;};\n})();\n// === DEBUGCHECK_SELF_END');
const port = 4190;
const server = spawn(process.execPath, [resolve(root, 'scripts/serve-static.mjs'), dist, String(port)], { stdio: 'ignore' });
const marker = resolve(root, '.cache/chromium-path');
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(marker) ? readFileSync(marker, 'utf8').trim() : undefined);
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let exit = 0;
try {
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch(executablePath ? { executablePath, args } : { args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/debugcheck.js', (r) => r.fulfill({ contentType: 'application/javascript', body: code }));
  await page.route(/\/(index\.html)?(\?.*)?$/, async (r) => {
    const res = await r.fetch();
    const html = (await res.text()).replace(/(<script[^>]*src="\/sdk\.js"[^>]*><\/script>)/, '$1\n<script src="debugcheck.js"></script>');
    await r.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__YA_MOCK__?.calls.some((c) => c.name === 'LoadingAPI.ready'), undefined, { timeout: 60_000 });
  // A minute of play: a click, a run up, a jump, the pause and back, a tab hidden and back.
  await page.mouse.click(640, 400);
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    await page.keyboard.press('Space');
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.YGDebugChecker.refresh());
  await page.waitForFunction(() => (window.__dcReport?.() ?? '').length > 200, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const report = await page.evaluate(() => window.__dcReport());
  await page.screenshot({ path: resolve(root, 'docs/evidence/compliance/checker.png') });
  const out = resolve(root, outArg || 'docs/evidence/compliance/checker-raw.txt');
  writeFileSync(out, `${report}\n\nconsole errors and page errors: ${errors.length}\n${errors.join('\n')}\n`);
  const counts = ['PASS', 'FAIL', 'WARN', 'NOT VERIFIED', 'N/A'].map((k) => `${k} ${(report.match(new RegExp(`\\[${k.replace('/', '\\/')}\\]`, 'g')) ?? []).length}`);
  console.log(`checker: ${counts.join(', ')}; console errors ${errors.length} -> ${out}`);
  await browser.close();
} catch (e) {
  console.error(e);
  exit = 1;
} finally {
  server.kill();
}
process.exit(exit);

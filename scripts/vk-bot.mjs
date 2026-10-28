// R-06 («Лавина 23»): the VK build as a VK player meets it — a phone upright first (the rotate screen), then turned, «Play»
// and forward for N minutes with a jump now and then. No test API in this build: the hero by __KIT_STATE__ (?coins=0), the
// bridge stand-in's calls, a frame a minute. Usage: node scripts/vk-bot.mjs [minutes] (after npm run build:vk).
import { chromium } from '@playwright/test';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const minutes = Number(process.argv[2] ?? 4);
const out = resolve(root, 'docs/evidence/L23');
mkdirSync(out, { recursive: true });
const site = resolve(root, '.cache/vk-bot-site');
rmSync(site, { recursive: true, force: true });
cpSync(resolve(root, 'dist-vk'), join(site, 'vk'), { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = raw.endsWith('/') ? `${raw}index.html` : raw;
  try {
    const body = await readFile(join(site, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(4390, '127.0.0.1');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 405, height: 880 }, hasTouch: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
const outside = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => !/^http:\/\/127\.0\.0\.1[:/]/.test(r.url()) && !/^(data|blob|about):/.test(r.url()) && outside.push(r.url()));
await page.goto('http://127.0.0.1:4390/vk/?mock=vk&vk_platform=mobile_android&fresh=1&coins=0');
await page.waitForSelector('#preloader.hidden', { timeout: 120_000 });
const rotateShown = await page.locator('[data-role="rotate"].shown').count();
await page.screenshot({ path: `${out}/vk-bot-portrait.png` });
await page.waitForTimeout(1500);
await page.setViewportSize({ width: 880, height: 405 });
await page.waitForTimeout(500);
const rotateAfter = await page.locator('[data-role="rotate"].shown').count();
await page.locator('[data-vk="play"]').tap();
const kit = () => page.evaluate(() => window.__KIT_STATE__());
const samples = [];
const t0 = Date.now();
await page.keyboard.down('ArrowUp');
let minute = 0;
while (Date.now() - t0 < minutes * 60_000) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  // Steer back to the middle of the slope now and then.
  const s = await kit();
  if (Math.abs(s.x ?? 0) > 25) {
    const key = s.x > 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    await page.waitForTimeout(300);
    await page.keyboard.up(key);
  }
  if (Date.now() - t0 >= (minute + 1) * 60_000) {
    minute++;
    samples.push({ minute, ...(await kit()) });
    await page.screenshot({ path: `${out}/vk-bot-${minute}min.png` });
  }
}
await page.keyboard.up('ArrowUp');
const calls = await page.evaluate(() => window.__VK_MOCK__.calls.map((c) => c.method));
const count = (m) => calls.filter((c) => c === m).length;
const report = {
  minutes,
  rotateShownUpright: rotateShown === 1,
  rotateGoneTurned: rotateAfter === 0,
  rotate: await page.evaluate(() => (window.__ANALYTICS_BUFFER__ ?? []).filter((e) => e.name.startsWith('rotate_'))),
  samples,
  showNativeAds: count('VKWebAppShowNativeAds'),
  storageSet: count('VKWebAppStorageSet'),
  errors,
  outside,
};
writeFileSync(`${out}/vk-bot.json`, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ ...report, samples: samples.map((s) => `${s.minute}: world ${s.world} z ${Math.round(s.z)}`) }));
await browser.close();
server.close();

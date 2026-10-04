// Video capture probe (docs/05 M1 "Окружение", docs/04-packaging.md 10.3): build:e2e, Playwright 1920×1080,
// __TEST__.stepFrames(1) per frame (1/30 s), 150 screenshots, MP4 through ffmpeg-static (or system ffmpeg).
// Output: docs/evidence/M1/capture-probe.mp4; frames stay outside git. Prints seconds per frame and the MP4 size.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const frames = Number(process.argv[2] || 150);
const outDir = resolve(root, 'docs/evidence/M1');
const frameDir = resolve(root, '.cache/capture-frames');
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const markerFile = resolve(root, '.cache/chromium-path');
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : undefined);
const port = 4195;
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let perFrame = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/?quality=high&seed=42`);
  await page.waitForFunction(() => window.__TEST__ && window.__TEST__.ready === true, undefined, { timeout: 60000 });
  await page.evaluate(() => window.__TEST__.openMenu(false));
  // Pause the loop and drive it by hand: a run up the slope with a jump every 40 frames.
  await page.evaluate(() => {
    const t = window.__TEST__;
    t.setTimeScale(1);
    
    t.keyDown('KeyW');
  });
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((k) => {
      if (k % 40 === 20) window.__TEST__.press('Space', 50);
      window.__TEST__.stepFrames(1);
    }, i);
    await page.screenshot({ path: resolve(frameDir, `f${String(i).padStart(4, '0')}.png`) });
  }
  perFrame = (Date.now() - t0) / 1000 / frames;
  await page.evaluate(() => window.__TEST__.keyUp('KeyW'));
} finally {
  await browser.close();
  server.kill();
}
console.log(`capture-probe: ${frames} frames, ${perFrame.toFixed(2)} s per frame`);

let ffmpeg = null;
try {
  const mod = await import('ffmpeg-static');
  ffmpeg = mod.default;
} catch {
  ffmpeg = null;
}
if (!ffmpeg || !existsSync(ffmpeg)) {
  const which = spawnSync('which', ['ffmpeg']);
  ffmpeg = which.status === 0 ? which.stdout.toString().trim() : null;
}
if (!ffmpeg) {
  console.error('capture-probe: no ffmpeg binary (ffmpeg-static missing and no system ffmpeg)');
  process.exit(2);
}
const out = resolve(outDir, 'capture-probe.mp4');
const res = spawnSync(ffmpeg, ['-y', '-framerate', '30', '-i', resolve(frameDir, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-crf', '23', '-movflags', '+faststart', out], { stdio: 'pipe' });
if (res.status !== 0) {
  console.error('capture-probe: ffmpeg failed', res.stderr.toString().slice(-800));
  process.exit(1);
}
console.log(`capture-probe: ${out} ${(statSync(out).size / 1024).toFixed(0)} KB (ffmpeg: ${ffmpeg})`);

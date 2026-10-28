// V24 (staff 28.10, «Lavina 24 · Look: canopies and gates»): frames of the track in the usual camera on the run, for the
// before/after pairs of the look review — not set shots: the hero is put at a spot of mountain 1 (a stage start, a z on
// the axis or a belt), runs forward (or stands) with the camera of the game, and the frame is taken after `wait` ticks.
// A build with the test API (dist-e2e) served statically, 880 × 405, quality high.
// usage: node scripts/look-run.mjs --points docs/evidence/V24/run-points.json --tag before --dir <main dist-e2e> [--only P1]
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
const points = JSON.parse(readFileSync(resolve(root, opt('points', 'docs/evidence/V24/run-points.json')), 'utf8'));
const tag = opt('tag', 'after');
const only = opt('only', '');
const dir = opt('dir', 'dist-e2e');
const port = Number(opt('port', '4195'));
const outDir = resolve(root, 'docs/evidence/V24', tag);
mkdirSync(outDir, { recursive: true });

const markerFile = resolve(root, '.cache/chromium-path');
const executablePath = process.env.CHROMIUM_EXECUTABLE || (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : undefined);
const server = spawn(process.execPath, ['scripts/serve-static.mjs', dir, String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const pace of [...new Set(points.map((p) => p.pace ?? 'stages'))]) {
    const page = await browser.newPage({ viewport: { width: 880, height: 405 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await page.route('**/mc.yandex.ru/**', (route) => route.fulfill({ status: 200, body: '' }));
    await page.goto(`http://127.0.0.1:${port}/?pace=${pace}&mock_device=mobile&mock_lang=ru&seed=7&quality=high`);
    await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 60000 });
    for (const p of points.filter((q) => (q.pace ?? 'stages') === pace && (!only || q.name.startsWith(only)))) {
      await page.evaluate((p) => {
        const T = window.__TEST__;
        T.setPlaySec(400);
        T.setFlag('firstWaveDone', true);
        T.setTutor(9);
        T.noWaves(true);
        T.setStat(p.stat ?? 2300);
        T.botJump(true);
        T.botPath(null);
        T.setCamera('auto');
        let x = p.x ?? 0;
        let y = p.y;
        let z = p.z ?? 0;
        if (p.stage) {
          // A build before V24 has no stageStart(): its checkpoint lies 8 below the start of the stage.
          const st = T.stages().find((q) => q.n === p.stage);
          const at = T.stageStart ? T.stageStart(p.stage) : { x: 0, y: st.y, z: st.start - 8 };
          x = at.x;
          y = at.y + 0.05;
          z = at.z + (p.dz ?? 0);
        } else if (p.belt !== undefined) {
          const s = T.shelters().filter((q) => q.kind === 'island' && q.belt)[p.belt];
          y = (p.dz ?? 0) >= 0 ? s.y + 0.05 : undefined;
          z = s.belt[1] + (p.dz ?? 0);
        }
        T.teleport(z, x, y);
      }, p);
      // The camera settles behind him first (no fly-in from the last spot), then he runs.
      await page.waitForTimeout(1200);
      const t0 = await page.evaluate(() => window.__TEST__.state().simTick);
      if (p.run) await page.evaluate(() => window.__TEST__.botPath([[0, window.__TEST__.state().hero.z + 400]]));
      await page.waitForFunction((t) => window.__TEST__.state().simTick >= t, t0 + (p.wait ?? 30), { timeout: 60000 }).catch(() => {});
      await page.screenshot({ path: resolve(outDir, `${p.name}.jpg`), type: 'jpeg', quality: 78 });
      console.log(tag, p.name);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

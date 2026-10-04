import { test, expect, waitTicks } from './fixtures.ts';

// Blocky hero (docs/02-tech.md 9.2): 8 faces from the atlas, all characters on ≤ 8 draw calls, colours from skins.json.
test('faces.png: eight emotions in a row; nine characters still fit in 8 draw calls', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openGame('quality=high');
  await page.evaluate(() => window.__TEST__!.showFaces());
  await waitTicks(page, 20);
  const calls = await page.evaluate(() => window.__TEST__!.charactersDrawCalls());
  expect(calls).toBeLessThanOrEqual(8);
  const info = await page.evaluate(() => window.__TEST__!.renderInfo()!);
  expect(info.calls).toBeLessThanOrEqual(60);
  await page.screenshot({ path: 'docs/evidence/M1/faces.png' });
});

// Hero close-up for the producer (Q-021): three-quarter front view, docs/evidence/M2/hero.png.
test('hero close-up: three-quarter view screenshot', async ({ page, openGame }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await openGame('quality=high');
  await page.evaluate(() => window.__TEST__!.setCamera({ yaw: Math.PI + 0.6, pitch: 0.15, dist: 6.5 }));
  await waitTicks(page, 180);
  await page.screenshot({ path: 'docs/evidence/M2/hero.png' });
});

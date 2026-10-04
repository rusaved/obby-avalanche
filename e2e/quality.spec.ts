import { test, expect, testState } from './fixtures.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

// Quality levels and render budgets (docs/02-tech.md 9.3, 9.5): draw calls ≤ 60, triangles ≤ 150k, textures ≤ 16.
test.describe('quality and budgets', () => {
  test('render budgets on the slope of mountain 1 at three points, written to docs/evidence/M1/budgets.txt', async ({ page, openGame }) => {
    await openGame('quality=high');
    const rows: string[] = [];
    for (const z of [20, 400, 1150]) {
      await page.evaluate((zz) => window.__TEST__!.teleport(zz), z);
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => window.__TEST__!.renderInfo()!);
      const chars = await page.evaluate(() => window.__TEST__!.charactersDrawCalls());
      rows.push(`z=${z}: draw calls ${info.calls}, triangles ${info.triangles}, textures ${info.textures}, geometries ${info.geometries}, character draw calls ${chars}`);
      expect(info.calls, `draw calls at z=${z}`).toBeLessThanOrEqual(60);
      expect(info.triangles, `triangles at z=${z}`).toBeLessThanOrEqual(150_000);
      expect(info.textures, `textures at z=${z}`).toBeLessThanOrEqual(16);
      expect(chars).toBeLessThanOrEqual(8);
    }
    mkdirSync('docs/evidence/M1', { recursive: true });
    writeFileSync('docs/evidence/M1/budgets.txt', [`budgets (docs/02-tech.md 9.5), mountain 1, quality high, ${new Date().toISOString()}`, ...rows, ''].join('\n'));
  });

  test('auto downgrade: slow frames lower DPR first, then the level; ?quality and ?dpr lock both', async ({ page, openGame }) => {
    await openGame();
    await page.evaluate(() => window.__TEST__!.qualityAutoFrom('high'));
    const q0 = (await testState(page)).quality;
    expect(q0.locked).toBe(false);
    expect(q0.level).toBe('high');
    const changed = await page.evaluate(() => window.__TEST__!.forceSlowFrames(3));
    expect(changed).toBe(true);
    const q1 = (await testState(page)).quality;
    expect(q1.dpr).toBeLessThanOrEqual(q0.dpr);
    for (let i = 0; i < 6; i++) await page.evaluate(() => window.__TEST__!.forceSlowFrames(3));
    const q2 = (await testState(page)).quality;
    expect(['low', 'medium'].includes(q2.level) || q2.dpr < q0.dpr).toBe(true);

    await openGame('quality=low&dpr=0.5');
    const q3 = (await testState(page)).quality;
    expect(q3).toEqual({ level: 'low', dpr: 0.5, locked: true });
    await page.evaluate(() => window.__TEST__!.forceSlowFrames(30));
    expect((await testState(page)).quality.level).toBe('low');
    const backing = await page.evaluate(() => {
      const c = document.getElementById('game') as HTMLCanvasElement;
      return { w: c.width, cssW: c.getBoundingClientRect().width };
    });
    expect(backing.w).toBe(Math.round(backing.cssW * 0.5));
  });

  test('?gpuload=2 renders the scene twice per frame', async ({ page, openGame }) => {
    await openGame('gpuload=2');
    const a = await testState(page);
    await page.waitForTimeout(600);
    const b = await testState(page);
    expect(b.gpuLoad).toBe(2);
    const presented = b.framesPresented - a.framesPresented;
    const rendered = b.framesRendered - a.framesRendered;
    expect(presented).toBeGreaterThan(5);
    expect(rendered).toBe(presented * 2);
  });
});

import { test, expect, testState, mockCalls } from './fixtures.ts';

// Smoke on the `_sample` pack (docs/02-tech.md 5.1): game 2 is a data swap, the same code boots and renders.
test('sample pack boots, renders and calls ready() once', async ({ page, openGame }) => {
  await openGame();
  const state = await testState(page);
  expect(state.pack).toBe('_sample');
  expect(state.platform).toBe('yandex');
  expect(await mockCalls(page, 'LoadingAPI.ready')).toBe(1);
  await page.waitForFunction(() => (window.__TEST__!.renderInfo()?.frame ?? 0) > 2);
  const info = await page.evaluate(() => window.__TEST__!.renderInfo());
  expect(info!.calls).toBeGreaterThan(0);
  const title = await page.title();
  expect(title.length).toBeGreaterThan(0);
});

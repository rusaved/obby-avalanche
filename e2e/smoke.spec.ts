import { test, expect, testState, mockCalls, runGameTime, waitTicks } from './fixtures.ts';

test.describe('smoke', () => {
  test('environment: WebGL2 context, renderer draws, UNMASKED_RENDERER_WEBGL logged', async ({ page, openGame }) => {
    await openGame();
    const hasWebGL2 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      return gl instanceof WebGL2RenderingContext;
    });
    expect(hasWebGL2).toBe(true);
    const state = await testState(page);
    console.log(`UNMASKED_RENDERER_WEBGL: ${state.glRenderer}`);
    expect(state.glRenderer.length).toBeGreaterThan(0);
    await page.waitForFunction(() => (window.__TEST__!.renderInfo()?.frame ?? 0) > 2);
    const info = await page.evaluate(() => window.__TEST__!.renderInfo());
    expect(info).not.toBeNull();
    expect(info!.calls).toBeGreaterThan(0);
  });

  test('SDK-02 LoadingAPI.ready() exactly once and after the first frame; platform is yandex', async ({ page, openGame }) => {
    await openGame();
    expect(await mockCalls(page, 'LoadingAPI.ready')).toBe(1);
    const state = await testState(page);
    expect(state.platform).toBe('yandex');
    expect(state.firstFrameAt).not.toBeNull();
    expect(state.readyAt).not.toBeNull();
    expect(state.firstFrameAt!).toBeLessThanOrEqual(state.readyAt!);
    const events = await page.evaluate(() => window.__TEST__!.events);
    expect(events.indexOf('firstFrame')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('firstFrame')).toBeLessThan(events.indexOf('ready'));
    expect(state.controllable).toBe(true);
    expect(state.pauseReasons).toEqual([]);
    expect(await mockCalls(page, 'GameplayAPI.start')).toBe(1);
    expect(await mockCalls(page, 'getPlayer')).toBe(1);
  });

  test('SDK-03 interface language comes from environment.i18n.lang', async ({ page, openGame }) => {
    await openGame('mock_lang=en');
    const en = await testState(page);
    expect(en.lang).toBe('en');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    const titleEn = await page.title();
    await openGame('mock_lang=ru');
    const ru = await testState(page);
    expect(ru.lang).toBe('ru');
    const titleRu = await page.title();
    expect(titleRu).not.toBe(titleEn);
    expect(/[А-Яа-яЁё]/.test(titleRu)).toBe(true);
    await openGame('mock_lang=kk');
    expect((await testState(page)).lang).toBe('ru');
    await openGame('mock_lang=de');
    expect((await testState(page)).lang).toBe('en');
  });

  test('SDK-02 slow network: ?mock_init_delay=15000 waits for init, ready once, sdk_init_slow once', async ({ page, openGame }) => {
    await openGame('mock_init_delay=15000&mock_lang=en');
    const state = await testState(page);
    expect(state.platform).toBe('yandex');
    expect(state.lang).toBe('en');
    expect(await mockCalls(page, 'LoadingAPI.ready')).toBe(1);
    const slow = await page.evaluate(() => window.__TEST__!.analytics().filter((e) => e.name === 'sdk_init_slow').length);
    expect(slow).toBe(1);
  });

  test('3 minutes of game time at ×20 without console errors', async ({ page, openGame }) => {
    await openGame('seed=42');
    await runGameTime(page, 180, 20);
    const state = await testState(page);
    expect(state.timeSec).toBeGreaterThanOrEqual(180);
    expect(await mockCalls(page, 'LoadingAPI.ready')).toBe(1);
  });

  test('BLD-02 no network requests outside the origin except /sdk.js and Metrika', async ({ page, openGame, requests, baseURL }) => {
    await openGame();
    await page.waitForTimeout(500);
    const origin = new URL(baseURL!).origin;
    const external = requests.filter((u) => !u.startsWith(origin) && !/^https?:\/\/mc\.yandex\.ru\//.test(u) && !u.startsWith('data:'));
    expect(external).toEqual([]);
    expect(requests.some((u) => u === `${origin}/sdk.js`)).toBe(true);
  });

  test('pause reasons: hidden tab stops the simulation and GameplayAPI, visible resumes it', async ({ page, openGame }) => {
    await openGame();
    const ticksBefore = (await testState(page)).ticks;
    await waitTicks(page, 6);
    expect((await testState(page)).ticks).toBeGreaterThan(ticksBefore);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((await testState(page)).pauseReasons).toEqual(['hidden']);
    const stops = await mockCalls(page, 'GameplayAPI.stop');
    expect(stops).toBe(1);
    const t1 = (await testState(page)).ticks;
    await page.waitForTimeout(200);
    expect((await testState(page)).ticks).toBe(t1);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((await testState(page)).pauseReasons).toEqual([]);
    await waitTicks(page, 6);
    expect((await testState(page)).ticks).toBeGreaterThan(t1);
    expect(await mockCalls(page, 'GameplayAPI.start')).toBe(2);
  });
});

import { test as base, expect, type Page } from '@playwright/test';
import type { TestApi } from '../src/test-api/index.ts';

export { expect };

type Options = {
  /** Set true in tests that provoke console errors on purpose. */
  allowConsoleErrors: boolean;
};

type Fixtures = {
  errors: string[];
  /** Opens the game with query params (string "a=1&b=2") and waits for window.__TEST__.ready. Without `pace` in the
   * query the classic pace (docs/01-gdd.md 16.1): specs of the fast pace pass `pace=fast` themselves. */
  openGame: (query?: string) => Promise<void>;
  requests: string[];
};

/** Shared fixture (docs/02-tech.md 17.2): Metrika stubbed, console errors and page errors collected, mock violations must be empty. */
export const test = base.extend<Options & Fixtures>({
  allowConsoleErrors: [false, { option: true }],
  requests: async ({ page }, use) => {
    const list: string[] = [];
    page.on('request', (r) => list.push(r.url()));
    await use(list);
  },
  errors: [
    async ({ page, allowConsoleErrors }, use) => {
      const errors: string[] = [];
      // E2E_CPU_THROTTLE=4 emulates a slow CI runner (tests must hold on game ticks, not wall time).
      const throttle = Number(process.env.E2E_CPU_THROTTLE || 0);
      if (throttle > 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      }
      await page.route('**/mc.yandex.ru/**', (route) => route.fulfill({ status: 200, body: '' }));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      await use(errors);
      if (!page.isClosed()) {
        const violations = await page.evaluate(() => window.__YA_MOCK__?.violations ?? []).catch(() => [] as string[]);
        expect(violations, 'SDK mock violations').toEqual([]);
      }
      if (!allowConsoleErrors) expect(errors, 'console errors and page errors').toEqual([]);
    },
    { auto: true },
  ],
  openGame: async ({ page, isMobile }, use) => {
    await use(async (query = '') => {
      const params = new URLSearchParams(query);
      if (isMobile && !params.has('mock_device')) params.set('mock_device', 'mobile');
      if (!params.has('pace')) params.set('pace', 'classic');
      const qs = params.toString();
      await page.goto(qs ? `/?${qs}` : '/');
      await waitReady(page);
    });
  },
});

export async function waitReady(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout });
}

export async function testState(page: Page): Promise<ReturnType<TestApi['state']>> {
  return page.evaluate(() => window.__TEST__!.state());
}

export async function mockCalls(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => window.__YA_MOCK__!.calls.filter((c) => c.name === n).length, name);
}

/** Runs game time at scale k until timeSec reaches target (docs/05, section 4: time in tests is game time). */
export async function runGameTime(page: Page, targetSec: number, scale = 20): Promise<void> {
  await page.evaluate((k) => window.__TEST__!.setTimeScale(k), scale);
  await page.waitForFunction((t) => (window.__TEST__!.state().timeSec ?? 0) >= t, targetSec, { timeout: 110_000 });
  await page.evaluate(() => window.__TEST__!.setTimeScale(1));
}

/** Waits until the simulation has advanced by `n` ticks (game time, independent of the machine speed). */
export async function waitTicks(page: Page, n: number, timeout = 60_000): Promise<void> {
  const start = await page.evaluate(() => window.__TEST__!.state().ticks);
  await page.waitForFunction((t) => window.__TEST__!.state().ticks >= t, start + n, { timeout });
}

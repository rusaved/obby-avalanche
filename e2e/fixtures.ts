import { test as base, expect, type Page } from '@playwright/test';
import type { TestApi } from '../src/test-api/index.ts';

export { expect };

type Options = {
  /** Set true in tests that provoke console errors on purpose. */
  allowConsoleErrors: boolean;
};

type Fixtures = {
  errors: string[];
  /** Opens the game with query params (string "a=1&b=2") and waits for window.__TEST__.ready. */
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

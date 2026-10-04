import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchArgs } from './playwright.config.ts';

// Static-server configs: e2e:release (unpacked release/*.zip) and the producer link build (dist-pages).
const dir = process.env.E2E_STATIC_DIR || '.cache/release-unpacked';
const port = Number(process.env.E2E_STATIC_PORT || 4180);
const spec = process.env.E2E_SPEC || 'smoke-release.spec.ts';
const markerFile = resolve(import.meta.dirname, '.cache/chromium-path');
const executablePath =
  process.env.CHROMIUM_EXECUTABLE || (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : undefined);

export default defineConfig({
  testDir: 'e2e',
  testMatch: new RegExp(spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/static',
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    headless: true,
    launchOptions: executablePath ? { executablePath, args: launchArgs } : { args: launchArgs },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node scripts/serve-static.mjs ${dir} ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

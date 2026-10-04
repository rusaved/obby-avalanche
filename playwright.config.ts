import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// e2e against `vite preview` of build:e2e (docs/02-tech.md 17.2). E2E_DIST/E2E_PORT let e2e:sample reuse it.
const dist = process.env.E2E_DIST || 'dist-e2e';
// e2e:sample points E2E_DIST at the _sample build and runs only sample.spec.ts; static-server specs have their own config.
const sampleMode = dist.includes('sample');
const STATIC_SPECS = /(smoke-release|pages)\.spec\.ts$/;
const MOBILE_SPECS = /(touch|layout|ftue)\.spec\.ts$/;
const port = Number(process.env.E2E_PORT || 4173);
const markerFile = resolve(import.meta.dirname, '.cache/chromium-path');
const executablePath =
  process.env.CHROMIUM_EXECUTABLE || (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : undefined);

export const launchArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'e2e',
  testMatch: sampleMode ? /sample\.spec\.ts$/ : /.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 2,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    headless: true,
    launchOptions: executablePath ? { executablePath, args: launchArgs } : { args: launchArgs },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: sampleMode ? [] : [MOBILE_SPECS, STATIC_SPECS, /sample\.spec\.ts$/] },
    {
      name: 'mobile',
      testMatch: sampleMode ? /$^/ : MOBILE_SPECS,
      use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: `npx vite preview --outDir ${dist} --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// e2e against `vite preview` of build:e2e (docs/02-tech.md 17.2). E2E_DIST/E2E_PORT let e2e:sample reuse it.
const dist = process.env.E2E_DIST || 'dist-e2e';
// e2e:sample points E2E_DIST at the _sample build and runs only sample.spec.ts; static-server specs have their own config.
const sampleMode = dist.includes('sample');
const STATIC_SPECS = /(smoke-release|pages)\.spec\.ts$/;
const MOBILE_SPECS = /(touch|layout|ftue)[^/]*\.spec\.ts$/;
// MU round 3 (producer 19.10): the truthful profile — a phone in full screen (915 × 412) and the same phone in Yandex
// Browser under its panels (815 × 290); every check of the round runs on each. Round 4 (20.10): the producer's phone
// is 2.17 : 1 — full screen ≈ 880 × 405 CSS, added first.
const TRUTHFUL_SPECS = /truthful[^/]*\.spec\.ts$/;
const TRUTHFUL_VIEWS = [{ width: 880, height: 405 }, { width: 915, height: 412 }, { width: 815, height: 290 }];
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
    { name: 'desktop', testIgnore: sampleMode ? [] : [MOBILE_SPECS, TRUTHFUL_SPECS, STATIC_SPECS, /sample\.spec\.ts$/] },
    {
      name: 'mobile',
      testMatch: sampleMode ? /$^/ : MOBILE_SPECS,
      use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
    },
    ...TRUTHFUL_VIEWS.map((viewport) => ({
      name: `truthful-${viewport.width}x${viewport.height}`,
      testMatch: sampleMode ? /$^/ : TRUTHFUL_SPECS,
      use: { viewport, hasTouch: true, isMobile: true },
    })),
  ],
  webServer: {
    command: `npx vite preview --outDir ${dist} --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

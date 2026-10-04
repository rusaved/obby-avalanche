/**
 * window.__TEST__ (docs/02-tech.md 17.3): only in build:e2e. Tests read state, not pixels. Time in tests is
 * game time: setTimeScale(k) and runSim(sec) also move the SDK mock clock (__YA_MOCK__.advance).
 */
import type { Loop } from '../core/loop.ts';
import type { PauseManager } from '../core/pause.ts';
import type { Platform } from '../platform/types.ts';
import type { GameRenderer, RenderInfo } from '../render/renderer.ts';
import { analyticsEvents } from '../analytics/index.ts';

export interface TestBootState {
  firstFrameAt: number | null;
  readyAt: number | null;
  controllable: boolean;
  glRenderer: string;
}

export interface TestApiDeps {
  loop: Loop;
  pause: PauseManager;
  platform: Platform;
  renderer: () => GameRenderer | null;
  boot: TestBootState;
  events: string[];
  packId: string;
  lang: string;
}

export interface TestApi {
  ready: boolean;
  state(): {
    platform: 'yandex' | 'null';
    lang: string;
    pack: string;
    controllable: boolean;
    pauseReasons: string[];
    paused: boolean;
    ticks: number;
    timeSec: number;
    firstFrameAt: number | null;
    readyAt: number | null;
    glRenderer: string;
  };
  events: string[];
  analytics(): ReadonlyArray<{ name: string; t: number; params?: Record<string, unknown> }>;
  renderInfo(): RenderInfo | null;
  setTimeScale(k: number): void;
  runSim(sec: number): void;
  stepFrames(n: number): void;
}

declare global {
  interface Window {
    __TEST__?: TestApi;
    __YA_MOCK__?: { advance(ms: number): void; calls: Array<{ name: string; args: unknown[]; t: number }>; violations: string[] };
  }
}

export function installTestApi(deps: TestApiDeps): TestApi {
  const advanceMock = (ms: number): void => {
    if (ms > 0) window.__YA_MOCK__?.advance(ms);
  };
  const api: TestApi = {
    ready: false,
    state() {
      return {
        platform: deps.platform.kind,
        lang: deps.lang,
        pack: deps.packId,
        controllable: deps.boot.controllable,
        pauseReasons: deps.pause.reasons,
        paused: deps.pause.paused,
        ticks: deps.loop.ticks,
        timeSec: deps.loop.timeSec,
        firstFrameAt: deps.boot.firstFrameAt,
        readyAt: deps.boot.readyAt,
        glRenderer: deps.boot.glRenderer,
      };
    },
    events: deps.events,
    analytics: () => analyticsEvents(),
    renderInfo: () => deps.renderer()?.info() ?? null,
    setTimeScale(k) {
      deps.loop.timeScale = k;
      deps.loop.unlimited = k !== 1;
    },
    runSim(sec) {
      deps.loop.runSim(sec);
      advanceMock(sec * 1000);
    },
    stepFrames(n) {
      const wasPaused = deps.loop.paused;
      deps.loop.paused = false;
      for (let i = 0; i < n; i++) deps.loop.runSim(deps.loop.step * 2);
      deps.loop.paused = wasPaused;
    },
  };
  window.__TEST__ = api;
  return api;
}

/** Called by the loop after every frame so the mock clock keeps up with accelerated game time. */
export function mockClockSync(gameDtSec: number, realDtSec: number): void {
  const extra = (gameDtSec - realDtSec) * 1000;
  if (extra > 0) window.__YA_MOCK__?.advance(extra);
}

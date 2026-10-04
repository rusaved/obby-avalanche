/**
 * window.__TEST__ (docs/02-tech.md 17.3, docs/04-packaging.md 11.2): only in build:e2e. Tests read state, not pixels.
 * Time in tests is game time: setTimeScale(k) and runSim(sec) also move the SDK mock clock (__YA_MOCK__.advance).
 */
import type { RenderInfo } from '../render/renderer.ts';
import type { GameHandles, SimEventRecord } from '../app/handles.ts';
import { analyticsEvents } from '../analytics/index.ts';
import type { QualityLevel } from '../render/quality.ts';

export type { BootState as TestBootState } from '../app/handles.ts';

export interface TestState {
  platform: 'yandex' | 'null';
  lang: string;
  pack: string;
  world: string;
  controllable: boolean;
  pauseReasons: string[];
  paused: boolean;
  ticks: number;
  timeSec: number;
  firstFrameAt: number | null;
  readyAt: number | null;
  glRenderer: string;
  hero: { x: number; y: number; z: number; vx: number; vy: number; vz: number; speed: number; onGround: boolean; yaw: number } | null;
  /** Stat (Speed) and steps taken (M2-01). */
  stat: number;
  steps: number;
  controlYaw: number;
  viewYaw: number;
  cameraDistance: number;
  cameraFov: number;
  cameraPos: [number, number, number];
  autoRun: boolean;
  checkpoint: number;
  respawning: boolean;
  touchMode: boolean;
  stickActive: boolean;
  quality: { level: QualityLevel; dpr: number; locked: boolean };
  field: { width: number; height: number; left: number; top: number };
  menuOpen: boolean;
  lastFrameMs: number;
  lastSimMs: number;
  gpuLoad: number;
  framesPresented: number;
  framesRendered: number;
}

export interface TestApi {
  ready: boolean;
  state(): TestState;
  events: string[];
  simEvents: SimEventRecord[];
  analytics(): ReadonlyArray<{ name: string; t: number; params?: Record<string, unknown> }>;
  renderInfo(): RenderInfo | null;
  setTimeScale(k: number): void;
  runSim(sec: number): void;
  stepFrames(n: number): void;
  teleport(z: number, x?: number, y?: number): void;
  press(code: string, holdMs?: number): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  stick(x: number, y: number): void;
  jump(): void;
  setAutoRun(on: boolean): void;
  setCamera(opts: { yaw?: number; pitch?: number; dist?: number; fov?: number } | 'auto'): void;
  cameraInsideGeometry(): boolean;
  forceSlowFrames(sec: number): boolean;
  setQuality(level: QualityLevel | 'auto'): void;
  /** Puts the auto controller at a level without locking it (tests of the downgrade on a weak machine). */
  qualityAutoFrom(level: QualityLevel): void;
  openMenu(open: boolean): void;
  showFaces(): void;
  setFace(index: number): void;
  charactersDrawCalls(): number;
  showAd(kind: 'interstitial' | 'rewarded'): Promise<{ shown?: boolean; rewarded?: boolean; error?: string }>;
}

declare global {
  interface Window {
    __TEST__?: TestApi;
    __YA_MOCK__?: { advance(ms: number): void; calls: Array<{ name: string; args: unknown[]; t: number }>; violations: string[] };
  }
}

export function installTestApi(g: GameHandles): TestApi {
  const advanceMock = (ms: number): void => {
    if (ms > 0) window.__YA_MOCK__?.advance(ms);
  };
  const api: TestApi = {
    ready: false,
    state() {
      const h = g.sim?.hero ?? null;
      const cam = g.camera;
      return {
        platform: g.platform.kind,
        lang: g.lang,
        pack: g.packId,
        world: g.world.id,
        controllable: g.boot.controllable,
        pauseReasons: g.pause.reasons,
        paused: g.pause.paused,
        ticks: g.loop.ticks,
        timeSec: g.loop.timeSec,
        firstFrameAt: g.boot.firstFrameAt,
        readyAt: g.boot.readyAt,
        glRenderer: g.boot.glRenderer,
        hero: h
          ? { x: h.pos.x, y: h.pos.y, z: h.pos.z, vx: h.vel.x, vy: h.vel.y, vz: h.vel.z, speed: h.speed, onGround: h.onGround, yaw: h.yaw }
          : null,
        stat: g.sim?.progress.stat ?? 0,
        steps: g.sim?.progress.steps ?? 0,
        controlYaw: g.frame.controlYaw,
        viewYaw: g.frame.viewYaw,
        cameraDistance: cam?.currentDistance ?? 0,
        cameraFov: cam?.camera.fov ?? 0,
        cameraPos: cam ? [cam.camera.position.x, cam.camera.position.y, cam.camera.position.z] : [0, 0, 0],
        autoRun: g.input.autoRun,
        checkpoint: g.sim?.checkpoint ?? -1,
        respawning: (g.sim?.respawnTicksLeft ?? -1) >= 0,
        touchMode: g.input.touchActive,
        stickActive: g.input.stick.active,
        quality: { level: g.quality.level, dpr: g.quality.dpr, locked: g.quality.locked },
        field: { ...g.field },
        menuOpen: g.pause.has('menu'),
        lastFrameMs: g.lastFrameMs,
        lastSimMs: g.lastSimMs,
        gpuLoad: g.gpuLoad,
        framesPresented: g.framesPresented,
        framesRendered: g.framesRendered,
      };
    },
    events: g.events,
    simEvents: g.simEvents,
    analytics: () => analyticsEvents(),
    renderInfo: () => g.renderer()?.info() ?? null,
    setTimeScale(k) {
      g.loop.timeScale = k;
      g.loop.unlimited = k !== 1;
    },
    runSim(sec) {
      g.loop.runSim(sec);
      advanceMock(sec * 1000);
    },
    stepFrames(n) {
      // Game paused; each frame is 1/30 s: two simulation steps and one render (docs/04-packaging.md 10.3).
      const wasPaused = g.loop.paused;
      g.loop.paused = false;
      for (let i = 0; i < n; i++) g.loop.runSim(2 / 60);
      g.loop.paused = wasPaused;
    },
    teleport(z, x = 0, y) {
      const level = g.level;
      const yy = y ?? (level ? level.floorYAt(z) + 0.05 : 0);
      g.teleport(x, yy, z);
    },
    press(code, holdMs = 120) {
      g.input.injectKey(code, true);
      setTimeout(() => g.input.injectKey(code, false), holdMs);
    },
    keyDown: (code) => g.input.injectKey(code, true),
    keyUp: (code) => g.input.injectKey(code, false),
    stick: (x, y) => g.input.setVirtualStick(x, y),
    jump: () => g.input.injectJump(),
    setAutoRun: (on) => g.setAutoRun(on),
    setCamera(opts) {
      if (!g.camera) return;
      if (opts === 'auto') {
        g.camera.shot = null;
        return;
      }
      if (opts.fov !== undefined) {
        g.camera.camera.fov = opts.fov;
        g.camera.camera.updateProjectionMatrix();
      }
      g.camera.shot = {
        yaw: opts.yaw ?? g.frame.viewYaw,
        pitch: opts.pitch ?? g.frame.pitch,
        distance: opts.dist ?? g.frame.distance,
      };
    },
    cameraInsideGeometry() {
      if (!g.camera || !g.sim) return false;
      return g.camera.insideGeometry(g.sim.collision);
    },
    forceSlowFrames: (sec) => g.quality.forceSlow(sec),
    setQuality: (level) => g.setQualitySetting(level),
    qualityAutoFrom: (level) => g.quality.setLevel(level, false),
    openMenu: (open) => g.toggleMenu(open),
    showFaces: () => g.showFaces(),
    setFace(index) {
      if (g.hero) g.hero.face = index;
    },
    charactersDrawCalls: () => g.characters?.drawCalls ?? 0,
    showAd: (kind) => g.showAd(kind),
  };
  window.__TEST__ = api;
  return api;
}

/** Called by the loop after every frame so the mock clock keeps up with accelerated game time. */
export function mockClockSync(gameDtSec: number, realDtSec: number): void {
  const extra = (gameDtSec - realDtSec) * 1000;
  if (extra > 0) window.__YA_MOCK__?.advance(extra);
}

/**
 * ?debug=1 panel (docs/02-tech.md, section 15): lil-gui folders Controller, Camera, Render, Analytics, stats
 * overlay, Export of tuning JSON. Only in dev, playtest, e2e and pages builds — the release never imports this
 * module (check-release rejects lil-gui). Values apply at once and are remembered on this device.
 */
import GUI from 'lil-gui';
import type { GameHandles } from '../app/handles.ts';
import { analyticsEvents } from '../analytics/index.ts';
import type { TuningJson } from '../content/types.ts';
import { createStorage } from '../platform/storage.ts';
import { QUALITY_LEVELS, type QualityLevel } from '../render/quality.ts';

export interface DebugPanel {
  gui: GUI;
  overlay: HTMLElement;
  update(frameMs: number): void;
  exportTuning(): string;
  destroy(): void;
}

declare global {
  interface Window {
    __DEBUG__?: { exportTuning(): string; set(path: string, value: number | boolean): void; get(path: string): unknown };
  }
}

type Range = [number, number, number];
const CONTROLLER_RANGES: Record<keyof TuningJson['controller'], Range | null> = {
  baseSpeed: [8, 32, 0.5],
  maxSpeed: [16, 96, 1],
  accel: [0.02, 0.5, 0.01],
  decel: [0.02, 0.5, 0.01],
  airControl: [0, 1, 0.05],
  jumpSpeed: [30, 80, 1],
  gravity: [100, 300, 1],
  fallMult: [1, 1.8, 0.05],
  coyoteSec: [0, 0.3, 0.01],
  jumpBufferSec: [0, 0.3, 0.01],
  variableJump: null,
  stepUp: [0, 2, 0.1],
};
const CAMERA_RANGES: Partial<Record<keyof TuningJson['camera'], Range>> = {
  distance: [6, 30, 0.5],
  height: [1, 8, 0.25],
  pitchDeg: [-10, 60, 1],
  fov: [40, 100, 1],
  fovSpeedAdd: [0, 30, 1],
  fovSmoothSec: [0, 1, 0.05],
  damping: [2, 40, 1],
  leadSec: [0, 0.5, 0.01],
  autoTurnDelaySec: [0, 5, 0.1],
  autoTurnRate: [0, 6, 0.1],
  sensitivity: [0.5, 2, 0.05],
  shake: [0, 1, 0.05],
};

export function mountDebug(g: GameHandles, host: HTMLElement, isMobile: boolean): DebugPanel {
  const store = createStorage(`${g.packId}:debug`);
  const saved = store.getJSON<Partial<TuningJson>>('tuning');
  if (saved?.controller) Object.assign(g.tuning.controller, saved.controller);
  if (saved?.camera) Object.assign(g.tuning.camera, saved.camera);
  g.applyTuning();

  const persist = (): void => {
    store.setJSON('tuning', { controller: g.tuning.controller, camera: g.tuning.camera });
    g.applyTuning();
  };

  const gui = new GUI({ title: 'debug', width: isMobile ? 230 : 280 });
  gui.domElement.style.cssText = 'position:absolute;top:0;right:0;z-index:40;opacity:.92;font-size:11px;max-height:100%;overflow:auto;';
  gui.domElement.dataset['hud'] = 'debug';
  host.appendChild(gui.domElement);
  if (isMobile) gui.close();

  const controller = gui.addFolder('Controller');
  for (const [key, range] of Object.entries(CONTROLLER_RANGES) as Array<[keyof TuningJson['controller'], Range | null]>) {
    const ctl = range ? controller.add(g.tuning.controller, key, range[0], range[1], range[2]) : controller.add(g.tuning.controller, key);
    ctl.onChange(persist);
  }
  controller.close();

  const camera = gui.addFolder('Camera');
  for (const [key, range] of Object.entries(CAMERA_RANGES) as Array<[keyof TuningJson['camera'], Range]>) {
    camera.add(g.tuning.camera, key, range[0], range[1], range[2]).onChange(persist);
  }
  camera.close();

  const render = gui.addFolder('Render');
  const renderState = { quality: g.quality.level as QualityLevel | 'auto', dpr: g.quality.dpr, fps: 0, ms: 0, calls: 0, triangles: 0, textures: 0, simMs: 0 };
  render.add(renderState, 'quality', ['auto', ...QUALITY_LEVELS]).onChange((v: QualityLevel | 'auto') => g.setQualitySetting(v));
  render.add(renderState, 'dpr').listen().disable();
  render.add(renderState, 'fps').listen().disable();
  render.add(renderState, 'ms').listen().disable();
  render.add(renderState, 'calls').listen().disable();
  render.add(renderState, 'triangles').listen().disable();
  render.add(renderState, 'textures').listen().disable();

  const analytics = gui.addFolder('Analytics');
  const analyticsState = { last: '' };
  analytics.add(analyticsState, 'last').listen().disable();
  analytics.close();

  const actions = {
    export: () => {
      const json = panel.exportTuning();
      void navigator.clipboard?.writeText(json).catch(() => {});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `tuning-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    reset: () => {
      store.remove('tuning');
      location.reload();
    },
  };
  gui.add(actions, 'export').name('Export');
  gui.add(actions, 'reset').name('Reset');

  const overlay = document.createElement('pre');
  overlay.dataset['role'] = 'debug-overlay';
  overlay.style.cssText =
    'position:absolute;left:6px;bottom:6px;margin:0;padding:4px 6px;background:rgba(0,0,0,.45);color:#9f9;font:11px/1.3 monospace;border-radius:6px;pointer-events:none;z-index:40;white-space:pre;';
  host.appendChild(overlay);

  let frames = 0;
  let acc = 0;
  let fps = 0;
  const panel: DebugPanel = {
    gui,
    overlay,
    update(frameMs) {
      frames++;
      acc += frameMs;
      if (acc >= 500) {
        fps = Math.round((frames * 1000) / acc);
        frames = 0;
        acc = 0;
      }
      const info = g.renderer()?.info();
      renderState.fps = fps;
      renderState.ms = Math.round(frameMs * 10) / 10;
      renderState.dpr = Math.round(g.quality.dpr * 100) / 100;
      renderState.calls = info?.calls ?? 0;
      renderState.triangles = info?.triangles ?? 0;
      renderState.textures = info?.textures ?? 0;
      renderState.simMs = Math.round(g.lastSimMs * 100) / 100;
      const last = analyticsEvents().slice(-30);
      analyticsState.last = last.map((e) => e.name).join(', ');
      overlay.textContent =
        `${g.quality.level} dpr ${renderState.dpr}  fps ${fps}  ${renderState.ms} ms  sim ${renderState.simMs} ms\n` +
        `calls ${renderState.calls}  tris ${renderState.triangles}  tex ${renderState.textures}  ticks ${g.loop.ticks}`;
    },
    exportTuning() {
      return JSON.stringify(g.tuning, null, 2);
    },
    destroy() {
      gui.destroy();
      overlay.remove();
    },
  };
  window.__DEBUG__ = {
    exportTuning: () => panel.exportTuning(),
    set(path, value) {
      const [folder, key] = path.split('.') as [string, string];
      const target = (g.tuning as unknown as Record<string, Record<string, unknown>>)[folder];
      if (!target || !(key in target)) return;
      target[key] = value;
      persist();
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
    get(path) {
      const [folder, key] = path.split('.') as [string, string];
      return (g.tuning as unknown as Record<string, Record<string, unknown>>)[folder]?.[key];
    },
  };
  return panel;
}

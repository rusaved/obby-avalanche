/**
 * ?debug=1 panel (docs/02-tech.md, section 15): lil-gui folders and a stats overlay. Only in dev, playtest, e2e
 * and pages builds — the release build never imports this module (check-release rejects lil-gui).
 * M0: skeleton with Render overlay and Export; folders fill in at M1-09.
 */
import GUI from 'lil-gui';
import type { Loop } from '../core/loop.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { TuningJson } from '../content/types.ts';

export interface DebugContext {
  loop: Loop;
  renderer: () => GameRenderer | null;
  tuning: TuningJson;
  host: HTMLElement;
  storageKey: string;
  isMobile: boolean;
}

export interface DebugPanel {
  gui: GUI;
  overlay: HTMLElement;
  update(frameMs: number): void;
  exportTuning(): string;
  destroy(): void;
}

export function mountDebug(ctx: DebugContext): DebugPanel {
  const gui = new GUI({ title: 'debug', width: ctx.isMobile ? 220 : 260 });
  gui.domElement.style.cssText = 'position:absolute;top:0;right:0;z-index:40;opacity:.92;font-size:11px;';
  ctx.host.appendChild(gui.domElement);
  if (ctx.isMobile) gui.close();

  const overlay = document.createElement('pre');
  overlay.dataset['role'] = 'debug-overlay';
  overlay.style.cssText =
    'position:absolute;left:6px;bottom:6px;margin:0;padding:4px 6px;background:rgba(0,0,0,.45);color:#9f9;font:11px/1.3 monospace;border-radius:6px;pointer-events:none;z-index:40;white-space:pre;';
  ctx.host.appendChild(overlay);

  const render = gui.addFolder('Render');
  const stats = { fps: 0, ms: 0, calls: 0, triangles: 0, textures: 0 };
  render.add(stats, 'fps').listen().disable();
  render.add(stats, 'ms').listen().disable();
  render.add(stats, 'calls').listen().disable();

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
  };
  gui.add(actions, 'export').name('Export');

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
      const info = ctx.renderer()?.info();
      stats.fps = fps;
      stats.ms = Math.round(frameMs * 10) / 10;
      stats.calls = info?.calls ?? 0;
      stats.triangles = info?.triangles ?? 0;
      stats.textures = info?.textures ?? 0;
      overlay.textContent = `fps ${fps}  ${stats.ms} ms\ncalls ${stats.calls}  tris ${stats.triangles}  tex ${stats.textures}\nticks ${ctx.loop.ticks}`;
    },
    exportTuning() {
      return JSON.stringify(ctx.tuning, null, 2);
    },
    destroy() {
      gui.destroy();
      overlay.remove();
    },
  };
  return panel;
}

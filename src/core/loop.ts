/**
 * Game loop with a fixed simulation step (docs/02-tech.md 4.2): accumulator, at most `maxSteps`
 * steps per frame, frames longer than `maxFrameSec` are clipped, render interpolates with alpha.
 * `tick(nowMs)` is pure enough to drive from tests; `start()` uses requestAnimationFrame.
 */
export interface LoopOptions {
  step?: number;
  maxSteps?: number;
  maxFrameSec?: number;
  update: (dt: number) => void;
  render: (alpha: number, frameDtSec: number) => void;
  /** After every frame: how much game time ran versus real time (e2e builds sync the SDK mock clock). */
  afterTick?: (gameDtSec: number, realDtSec: number) => void;
  /** Frame scheduler; the browser passes requestAnimationFrame, tests drive tick() by hand. */
  scheduler?: FrameScheduler;
}

export interface FrameScheduler {
  request(cb: (nowMs: number) => void): number;
  cancel(id: number): void;
}

export interface Loop {
  readonly step: number;
  readonly ticks: number;
  /** Simulated game time in seconds (ticks / 60). */
  readonly timeSec: number;
  readonly running: boolean;
  /** 1 in all builds; e2e builds may raise it through __TEST__.setTimeScale. */
  timeScale: number;
  /** When true (e2e only) the maxSteps cap is lifted so time scale can run far ahead of real time. */
  unlimited: boolean;
  /** When paused, frames still render but no simulation steps run and no time accumulates. */
  paused: boolean;
  tick(nowMs: number): void;
  /** Drops accumulated time (after a pause or returning to the tab): no catch-up burst. */
  resetAccumulator(): void;
  /** Synchronously runs `sec` game seconds of simulation, then renders one frame. */
  runSim(sec: number): void;
  start(): void;
  stop(): void;
}

export function createLoop(opts: LoopOptions): Loop {
  const step = opts.step ?? 1 / 60;
  const maxSteps = opts.maxSteps ?? 5;
  const maxFrameSec = opts.maxFrameSec ?? 0.1;
  const EPS = 1e-9;
  let acc = 0;
  let lastMs: number | null = null;
  let ticks = 0;
  let raf = 0;
  let running = false;

  const loop: Loop = {
    step,
    get ticks() {
      return ticks;
    },
    get timeSec() {
      return ticks * step;
    },
    get running() {
      return running;
    },
    timeScale: 1,
    unlimited: false,
    paused: false,
    tick(nowMs) {
      if (lastMs === null) {
        lastMs = nowMs;
        opts.render(1, 0);
        return;
      }
      let dt = (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      if (dt < 0) dt = 0;
      if (loop.paused) {
        opts.render(1, dt);
        return;
      }
      if (dt > maxFrameSec) dt = maxFrameSec;
      acc += dt * loop.timeScale;
      let steps = 0;
      while (acc >= step - EPS && (loop.unlimited || steps < maxSteps)) {
        opts.update(step);
        ticks++;
        acc -= step;
        steps++;
      }
      if (!loop.unlimited && acc >= step) acc = acc % step;
      if (acc < 0) acc = 0;
      opts.render(Math.min(1, Math.max(0, acc / step)), dt);
      opts.afterTick?.(steps * step, dt);
    },
    resetAccumulator() {
      acc = 0;
      lastMs = null;
    },
    runSim(sec) {
      const n = Math.round(sec / step);
      for (let i = 0; i < n; i++) {
        opts.update(step);
        ticks++;
      }
      acc = 0;
      opts.render(1, 0);
    },
    start() {
      if (running) return;
      const scheduler = opts.scheduler;
      if (!scheduler) throw new Error('loop.start needs a scheduler; tests call tick() directly');
      running = true;
      lastMs = null;
      const frame = (t: number): void => {
        if (!running) return;
        loop.tick(t);
        raf = scheduler.request(frame);
      };
      raf = scheduler.request(frame);
    },
    stop() {
      running = false;
      if (raf) opts.scheduler?.cancel(raf);
      raf = 0;
    },
  };
  return loop;
}

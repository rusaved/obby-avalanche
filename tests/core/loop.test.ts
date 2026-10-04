import { describe, expect, it } from 'vitest';
import { createLoop } from '../../src/core/loop.ts';

function simulate(fps: number, seconds: number) {
  let steps = 0;
  let renders = 0;
  const loop = createLoop({ update: () => steps++, render: () => renders++ });
  const frame = 1000 / fps;
  let t = 1000;
  loop.tick(t);
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    t += frame;
    loop.tick(t);
  }
  return { steps, renders, loop };
}

describe('fixed-step loop (docs/02-tech.md 4.2)', () => {
  it('runs exactly 60 simulation steps per game second at 30, 60, 144 and 240 FPS', () => {
    for (const fps of [30, 60, 144, 240]) {
      const { steps } = simulate(fps, 10);
      expect(steps, `fps ${fps}`).toBe(600);
    }
  });

  it('caps catch-up at 5 steps per frame and clips frames longer than 0.1 s', () => {
    let steps = 0;
    const loop = createLoop({ update: () => steps++, render: () => {} });
    loop.tick(0);
    loop.tick(2000);
    expect(steps).toBe(5);
    loop.tick(2016.7);
    expect(steps).toBe(6);
  });

  it('paused: renders but does not step; resetAccumulator drops pending time', () => {
    let steps = 0;
    let renders = 0;
    const loop = createLoop({ update: () => steps++, render: () => renders++ });
    loop.tick(0);
    loop.tick(100);
    expect(steps).toBe(5);
    loop.paused = true;
    loop.tick(5000);
    expect(steps).toBe(5);
    expect(renders).toBe(3);
    loop.paused = false;
    loop.resetAccumulator();
    loop.tick(5016);
    loop.tick(5033);
    expect(steps).toBe(6);
  });

  it('timeScale with unlimited steps runs ahead of real time; runSim steps synchronously', () => {
    let steps = 0;
    const loop = createLoop({ update: () => steps++, render: () => {} });
    loop.timeScale = 20;
    loop.unlimited = true;
    loop.tick(0);
    loop.tick(100);
    expect(steps).toBe(120);
    loop.runSim(2);
    expect(steps).toBe(240);
    expect(loop.timeSec).toBeCloseTo(4, 5);
  });

  it('render alpha stays within [0, 1]', () => {
    const alphas: number[] = [];
    const loop = createLoop({ update: () => {}, render: (a) => alphas.push(a) });
    let t = 0;
    loop.tick(t);
    for (let i = 0; i < 200; i++) {
      t += 7 + (i % 5) * 3;
      loop.tick(t);
    }
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});

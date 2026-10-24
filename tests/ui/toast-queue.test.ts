import { describe, expect, it } from 'vitest';
import { createToastQueue, type QueuedToast, type ToastClock } from '../../src/ui/toast-queue.ts';

// FX-01: one toast at a time, each held toastMinSec before the next, equal ones once, an urgent one at once and whole.
function fake(): ToastClock & { tick(ms: number): void } {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let n = 0;
  return {
    now: () => t,
    set(fn, ms) {
      timers.push({ at: t + ms, fn, id: ++n });
      return n;
    },
    clear(id) {
      timers = timers.filter((x) => x.id !== id);
    },
    tick(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const x = timers[0];
        if (!x || x.at > end) break;
        timers.shift();
        t = x.at;
        x.fn();
      }
      t = end;
    },
  };
}

function setup(blocked = () => false) {
  const clock = fake();
  const log: string[] = [];
  let shown: string | null = null;
  const q = createToastQueue<QueuedToast>({
    minSec: 1.2,
    gapMs: 120,
    max: 3,
    blocked,
    clock,
    show: (i) => {
      expect(shown, 'never two at once').toBeNull();
      shown = i.text;
      log.push(`${clock.now()} ${i.text}`);
    },
    hide: () => {
      shown = null;
    },
  });
  return { q, clock, log, shown: () => shown };
}

describe('toast queue (FX-01)', () => {
  it('the second waits minSec of the first, a gap, then shows; never two at once', () => {
    const { q, clock, log } = setup();
    q.push({ text: 'A', sec: 3 });
    clock.tick(200);
    q.push({ text: 'B', sec: 2 });
    clock.tick(5000);
    expect(log).toEqual(['0 A', '1320 B']);
  });
  it('a toast alone keeps its whole time', () => {
    const { q, clock, shown } = setup();
    q.push({ text: 'A', sec: 3 });
    clock.tick(2900);
    expect(shown()).toBe('A');
    clock.tick(200);
    expect(shown()).toBeNull();
  });
  it('one up past minSec yields to a new one after the gap', () => {
    const { q, clock, log } = setup();
    q.push({ text: 'A', sec: 3 });
    clock.tick(2000);
    q.push({ text: 'B', sec: 1 });
    clock.tick(3000);
    expect(log).toEqual(['0 A', '2120 B']);
  });
  it('an equal toast is never shown twice in a row nor queued twice', () => {
    const { q, clock, log } = setup();
    q.push({ text: 'A', sec: 2 });
    q.push({ text: 'A', sec: 2 });
    q.push({ text: 'B', sec: 2 });
    q.push({ text: 'B', sec: 2 });
    clock.tick(6000);
    expect(log).toEqual(['0 A', '1320 B']);
  });
  it('an urgent toast shows at once and whole, the plain one comes back after it', () => {
    const { q, clock, log } = setup();
    q.push({ text: 'A', sec: 3 });
    clock.tick(500);
    q.push({ text: 'R', sec: 2, now: true });
    q.push({ text: 'B', sec: 2 });
    clock.tick(1900);
    expect(log).toEqual(['0 A', '500 R']);
    clock.tick(4000);
    expect(log).toEqual(['0 A', '500 R', '2620 A', '3940 B']);
  });
  it('an urgent toast yields to the next urgent one after minSec, not to a plain one', () => {
    const { q, clock, log } = setup();
    q.push({ text: 'R1', sec: 5, now: true });
    q.push({ text: 'A', sec: 2 });
    clock.tick(1000);
    q.push({ text: 'R2', sec: 2, now: true });
    clock.tick(10000);
    expect(log).toEqual(['0 R1', '1320 R2', '3440 A']);
  });
  it('the banner holds plain toasts, an urgent one still shows; release brings the rest in order', () => {
    let banner = false;
    const { q, clock, log } = setup(() => banner);
    q.push({ text: 'A', sec: 3 });
    clock.tick(300);
    banner = true;
    q.hold();
    q.push({ text: 'B', sec: 2 });
    q.push({ text: 'R', sec: 1, now: true });
    clock.tick(3000);
    expect(log).toEqual(['0 A', '300 R']);
    banner = false;
    q.release();
    clock.tick(6000);
    expect(log.slice(2)).toEqual(['3300 A', '4620 B']);
  });
  it('past the cap the oldest plain one goes', () => {
    let banner = true;
    const { q, clock, log } = setup(() => banner);
    for (const x of ['A', 'B', 'C', 'D']) q.push({ text: x, sec: 1 });
    expect(q.pending.map((p) => p.text)).toEqual(['B', 'C', 'D']);
    banner = false;
    q.release();
    clock.tick(10000);
    expect(log.map((l) => l.split(' ')[1])).toEqual(['B', 'C', 'D']);
  });
});

// What: Toast queue (FX-01): one toast at a time, each held at least minSec before the next takes its place, equal ones never twice, a short gap between two.
// Called by: ui/hud.ts (createToastQueue with its show/hide); tests/ui/toast-queue.test.ts with a fake clock.
// Keep: Never two toasts at once and never a swap before minSec; an urgent toast (`now`) shows at once and only another urgent one cuts it; no DOM here.

/** A toast as the queue knows it: its text and sub (equal ones are one toast), how long it stays, urgent or not. */
export interface QueuedToast {
  text: string;
  sub?: string | undefined;
  sec: number;
  now?: boolean;
}

export interface ToastClock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

export interface ToastQueue<T extends QueuedToast> {
  /** A new toast: shown at once if the slot is free, else waits (the current one keeps minSec). */
  push(item: T): void;
  /** The avalanche banner came: a plain toast on screen steps back to the head of the queue. */
  hold(): void;
  /** The banner went: the next toast shows. */
  release(): void;
  readonly current: T | null;
  readonly pending: readonly T[];
}

export function createToastQueue<T extends QueuedToast>(o: {
  minSec: number;
  gapMs: number;
  max: number;
  /** The banner is up: plain toasts wait. */
  blocked: () => boolean;
  show: (item: T) => void;
  hide: () => void;
  clock?: ToastClock;
}): ToastQueue<T> {
  const clock: ToastClock = o.clock ?? { now: () => performance.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  let cur: { item: T; at: number } | null = null;
  let gap = false;
  const pending: T[] = [];
  let timer: unknown = null;
  const same = (a: T, b: T): boolean => a.text === b.text && (a.sub ?? '') === (b.sub ?? '');
  const stop = (): void => {
    if (timer !== null) clock.clear(timer);
    timer = null;
  };
  const arm = (): void => {
    stop();
    if (!cur) return;
    const end = cur.at + cur.item.sec * 1000;
    // A plain toast yields to a waiting one after minSec; an urgent one keeps its whole time but for another urgent one.
    const waits = cur.item.now ? pending.some((p) => p.now) : pending.length > 0;
    const yieldAt = waits ? Math.min(end, cur.at + o.minSec * 1000) : end;
    timer = clock.set(leave, Math.max(0, yieldAt - clock.now()));
  };
  const show = (item: T): void => {
    cur = { item, at: clock.now() };
    o.show(item);
    arm();
  };
  const next = (): void => {
    if (cur || gap) return;
    // Urgent ones first (a reward handed in), then the rest in order — not while the banner is up.
    const u = pending.findIndex((p) => p.now);
    const i = u >= 0 || o.blocked() ? u : 0;
    const item = i >= 0 ? pending.splice(i, 1)[0] : undefined;
    if (item) show(item);
  };
  function leave(): void {
    timer = null;
    cur = null;
    o.hide();
    if (pending.length === 0) return;
    // The next one comes after a short gap: the old one fades out before the new one fades in.
    gap = true;
    timer = clock.set(() => {
      timer = null;
      gap = false;
      next();
    }, o.gapMs);
  }
  const queue = (item: T, head = false): void => {
    if (head) pending.unshift(item);
    else pending.push(item);
    while (pending.length > o.max) {
      // The oldest plain one goes first; urgent ones stay.
      const k = pending.findIndex((p) => !p.now);
      pending.splice(k >= 0 ? k : 0, 1);
    }
  };
  return {
    push(item) {
      if ((cur && same(cur.item, item)) || pending.some((p) => same(p, item))) return;
      if (item.now && cur && !cur.item.now) {
        // An urgent toast (a reward handed in) is seen at once; the plain one comes back after it.
        const back = cur.item;
        stop();
        cur = null;
        o.hide();
        queue(back, true);
        show(item);
        return;
      }
      if (!cur && !gap && (!o.blocked() || item.now)) {
        show(item);
        return;
      }
      queue(item);
      if (cur) arm();
    },
    hold() {
      if (!cur || cur.item.now) return;
      const back = cur.item;
      stop();
      cur = null;
      o.hide();
      queue(back, true);
    },
    release() {
      if (!cur && !gap) next();
    },
    get current() {
      return cur?.item ?? null;
    },
    get pending() {
      return pending;
    },
  };
}

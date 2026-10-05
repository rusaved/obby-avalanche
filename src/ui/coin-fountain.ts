/**
 * The coin fountain of a gate (docs/01-gdd.md 16.5): coins burst up out of the arch on screen, hang for a moment and
 * fly into the coin plaque one after another; the first one there calls `onArrive` («+N» by the plaque). DOM, pooled
 * spans moved by transform, on game time (they stand while the game stands).
 */

/** Burst: up and out at these px/s, pulled down; then the flight to the plaque, the coins this far apart. */
const BURST_SEC = 0.35;
const BURST_SPEED: [number, number] = [260, 460];
const BURST_GRAVITY = 900;
const FLY_SEC = 0.55;
const STAGGER_SEC = 0.035;
const POOL = 48;

interface Coin {
  el: HTMLElement;
  t: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  /** Where the burst ended (the flight starts there). */
  bx: number;
  by: number;
  delay: number;
  onArrive: (() => void) | null;
}

export interface CoinFountain {
  /** `n` coins from (x, y) in field px into the plaque. */
  start(x: number, y: number, n: number, onArrive: () => void): void;
  update(dt: number): void;
  /** Coins in the air now (test API). */
  readonly flying: number;
  clear(): void;
}

export function createCoinFountain(root: HTMLElement, target: () => { x: number; y: number }, color: string): CoinFountain {
  const free: HTMLElement[] = [];
  for (let i = 0; i < POOL; i++) {
    const el = document.createElement('span');
    el.className = 'hud-fly-coin';
    el.dataset['role'] = 'fly-coin';
    el.style.setProperty('--coins', color);
    root.appendChild(el);
    free.push(el);
  }
  const live: Coin[] = [];
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const put = (c: Coin, x: number, y: number, scale: number): void => {
    c.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(2)})`;
  };
  return {
    start(x, y, n, onArrive) {
      for (let i = 0; i < n; i++) {
        const el = free.pop();
        if (!el) break;
        const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
        const s = BURST_SPEED[0] + (BURST_SPEED[1] - BURST_SPEED[0]) * rand();
        const c: Coin = { el, t: 0, x0: x, y0: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, bx: x, by: y, delay: i * STAGGER_SEC, onArrive: i === 0 ? onArrive : null };
        el.classList.add('on');
        put(c, x, y, 0.6);
        live.push(c);
      }
    },
    update(dt) {
      if (live.length === 0 || dt <= 0) return;
      const to = target();
      for (let i = live.length - 1; i >= 0; i--) {
        const c = live[i]!;
        c.t += dt;
        if (c.t < BURST_SEC) {
          const t = c.t;
          c.bx = c.x0 + c.vx * t;
          c.by = c.y0 + c.vy * t + 0.5 * BURST_GRAVITY * t * t;
          put(c, c.bx, c.by, 0.6 + t);
          continue;
        }
        const k = Math.min(1, (c.t - BURST_SEC - c.delay) / FLY_SEC);
        if (k < 0) continue;
        const e = k * k * (3 - 2 * k);
        put(c, c.bx + (to.x - c.bx) * e, c.by + (to.y - c.by) * e, 1 - 0.3 * e);
        if (k >= 1) {
          c.el.classList.remove('on');
          free.push(c.el);
          live.splice(i, 1);
          c.onArrive?.();
        }
      }
    },
    get flying() {
      return live.length;
    },
    clear() {
      for (const c of live) {
        c.el.classList.remove('on');
        free.push(c.el);
      }
      live.length = 0;
    },
  };
}

// What: Rewards as a show (FX-03): marks of the coin or the cup fly from where the reward was taken to its counter, the counter ticks from the old number to the new.
// Called by: main.ts (createRewardFly over the #ui layer; rewards.onGain, the stage pad).
// Keep: A real-time look on its own top layer (a window may hold the game): never changes a wallet; the counter's last text is always the true one; a fixed pool of marks.

import { icon } from './icons.ts';

/** Marks in the pool: a reward flies at most this many. */
const POOL = 12;
/** Each next mark starts this much later. */
const STAGGER_MS = 45;
/** The copy of a counter over a window stays this long after its tick (its new number is read). */
const GHOST_KEEP_MS = 900;

export interface RewardFlyOptions {
  flyIcons: number;
  flyMs: number;
  tickMs: number;
  format: (n: number) => string;
  /** The box of the counter on screen (client px) and its value node; null — no counter now. */
  counter: (kind: 'coins' | 'trophies') => { rect: DOMRect; value: HTMLElement; hidden: boolean } | null;
  /** The counter shows a number now (the HUD keeps its text while a tick runs, see hud.holdCounter). */
  hold: (kind: 'coins' | 'trophies', on: boolean) => void;
  /** A tick sound per step of the counter. */
  onTick?: () => void;
}

export interface RewardFly {
  /** `from` — the point of the take in px of the layer (default: where the player last pressed, else the middle). */
  play(kind: 'coins' | 'trophies', before: number, after: number, from?: { x: number; y: number }): void;
  /** Where the player last pressed (the button of the reward). */
  pressedAt(x: number, y: number): void;
  readonly flying: number;
}

export function createRewardFly(host: HTMLElement, o: RewardFlyOptions): RewardFly {
  const layer = document.createElement('div');
  layer.className = 'fx-fly';
  layer.dataset['role'] = 'fx-fly';
  host.appendChild(layer);
  const marks = Array.from({ length: POOL }, () => {
    const m = document.createElement('span');
    m.className = 'fx-fly-mark';
    layer.appendChild(m);
    return m;
  });
  // A copy of the counter over a window (the HUD under a window is hidden): it ticks there instead.
  const ghost = document.createElement('div');
  ghost.className = 'fx-fly-ghost';
  ghost.dataset['role'] = 'fx-ghost';
  const ghostIcon = document.createElement('span');
  ghostIcon.className = 'mark';
  const ghostValue = document.createElement('span');
  ghost.append(ghostIcon, ghostValue);
  layer.appendChild(ghost);
  let next = 0;
  let flying = 0;
  let press: { x: number; y: number; at: number } | null = null;
  const ticks = new Map<string, number>();

  const tick = (kind: 'coins' | 'trophies', before: number, after: number, node: HTMLElement, done: () => void): void => {
    const t0 = performance.now();
    const id = (ticks.get(kind) ?? 0) + 1;
    ticks.set(kind, id);
    let shown = '';
    const step = (): void => {
      if (ticks.get(kind) !== id) return;
      const k = Math.min(1, (performance.now() - t0) / Math.max(1, o.tickMs));
      const text = o.format(Math.round(before + (after - before) * (1 - (1 - k) * (1 - k))));
      if (text !== shown) {
        shown = text;
        node.textContent = text;
        o.onTick?.();
      }
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    step();
  };

  return {
    get flying() {
      return flying;
    },
    pressedAt(x, y) {
      press = { x, y, at: performance.now() };
    },
    play(kind, before, after, from) {
      const c = o.counter(kind);
      if (!c || !(after > before)) return;
      const hb = host.getBoundingClientRect();
      const start = from
        ? { x: from.x + hb.left, y: from.y + hb.top }
        : press && performance.now() - press.at < 3000
          ? press
          : { x: hb.left + hb.width / 2, y: hb.top + hb.height / 2 };
      const to = { x: c.rect.left + Math.min(c.rect.width, c.rect.height) / 2, y: c.rect.top + c.rect.height / 2 };
      const n = Math.max(3, Math.min(o.flyIcons, POOL, Math.round(Math.log2(after - before + 1)) + 2));
      const svg = icon(kind === 'coins' ? 'coin' : 'cup');
      for (let i = 0; i < n; i++) {
        const m = marks[next]!;
        next = (next + 1) % POOL;
        m.innerHTML = svg;
        const dx = (i % 2 ? 1 : -1) * (20 + ((i * 37) % 40));
        const dy = -30 - ((i * 23) % 30);
        const x0 = start.x - hb.left;
        const y0 = start.y - hb.top;
        const x1 = to.x - hb.left;
        const y1 = to.y - hb.top;
        flying++;
        const a = m.animate(
          [
            { transform: `translate(${x0}px, ${y0}px) scale(0.6)`, opacity: 0 },
            { transform: `translate(${x0 + dx}px, ${y0 + dy}px) scale(1.15)`, opacity: 1, offset: 0.3 },
            { transform: `translate(${x1}px, ${y1}px) scale(0.8)`, opacity: 1 },
          ],
          { duration: o.flyMs, delay: i * STAGGER_MS, easing: 'ease-in', fill: 'both' },
        );
        const end = (): void => {
          flying--;
          a.cancel();
        };
        a.onfinish = end;
        a.oncancel = () => undefined;
      }
      // The counter starts ticking as the first mark arrives.
      const at = o.flyMs * 0.85;
      setTimeout(() => {
        const cc = o.counter(kind);
        if (!cc) return;
        if (cc.hidden) {
          ghostIcon.innerHTML = svg;
          ghost.style.transform = `translate(${Math.round(cc.rect.left - hb.left)}px, ${Math.round(cc.rect.top - hb.top)}px)`;
          ghost.style.minWidth = `${Math.round(cc.rect.width)}px`;
          ghost.classList.add('shown');
          tick(kind, before, after, ghostValue, () => setTimeout(() => ghost.classList.remove('shown'), GHOST_KEEP_MS));
          return;
        }
        o.hold(kind, true);
        cc.value.parentElement?.classList.add('fx-got');
        tick(kind, before, after, cc.value, () => {
          o.hold(kind, false);
          cc.value.parentElement?.classList.remove('fx-got');
        });
      }, at);
    },
  };
}

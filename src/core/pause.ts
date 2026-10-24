// What: PauseManager: one set of pause reasons (ad, sdk, hidden, blur, menu, shop, pointerlock, orientation, transition); the game runs only while it is empty.
// Called by: main.ts, app/handles.ts; tests/core/pause.test.ts, tests/sim/threat.test.ts.
// Keep: A reason is removed only by the source that added it, never by a timer; onChange fires only on paused/running transitions (onReasons on every change of the set); ad and sdk must keep pausing.

/**
 * PauseManager (docs/02-tech.md 4.3): one set of reasons, the game runs only while the set is empty.
 * Reasons are removed by the same source that added them; there is never a timed resume.
 */
export const PAUSE_REASONS = [
  'ad',
  'sdk',
  'hidden',
  'blur',
  'menu',
  'shop',
  'pointerlock',
  'orientation',
  'transition',
] as const;

export type PauseReason = (typeof PAUSE_REASONS)[number];

export type PauseListener = (paused: boolean, reasons: readonly PauseReason[]) => void;

export class PauseManager {
  private readonly set = new Set<PauseReason>();
  private readonly listeners = new Set<PauseListener>();
  private readonly reasonListeners = new Set<PauseListener>();

  get paused(): boolean {
    return this.set.size > 0;
  }

  get reasons(): PauseReason[] {
    return Array.from(this.set);
  }

  has(reason: PauseReason): boolean {
    return this.set.has(reason);
  }

  add(reason: PauseReason): void {
    const wasPaused = this.paused;
    if (this.set.has(reason)) return;
    this.set.add(reason);
    if (!wasPaused) this.notify();
    this.notifyReasons();
  }

  remove(reason: PauseReason): void {
    if (!this.set.delete(reason)) return;
    if (!this.paused) this.notify();
    this.notifyReasons();
  }

  /** Adds or removes a reason depending on `on`. */
  set_(reason: PauseReason, on: boolean): void {
    if (on) this.add(reason);
    else this.remove(reason);
  }

  /** Called on every transition paused <-> running. Returns an unsubscribe function. */
  onChange(fn: PauseListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** FX-06: called on every change of the set (a window holds the game and an ad comes: the sound must stop). */
  onReasons(fn: PauseListener): () => void {
    this.reasonListeners.add(fn);
    return () => this.reasonListeners.delete(fn);
  }

  private notifyReasons(): void {
    const paused = this.paused;
    const reasons = this.reasons;
    for (const fn of Array.from(this.reasonListeners)) fn(paused, reasons);
  }

  private notify(): void {
    const paused = this.paused;
    const reasons = this.reasons;
    for (const fn of Array.from(this.listeners)) fn(paused, reasons);
  }
}

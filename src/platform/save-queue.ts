/**
 * Cloud write queue (docs/02-tech.md 11.6; docs/03 SAV-01, SAV-02): the latest SaveData goes to `write` 2 s after the
 * last change but never later than 10 s after the first unsent one; a `flush` writes at once. Over all of it a token
 * bucket: one write per 3.5 s at most (≤ 86 in any 5 minutes, Yandex allows 100). A failed write is retried after
 * 5, 15, 60 s with the newest data. Time is the platform clock (`now`), so accelerated game time in e2e is honest.
 */
export const SAVE_DEBOUNCE_MS = 2000;
export const SAVE_MAX_WAIT_MS = 10_000;
export const SAVE_MIN_GAP_MS = 3500;
export const SAVE_RETRY_MS = [5000, 15_000, 60_000] as const;

export interface SaveQueueOptions<T> {
  now(): number;
  write(data: T): Promise<void>;
  /** Real-time timer for the next try (setTimeout in the game, fake timers in tests). */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
}

export class SaveQueue<T> {
  private pending: T | null = null;
  private firstAt = 0;
  private lastAt = 0;
  private urgent = false;
  private lastWriteAt = -Infinity;
  private retryAt = -Infinity;
  private failures = 0;
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  /** Writes started (tests read it). */
  writes = 0;

  constructor(private readonly o: SaveQueueOptions<T>) {}

  get hasPending(): boolean {
    return this.pending !== null;
  }

  push(data: T, flush = false): void {
    const t = this.o.now();
    if (this.pending === null) this.firstAt = t;
    this.pending = data;
    this.lastAt = t;
    if (flush) this.urgent = true;
    this.pump();
  }

  /** Write now if the bucket allows (pause, hidden page, pagehide); resolves when the write in flight is over. */
  async flush(): Promise<void> {
    if (this.pending !== null) this.urgent = true;
    this.pump();
    while (this.inFlight) await this.inFlight;
  }

  /** When the pending data may go out (null — nothing to write). */
  dueAt(): number | null {
    if (this.pending === null) return null;
    const base = this.urgent ? this.lastAt : Math.min(this.lastAt + SAVE_DEBOUNCE_MS, this.firstAt + SAVE_MAX_WAIT_MS);
    return Math.max(base, this.lastWriteAt + SAVE_MIN_GAP_MS, this.retryAt);
  }

  private pump(): void {
    if (this.inFlight) return;
    const due = this.dueAt();
    if (due === null) return;
    const t = this.o.now();
    if (due > t) {
      this.schedule(due - t);
      return;
    }
    this.cancel();
    const data = this.pending as T;
    this.pending = null;
    this.urgent = false;
    this.lastWriteAt = t;
    this.writes++;
    let p: Promise<void>;
    try {
      p = this.o.write(data);
    } catch (err) {
      p = Promise.reject(err);
    }
    this.inFlight = p
      .then(() => {
        this.failures = 0;
        this.retryAt = -Infinity;
      })
      .catch(() => {
        // Newer data wins; the failed one goes again only if nothing newer came.
        if (this.pending === null) {
          this.pending = data;
          this.firstAt = t;
          this.lastAt = t;
        }
        this.retryAt = t + SAVE_RETRY_MS[Math.min(this.failures, SAVE_RETRY_MS.length - 1)]!;
        this.failures++;
      })
      .finally(() => {
        this.inFlight = null;
        this.pump();
      });
  }

  private schedule(ms: number): void {
    this.cancel();
    const set = this.o.setTimer ?? ((fn: () => void, d: number) => setTimeout(fn, d));
    this.timer = set(() => {
      this.timer = null;
      this.pump();
    }, Math.max(0, Math.ceil(ms)));
  }

  private cancel(): void {
    if (this.timer === null) return;
    const clear = this.o.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    clear(this.timer);
    this.timer = null;
  }
}

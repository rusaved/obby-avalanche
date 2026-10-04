/**
 * Analytics (docs/02-tech.md 13.1, docs/06): `track()` buffers events, sends them to Yandex Metrika
 * when a counter is configured, otherwise prints them in dev/playtest builds. Catalog grows at M4.
 */
export interface AnalyticsEvent {
  name: string;
  t: number;
  params?: Record<string, unknown>;
}

declare global {
  interface Window {
    __T0?: number;
    __ANALYTICS_BUFFER__?: AnalyticsEvent[];
    ym?: (id: number, action: string, goal: string, params?: Record<string, unknown>) => void;
  }
}

const buffer: AnalyticsEvent[] = typeof window !== 'undefined' && window.__ANALYTICS_BUFFER__ ? window.__ANALYTICS_BUFFER__ : [];
let counterId = 0;
let echo = false;
let listener: ((ev: AnalyticsEvent) => void) | null = null;

/** One listener for every tracked event (the e2e test API stamps events with play time). */
export function onTrack(fn: ((ev: AnalyticsEvent) => void) | null): void {
  listener = fn;
}

export function configureAnalytics(opts: { counterId: number; echoToConsole: boolean }): void {
  counterId = opts.counterId;
  echo = opts.echoToConsole;
}

function sinceStart(): number {
  if (typeof performance === 'undefined') return 0;
  const t0 = typeof window !== 'undefined' && typeof window.__T0 === 'number' ? window.__T0 : 0;
  return Math.round(performance.now() - t0);
}

export function track(name: string, params?: Record<string, unknown>): void {
  const ev: AnalyticsEvent = params ? { name, t: sinceStart(), params } : { name, t: sinceStart() };
  buffer.push(ev);
  listener?.(ev);
  if (buffer.length > 500) buffer.splice(0, buffer.length - 500);
  if (counterId > 0 && typeof window !== 'undefined' && typeof window.ym === 'function') {
    try {
      window.ym(counterId, 'reachGoal', name, { t: ev.t, ...(params ?? {}) });
    } catch {
      /* Metrika is best effort */
    }
  } else if (echo) {
    // eslint-disable-next-line no-console
    console.info('[analytics]', name, ev.t, params ?? '');
  }
}

export function analyticsEvents(): readonly AnalyticsEvent[] {
  return buffer;
}

export function countEvents(name: string): number {
  return buffer.filter((e) => e.name === name).length;
}

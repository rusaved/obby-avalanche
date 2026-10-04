/**
 * Quality levels (docs/02-tech.md 9.3): desktop and phone tables, start level by device, automatic
 * downgrade (first lever DPR, then the level), never an upgrade within a session. Remembered per device.
 */
import type { KeyValueStore } from '../platform/storage.ts';

export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

export interface QualityParams {
  level: QualityLevel;
  dprCap: number;
  antialias: boolean;
  shadowMap: number;
  particles: number;
  fogFar: number;
  snowflakes: number;
}

const DESKTOP: Record<QualityLevel, Omit<QualityParams, 'level'>> = {
  high: { dprCap: 2, antialias: true, shadowMap: 1024, particles: 1, fogFar: 220, snowflakes: 1000 },
  medium: { dprCap: 1.5, antialias: false, shadowMap: 512, particles: 0.7, fogFar: 190, snowflakes: 600 },
  low: { dprCap: 1, antialias: false, shadowMap: 0, particles: 0.5, fogFar: 160, snowflakes: 300 },
};
const MOBILE: Record<QualityLevel, Omit<QualityParams, 'level'>> = {
  high: { dprCap: 1.25, antialias: false, shadowMap: 0, particles: 0.7, fogFar: 220, snowflakes: 400 },
  medium: { dprCap: 1.0, antialias: false, shadowMap: 0, particles: 0.5, fogFar: 190, snowflakes: 250 },
  low: { dprCap: 0.8, antialias: false, shadowMap: 0, particles: 0.35, fogFar: 160, snowflakes: 0 },
};

export const SLOW_FRAME_MS = 28;
export const SLOW_WINDOW_SEC = 3;
export const DPR_STEP = 0.25;

export function qualityParams(level: QualityLevel, mobile: boolean): QualityParams {
  return { level, ...(mobile ? MOBILE : DESKTOP)[level] };
}

export function initialLevel(mobile: boolean, hardwareConcurrency: number, deviceMemory: number | undefined): QualityLevel {
  if (hardwareConcurrency <= 4 || (deviceMemory !== undefined && deviceMemory <= 3)) return 'low';
  return mobile ? 'medium' : 'high';
}

export interface QualityController {
  readonly level: QualityLevel;
  readonly params: QualityParams;
  /** Effective device pixel ratio after caps and auto downgrade. */
  readonly dpr: number;
  readonly locked: boolean;
  readonly mobile: boolean;
  setLevel(level: QualityLevel, remember?: boolean): void;
  /** Feed every frame; returns true when something changed (resize needed). */
  sample(frameMs: number): boolean;
  /** For tests: pretend frames were slow. */
  forceSlow(seconds: number): boolean;
}

export interface QualityOptions {
  mobile: boolean;
  devicePixelRatio: number;
  store: KeyValueStore;
  hardwareConcurrency: number;
  deviceMemory?: number | undefined;
  /** ?quality= and ?dpr= (debug builds only): lock the level and DPR, no auto downgrade. */
  forcedLevel?: QualityLevel | undefined;
  forcedDpr?: number | undefined;
  /** Manual choice in settings beats auto. */
  settingLevel?: QualityLevel | 'auto' | undefined;
}

export function createQuality(opts: QualityOptions): QualityController {
  const stored = opts.store.get('quality') as QualityLevel | null;
  let level: QualityLevel =
    opts.forcedLevel ??
    (opts.settingLevel && opts.settingLevel !== 'auto' ? opts.settingLevel : null) ??
    (stored && QUALITY_LEVELS.includes(stored) ? stored : initialLevel(opts.mobile, opts.hardwareConcurrency, opts.deviceMemory));
  let params = qualityParams(level, opts.mobile);
  let dprDrop = 0;
  let slowAcc = 0;
  const locked = opts.forcedLevel !== undefined || opts.forcedDpr !== undefined;
  const effectiveDpr = (): number => {
    if (opts.forcedDpr !== undefined) return opts.forcedDpr;
    const lowCap = qualityParams('low', opts.mobile).dprCap;
    return Math.max(Math.min(lowCap, params.dprCap), Math.min(opts.devicePixelRatio, params.dprCap) - dprDrop);
  };
  const degrade = (): boolean => {
    const lowCap = qualityParams('low', opts.mobile).dprCap;
    const current = effectiveDpr();
    if (current - DPR_STEP >= lowCap) {
      dprDrop += DPR_STEP;
      return true;
    }
    const idx = QUALITY_LEVELS.indexOf(level);
    if (idx > 0) {
      level = QUALITY_LEVELS[idx - 1] as QualityLevel;
      params = qualityParams(level, opts.mobile);
      opts.store.set('quality', level);
      return true;
    }
    return false;
  };
  const ctrl: QualityController = {
    get level() {
      return level;
    },
    get params() {
      return params;
    },
    get dpr() {
      return effectiveDpr();
    },
    locked,
    mobile: opts.mobile,
    setLevel(l, remember = true) {
      level = l;
      params = qualityParams(l, opts.mobile);
      dprDrop = 0;
      if (remember) opts.store.set('quality', l);
    },
    sample(frameMs) {
      if (locked) return false;
      if (frameMs > SLOW_FRAME_MS) slowAcc += frameMs / 1000;
      else slowAcc = Math.max(0, slowAcc - (frameMs / 1000) * 0.5);
      if (slowAcc >= SLOW_WINDOW_SEC) {
        slowAcc = 0;
        return degrade();
      }
      return false;
    },
    forceSlow(seconds) {
      if (locked) return false;
      slowAcc += seconds;
      if (slowAcc >= SLOW_WINDOW_SEC) {
        slowAcc = 0;
        return degrade();
      }
      return false;
    },
  };
  return ctrl;
}

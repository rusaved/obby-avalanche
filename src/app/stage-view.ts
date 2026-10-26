// What: The stage finishes of the stages pace (docs/01-gdd.md 22.8): «+N 🏆» over the nearest trophy button ahead, and the toast, confetti and chime when one is taken.
// Called by: main.ts (createStageView, wire on each new mountain, update every frame).
// Keep: Reads the sim, never changes it; texts via t(), numbers via formatNumber; no stages on the mountain — no label.

import { Vector3 } from 'three';
import type { ThemeJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import type { CameraRig } from '../render/camera.ts';
import type { FxParticles } from '../render/fx.ts';
import { formatNumber } from '../ui/format.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';
import { t } from '../ui/i18n.ts';

/** The label shows over a button this close ahead or behind (units) and floats this high over it. */
const LABEL_NEAR = 140;
const LABEL_ABOVE = 3;
/** Half the width of a trophy button (level data: a 6-unit block); the phone label's bottom this high over it (l3). */
const PAD_HALF = 3;
const MU_LABEL_ABOVE = 0.5;
/** Round of fixes MU (l5-camp): a portal plaque hangs at this share of the arch. */
const PORTAL_AT = 0.15;
/** MU round 4 (producer 20.10: the world labels read from afar, stood in the middle and shook): on the phone a label
 * comes in at this distance (units = metres), goes out past the second one at once — no blinking at the border — and
 * comes in again no sooner than this time (s) after it flipped. MU round 5 (producer 21.10): ×1.5 — 18 in, out past 21;
 * MU rest R1 (producer 22.10): ×1.5 again — 27 in, out past 31. */
const MU_SHOW = 27;
const MU_HIDE = 31;
const MU_FLIP_SEC = 0.5;

export interface StageViewDeps {
  getSim(): Sim;
  hud: Hud;
  camera: CameraRig;
  theme: ThemeJson;
  field(): { width: number; height: number };
  fx(): FxParticles | null;
  play(name: string): void;
  numSuffix(k: string): string;
  /** A trophy button taken (the tutorial step, docs/01-gdd.md 22.12); SD-03: `trophies` — they go to the trophy wallet. */
  onTrophy?: (amount: number, trophies: boolean) => void;
  /** FX-03: the pad paid `amount` (after onTrophy) — its marks fly from `at` (field px, null — off screen) to the counter. */
  onGain?: (kind: 'coins' | 'trophies', amount: number, at: { x: number; y: number } | null) => void;
  /** SD-03 (docs/01-gdd.md 23.3): back in the camp after the trophies — a flash over the jump. */
  onCampReturn?: () => void;
  /** The teleport pad of the camp of this mountain (docs/01-gdd.md 22.12); absent — none. */
  campTeleport?: () => { x: number; y: number; z: number } | undefined;
  /** ST-06: the pad of stage n pays nothing any more (its label says «Reward taken»). */
  padSpent?(stage: number): boolean;
  /** MU-04 (l3-stage-finish): the light plaque «Stage reward · coin N / you can run past» over the pad. */
  mu?: boolean;
  /** Round of fixes MU (l5-camp): on the base, its portals with their plaque texts; null — not on the base. */
  basePortals?(): ReadonlyArray<{ x: number; z: number; height: number; text: string; sub: string; locked: boolean }> | null;
}

export interface StageView {
  wire(sim: Sim): void;
  update(): void;
  /** Trophy buttons taken this run (tests). */
  readonly taken: number;
}

export function createStageView(d: StageViewDeps): StageView {
  const p = new Vector3();
  const fmt = (n: number): string => formatNumber(n, d.numSuffix);
  let taken = 0;
  /** MU round 4: the labels in range now, by key, and when each flipped (s). */
  const near = new Map<string, { on: boolean; at: number }>();
  const inRange = (key: string, dist: number): boolean => {
    const now = performance.now() / 1000;
    const was = near.get(key) ?? { on: false, at: -Infinity };
    const want = was.on ? dist <= MU_HIDE : dist <= MU_SHOW;
    if (want !== was.on && (!want || now - was.at >= MU_FLIP_SEC)) near.set(key, { on: want, at: now });
    return near.get(key)?.on ?? false;
  };
  const project = (x: number, y: number, z: number): { x: number; y: number } | null => {
    p.set(x, y, z).project(d.camera.camera);
    if (p.z >= 1) return null;
    const f = d.field();
    return { x: (p.x * 0.5 + 0.5) * f.width, y: (0.5 - p.y * 0.5) * f.height };
  };
  return {
    get taken() {
      return taken;
    },
    wire(sim) {
      sim.events.on('trophyTake', ({ amount, x, y, z, trophies, total, spent }) => {
        taken++;
        // ST-06: a pad taken its times — a quiet word, no coins and no confetti; the flight to the camp as ever.
        if (spent) return d.hud.toast(t('stage.padSpent'));
        d.hud.toast(t('toast.trophyPad', { n: fmt(amount) }));
        if (!trophies) {
          // SD-11 (review: the coin plaque stayed hidden after a button): the wallet shows at once.
          d.hud.setCoins(fmt(total));
          d.hud.popCoinGain(`+${fmt(amount)}`);
        }
        d.fx()?.burst('confetti', x, y + 1.5, z, [d.theme.ui.trophies, '#ffffff', d.theme.ui.coins], 36, 9, 3);
        // SD-14: the button pays coins (SD-11) — the coin reward of ui/ (trophies — the SD-03 wallet test — the trophy one).
        d.play(trophies ? 'rewardTrophy' : 'rewardCoins');
        d.onTrophy?.(amount, trophies);
        d.onGain?.(trophies ? 'trophies' : 'coins', amount, project(x, y + 1.5, z));
      });
      sim.events.on('campReturn', () => d.onCampReturn?.());
    },
    update() {
      // Round of fixes MU (l5-camp): a plaque at the middle of each arch's opening, nearest first, within read range.
      const portals = d.mu ? d.basePortals?.() : null;
      if (portals) {
        const h = d.getSim().hero.pos;
        const list = portals
          .map((q) => ({ q, dist: Math.hypot(q.x - h.x, q.z - h.z) }))
          .filter((x) => inRange(`portal:${x.q.text}`, x.dist))
          .sort((a, b) => a.dist - b.dist)
          .flatMap(({ q }) => {
            const at = project(q.x, q.height * PORTAL_AT, q.z);
            return at ? [{ text: q.text, sub: q.sub, locked: q.locked, x: at.x, y: at.y }] : [];
          });
        // The hero's box on screen (feet to the top of the head, a body wide): no plaque over him.
        const feet = project(h.x, h.y, h.z);
        const head = project(h.x, h.y + HERO_HEIGHT + 0.4, h.z);
        const half = feet && head ? (feet.y - head.y) * 0.4 : 0;
        d.hud.setPortalLabels(list, feet && head ? { x0: feet.x - half, y0: head.y, x1: feet.x + half, y1: feet.y } : undefined);
      } else if (d.mu) d.hud.setPortalLabels([]);
      const sim = d.getSim();
      const stages = sim.level.stages;
      if (!stages) return d.hud.setPadLabel(null);
      // SD-10 (review: «+N 🏆» covered the avalanche banner): no label while a wave is on.
      const ws = sim.threat?.state;
      if (ws && (ws.phase === 'warn' || ws.phase === 'run')) return d.hud.setPadLabel(null);
      const h = sim.hero.pos;
      let best = -1;
      for (let k = 0; k < stages.length; k++) {
        const st = stages[k]!;
        // Round of fixes MU (mockup check, l3: the plaque went out the moment the reward came): a taken pad keeps it while
        // the hero stands on it.
        const onPad = d.mu && Math.abs(st.pad.x - h.x) <= PAD_HALF + 1 && Math.abs(st.pad.z - h.z) <= PAD_HALF + 1;
        // MU round 4: on the phone the pad's plaque only within range of the pad (12 in, out past 14).
        const close = d.mu ? inRange(`pad:${k}`, Math.hypot(st.pad.x - h.x, st.pad.z - h.z)) : Math.abs(st.pad.z - h.z) <= LABEL_NEAR;
        if (st.trophies <= 0 || (sim.padTaken[k] && !onPad) || !close) continue;
        if (best < 0 || Math.abs(st.pad.z - h.z) < Math.abs(stages[best]!.pad.z - h.z)) best = k;
      }
      const st = best >= 0 ? stages[best]! : null;
      // Round of fixes MU (l3-stage-finish): the phone label stands right of the pad and over it — its right top corner
      // (the camera looks up +Z: −X is the right of the screen).
      const at = st ? project(st.pad.x - (d.mu ? PAD_HALF : 0), st.pad.y + (d.mu ? MU_LABEL_ABOVE : LABEL_ABOVE), st.pad.z) : null;
      // In the camp — the teleport pad (docs/01-gdd.md 22.12) instead of a trophy button.
      const tp = d.campTeleport?.();
      const tpAt = !st && tp && h.z < tp.z + LABEL_NEAR / 4 ? project(tp.x, tp.y + LABEL_ABOVE, tp.z) : null;
      // MU round 3 (producer): the reward taken — «you can run past» no more.
      if (d.mu && st && at) {
        // MU round 3: the hero's box on screen — the plaque keeps off it.
        const feet = project(h.x, h.y, h.z);
        const head = project(h.x, h.y + HERO_HEIGHT + 0.4, h.z);
        const half = feet && head ? (feet.y - head.y) * 0.4 : 0;
        const hero = feet && head ? { x0: feet.x - half, y0: head.y, x1: feet.x + half, y1: feet.y } : undefined;
        // MU round 5 (producer 21.10: the plaque covered the pad): the pad's top on screen, the plaque keeps off it.
        const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => project(st.pad.x + sx * PAD_HALF, st.pad.y, st.pad.z + sz * PAD_HALF)));
        const seen = corners.filter((c): c is { x: number; y: number } => c !== null);
        const pad = seen.length === 4 ? { x0: Math.min(...seen.map((c) => c.x)), y0: Math.min(...seen.map((c) => c.y)), x1: Math.max(...seen.map((c) => c.x)), y1: Math.max(...seen.map((c) => c.y)) } : undefined;
        const spent = d.padSpent?.(st.n) ?? false;
        // G-02 (producer 26.10): standing on a paying pad — «+N · to camp» and the ring filling up to the flight.
        const hold = !spent && sim.padHold?.stage === st.n ? sim.padHold : null;
        return d.hud.setPadLabel({
          ...(pad ? { pad } : {}),
          text: spent ? t('stage.padTaken') : hold ? t('stage.padCamp', { n: fmt(st.trophies) }) : t('stage.padReward', { n: fmt(st.trophies) }),
          ...(sim.padTaken[best] || spent ? {} : { sub: t('stage.padPass') }),
          ...(hold ? { ring: Math.min(1, hold.t / hold.sec) } : {}),
          x: at.x,
          y: at.y,
          ...(hero ? { hero } : {}),
        });
      }
      const hold = st && !d.padSpent?.(st.n) && sim.padHold?.stage === st.n ? sim.padHold : null;
      d.hud.setPadLabel(
        st && at
          ? { text: d.padSpent?.(st.n) ? t('stage.padTaken') : hold ? t('stage.padCamp', { n: fmt(st.trophies) }) : `+${fmt(st.trophies)}`, x: at.x, y: at.y, ...(hold ? { ring: Math.min(1, hold.t / hold.sec) } : {}) }
          : tpAt
            ? { text: t('teleport.title'), x: tpAt.x, y: tpAt.y, tap: true }
            : null,
      );
    },
  };
}

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
/** Round of fixes MU (l5-camp): a portal plaque reads up to this far (units) and hangs at this share of the arch. */
const PORTAL_READ = 90;
const PORTAL_AT = 0.15;

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
  /** SD-03 (docs/01-gdd.md 23.3): back in the camp after the trophies — a flash over the jump. */
  onCampReturn?: () => void;
  /** The teleport pad of the camp of this mountain (docs/01-gdd.md 22.12); absent — none. */
  campTeleport?: () => { x: number; y: number; z: number } | undefined;
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
      sim.events.on('trophyTake', ({ amount, x, y, z, trophies, total }) => {
        taken++;
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
          .filter((x) => x.dist <= PORTAL_READ)
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
        if (st.trophies <= 0 || (sim.padTaken[k] && !onPad) || Math.abs(st.pad.z - h.z) > LABEL_NEAR) continue;
        if (best < 0 || Math.abs(st.pad.z - h.z) < Math.abs(stages[best]!.pad.z - h.z)) best = k;
      }
      const st = best >= 0 ? stages[best]! : null;
      // Round of fixes MU (l3-stage-finish): the phone label stands right of the pad and over it — its right top corner
      // (the camera looks up +Z: −X is the right of the screen).
      const at = st ? project(st.pad.x - (d.mu ? PAD_HALF : 0), st.pad.y + (d.mu ? MU_LABEL_ABOVE : LABEL_ABOVE), st.pad.z) : null;
      // In the camp — the teleport pad (docs/01-gdd.md 22.12) instead of a trophy button.
      const tp = d.campTeleport?.();
      const tpAt = !st && tp && h.z < tp.z + LABEL_NEAR / 4 ? project(tp.x, tp.y + LABEL_ABOVE, tp.z) : null;
      if (d.mu && st && at) return d.hud.setPadLabel({ text: t('stage.padReward', { n: fmt(st.trophies) }), sub: t('stage.padPass'), x: at.x, y: at.y });
      d.hud.setPadLabel(st && at ? { text: `+${fmt(st.trophies)}`, x: at.x, y: at.y } : tpAt ? { text: t('teleport.title'), x: tpAt.x, y: tpAt.y, tap: true } : null);
    },
  };
}

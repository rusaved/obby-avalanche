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
import { t } from '../ui/i18n.ts';

/** The label shows over a button this close ahead or behind (units) and floats this high over it. */
const LABEL_NEAR = 140;
const LABEL_ABOVE = 3;

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
      sim.events.on('trophyTake', ({ amount, x, y, z, trophies }) => {
        taken++;
        d.hud.toast(t('toast.trophyPad', { n: fmt(amount) }));
        if (!trophies) d.hud.popCoinGain(`+${fmt(amount)}`);
        d.fx()?.burst('confetti', x, y + 1.5, z, [d.theme.ui.trophies, '#ffffff', d.theme.ui.coins], 36, 9, 3);
        d.play('levelUp');
        d.onTrophy?.(amount, trophies);
      });
      sim.events.on('campReturn', () => d.onCampReturn?.());
    },
    update() {
      const sim = d.getSim();
      const stages = sim.level.stages;
      if (!stages) return d.hud.setPadLabel(null);
      const h = sim.hero.pos;
      let best = -1;
      for (let k = 0; k < stages.length; k++) {
        const st = stages[k]!;
        if (st.trophies <= 0 || sim.padTaken[k] || Math.abs(st.pad.z - h.z) > LABEL_NEAR) continue;
        if (best < 0 || Math.abs(st.pad.z - h.z) < Math.abs(stages[best]!.pad.z - h.z)) best = k;
      }
      const st = best >= 0 ? stages[best]! : null;
      const at = st ? project(st.pad.x, st.pad.y + LABEL_ABOVE, st.pad.z) : null;
      // In the camp — the teleport pad (docs/01-gdd.md 22.12) instead of a trophy button.
      const tp = d.campTeleport?.();
      const tpAt = !st && tp && h.z < tp.z + LABEL_NEAR / 4 ? project(tp.x, tp.y + LABEL_ABOVE, tp.z) : null;
      d.hud.setPadLabel(st && at ? { text: `+${fmt(st.trophies)}`, x: at.x, y: at.y } : tpAt ? { text: t('teleport.title'), x: tpAt.x, y: tpAt.y, tap: true } : null);
    },
  };
}

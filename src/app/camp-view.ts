// What: The stage tutorial and the camp of the stages pace (docs/01-gdd.md 22.12): «Run to the reward» → «Take the trophies» → «+3 levels» one at a time; the teleport pad of the camp opens the stages passed, each for its trophies.
// Called by: main.ts (createCampView, update every frame; trophyTake from the sim events); test-api/index.ts via app/handles.ts.
// Keep: Reads the sim and the save, changes only the wallet (a teleport's price), the hero's place and save.tutor/stageBest; texts via t(); no stages on the mountain — nothing.

import type { Sim } from '../sim/world.ts';
import { stageAt } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { SaveData } from '../meta/save.ts';
import type { World } from '../content/types.ts';
import { levelOf, type Levels } from '../sim/levels.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';
import { track } from '../analytics/index.ts';

export const TELEPORT_WINDOW = 'campTeleport';
/** The hero stands on the teleport pad within this half side (the pad is 6 × 6). */
const PAD_REACH = 3.2;
/** Levels the last tutorial step asks for (docs/01-gdd.md 22.12: «+3 levels»). */
const TUTOR_LEVELS = 3;

export interface CampViewDeps {
  getSim(): Sim;
  getWorld(): World;
  hud: Hud;
  windows: WindowFrame;
  save: SaveData;
  levels: Levels | undefined;
  persist(): void;
  numSuffix(k: string): string;
}

export interface CampView {
  update(): void;
  /** A trophy button was taken (the tutorial step 2 is done). */
  trophyTaken(): void;
  /** Opens the teleport window (the pad; tests). */
  open(): void;
  /** A stage past the first is passed on this mountain: the teleport pad of the camp has something to offer. */
  hasPassed(): boolean;
  /** Teleports to stage n paying its trophies; false — not passed or short. */
  teleport(n: number): boolean;
}

export function createCampView(d: CampViewDeps): CampView {
  let onPad = false;
  let levelAtStep3 = -1;
  const fmt = (n: number): string => formatNumber(n, d.numSuffix);
  const best = (w: World): number => d.save.stageBest?.[String(w.index)] ?? 0;

  const view: CampView = {
    update() {
      const sim = d.getSim();
      const w = d.getWorld();
      const stages = sim.level.stages;
      if (!stages || !d.levels) return d.hud.setTutor(null);
      const h = sim.hero.pos;
      const n = stageAt(sim.level, h.z);
      if (n > best(w)) {
        (d.save.stageBest ??= {})[String(w.index)] = n;
        d.persist();
      }
      // The tutorial (22.12), from the first stage after the first minute.
      const step = d.save.tutor ?? 0;
      const st = stages.find((x) => x.n === n);
      if (step === 0 && st && (st.type !== 'intro' || w.index > 1)) {
        if (h.z >= st.finish[0] && st.trophies > 0) d.save.tutor = 1;
      } else if (step === 2) {
        const lv = levelOf(sim.progress.stat, d.levels);
        if (levelAtStep3 < 0) levelAtStep3 = lv;
        if (lv >= levelAtStep3 + TUTOR_LEVELS) {
          d.save.tutor = 3;
          d.persist();
        }
      }
      const now = d.save.tutor ?? 0;
      const show = now === 0 ? (st && (st.type !== 'intro' || w.index > 1) ? t('tutor.run') : null) : now === 1 ? t('tutor.take') : now === 2 ? t('tutor.levels', { n: TUTOR_LEVELS }) : null;
      d.hud.setTutor(show);
      // The teleport pad of the camp: stepping on it opens the window once a step-on.
      const p = w.campTeleport;
      const on = !!p && Math.abs(h.x - p.x) <= PAD_REACH && Math.abs(h.z - p.z) <= PAD_REACH && sim.hero.onGround;
      if (on && !onPad && !d.windows.current && view.hasPassed()) view.open();
      onPad = on;
    },
    hasPassed: () => best(d.getWorld()) >= 2,
    trophyTaken() {
      if ((d.save.tutor ?? 0) <= 1) {
        d.save.tutor = 2;
        levelAtStep3 = -1;
        d.persist();
      }
    },
    open() {
      const w = d.getWorld();
      const stages = w.stages ?? [];
      const render = (body: HTMLElement): void => {
        body.textContent = '';
        const list = document.createElement('div');
        list.className = 'tp-list';
        const top = best(w);
        for (const st of stages.filter((x) => x.n >= 2)) {
          const b = document.createElement('button');
          b.className = 'tp-item';
          b.dataset['stage'] = String(st.n);
          const passed = st.n <= top;
          const can = passed && d.getSim().coins >= st.trophies;
          b.disabled = !can;
          b.textContent = passed ? t('teleport.stage', { n: st.n, price: fmt(st.trophies) }) : t('teleport.locked', { n: st.n });
          b.addEventListener('click', () => {
            if (view.teleport(st.n)) d.windows.close();
          });
          list.appendChild(b);
        }
        body.appendChild(list);
      };
      d.windows.open(TELEPORT_WINDOW, t('teleport.title'), render);
    },
    teleport(n) {
      const sim = d.getSim();
      const st = sim.level.stages?.find((x) => x.n === n);
      if (!st || n > best(d.getWorld()) || sim.coins < st.trophies) return false;
      sim.coins -= st.trophies;
      const at = sim.stageStart(n);
      sim.teleport(at.x, at.y, at.z);
      track('camp_teleport', { world: sim.level.worldIndex, stage: n });
      return true;
    },
  };
  return view;
}

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
import { icon, setRich } from '../ui/icons.ts';
import { track } from '../analytics/index.ts';

/** SD-11: «Buy sneakers» shows at a closed ridge this close ahead (units). */
const SHOES_HINT_AHEAD = 40;

export const TELEPORT_WINDOW = 'campTeleport';
/** The hero stands on the teleport pad within this half side (the pad is 6 × 6). */
const PAD_REACH = 3.2;
/** Levels the last tutorial step asks for (docs/01-gdd.md 22.12: «+3 levels»). */
const TUTOR_LEVELS = 3;
/** «Jump!» shows this close before a pit on the line of the run, and no later than JUMP_HINT_SEC of the run before it
 * (LV-12 re-check: at 14 units it came 0.4 s before the edge on a phone). */
const JUMP_HINT_AHEAD = 14;
const JUMP_HINT_SEC = 1;
/** The hook for tomorrow waits this long after a trophy toast (one toast at a time, LV-12 review). */
const HOOK_QUIET_TICKS = 150;
const HOOK_SEC = 6;

export interface CampViewDeps {
  getSim(): Sim;
  getWorld(): World;
  hud: Hud;
  windows: WindowFrame;
  save: SaveData;
  levels: Levels | undefined;
  persist(): void;
  numSuffix(k: string): string;
  /** SD-03 (docs/01-gdd.md 23.3): the teleports cost stage trophies (the trophy wallet); absent — coins. */
  trophyWallet?: boolean;
  /** SD-11: the next pair of sneakers can be bought now (the plaque at a closed ridge). */
  shoesAffordable?(): boolean;
  onTrophies?(left: number): void;
}

export interface CampView {
  update(): void;
  /** A trophy button was taken (the tutorial step 2 is done). */
  trophyTaken(): void;
  /** Opens the teleport window (the pad; tests). */
  open(): void;
  /** A stage past the first is passed on this mountain: the teleport pad of the camp has something to offer. */
  hasPassed(): boolean;
  /** SD-13: a stage past the first is passed on any mountain — the pad answers (its window shows what is open here). */
  known(): boolean;
  /** Teleports to stage n paying its trophies; false — not passed or short. */
  teleport(n: number): boolean;
}

export function createCampView(d: CampViewDeps): CampView {
  let onPad = false;
  let levelAtStep3 = -1;
  let takenTick = -1;
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
      // The hook for tomorrow (LV-12 review: nothing in the first session said «come back»): once the tutorial is done, on
      // the next safe finish, not mid-run and not over a trophy toast (LV-12 re-check: a 4 s toast in the run was missed).
      const quiet = sim.tick < takenTick || sim.tick - takenTick >= HOOK_QUIET_TICKS;
      if ((d.save.tutor ?? 0) >= 3 && !d.save.flags?.['tomorrowHook'] && st && h.z >= st.finish[0] && h.z <= st.finish[1] && quiet) {
        (d.save.flags ??= {})['tomorrowHook'] = true;
        d.hud.toast(t('tutor.done'), HOOK_SEC, true, t('tutor.tomorrow'));
        d.persist();
      }
      const now = d.save.tutor ?? 0;
      let show = now === 0 ? (st && (st.type !== 'intro' || w.index > 1) ? t('tutor.run') : null) : now === 1 ? t('tutor.take') : now === 2 ? t('tutor.levels', { n: TUTOR_LEVELS }) : null;
      // «Jump!» before a pit on the line of the run until three are jumped (LV-12 review: no hint at the first jump).
      const jumps = d.save.flags?.['jumpsTaught'] === true;
      if (!jumps && st && (st.type === 'cracks' || st.type === 'plates') && sim.hero.onGround) {
        const ahead = Math.max(JUMP_HINT_AHEAD, sim.hero.speed * JUMP_HINT_SEC);
        const pit = sim.level.shapes?.find((q) => q.kind === 'pit' && q.z0 > h.z && q.z0 - h.z < ahead && h.x >= q.x0 && h.x <= q.x1);
        if (pit) show = t('tutor.jump');
      }
      if (!jumps && st && h.z > st.end && (st.type === 'cracks' || st.type === 'plates')) (d.save.flags ??= {})['jumpsTaught'] = true;
      // SD-11 (Q-088, producer: «show the purchase of sneakers»): at a closed ridge ahead with enough for the next pair.
      const gi = sim.level.gates.findIndex((g) => g.kind === 'ridge' && g.z > h.z && g.z - h.z < SHOES_HINT_AHEAD);
      if (gi >= 0 && !sim.gatesOpen[gi] && d.shoesAffordable?.()) show = t('hint.buyShoes');
      // The avalanche of a stage (LV-12 re-check: «Run up!» and «Take the trophies» stood under the wave): to a grotto.
      const ws = sim.threat?.state;
      // MU-11 (review: «Duck behind a rock!» hung after a catch): only the wave of the hero's own stage, not while he rolls
      // — a fall or the giant's slap took him a stage back while the wave above ran on, its plaque stood over the giant.
      const wave = !!ws && (ws.phase === 'warn' || (ws.phase === 'run' && ws.outcome === 'none')) && !sim.caught && stageAt(sim.level, ws.spawnZ) === n;
      // SD-06: the avalanche comes on almost every stage — the same plaque on any of them.
      // No grotto within reach of the warning (SD-10 review: «hide» pointed back past the finish) — run on to the finish.
      if (st && st.type !== 'intro' && wave) show = sim.inShelter() ? null : ws!.shelter >= 0 ? t('hint.cover') : t('hint.toFinish');
      d.hud.setTutor(show);
      // The teleport pad of the camp: stepping on it opens the window once a step-on.
      // SD-13 (producer 16.10: «it worked once, then broke»): on the next mountain the pad stood dead until its own
      // stage 2 — now it answers once the player knows it (a stage 2 passed anywhere), the stages not passed locked.
      const p = w.campTeleport;
      const on = !!p && Math.abs(h.x - p.x) <= PAD_REACH && Math.abs(h.z - p.z) <= PAD_REACH && sim.hero.onGround;
      if (on && !onPad && !d.windows.current && view.known()) view.open();
      onPad = on;
    },
    hasPassed: () => best(d.getWorld()) >= 2,
    known: () => Object.values(d.save.stageBest ?? {}).some((n) => n >= 2),
    trophyTaken() {
      takenTick = d.getSim().tick;
      if ((d.save.tutor ?? 0) <= 1) {
        d.save.tutor = 2;
        levelAtStep3 = -1;
        d.persist();
      }
    },
    open() {
      const w = d.getWorld();
      const stages = w.stages ?? [];
      // A stage tapped once is armed («Yes, for N»), the second tap pays (LV-12 review: one tap spent all trophies).
      let armed = 0;
      const render = (body: HTMLElement, head: HTMLElement): void => {
        body.textContent = '';
        const list = document.createElement('div');
        list.className = 'tp-list';
        const top = best(w);
        const coins = d.trophyWallet ? (d.save.trophies ?? 0) : d.getSim().coins;
        // MU-07 (w2-teleport): the balance in the head; a row of 52 px a stage — «Stage N · trial · price · Buy», the
        // stages not passed dimmed with a lock and «not passed yet».
        const bal = document.createElement('span');
        bal.className = 'card-price';
        bal.dataset['role'] = 'teleport-balance';
        setRich(bal, `${d.trophyWallet ? '{trophy}' : '{coin}'} ${fmt(coins)}`);
        head.appendChild(bal);
        for (const st of stages.filter((x) => x.n >= 2)) {
          const row = document.createElement('div');
          const passed = st.n <= top;
          const can = passed && coins >= st.trophies;
          row.className = passed ? 'tp-row' : 'tp-row off';
          const name = document.createElement('span');
          name.className = 'tp-name';
          name.textContent = t('teleport.stage', { n: st.n });
          const kind = document.createElement('span');
          kind.className = 'tp-kind';
          kind.textContent = t(`stageType.${st.type}`);
          row.append(name, kind);
          const b = document.createElement('button');
          b.className = passed ? 'card-btn tp-item' : 'tp-item tp-locked';
          b.dataset['stage'] = String(st.n);
          b.disabled = !can;
          if (passed) {
            const price = document.createElement('span');
            price.className = 'card-price tp-price';
            setRich(price, `{coin} ${fmt(st.trophies)}`);
            row.appendChild(price);
            setRich(b, !can ? t('teleport.short', { n: fmt(st.trophies - coins) }) : armed === st.n ? t('teleport.yes') : t('teleport.buy'));
          } else {
            const lock = document.createElement('span');
            lock.className = 'mark';
            lock.innerHTML = icon('padlock');
            b.append(lock, t('teleport.locked'));
          }
          row.appendChild(b);
          if (armed === st.n) b.classList.add('armed', 'ok');
          b.addEventListener('click', () => {
            if (armed !== st.n) {
              armed = st.n;
              d.windows.refresh();
            } else if (view.teleport(st.n)) d.windows.close();
          });
          list.appendChild(row);
        }
        body.appendChild(list);
      };
      d.windows.open(TELEPORT_WINDOW, t('teleport.title'), render, { sub: t('teleport.sub', { n: w.index }), size: 'list' });
    },
    teleport(n) {
      const sim = d.getSim();
      const st = sim.level.stages?.find((x) => x.n === n);
      const have = d.trophyWallet ? (d.save.trophies ?? 0) : sim.coins;
      if (!st || n > best(d.getWorld()) || have < st.trophies) return false;
      if (d.trophyWallet) {
        d.save.trophies = have - st.trophies;
        d.onTrophies?.(d.save.trophies);
        d.persist();
      } else sim.coins -= st.trophies;
      const at = sim.stageStart(n);
      sim.teleport(at.x, at.y, at.z);
      track('camp_teleport', { world: sim.level.worldIndex, stage: n });
      return true;
    },
  };
  return view;
}

// What: The stage tutorial and the camp of the stages pace (docs/01-gdd.md 22.12; ST-01: treadmill → level → the way → the reward pad → sneakers → the gift → on → the portal of mountain 2 → its stage 2, one at a time); the teleport pad of the camp opens the stages passed, each for its trophies.
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
import { setOff } from '../ui/nudge.ts';

/** SD-11: «Buy sneakers» shows at a closed ridge this close ahead (units). */
const SHOES_HINT_AHEAD = 40;

export const TELEPORT_WINDOW = 'campTeleport';
/** The hero stands on the teleport pad within this half side (the pad is 6 × 6). */
const PAD_REACH = 3.2;
/**
 * ST-01 (producer 22.10: the tutorial 2–3 times fuller, up to stage 2 of mountain 2): the steps in order; save.tutor —
 * how many are done (TUTOR_DONE — all). A step shows only while its moment is there (a belt near, a closed ridge, a pad
 * near, sneakers affordable, a gift ready, the base, mountain 2) and never over a window; a later step whose moment comes
 * first waits for the earlier ones — the next step is always the first one not done.
 */
// The gift last (game designer review: the time gifts open at 5 min of play, the steps after it waited for them).
export const TUTOR_STEPS = ['belt', 'level', 'pass', 'pad', 'shoes', 'onward', 'portal', 'next', 'gift'] as const;
export type TutorStep = (typeof TUTOR_STEPS)[number];
export const TUTOR_DONE = TUTOR_STEPS.length;
/** «Stand on the treadmill» shows with a belt this close (m), done after this long on it (s). */
const BELT_NEAR = 60;
const BELT_SEC = 1;
/** «The way is open, run!» within this distance of the ridge just opened (m). */
const PASS_NEAR = 40;
/** «Jump!» shows this close before a pit on the line of the run, and no later than JUMP_HINT_SEC of the run before it
 * (LV-12 re-check: at 14 units it came 0.4 s before the edge on a phone). */
const JUMP_HINT_AHEAD = 14;
const JUMP_HINT_SEC = 1;
/** The hook for tomorrow waits this long after a trophy toast (one toast at a time, LV-12 review). */
const HOOK_QUIET_TICKS = 150;
const HOOK_SEC = 6;
/** MU round 5 (producer 21.10: «Stand on the pad» hung at the top before the pad was in sight): the step shows only this
 * close to a pad not taken (m — the distance the world labels come in at) or while its pad is on screen from its safe
 * finish, with an arrow to it. */
const TAKE_NEAR = 18;

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
  /** MU round 5: the screen angle (rad) from the hero to a place — the arrow of the slot plaque. */
  aim?(x: number, y: number, z: number): number;
  /** MU round 5: a place is inside the frame now. */
  seen?(x: number, y: number, z: number): boolean;
  /** ST-01: a gift of the time rewards is ready to take (the gift plaque of the HUD in gold). */
  giftReady?(): boolean;
  /** ST-01: the hero is on the base and the portal of mountain `world` there (null — not on the base). */
  basePortal?(world: number): { x: number; y: number; z: number } | null;
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
  /** ST-01: the step of the tutorial now (null — all done). */
  readonly step: TutorStep | null;
}

export function createCampView(d: CampViewDeps): CampView {
  let onPad = false;
  let takenTick = -1;
  const fmt = (n: number): string => formatNumber(n, d.numSuffix);
  const best = (w: World): number => d.save.stageBest?.[String(w.index)] ?? 0;

  // ST-01: a save of the tutorial before it (LV: 3 steps, 3 — done) keeps «done»; the steps of it started anew.
  const flags = (d.save.flags ??= {});
  if (!flags['tutorST']) {
    flags['tutorST'] = true;
    d.save.tutor = (d.save.tutor ?? 0) >= 3 ? TUTOR_DONE : 0;
  }
  const done = (step: TutorStep): void => {
    if (TUTOR_STEPS[d.save.tutor ?? 0] !== step) return;
    d.save.tutor = (d.save.tutor ?? 0) + 1;
    d.persist();
  };
  let beltSec = 0;
  let beltTick = -1;
  let shoesAt = -1;
  let giftsAt = -1;
  /** The ridge ahead of the hero on this mountain (its gate index), −1 — none. */
  const ridgeAhead = (sim: Sim): number => sim.level.gates.findIndex((g) => g.kind === 'ridge' && g.z > sim.hero.pos.z - 1);
  /** The nearest treadmill within BELT_NEAR (the belts of the stage finishes and of the caves). */
  const beltNear = (sim: Sim, w: World): { x: number; y: number; z: number } | null => {
    const h = sim.hero.pos;
    let best: { x: number; y: number; z: number } | null = null;
    let far = BELT_NEAR;
    for (const s of w.segments) {
      if (s.type !== 'treadmill') continue;
      const x = typeof s['x'] === 'number' ? (s['x'] as number) : 0;
      const dist = Math.hypot(x - h.x, s.z - h.z);
      if (dist < far) {
        far = dist;
        best = { x, y: typeof s['y'] === 'number' ? (s['y'] as number) : h.y, z: s.z };
      }
    }
    return best;
  };
  /** ST-01: the text and the arrow of the step of the tutorial now (null — not its moment, or all done). */
  const tutorial = (sim: Sim, w: World, n: number): { text: string | null; arrow: number | null } => {
    const none = { text: null, arrow: null };
    const step = TUTOR_STEPS[d.save.tutor ?? 0];
    if (!step || !d.levels) return none;
    const h = sim.hero.pos;
    const st = sim.level.stages?.find((x) => x.n === n);
    // The first minute of mountain 1 has its own hints (meta/hints.ts): the steps start past it.
    const firstMinute = w.index === 1 && st?.type === 'intro' && !d.save.flags?.['firstWaveDone'];
    if (firstMinute || sim.caught) return none;
    const aim = (p: { x: number; y: number; z: number }): number | null => d.aim?.(p.x, p.y + 0.5, p.z) ?? null;
    const gi = ridgeAhead(sim);
    const gate = gi >= 0 ? sim.level.gates[gi] : undefined;
    switch (step) {
      case 'belt': {
        if (sim.onBelt) {
          if (sim.tick !== beltTick) beltSec += 1 / 60;
          beltTick = sim.tick;
          if (beltSec >= BELT_SEC) done('belt');
          return { text: t('tutor.belt'), arrow: null };
        }
        const b = beltNear(sim, w);
        return b ? { text: t('tutor.belt'), arrow: aim(b) } : none;
      }
      case 'level': {
        // The ridge ahead closed: its level; open (or none ahead) — the step is done, the way through it next.
        if (!gate || sim.gatesOpen[gi]) {
          passGate = gi;
          done('level');
          return none;
        }
        return { text: t('tutor.level', { n: levelOf(gate.requires, d.levels) }), arrow: null };
      }
      case 'pass': {
        const g = passGate >= 0 ? sim.level.gates[passGate] : undefined;
        if (!g || h.z > g.z + 2) {
          done('pass');
          return none;
        }
        return g.z - h.z <= PASS_NEAR ? { text: t('tutor.pass'), arrow: aim({ x: 0, y: h.y, z: g.z }) } : none;
      }
      case 'pad': {
        let take: { x: number; y: number; z: number } | null = null;
        let near = TAKE_NEAR;
        for (const [k, q] of (sim.level.stages ?? []).entries()) {
          const dist = Math.hypot(q.pad.x - h.x, q.pad.z - h.z);
          const inFinish = h.z >= q.finish[0] && h.z <= q.finish[1] && (d.seen?.(q.pad.x, q.pad.y, q.pad.z) ?? false);
          if (q.trophies > 0 && !sim.padTaken[k] && (dist <= near || (inFinish && take === null))) {
            near = dist;
            take = q.pad;
          }
        }
        return take ? { text: t('tutor.take'), arrow: aim(take) } : none;
      }
      case 'shoes': {
        const pairs = d.save.shoes ?? 0;
        if (shoesAt < 0) shoesAt = pairs;
        if (pairs > shoesAt) {
          done('shoes');
          return none;
        }
        return d.shoesAffordable?.() ? { text: t('tutor.shoes'), arrow: null } : none;
      }
      case 'gift': {
        const got = d.save.timeRw?.got.length ?? 0;
        if (giftsAt < 0) giftsAt = got;
        if (got > giftsAt) {
          done('gift');
          return none;
        }
        return d.giftReady?.() ? { text: t('tutor.gift'), arrow: null } : none;
      }
      case 'onward': {
        // Past the next ridge after these steps — the way to the summit is clear.
        if (n > (onwardFrom < 0 ? (onwardFrom = n) : onwardFrom)) {
          done('onward');
          return none;
        }
        return { text: t('tutor.onward'), arrow: null };
      }
      case 'portal':
        // On a mountain (back from the base on mountain 1, or straight on): the portal step waits for the base.
        if (w.index >= 2) done('portal');
        return none;
      case 'next':
        if (w.index >= 2 && n >= 2) {
          done('next');
          return none;
        }
        return w.index >= 2 ? { text: t('tutor.next'), arrow: null } : none;
    }
    return none;
  };
  let onwardFrom = -1;
  let passGate = -1;

  const view: CampView = {
    update() {
      const sim = d.getSim();
      const w = d.getWorld();
      const stages = sim.level.stages;
      // ST-01: the portal of mountain 2 on the base (no stages there).
      if (!stages && d.levels) {
        const step = TUTOR_STEPS[d.save.tutor ?? 0];
        const p = step === 'portal' && !d.windows.current ? d.basePortal?.(2) : null;
        return d.hud.setTutor(p ? t('tutor.portal') : null, false, p ? (d.aim?.(p.x, p.y + 2, p.z) ?? null) : null);
      }
      if (!stages || !d.levels) return d.hud.setTutor(null);
      const h = sim.hero.pos;
      const n = stageAt(sim.level, h.z);
      if (n > best(w)) {
        (d.save.stageBest ??= {})[String(w.index)] = n;
        d.persist();
      }
      const st = stages.find((x) => x.n === n);
      // The hook for tomorrow (LV-12 review: nothing in the first session said «come back»): once the tutorial is done, on
      // the next safe finish, not mid-run and not over a trophy toast (LV-12 re-check: a 4 s toast in the run was missed).
      const quiet = sim.tick < takenTick || sim.tick - takenTick >= HOOK_QUIET_TICKS;
      if ((d.save.tutor ?? 0) >= TUTOR_DONE && !d.save.flags?.['tomorrowHook'] && st && h.z >= st.finish[0] && h.z <= st.finish[1] && quiet) {
        (d.save.flags ??= {})['tomorrowHook'] = true;
        d.hud.toast(t('tutor.done'), HOOK_SEC, true, t('tutor.tomorrow'));
        d.persist();
      }
      const show0 = tutorial(sim, w, n);
      let show = show0.text;
      // «Jump!» before a pit on the line of the run until three are jumped (LV-12 review: no hint at the first jump).
      const jumps = d.save.flags?.['jumpsTaught'] === true;
      if (!jumps && st && (st.type === 'cracks' || st.type === 'plates') && sim.hero.onGround) {
        const ahead = Math.max(JUMP_HINT_AHEAD, sim.hero.speed * JUMP_HINT_SEC);
        const pit = sim.level.shapes?.find((q) => q.kind === 'pit' && q.z0 > h.z && q.z0 - h.z < ahead && h.x >= q.x0 && h.x <= q.x1);
        if (pit) show = t('tutor.jump');
      }
      if (!jumps && st && h.z > st.end && (st.type === 'cracks' || st.type === 'plates')) (d.save.flags ??= {})['jumpsTaught'] = true;
      // MU round 5 (producer 21.10): in the first blizzard — «Blizzard! Jump, it's faster» while in it, until a jump there.
      const bz = sim.rare?.state.blizzard;
      if (bz && h.z >= bz.z0 && h.z < bz.z1 && !d.save.flags?.['blizzardTaught']) {
        show = t('event.blizzardJump');
        if (!sim.hero.onGround) {
          (d.save.flags ??= {})['blizzardTaught'] = true;
          d.persist();
        }
      }
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
      // MU-02 (one message slot): a jump and the wave go before the gate plaque, the other steps after it.
      // ST-01: never over a window.
      if (d.windows.current) show = null;
      // ST-01 (usability review: the ridge plaque hid the steps): the level, the pad and on go before the ridge plaque; the
      // treadmill step leaves it the slot (its «Level up on a treadmill» points to the same belt).
      const lead = show !== null && show === show0.text && (TUTOR_STEPS[d.save.tutor ?? 0] === 'level' || TUTOR_STEPS[d.save.tutor ?? 0] === 'pad' || TUTOR_STEPS[d.save.tutor ?? 0] === 'onward');
      d.hud.setTutor(show, show !== null && (show === t('tutor.jump') || wave || lead), show !== null && show === show0.text ? show0.arrow : null);
      // The teleport pad of the camp: stepping on it opens the window once a step-on.
      // SD-13 (producer 16.10: «it worked once, then broke»): on the next mountain the pad stood dead until its own
      // stage 2 — now it answers once the player knows it (a stage 2 passed anywhere), the stages not passed locked.
      const p = w.campTeleport;
      const on = !!p && Math.abs(h.x - p.x) <= PAD_REACH && Math.abs(h.z - p.z) <= PAD_REACH && sim.hero.onGround;
      if (on && !onPad && !d.windows.current && view.known()) view.open();
      onPad = on;
    },
    get step() {
      return TUTOR_STEPS[d.save.tutor ?? 0] ?? null;
    },
    hasPassed: () => best(d.getWorld()) >= 2,
    known: () => Object.values(d.save.stageBest ?? {}).some((n) => n >= 2),
    trophyTaken() {
      takenTick = d.getSim().tick;
      if (TUTOR_STEPS[d.save.tutor ?? 0] === 'pad') done('pad');
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
          setOff(b, !can);
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

// What: Rewarded-ad buttons on the HUD by the common rules of docs/01-gdd.md 9.1: «Speed now» in a grotto with a belt or on the base treadmill (stat_now) and «continue from here» after a catch (continue_here).
// Called by: main.ts (createAdsView, update every frame, onAd from the HUD buttons, caught() after «Snowed in!»); app/handles.ts (AdsView type).
// Keep: The reward is given only when the ad says rewarded (docs/03 2.3); the game pauses with reason «ad» while it plays and goes on after any outcome; texts via t().

/**
 * Rewarded ads on the HUD (docs/01-gdd.md 9.1; docs/03-yandex-compliance.md 2.2–2.4): a button shows when all the
 * common conditions hold — 60 s of play in all and the first avalanche over, the hero standing ≥ 1 s (on a belt too),
 * the avalanche idle or gone, no window — and hides on the first move or the warning. While the ad runs the button is
 * locked and the game is paused («ad»); the reward comes only with `rewarded`, any other outcome is a toast.
 * Places here: `stat_now` — in a grotto with a belt (the ridge grotto, the one before the giant's zone; the cave of
 * 4.3 in the other paces), the belt's steps of `boost.statNowSec` at run speed, once in `ads.statNowCooldownSec`;
 * `continue_here` (the open slope, 17.11) — for `ads.continueShowSec` from the pop of the snowball of «Snowed in!» or
 * «The giant caught you!» until the first move, the hero back on the record flag, once in `ads.continueCooldownSec`.
 * It needs no second of standing (it comes at the pop) and takes an avalanche that has passed the hero for over.
 */
import type { BalanceJson } from '../content/types.ts';
import { stageAt, type Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import type { PauseManager } from '../core/pause.ts';
import type { Platform } from '../platform/types.ts';
import type { SaveData } from '../meta/save.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';
import { track } from '../analytics/index.ts';

/** The hero «stands» below this speed (units/s). */
const STAND_SPEED = 0.5;

export interface AdsViewDeps {
  balance: BalanceJson;
  hud: Hud;
  platform: Platform;
  pause: PauseManager;
  save: SaveData;
  getSim(): Sim;
  /** A window is open (its own buttons there). */
  windowOpen(): boolean;
  /** Move input this frame (stick, keys, autorun). */
  moving(): boolean;
  numSuffix(k: string): string;
  /** The stat changed by a reward: persist and update what depends on it. */
  onStat(): void;
}

export interface AdsView {
  /** Ids of the buttons shown now (tests). */
  readonly shown: readonly string[];
  /** Waiting for an ad (the button is locked). */
  readonly busy: string | null;
  update(dt: number, playSec: number): void;
  press(id: string): void;
}

export function createAdsView(d: AdsViewDeps): AdsView {
  let standSec = 0;
  /** The hero was in a snowball last frame; play second the «continue from here» offer ends at. */
  let caughtBefore = false;
  let continueUntil = -Infinity;
  /** Stages pace (docs/01-gdd.md 22.9): «Continue from stage N» after a roll-back — the stage and the play second it ends;
   * the mountains whose free continue is spent this run. */
  let stageOffer: { stage: number; until: number; world: number } | null = null;
  const freeSpent = new Set<number>();
  let shown: string[] = [];
  let busy: string | null = null;
  /** Play seconds of the last reward of each place (its cooldown counts from there). */
  const lastAt = new Map<string, number>();
  let now = 0;
  const ads = d.balance.ads;
  const fmt = (n: number): string => formatNumber(n, d.numSuffix);

  /** «Speed now» of the grotto the hero stands in: its belt's steps over statNowSec at run speed; 0 — no belt here. On
   * the base (level index 0, docs/01-gdd.md 19.3) — standing on its treadmill. */
  const statNow = (sim: Sim): number => {
    const n = sim.level.niches[sim.shelterIndex()];
    const belt = n && n.treadmill > 0 ? n.treadmill : sim.level.worldIndex === 0 && sim.onBelt ? sim.treadmillAt() : 0;
    if (!(belt > 0)) return 0;
    const steps = (sim.params.speed * d.balance.boost.statNowSec) / d.balance.stepLength;
    return d.balance.gainPerStep * sim.progress.gainMult * belt * steps;
  };
  const cooled = (id: string, sec: number): boolean => now - (lastAt.get(id) ?? -Infinity) >= sec;

  const view: AdsView = {
    get shown() {
      return shown;
    },
    get busy() {
      return busy;
    },
    update(dt, playSec) {
      now = playSec;
      const sim = d.getSim();
      const phase = sim.threat?.state.phase ?? 'idle';
      const moving = d.moving();
      const still = !moving && (sim.hero.speed < STAND_SPEED || sim.onBelt) && !sim.caught;
      standSec = still ? standSec + dt : 0;
      // The snowball popped: «continue from here» for continueShowSec, until the first move (docs/01-gdd.md 17.11).
      if (caughtBefore && !sim.caught && sim.record && ads.continueCooldownSec !== undefined) continueUntil = playSec + (ads.continueShowSec ?? 0);
      if (caughtBefore && !sim.caught && sim.level.stages && sim.rollFrom > 1) {
        stageOffer = { stage: sim.rollFrom, until: playSec + (ads.stageContinueSec ?? 60), world: sim.level.worldIndex };
        continueUntil = -Infinity;
      }
      caughtBefore = !!sim.caught;
      if (moving) continueUntil = -Infinity;
      // The offer ends by its time, on another mountain, or once the hero is back on that stage by himself.
      if (stageOffer && (playSec >= stageOffer.until || stageOffer.world !== sim.level.worldIndex || stageAt(sim.level, sim.hero.pos.z) >= stageOffer.stage)) stageOffer = null;
      const common =
        playSec >= ads.rewardedMinPlaySec &&
        (d.save.flags?.['firstWaveDone'] ?? false) &&
        // Nothing in the giant's zone (docs/01-gdd.md 17.6).
        (sim.boss?.zoneOf(sim.hero.pos.z) ?? -1) < 0 &&
        !d.windowOpen();
      const calm = phase === 'idle' || phase === 'gone';
      const ok = common && standSec >= ads.standStillSec && calm;
      const list: Array<{ id: string; text: string; busy: boolean }> = [];
      if (ok || busy) {
        const n = statNow(sim);
        if ((n > 0 && cooled('stat_now', ads.statNowCooldownSec)) || busy === 'stat_now') list.push({ id: 'stat_now', text: t('ad.statNow', { n: fmt(n) }), busy: busy === 'stat_now' });
      }
      // The avalanche that caught the hero is over for him once its front is below him.
      const passed = calm || (phase === 'run' && sim.threat?.state.outcome !== 'none');
      const offer = common && passed && playSec < continueUntil && !sim.caught && cooled('continue_here', ads.continueCooldownSec ?? Infinity);
      if (offer || busy === 'continue_here') list.push({ id: 'continue_here', text: t('ad.continueHere'), busy: busy === 'continue_here' });
      if (stageOffer && !sim.caught && !d.windowOpen()) {
        // Free while an ad may not be offered yet (the first 60 s, the first wave; LV-12 review: no button at all then).
        const free = !freeSpent.has(stageOffer.world) || !common;
        // The first of a mountain is free (no ad, no word «Ad»); then the rewarded ad by the common rules (9.1).
        if (free) list.push({ id: 'continue_free', text: t('stage.continueFree', { n: stageOffer.stage }), busy: false });
        else if (common || busy === 'continue_here') list.push({ id: 'continue_here', text: t('stage.continueAd', { n: stageOffer.stage }), busy: busy === 'continue_here' });
      }
      shown = list.map((b) => b.id);
      d.hud.setAdButtons(list);
    },
    press(id) {
      if (busy || !shown.includes(id)) return;
      const sim = d.getSim();
      if (id === 'continue_free' && stageOffer) {
        const at = sim.stageStart(stageOffer.stage);
        freeSpent.add(stageOffer.world);
        sim.teleport(at.x, at.y, at.z);
        stageOffer = null;
        return;
      }
      const amount = id === 'stat_now' ? statNow(sim) : 0;
      // «Speed now» by mountain (docs/01-gdd.md 20.13: the share of the ads against F19; 0 — the base).
      const where = id === 'stat_now' ? { mountain: sim.level.worldIndex } : {};
      busy = id;
      d.pause.add('ad');
      void d.platform
        .showRewarded(id)
        .then((r) => {
          if (r.rewarded) {
            lastAt.set(id, now);
            if (id === 'stat_now') {
              d.getSim().progress.stat += amount;
              d.onStat();
            }
            // Back on the record flag, where the hero was caught (docs/01-gdd.md 17.11).
            const r = d.getSim().record;
            if (id === 'continue_here' && stageOffer) {
              const at = d.getSim().stageStart(stageOffer.stage);
              d.getSim().teleport(at.x, at.y, at.z);
              stageOffer = null;
            } else if (id === 'continue_here' && r) {
              d.getSim().teleport(r.x, r.y, r.z);
              continueUntil = -Infinity;
            }
            d.hud.toast(t('toast.reward'));
          } else d.hud.toast(t(r.error ? 'toast.adUnavailable' : 'toast.noReward'));
        })
        .finally(() => {
          busy = null;
          d.pause.remove('ad');
          // The hero is in the player's hands again after any outcome (docs/06 section 3).
          track('ad_resume_ok', { placement: id, type: 'rewarded', ...where });
        });
    },
  };
  return view;
}

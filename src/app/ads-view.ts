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
import { formatNumber, formatTimer } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';
import { track } from '../analytics/index.ts';

/** The hero «stands» below this speed (units/s). */
const STAND_SPEED = 0.5;

export interface AdsViewDeps {
  /** MU-06 (l5-camp): the phone layout — only the stage offer stands in the slot, with its timer; the Speed ad lives in
   * the «Gifts» window. */
  mu?: boolean;
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
  /** M4-03 (x2_stat): the ×2 step boost changed — the step gain anew. */
  onBoost?(): void;
  /** M4-03: the places of `game.json.ads.rewarded` (docs/01-gdd.md 9.1). */
  rewardedPlaces?: readonly string[];
  /** M4-04: the points of `game.json.ads.interstitial` (docs/01-gdd.md 9.2). */
  interstitialPoints?: readonly string[];
  /** M4-04: play seconds of this load (from gameReady; pauses not counted). */
  sessionSec?(): number;
  /** M4-04: «No ads» bought (IAP-03) — no fullscreen ads. */
  noAds?(): boolean;
}

/** M4-04 (docs/01-gdd.md 9.2): where a fullscreen ad may follow a press of the player. */
export type InterstitialPoint = 'portal' | 'rebirth' | 'menu';

export interface AdsView {
  /** Ids of the buttons shown now (tests). */
  readonly shown: readonly string[];
  /** Waiting for an ad (the button is locked). */
  readonly busy: string | null;
  update(dt: number, playSec: number): void;
  press(id: string): void;
  /** MU-07 (w1-gifts): the Speed of «+N Speed · Ad» of the «Gifts» window — a belt run of the best belt of the mountain. */
  giftStat(): number;
  /** MU-07: that ad (place stat_now); `done` — after any outcome (the window re-renders). */
  giftAd(done: () => void): void;
  /** MU-07 (w5-summit): «Ad: ×2» by the chest (place x2_chest) — `coins` once more on `rewarded`. */
  chestAd(coins: number, done: () => void): void;
  /** M4-04: the player pressed at `point` — a fullscreen ad if its rules allow (called at once, within the press), then
   * `then` (at once when no ad). The game stands («ad») while it plays and goes on after any outcome. */
  interstitial(point: InterstitialPoint, then: () => void): void;
  /** M4-03 (docs/01-gdd.md 9.1, place egg): «▶ Ad: {egg}» may be offered now (60 s of play and the first avalanche over,
   * ads.eggPauseSec since the last one); null — not now. */
  eggOffer(): { busy: boolean } | null;
  /** M4-03: that ad; `give` on `rewarded` (the egg hatches) returns the toast, `done` after any outcome. */
  eggAd(give: () => string, done: () => void): void;
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
  /** M4-04: session seconds of the last fullscreen ad shown and of the last rewarded ad played. */
  let interAt = -Infinity;
  let rewardedAt = -Infinity;
  const session = (): number => d.sessionSec?.() ?? now;
  /** M4-09 (docs/06 step 14): the first «▶ Ad» button seen in this load, with its place. */
  let adSeen = false;
  const seen = (placement: string): void => {
    if (adSeen) return;
    adSeen = true;
    track('rewarded_shown', { placement });
  };
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
  /** A rewarded ad of a window (MU-07): the game and the avalanche stand while it runs, `give` only on `rewarded`, the
   * game goes on after any outcome. */
  // MU round 5 (producer 21.10): after the ad a toast of what it gave («+N Speed», «+N coins»), not «Reward received».
  const rewardAd = (place: string, give: () => string, done: () => void): void => {
    if (busy) return;
    busy = place;
    d.pause.add('ad');
    done();
    // M4-05 (docs/02-tech.md 11.5): the reward once per call — on rewarded, or on a late rewarded after the watchdog.
    let granted = false;
    const grant = (): void => {
      if (granted) return;
      granted = true;
      lastAt.set(place, now);
      d.hud.toast(give(), 3, true, undefined, undefined, true);
    };
    void d.platform
      .showRewarded(place, () => {
        grant();
        done();
      })
      .then((r) => {
        if (!r.error) rewardedAt = session();
        if (r.rewarded) grant();
        else d.hud.toast(t(r.error ? 'toast.adUnavailable' : 'toast.noReward'));
      })
      .finally(() => {
        busy = null;
        d.pause.remove('ad');
        track('ad_resume_ok', { placement: place, type: 'rewarded' });
        done();
      });
  };
  /** The Speed for an ad in the «Gifts» window: as statNow on the best belt of this mountain (1 — none). */
  const giftStat = (sim: Sim): number => {
    const belt = Math.max(1, ...sim.level.niches.map((n) => n.treadmill));
    const steps = (sim.params.speed * d.balance.boost.statNowSec) / d.balance.stepLength;
    return Math.max(statNow(sim), d.balance.gainPerStep * sim.progress.gainMult * belt * steps);
  };

  const view: AdsView = {
    giftStat: () => {
      seen('stat_now');
      return giftStat(d.getSim());
    },
    giftAd(done) {
      const amount = giftStat(d.getSim());
      rewardAd('stat_now', () => {
        d.getSim().progress.stat += amount;
        d.onStat();
        return t('toast.adStat', { n: fmt(amount) });
      }, done);
    },
    chestAd(coins, done) {
      rewardAd('x2_chest', () => {
        d.getSim().coins += coins;
        d.onStat();
        return t('toast.adCoins', { n: fmt(coins) });
      }, done);
    },
    interstitial(point, then) {
      const sim = d.getSim();
      const phase = sim.threat?.state.phase ?? 'idle';
      const flags = (d.save.flags ??= {});
      // The first portal of a new player passes with no ad (Q-014); the cooldown stays as it was.
      const firstPortal = point === 'portal' && !flags['firstPortalDone'];
      if (point === 'portal') flags['firstPortalDone'] = true;
      const t0 = session();
      const allowed =
        (d.interstitialPoints ?? []).includes(point) &&
        !(firstPortal && ads.skipFirstPortal) &&
        !busy &&
        !(d.noAds?.() ?? false) &&
        // Never on the warning or while the avalanche runs (docs/01-gdd.md 9.2).
        phase !== 'warn' &&
        phase !== 'run' &&
        t0 >= ads.interstitialMinSec &&
        t0 - interAt >= ads.interstitialCooldownSec &&
        t0 - rewardedAt >= ads.interstitialAfterRewardedSec;
      if (!allowed) {
        then();
        return;
      }
      busy = `inter_${point}`;
      d.pause.add('ad');
      void d.platform
        .showInterstitial(point)
        .then((r) => {
          // The cooldown counts from an ad really shown (wasShown, docs/01-gdd.md 9.2).
          if (r.shown) {
            interAt = session();
            track('inter_shown', { placement: point });
          }
        })
        .finally(() => {
          busy = null;
          d.pause.remove('ad');
          track('ad_resume_ok', { placement: point, type: 'interstitial' });
          then();
        });
    },
    eggOffer() {
      if (!(d.rewardedPlaces ?? []).includes('egg')) return null;
      if (busy === 'egg') return { busy: true };
      const common = now >= ads.rewardedMinPlaySec && (d.save.flags?.['firstWaveDone'] ?? false);
      if (!(common && !busy && cooled('egg', ads.eggPauseSec))) return null;
      seen('egg');
      return { busy: false };
    },
    eggAd(give, done) {
      rewardAd('egg', give, done);
    },
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
      // M4-03 (docs/01-gdd.md 9.1, x2_stat): «▶ Ad: ×2 per step for 3 min» while no boost runs (then its badge).
      if ((ok || busy === 'x2_stat') && !d.mu && (d.rewardedPlaces ?? []).includes('x2_stat') && ((d.save.boostSec ?? 0) <= 0 || busy === 'x2_stat'))
        list.push({ id: 'x2_stat', text: t('ad.x2stat', { n: Math.round(d.balance.boost.x2Sec / 60) }), busy: busy === 'x2_stat' });
      if ((ok || busy) && !d.mu) {
        const n = statNow(sim);
        if ((n > 0 && cooled('stat_now', ads.statNowCooldownSec)) || busy === 'stat_now') list.push({ id: 'stat_now', text: t('ad.statNow', { n: fmt(n) }), busy: busy === 'stat_now' });
      }
      // The avalanche that caught the hero is over for him once its front is below him.
      const passed = calm || (phase === 'run' && sim.threat?.state.outcome !== 'none');
      const offer = common && passed && playSec < continueUntil && !sim.caught && cooled('continue_here', ads.continueCooldownSec ?? Infinity);
      if ((offer && !d.mu) || (busy === 'continue_here' && !stageOffer)) list.push({ id: 'continue_here', text: t('ad.continueHere'), busy: busy === 'continue_here' });
      if (stageOffer && !sim.caught && !d.windowOpen()) {
        // Free while an ad may not be offered yet (the first 60 s, the first wave; LV-12 review: no button at all then).
        const free = !freeSpent.has(stageOffer.world) || !common;
        // The first of a mountain is free (no ad, no word «Ad»); then the rewarded ad by the common rules (9.1).
        if (free) list.push({ id: 'continue_free', text: t('stage.continueFree', { n: stageOffer.stage }), busy: false });
        else if (common || busy === 'continue_here') {
          // MU-06: «Ad: from stage N · 0:54» — how long the offer stands.
          const text = t('stage.continueAd', { n: stageOffer.stage });
          list.push({ id: 'continue_here', text: d.mu ? `${text} · ${formatTimer(Math.max(0, stageOffer.until - playSec))}` : text, busy: busy === 'continue_here' });
        }
      }
      shown = list.map((b) => b.id);
      const ad = list.find((b) => b.id !== 'continue_free');
      if (ad) seen(ad.id);
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
      // M4-05 (docs/02-tech.md 11.5): the reward once per call — on rewarded, or on a late rewarded after the watchdog.
      let granted = false;
      const grant = (): void => {
        if (granted) return;
        granted = true;
        lastAt.set(id, now);
        let got = t('toast.reward');
        if (id === 'stat_now') got = t('toast.adStat', { n: fmt(amount) });
        if (id === 'x2_stat') {
          d.save.boostSec = (d.save.boostSec ?? 0) + d.balance.boost.x2Sec;
          d.onBoost?.();
          d.onStat();
          got = t('toast.boostOn');
        }
        if (id === 'stat_now') {
          d.getSim().progress.stat += amount;
          d.onStat();
        }
        // Back on the record flag, where the hero was caught (docs/01-gdd.md 17.11).
        const r = d.getSim().record;
        if (id === 'continue_here' && stageOffer) {
          got = t('toast.adStage', { n: stageOffer.stage });
          const at = d.getSim().stageStart(stageOffer.stage);
          d.getSim().teleport(at.x, at.y, at.z);
          stageOffer = null;
        } else if (id === 'continue_here' && r) {
          d.getSim().teleport(r.x, r.y, r.z);
          continueUntil = -Infinity;
        }
        d.hud.toast(got, 3, true, undefined, undefined, true);
      };
      void d.platform
        .showRewarded(id, grant)
        .then((r) => {
          if (!r.error) rewardedAt = session();
          if (r.rewarded) grant();
          else d.hud.toast(t(r.error ? 'toast.adUnavailable' : 'toast.noReward'));
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

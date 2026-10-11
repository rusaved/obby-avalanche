// What: Rewarded-ad buttons on the HUD by the common rules of docs/01-gdd.md 9.1: «Speed now» in a grotto with a belt (stat_now) and «continue from here» (continue_here).
// Called by: main.ts (createAdsView, update every frame, onAd from the HUD buttons, caught() after «Snowed in!»); app/handles.ts (AdsView type).
// Keep: The reward is given only when the ad says rewarded (docs/03 2.3); the game pauses with reason «ad» while it plays and goes on after any outcome; texts via t().

/**
 * Rewarded ads on the HUD (docs/01-gdd.md 9.1; docs/03-yandex-compliance.md 2.2–2.4): a button shows when all the
 * common conditions hold — 60 s of play in all and the first avalanche over, the hero standing ≥ 1 s (on a belt too),
 * the avalanche idle or gone, no window — and hides on the first move or the warning. While the ad runs the button is
 * locked and the game is paused («ad»); the reward comes only with `rewarded`, any other outcome is a toast.
 * Places here: `stat_now` — in a grotto with a belt (the ridge grotto, the one before the giant's zone; the cave of
 * 4.3 in the other paces), the belt's steps of `boost.statNowSec` at run speed, once in `ads.statNowCooldownSec`.
 */
import type { BalanceJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import type { PauseManager } from '../core/pause.ts';
import type { Platform } from '../platform/types.ts';
import type { SaveData } from '../meta/save.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

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
  let shown: string[] = [];
  let busy: string | null = null;
  /** Play seconds of the last reward of each place (its cooldown counts from there). */
  const lastAt = new Map<string, number>();
  let now = 0;
  const ads = d.balance.ads;
  const fmt = (n: number): string => formatNumber(n, d.numSuffix);

  /** «Speed now» of the grotto the hero stands in: its belt's steps over statNowSec at run speed; 0 — no belt here. */
  const statNow = (sim: Sim): number => {
    const n = sim.level.niches[sim.shelterIndex()];
    if (!n || !(n.treadmill > 0)) return 0;
    const steps = (sim.params.speed * d.balance.boost.statNowSec) / d.balance.stepLength;
    return d.balance.gainPerStep * sim.progress.gainMult * n.treadmill * steps;
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
      const still = !d.moving() && (sim.hero.speed < STAND_SPEED || sim.onBelt) && !sim.caught;
      standSec = still ? standSec + dt : 0;
      const ok =
        playSec >= ads.rewardedMinPlaySec &&
        (d.save.flags?.['firstWaveDone'] ?? false) &&
        standSec >= ads.standStillSec &&
        (phase === 'idle' || phase === 'gone') &&
        // Nothing in the giant's zone (docs/01-gdd.md 17.6).
        (sim.boss?.zoneOf(sim.hero.pos.z) ?? -1) < 0 &&
        !d.windowOpen();
      const list: Array<{ id: string; text: string; busy: boolean }> = [];
      if (ok || busy) {
        const n = statNow(sim);
        if ((n > 0 && cooled('stat_now', ads.statNowCooldownSec)) || busy === 'stat_now') list.push({ id: 'stat_now', text: t('ad.statNow', { n: fmt(n) }), busy: busy === 'stat_now' });
      }
      shown = list.map((b) => b.id);
      d.hud.setAdButtons(list);
    },
    press(id) {
      if (busy || !shown.includes(id)) return;
      const sim = d.getSim();
      const amount = id === 'stat_now' ? statNow(sim) : 0;
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
            d.hud.toast(t('toast.reward'));
          } else d.hud.toast(t(r.error ? 'toast.adUnavailable' : 'toast.noReward'));
        })
        .finally(() => {
          busy = null;
          d.pause.remove('ad');
        });
    },
  };
  return view;
}

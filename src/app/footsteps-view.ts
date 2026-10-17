// What: Footsteps (LV-09, SD-14): a soft step of the set on (snow, or the common ice on a slide) at most perSec a second, a variant at random never twice in a row, a random pitch; the «Footsteps» window — choose a set, open one by a rewarded ad, buy one for trophies, the volume.
// Called by: main.ts (createFootstepsView; step() on every sim `gain`; openWindow() from the pause window); test-api/index.ts via app/handles.ts.
// Keep: Steps play through GameAudio.playStep (silent while paused, in an ad or with sound off); the cadence is audio/steps.ts; the reward only on `rewarded`, pause «ad» while it runs, the game goes on after any outcome; a purchase only by buyShop; texts via t().

/**
 * Footsteps (LV-09, docs/01-gdd.md 11: quiet, the pitch slightly random): a step of the step tracker — on the ground,
 * the belt of a treadmill too — plays a file of the set on, one of the common `ice` files while the feet are on an ice
 * slide, at the footsteps volume (sfx.json `footsteps.volume` by default, about 40% of the effects). SD-14 (producer
 * 16.10: a rattle at a fast run): not every step — at most `perSec` a second, the variant by its weights and never the
 * one just heard, ± `pitch` semitones, one voice (audio/steps.ts, GameAudio.playStep).
 * The window: a free set is chosen at once (the tap plays it), an `ad` set opens for ever by the rewarded place
 * `footsteps` (docs/03 2.3: «Реклама» on the button, the reward only on `rewarded`), a `shop` set is bought for its
 * price of summit trophies (SD-14) and put on.
 */
import type { FootstepsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { Platform } from '../platform/types.ts';
import type { PauseManager } from '../core/pause.ts';
import type { Hud } from '../ui/hud.ts';
import type { GameAudio } from '../audio/index.ts';
import { createStepCadence } from '../audio/steps.ts';
import { buyShop, chooseSet, footstepsOf, setVolume, unlockAd, type FootstepsState } from '../meta/footsteps.ts';
import { formatNumber } from '../ui/format.ts';
import { renderFootstepsPanel, type FootstepCard } from '../ui/footsteps-panel.ts';
import { t } from '../ui/i18n.ts';
import { track } from '../analytics/index.ts';

/** The rewarded place of the sets by an ad (game.json ads.rewarded). */
const PLACE = 'footsteps';
export const FOOTSTEPS_WINDOW = 'footsteps';

export type Surface = 'snow' | 'ice';

export interface FootstepsViewDeps {
  manifest: FootstepsJson;
  save: SaveData;
  windows: WindowFrame;
  platform: Platform;
  pause: PauseManager;
  hud: Hud;
  audio(): GameAudio | null;
  persist(flush?: boolean): void;
  numSuffix(k: string): string;
  /** SD-14: summit trophies left after a purchase (the HUD plaque). */
  onTrophies?(left: number): void;
}

export interface FootstepsView {
  /** Steps heard so far and the surface of the last one (e2e). */
  readonly count: number;
  readonly surface: Surface | null;
  /** The set whose ad is running, null — none. */
  readonly busy: string | null;
  state(): FootstepsState;
  /** One hero step on `surface` (a sim `gain`): heard at most perSec a second. */
  step(surface: Surface): void;
  openWindow(): void;
}

export function createFootstepsView(d: FootstepsViewDeps): FootstepsView {
  const m = d.manifest;
  let count = 0;
  let surface: Surface | null = null;
  let busy: string | null = null;
  // Math.random: a sound only, never the simulation (its rng stays seeded).
  const cadence = createStepCadence(m.perSec, m.pitch, Math.random);
  const filesOf = (id: string): string[] => m.sets.find((s) => s.id === id)?.files ?? [];
  d.audio()?.load([...filesOf(footstepsOf(d.save, m).set), ...m.ice]);

  /** A step of set `id` on `on` (`now` — seconds; −Infinity: a preview, outside the cadence). */
  const play = (id: string, on: Surface, now: number): boolean => {
    const set = m.sets.find((s) => s.id === id);
    const list = on === 'ice' ? m.ice : (set?.files ?? []);
    const pick = now === -Infinity ? { index: 0, semitones: 0 } : cadence.next(now, on === 'ice' ? 'ice' : id, list.length, on === 'ice' ? undefined : set?.weights);
    const file = pick ? list[pick.index] : undefined;
    const ok = !!file && (d.audio()?.playStep(file, pick!.semitones, footstepsOf(d.save, m).volume) ?? false);
    if (ok) {
      count++;
      surface = on;
    }
    return ok;
  };
  const preview = (id: string): void => void play(id, 'snow', -Infinity);

  const render = (body: HTMLElement): void => {
    const st = footstepsOf(d.save, m);
    const trophies = d.save.trophies ?? 0;
    const cards: FootstepCard[] = m.sets.map((s) => ({
      id: s.id,
      state:
        s.id === st.set
          ? 'on'
          : s.unlock === 'free' || st.ads.includes(s.id) || st.bought.includes(s.id)
            ? 'open'
            : s.unlock === 'ad'
              ? busy === s.id
                ? 'busy'
                : 'ad'
              : s.price === undefined
                ? 'shop'
                : trophies >= s.price
                  ? 'buy'
                  : 'short',
      ...(s.unlock === 'shop' && s.price !== undefined
        ? { price: formatNumber(s.price, d.numSuffix), need: t('shop.need', { n: formatNumber(Math.max(0, s.price - trophies), d.numSuffix) }) }
        : {}),
    }));
    renderFootstepsPanel(body, { volume: st.volume, cards }, {
      choose(id) {
        if (!chooseSet(d.save, m, id)) return;
        d.persist(true);
        d.windows.refresh();
        preview(id);
      },
      buy(id) {
        if (!buyShop(d.save, m, id)) return;
        d.persist(true);
        d.onTrophies?.(d.save.trophies ?? 0);
        d.windows.refresh();
        preview(id);
      },
      volume(v, done) {
        setVolume(d.save, m, v);
        if (!done) return;
        d.persist(true);
        preview(footstepsOf(d.save, m).set);
      },
      ad(id) {
        if (busy) return;
        busy = id;
        d.pause.add('ad');
        // The footsteps window keeps the sound on for its previews: the ad stops it now.
        d.audio()?.sync();
        d.windows.refresh();
        void d.platform
          .showRewarded(PLACE)
          .then((r) => {
            if (r.rewarded) {
              unlockAd(d.save, m, id);
              chooseSet(d.save, m, id);
              d.persist(true);
              d.hud.toast(t('toast.reward'));
            } else d.hud.toast(t(r.error ? 'toast.adUnavailable' : 'toast.noReward'));
          })
          .finally(() => {
            busy = null;
            d.pause.remove('ad');
            d.audio()?.sync();
            if (d.windows.current === FOOTSTEPS_WINDOW) d.windows.refresh();
            // The hero is in the player's hands again after any outcome (docs/06 section 3).
            track('ad_resume_ok', { placement: PLACE, type: 'rewarded' });
          });
      },
    });
  };

  return {
    get count() {
      return count;
    },
    get surface() {
      return surface;
    },
    get busy() {
      return busy;
    },
    state: () => footstepsOf(d.save, m),
    step(on) {
      play(footstepsOf(d.save, m).set, on, performance.now() / 1000);
    },
    openWindow() {
      // The previews of every set (SD-14: the files of a set come when first needed).
      d.audio()?.load(m.sets.flatMap((s) => s.files));
      d.windows.open(FOOTSTEPS_WINDOW, t('footsteps.title'), render, { onClose: () => d.audio()?.sync() });
      // Only `menu` holds the game now: the sound stays on for the previews (main.ts, the audio pause predicate).
      d.audio()?.sync();
    },
  };
}

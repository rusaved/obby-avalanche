// What: Footsteps (LV-09): a soft sound of the set on at every hero step (snow, or ice on a slide) with a random pitch, and the «Footsteps» window — choose a set, open one by a rewarded ad, the volume.
// Called by: main.ts (createFootstepsView; step() on every sim `gain`; openWindow() from the pause window); test-api/index.ts via app/handles.ts.
// Keep: Steps play through GameAudio.playStep (silent while paused, in an ad or with sound off); the reward only on `rewarded`, pause «ad» while it runs, the game goes on after any outcome; texts via t().

/**
 * Footsteps (LV-09, docs/01-gdd.md 11: quiet, the pitch slightly random): every step of the step tracker — on the
 * ground, the belt of a treadmill too — plays the step of the set on, `ice` while the feet are on an ice slide, at the
 * footsteps volume (sfx.json `footsteps.volume` by default, about 40% of the effects), ± `pitch` semitones at random.
 * The window: a free set is chosen at once (the tap plays it), an `ad` set opens for ever by the rewarded place
 * `footsteps` (docs/03 2.3: «Реклама» on the button, the reward only on `rewarded`), a `shop` set stands locked.
 */
import type { FootstepsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { Platform } from '../platform/types.ts';
import type { PauseManager } from '../core/pause.ts';
import type { Hud } from '../ui/hud.ts';
import { stepSound, type GameAudio } from '../audio/index.ts';
import { chooseSet, footstepsOf, setVolume, unlockAd, type FootstepsState } from '../meta/footsteps.ts';
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
}

export interface FootstepsView {
  /** Steps heard so far and the surface of the last one (e2e). */
  readonly count: number;
  readonly surface: Surface | null;
  /** The set whose ad is running, null — none. */
  readonly busy: string | null;
  state(): FootstepsState;
  /** One hero step on `surface`. */
  step(surface: Surface): void;
  openWindow(): void;
}

export function createFootstepsView(d: FootstepsViewDeps): FootstepsView {
  const m = d.manifest;
  let count = 0;
  let surface: Surface | null = null;
  let busy: string | null = null;

  const play = (id: string, on: Surface, semitones: number): boolean => {
    const ok = d.audio()?.playStep(stepSound(id, on), semitones, footstepsOf(d.save, m).volume) ?? false;
    if (ok) {
      count++;
      surface = on;
    }
    return ok;
  };
  const preview = (id: string): void => void play(id, 'snow', 0);

  const render = (body: HTMLElement): void => {
    const st = footstepsOf(d.save, m);
    const cards: FootstepCard[] = m.sets.map((s) => ({
      id: s.id,
      state:
        s.id === st.set ? 'on' : s.unlock === 'free' || st.ads.includes(s.id) ? 'open' : s.unlock === 'ad' ? (busy === s.id ? 'busy' : 'ad') : 'shop',
    }));
    renderFootstepsPanel(body, { volume: st.volume, cards }, {
      choose(id) {
        if (!chooseSet(d.save, m, id)) return;
        d.persist(true);
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
      // Math.random: a sound only, never the simulation (its rng stays seeded).
      play(footstepsOf(d.save, m).set, on, (Math.random() * 2 - 1) * m.pitch);
    },
    openWindow() {
      d.windows.open(FOOTSTEPS_WINDOW, t('footsteps.title'), render, { onClose: () => d.audio()?.sync() });
      // Only `menu` holds the game now: the sound stays on for the previews (main.ts, the audio pause predicate).
      d.audio()?.sync();
    },
  };
}

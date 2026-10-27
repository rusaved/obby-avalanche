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
import { setRich } from '../ui/icons.ts';
import { renderFootstepsPanel, type FootstepCard } from '../ui/footsteps-panel.ts';
import type { ShopCard } from '../ui/shop-panel.ts';
import type { ShopTabSource } from './cosmetics-view.ts';
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
  /** MU-12: the coins of the run (a set priced in coins takes them) and setting them after a purchase. */
  coins?(): number;
  setCoins?(n: number): void;
  /** MU-12: «To the shop» of a set not bought — the «Steps» tab of the shop. */
  toShop?(): void;
  /** ST-07: the rewarded ad of app/ads-view.ts (pause, one reward, the toast, the game on) and the place it plays; absent —
   * the platform directly (tests of the window alone). */
  rewarded?(place: string, give: () => string, done: (granted: boolean) => void): boolean;
  adBusy?(): string | null;
  /** K-05 (VK build): a rewarded ad is loaded now — the «Ad» set shows its button only then (absent — always). */
  adReady?(): boolean;
}

export interface FootstepsView {
  /** Steps heard so far and the surface of the last one (e2e). */
  readonly count: number;
  readonly surface: Surface | null;
  /** The set whose ad is running, null — none. */
  readonly busy: string | null;
  /** MU round 4: the file of the last step heard, null — none yet. */
  readonly last: string | null;
  state(): FootstepsState;
  /** One hero step on `surface` (a sim `gain`): heard at most perSec a second. */
  step(surface: Surface): void;
  openWindow(): void;
  /** MU-12: the «Steps» tab of the shop — a card a set: listen, the price, «Buy» / «Selected». */
  readonly shopTab: ShopTabSource;
}

export function createFootstepsView(d: FootstepsViewDeps): FootstepsView {
  const m = d.manifest;
  let count = 0;
  let surface: Surface | null = null;
  let busy: string | null = null;
  /** MU round 4: the file of the last step heard (tests: the set that plays). */
  let last: string | null = null;
  // Math.random: a sound only, never the simulation (its rng stays seeded).
  const cadence = createStepCadence(m.perSec, m.pitch, Math.random);
  const filesOf = (id: string): string[] => m.sets.find((s) => s.id === id)?.files ?? [];
  d.audio()?.load([...filesOf(footstepsOf(d.save, m).set), ...m.ice]);

  /** A step of set `id` on `on` (`now` — seconds; −Infinity: a preview, outside the cadence). */
  const play = (id: string, on: Surface, now: number): boolean => {
    const set = m.sets.find((s) => s.id === id);
    const list = on === 'ice' ? m.ice : (set?.files ?? []);
    // MU round 4 (producer 20.10: a set bought in the shop was never heard): its files are asked for when it plays —
    // bought or chosen without a preview they were never loaded (the audio asks for each file once).
    d.audio()?.load(list);
    const pick = now === -Infinity ? { index: 0, semitones: 0 } : cadence.next(now, on === 'ice' ? 'ice' : id, list.length, on === 'ice' ? undefined : set?.weights);
    const file = pick ? list[pick.index] : undefined;
    const ok = !!file && (d.audio()?.playStep(file, pick!.semitones + (on === 'ice' ? 0 : (set?.semitones ?? 0)), footstepsOf(d.save, m).volume) ?? false);
    if (ok) {
      count++;
      surface = on;
      last = file;
    }
    return ok;
  };
  const preview = (id: string): void => void play(id, 'snow', -Infinity);

  const fmt = (n: number): string => formatNumber(n, d.numSuffix);
  /** The price of a set with its currency mark («{trophy} 3», «{coin} 150»). */
  const priceOf = (s: FootstepsJson['sets'][number]): string => `${s.currency === 'coins' ? '{coin}' : '{trophy}'} ${fmt(s.price ?? 0)}`;
  const owned = (st: FootstepsState, s: FootstepsJson['sets'][number]): boolean =>
    s.unlock === 'free' || st.ads.includes(s.id) || st.bought.includes(s.id) || (s.unlock === 'daily' && (d.save.daily?.n ?? 0) >= (s.day ?? Infinity));
  const buy = (id: string): boolean => {
    d.audio()?.load(filesOf(id));
    const wallet = { coins: d.coins?.() ?? 0 };
    if (!buyShop(d.save, m, id, wallet)) return false;
    d.setCoins?.(wallet.coins);
    d.persist(true);
    d.onTrophies?.(d.save.trophies ?? 0);
    d.windows.refresh();
    preview(id);
    return true;
  };

  /** A set for an ad (the window and the shop card): ST-07 — through the common logic of app/ads-view.ts when given. */
  const playAd = (id: string): void => {
    if (busy) return;
    if (d.rewarded) {
      busy = id;
      const started = d.rewarded(PLACE, () => {
        unlockAd(d.save, m, id);
        chooseSet(d.save, m, id);
        d.persist(true);
        return t('toast.adSteps', { name: t(`footsteps.set.${id}`) });
      }, () => {
        // The ad still runs while its place is busy: the sound stays off, the button locked.
        busy = d.adBusy?.() === PLACE ? id : null;
        d.audio()?.sync();
        // The window or the shop card the ad came from.
        if (d.windows.current) d.windows.refresh();
      });
      if (!started) busy = null;
      return;
    }
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
          // MU round 5: the toast names what the ad gave.
          d.hud.toast(t('toast.adSteps', { name: t(`footsteps.set.${id}`) }), 3, true, undefined, undefined, true);
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
  };

  const render = (body: HTMLElement, head: HTMLElement): void => {
    const st = footstepsOf(d.save, m);
    // MU-07 (w4-footsteps): the balances the sets are priced in, in the head.
    const bal = document.createElement('span');
    bal.className = 'card-price';
    setRich(bal, `{coin} ${fmt(d.coins?.() ?? 0)}  {trophy} ${fmt(d.save.trophies ?? 0)}`);
    head.appendChild(bal);
    const cards: FootstepCard[] = m.sets.map((s) => ({
      id: s.id,
      ...(s.color ? { color: s.color } : {}),
      state: s.id === st.set ? 'on' : owned(st, s) ? 'open' : s.unlock === 'ad' ? (busy === s.id ? 'busy' : (d.adReady?.() ?? true) ? 'ad' : 'locked') : 'locked',
      ...(s.unlock === 'shop' && s.price !== undefined ? { price: priceOf(s) } : s.unlock === 'daily' ? { lock: t('footsteps.daily', { n: s.day ?? 0 }) } : {}),
    }));
    renderFootstepsPanel(body, { volume: st.volume, cards }, {
      choose(id) {
        if (!chooseSet(d.save, m, id)) return;
        d.persist(true);
        d.windows.refresh();
        preview(id);
      },
      preview,
      toShop: () => d.toShop?.(),
      volume(v, done) {
        setVolume(d.save, m, v);
        if (!done) return;
        d.persist(true);
        preview(footstepsOf(d.save, m).set);
      },
      ad: playAd,
    });
  };

  const shopTab: ShopTabSource = {
    cards(): ShopCard[] {
      const st = footstepsOf(d.save, m);
      const coins = d.coins?.() ?? 0;
      return m.sets.map((s) => {
        const have = s.currency === 'coins' ? coins : (d.save.trophies ?? 0);
        const price = s.price ?? 0;
        const mine = owned(st, s);
        return {
          id: s.id,
          name: t(`footsteps.set.${s.id}`),
          mult: '',
          price: fmt(price),
          coin: s.currency === 'coins',
          color: s.color ?? '#ffffff',
          sound: true,
          state: s.id === st.set ? 'on' : mine ? 'owned' : s.unlock === 'shop' ? (have >= price ? 'buy' : 'short') : 'locked',
          need: t('shop.need', { n: fmt(Math.max(0, price - have)) }),
          // ST-07: a set for an ad — «▶ Ad: open» on its card.
          ...(s.unlock === 'ad' && !mine && (busy === s.id || (d.adReady?.() ?? true)) ? { ad: { text: t('footsteps.ad'), busy: busy === s.id } } : {}),
          ...(s.unlock === 'daily' ? { lock: t('footsteps.daily', { n: s.day ?? 0 }) } : {}),
        };
      });
    },
    balance: () => fmt(d.save.trophies ?? 0),
    buy: (id) => void buy(id),
    equip(id) {
      if (!chooseSet(d.save, m, id)) return;
      d.persist(true);
      d.windows.refresh();
      preview(id);
    },
    preview: (id) => {
      d.audio()?.load(filesOf(id));
      preview(id);
    },
    trophies: () => true,
    ad: playAd,
  };

  return {
    shopTab,
    get count() {
      return count;
    },
    get surface() {
      return surface;
    },
    get busy() {
      return busy;
    },
    get last() {
      return last;
    },
    state: () => footstepsOf(d.save, m),
    step(on) {
      play(footstepsOf(d.save, m).set, on, performance.now() / 1000);
    },
    openWindow() {
      // The previews of every set (SD-14: the files of a set come when first needed).
      d.audio()?.load(m.sets.flatMap((s) => s.files));
      d.windows.open(FOOTSTEPS_WINDOW, t('footsteps.title'), render, { onClose: () => d.audio()?.sync(), sub: t('footsteps.sub'), size: 'cards' });
      // Only `menu` holds the game now: the sound stays on for the previews (main.ts, the audio pause predicate).
      d.audio()?.sync();
    },
  };
}

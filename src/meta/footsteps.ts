// What: Footsteps choice (LV-09, SD-14): reads the save's set on, sets opened by an ad or bought for trophies and volume against sfx.json footsteps with safe defaults; choose, open by an ad, buy, set the volume.
// Called by: app/footsteps-view.ts; tests/meta/footsteps.test.ts.
// Keep: Pure TS, no DOM; the save field is tolerant (absent or bad values give the manifest defaults, never throw); an ad set opens only by unlockAd, which the caller runs on `rewarded`; a shop set only by buyShop, which takes its price of the summit trophies.

/**
 * Footsteps (LV-09, docs/01-gdd.md 11): the save keeps `footsteps` { set, ads, volume } and every read goes through
 * `footstepsOf`, so an old save without the field, a set gone from the data or a volume out of 0–1 fall back to the
 * defaults of sfx.json (the first free set, `volume`). A `free` set is open at once, an `ad` one after its rewarded ad
 * (forever), a `shop` one once bought for its `price` of summit trophies (SD-14; forever).
 */
import type { FootstepsJson } from '../content/types.ts';
import type { SaveData } from './save.ts';

export interface FootstepsState {
  /** Id of the set on. */
  set: string;
  /** Ids of the `ad` sets opened by an ad. */
  ads: string[];
  /** Volume of the steps, a share of the effects (0–1). */
  volume: number;
  /** SD-14: ids of the `shop` sets bought. */
  bought: string[];
}

type FootstepsSave = Pick<SaveData, 'footsteps'> & Partial<Pick<SaveData, 'daily'>>;

/** MU-12: a `daily` set opens once the calendar of gifts has given its day. */
const dailyOpen = (save: FootstepsSave, day: number | undefined): boolean => (save.daily?.n ?? 0) >= (day ?? Infinity);

/** The set on by default: the first free one (the schema demands one). */
export function defaultSet(m: FootstepsJson): string {
  return (m.sets.find((s) => s.unlock === 'free') ?? m.sets[0])?.id ?? '';
}

/** The state of the save with the defaults of the data for what is absent or bad. */
export function footstepsOf(save: FootstepsSave, m: FootstepsJson): FootstepsState {
  const f = save.footsteps ?? {};
  const saved: unknown[] = Array.isArray(f.ads) ? f.ads : [];
  const ads = m.sets.filter((s) => s.unlock === 'ad' && saved.includes(s.id)).map((s) => s.id);
  const paid: unknown[] = Array.isArray(f.bought) ? f.bought : [];
  const bought = m.sets.filter((s) => s.unlock === 'shop' && paid.includes(s.id)).map((s) => s.id);
  const volume = typeof f.volume === 'number' && Number.isFinite(f.volume) ? Math.min(1, Math.max(0, f.volume)) : m.volume;
  const open = (id: string): boolean =>
    m.sets.some((s) => s.id === id && (s.unlock === 'free' || (s.unlock === 'ad' && ads.includes(id)) || (s.unlock === 'shop' && bought.includes(id)) || (s.unlock === 'daily' && dailyOpen(save, s.day))));
  const set = typeof f.set === 'string' && open(f.set) ? f.set : defaultSet(m);
  return { set, ads, volume, bought };
}

/** Set `id` can be put on: free, by an ad and already opened, or bought. */
export function isOpen(save: FootstepsSave, m: FootstepsJson, id: string): boolean {
  const s = m.sets.find((x) => x.id === id);
  const st = footstepsOf(save, m);
  return !!s && (s.unlock === 'free' || (s.unlock === 'ad' && st.ads.includes(id)) || (s.unlock === 'shop' && st.bought.includes(id)) || (s.unlock === 'daily' && dailyOpen(save, s.day)));
}

/** SD-14: buys the `shop` set `id` for its price of the summit trophies (save.trophies) and puts it on; MU-12: a set
 * priced in coins takes them from `wallet`. False — no such set, bought already or short. */
export function buyShop(save: Pick<SaveData, 'footsteps' | 'trophies'> & Partial<Pick<SaveData, 'daily'>>, m: FootstepsJson, id: string, wallet?: { coins: number }): boolean {
  const s = m.sets.find((x) => x.id === id && x.unlock === 'shop');
  const st = footstepsOf(save, m);
  const coins = s?.currency === 'coins';
  const have = coins ? (wallet?.coins ?? 0) : (save.trophies ?? 0);
  if (!s || st.bought.includes(id) || have < (s.price ?? 0)) return false;
  if (coins) wallet!.coins = have - (s.price ?? 0);
  else save.trophies = have - (s.price ?? 0);
  save.footsteps = { ...st, bought: [...st.bought, id], set: id };
  return true;
}

/** Puts set `id` on; false — it is not open. */
export function chooseSet(save: FootstepsSave, m: FootstepsJson, id: string): boolean {
  if (!isOpen(save, m, id)) return false;
  save.footsteps = { ...footstepsOf(save, m), set: id };
  return true;
}

/** Opens the `ad` set `id` for ever (call on `rewarded` only); false — no such set by an ad. */
export function unlockAd(save: FootstepsSave, m: FootstepsJson, id: string): boolean {
  if (!m.sets.some((s) => s.id === id && s.unlock === 'ad')) return false;
  const st = footstepsOf(save, m);
  save.footsteps = { ...st, ads: st.ads.includes(id) ? st.ads : [...st.ads, id] };
  return true;
}

/** The volume of the steps, clamped to 0–1. */
export function setVolume(save: FootstepsSave, m: FootstepsJson, volume: number): void {
  save.footsteps = { ...footstepsOf(save, m), volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : m.volume };
}

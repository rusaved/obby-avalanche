/**
 * Eggs and pets in the game (docs/01-gdd.md 7.2): the egg button over a stand when the hero stands next to it
 * (camp and the flag past wall 6), price × wallScale[n], one tap buys; the egg wobbles 1 s, the pet jumps out with
 * a toast (no window); new pets go on by meta/pets.ts; up to 3 pets hop next to the hero; the «Pets» window with
 * slots, the grid, «Equip best», equip, unequip and release. The free egg of the first minute lands here too.
 * Collection counter (M3-13, Q-024): «Snow Egg: 2 of 5» under the hatch toast, «2/27» on the «Pets» button and
 * «Pets 2/27» in the window — kinds of pets, n and total from eggs.json and pets.json.
 * The shop tab «Eggs» (M3-09): the eggs of the mountains open on this tier, an egg bought there hatches at once into
 * the «New pet!» window with «Equip» and «OK» (docs/01-gdd.md 7.2, 10.2).
 * The inventory lives in the save (save.pets, save.petsOn); purchases write at once.
 */
import { Vector3 } from 'three';
import type { BalanceJson, EggsJson, PetsJson, ThemeJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud, MenuItem } from '../ui/hud.ts';
import type { CameraRig } from '../render/camera.ts';
import type { PetsVisual } from '../render/pets.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { Rng } from '../core/rng.ts';
import { addPet, collected, eggPrice, equipBest, equipPet, equipped, equippedIds, petsOnMult, releasePet, rollEgg, unequipPet, type Egg } from '../meta/pets.ts';
import { petFace, renderPetsPanel, type PetCard } from '../ui/pets-panel.ts';
import type { ShopCard } from '../ui/shop-panel.ts';
import { formatMult, formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

/** The hero is at a stand within this horizontal distance (units) and height, standing (slower than STAND_SPEED). */
const STAND_NEAR = 3.2;
const STAND_HEIGHT = 2.5;
const STAND_SPEED = 1.5;
/** The button floats this high over the stand foot (units). */
const BUTTON_ABOVE = 4.2;

export interface PetsViewDeps {
  balance: BalanceJson;
  pets: PetsJson;
  eggs: EggsJson;
  theme: ThemeJson;
  save: SaveData;
  getSim(): Sim;
  hud: Hud;
  windows: WindowFrame;
  visual: PetsVisual;
  camera: CameraRig;
  field(): { width: number; height: number };
  rng: Rng;
  numSuffix(k: string): string;
  persist(flush?: boolean): void;
  trackOnce(name: string, params?: Record<string, unknown>): void;
  /** The pets on changed: the meta multiplier goes into the simulation again. */
  onChange(): void;
  /** An egg hatched (the quest «Open an egg», M3-08b). */
  onHatch?(): void;
  /** Mountain of each egg (worlds.json `egg`) and the highest mountain open on this tier: the shop tab «Eggs». */
  eggWorlds?: Record<string, number>;
  openWorld?(): number;
  /** «OK» of the «New pet!» window: back to the shop tab «Eggs». */
  toShop?(): void;
}

export interface PetsView {
  wire(sim: Sim): void;
  update(gameDt: number, timeSec: number, hero: Vector3, heroYaw: number, running: boolean): void;
  /** A pet came out of egg `egg` (`from` — where it jumps out); `gift` — the free egg of the first minute;
   * `quiet` — no toast (the «New pet!» window shows it). Returns its inventory index, null when there was no room. */
  hatched(pet: string, from: Vector3 | null, gift?: boolean, egg?: Egg, quiet?: boolean): number | null;
  /** Cards of the shop tab «Eggs». */
  shopCards(): ShopCard[];
  /** «Buy» on an egg card: the egg hatches at once into the «New pet!» window; no room — the «Pets» window. */
  buyFromShop(egg: string): boolean;
  /** The egg button pressed: buys the egg of the stand (or opens the window when there is no room). */
  buyEgg(): boolean;
  openWindow(): void;
  /** The «Pets» button of the HUD column (null until it is due, docs/01-gdd.md 6.4). */
  menuItem(): MenuItem | null;
  readonly eggButton: { shown: boolean; text: string; can: boolean; egg: string | null };
  readonly hatching: { egg: string; t: number } | null;
  readonly equippedIds: string[];
  readonly shownPets: number;
}

interface Stand {
  x: number;
  y: number;
  z: number;
  egg: Egg;
}

export function createPetsView(d: PetsViewDeps): PetsView {
  const slots = d.balance.pets.slots;
  const p = new Vector3();
  let stands: Stand[] = [];
  let near = -1;
  let hatch: { stand: number; t: number; pet: string; egg: string } | null = null;
  let asking: number | null = null;
  let looksKey = '';
  let eggButton = { shown: false, text: '', can: false, egg: null as string | null };

  const petDef = (id: string): PetsJson['pets'][number] | undefined => d.pets.pets.find((x) => x.id === id);
  const full = (): boolean => (d.save.pets ?? []).length >= d.balance.pets.inventory;
  const pct = (bonus: number): number => Math.round(bonus * 100);
  const allIds = d.pets.pets.map((x) => x.id);
  /** «2/27»: kinds of pets the player has of all pets.json. */
  const collection = (): { k: number; total: number } => ({ k: collected(d.save.pets, allIds), total: allIds.length });

  /** The pets next to the hero follow the pets on; returns the slot of inventory index `index`. */
  const syncLooks = (): void => {
    const ids = equippedIds(d.save, d.pets, slots);
    const key = ids.join(',');
    if (key === looksKey) return;
    looksKey = key;
    d.visual.setPets(ids.map((id) => ({ color: petDef(id)?.color ?? '#ffffff', accent: petDef(id)?.accent ?? '#ffffff' })));
  };

  const changed = (): void => {
    syncLooks();
    d.onChange();
    d.persist(true);
    d.windows.refresh();
  };

  const model = (): Parameters<typeof renderPetsPanel>[2] => {
    const list = d.save.pets ?? [];
    const on = equipped(d.save, d.pets, slots);
    const card = (index: number): PetCard => {
      const def = petDef(list[index]!);
      return {
        index,
        name: t(`pet.${list[index]}`),
        bonus: t('pets.bonus', { n: pct(def?.bonus ?? 0) }),
        color: def?.color ?? '#ffffff',
        accent: def?.accent ?? '#ffffff',
        rim: d.theme.rarity[def?.rarity ?? ''] ?? '#c8d6e5',
        on: on.includes(index),
      };
    };
    const cards = list.map((_, i) => card(i)).sort((a, b) => (petDef(list[b.index]!)?.bonus ?? 0) - (petDef(list[a.index]!)?.bonus ?? 0) || a.index - b.index);
    return {
      count: t('pets.count', { a: collection().k, b: collection().total }),
      slots: t('pets.slots', { a: on.length }),
      total: t('pets.total', { m: formatMult(petsOnMult(d.save, d.pets, slots), d.numSuffix) }),
      on: on.map(card),
      cards,
      slotCount: slots,
      asking,
    };
  };

  const render = (body: HTMLElement, head: HTMLElement): void =>
    renderPetsPanel(body, head, model(), {
      equip: (i) => void (equipPet(d.save, d.pets, slots, i) && changed()),
      unequip: (i) => void (unequipPet(d.save, d.pets, slots, i) && changed()),
      askRelease: (i) => {
        asking = i;
        d.windows.refresh();
      },
      release: (i) => {
        asking = null;
        if (releasePet(d.save, d.pets, slots, i)) changed();
      },
      equipBest: () => {
        equipBest(d.save, d.pets, slots);
        changed();
      },
    });

  const view: PetsView = {
    get eggButton() {
      return eggButton;
    },
    get hatching() {
      return hatch ? { egg: hatch.egg, t: hatch.t } : null;
    },
    get equippedIds() {
      return equippedIds(d.save, d.pets, slots);
    },
    get shownPets() {
      return d.visual.shown;
    },
    wire(sim) {
      stands = sim.level.points
        .filter((x) => x.type === 'eggStand')
        .map((x) => ({ x: x.x, y: x.y, z: x.z, egg: d.eggs.eggs.find((e) => e.id === x['egg']) }))
        .filter((x): x is Stand => x.egg !== undefined);
      d.visual.setStands(stands);
      hatch = null;
      near = -1;
    },
    update(gameDt, timeSec, hero, heroYaw, running) {
      const sim = d.getSim();
      syncLooks();
      if (hatch) {
        hatch.t += gameDt;
        if (hatch.t >= d.balance.ftue.eggHatchSec) {
          const st = stands[hatch.stand];
          const pet = hatch.pet;
          hatch = null;
          view.hatched(pet, st ? new Vector3(st.x, st.y + 1.8, st.z) : null, false, st?.egg);
        }
      }
      // The stand the hero stands at (docs/01-gdd.md 7.2: «when the hero is near and stands»).
      const h = sim.hero;
      near = -1;
      if (!hatch && !sim.caught && sim.respawnTicksLeft < 0 && h.speed < STAND_SPEED) {
        near = stands.findIndex((s) => Math.hypot(h.pos.x - s.x, h.pos.z - s.z) <= STAND_NEAR && Math.abs(h.pos.y - s.y) <= STAND_HEIGHT);
      }
      const st = stands[near];
      let at: { x: number; y: number } | null = null;
      if (st) {
        p.set(st.x, st.y + BUTTON_ABOVE, st.z).project(d.camera.camera);
        const f = d.field();
        if (p.z < 1) at = { x: (p.x * 0.5 + 0.5) * f.width, y: (0.5 - p.y * 0.5) * f.height };
      }
      if (st && at) {
        const price = eggPrice(st.egg, sim.tier, d.balance.rebirth);
        const noRoom = full();
        const text = noRoom ? t('toast.noSpace') : t('hud.eggBuy', { egg: t(`egg.${st.egg.id}`), price: formatNumber(price, d.numSuffix) });
        eggButton = { shown: true, text, can: noRoom || sim.coins >= price, egg: st.egg.id };
        d.hud.setEggButton({ text, can: eggButton.can, x: at.x, y: at.y });
      } else {
        eggButton = { shown: false, text: '', can: false, egg: null };
        d.hud.setEggButton(null);
      }
      d.visual.update(hero, heroYaw, running, gameDt, timeSec, hatch ? { stand: hatch.stand, k: Math.min(1, hatch.t / d.balance.ftue.eggHatchSec) } : null);
    },
    hatched(pet, from, gift = false, egg, quiet = false) {
      const res = addPet(d.save, d.pets, d.balance.pets, pet);
      if (!res) return null;
      if (gift) (d.save.flags ??= {})['giftEgg'] = true;
      d.onHatch?.();
      syncLooks();
      if (res.on && from) {
        const slot = equipped(d.save, d.pets, slots).indexOf(res.index);
        if (slot >= 0) d.visual.jumpOut(slot, from);
      }
      d.onChange();
      // Under the toast: «Snow Egg: 2 of 5» — kinds of this egg's pets the player has (M3-13).
      const pool = egg?.pool.map((x) => x.pet) ?? [];
      const count = egg ? t('toast.hatchCount', { egg: t(`egg.${egg.id}`), k: collected(d.save.pets, pool), n: pool.length }) : undefined;
      if (!quiet) d.hud.toast(t('toast.newPet', { n: pct(petDef(pet)?.bonus ?? 0) }), count ? 3 : 2, false, count);
      d.trackOnce('egg_1');
      d.persist(true);
      d.windows.refresh();
      return res.index;
    },
    shopCards() {
      const sim = d.getSim();
      const open = d.openWorld?.() ?? 1;
      return d.eggs.eggs.map((egg): ShopCard => {
        const price = eggPrice(egg, sim.tier, d.balance.rebirth);
        const world = d.eggWorlds?.[egg.id] ?? 1;
        const noRoom = full();
        const state: ShopCard['state'] = world > open ? 'locked' : noRoom || sim.coins >= price ? 'buy' : 'short';
        return {
          id: egg.id,
          name: t(`egg.${egg.id}`),
          mult: '',
          price: formatNumber(price, d.numSuffix),
          color: d.theme.materials['giftEgg']?.color ?? '#ffffff',
          state,
          need: t('shop.need', { n: formatNumber(Math.max(0, price - sim.coins), d.numSuffix) }),
          coin: true,
          lock: t('shop.lockedWorld', { n: world }),
          lines: egg.pool.map((x) => `${t(`pet.${x.pet}`)} ${formatMult(Math.round(x.chance * 1000) / 10, d.numSuffix)}%`),
          ...(noRoom ? { action: t('toast.noSpace') } : {}),
        };
      });
    },
    buyFromShop(id) {
      const egg = d.eggs.eggs.find((x) => x.id === id);
      if (!egg || (d.eggWorlds?.[id] ?? 1) > (d.openWorld?.() ?? 1)) return false;
      if (full()) {
        view.openWindow();
        return false;
      }
      const sim = d.getSim();
      const price = eggPrice(egg, sim.tier, d.balance.rebirth);
      if (!(sim.coins >= price)) return false;
      sim.coins -= price;
      d.hud.setCoins(formatNumber(sim.coins, d.numSuffix));
      const pet = rollEgg(egg, d.rng.next());
      const index = view.hatched(pet, null, false, egg, true);
      if (index === null) return false;
      // «New pet!» (docs/01-gdd.md 7.2, 10.2): the card with «Equip»; «OK» goes back to the eggs.
      const pool = egg.pool.map((x) => x.pet);
      const renderNew = (body: HTMLElement): void => {
        const def = petDef(pet);
        const card = document.createElement('div');
        card.className = 'card new-pet';
        card.dataset['role'] = 'new-pet';
        card.style.setProperty('--rim', d.theme.rarity[def?.rarity ?? ''] ?? '#c8d6e5');
        const line = (cls: string, text: string): HTMLElement => {
          const e = document.createElement('span');
          e.className = cls;
          e.textContent = text;
          return e;
        };
        card.append(
          petFace(def?.color ?? '#ffffff', def?.accent ?? '#ffffff'),
          line('card-name', t(`pet.${pet}`)),
          line('card-big', t('pets.bonus', { n: pct(def?.bonus ?? 0) })),
          line('card-sub', t('toast.hatchCount', { egg: t(`egg.${egg.id}`), k: collected(d.save.pets, pool), n: pool.length })),
        );
        const on = equipped(d.save, d.pets, slots).includes(index);
        const b = document.createElement('button');
        b.className = on ? 'card-btn off' : 'card-btn';
        b.dataset['hud'] = 'new-pet-equip';
        b.textContent = on ? t('shop.equipped') : t('btn.equip');
        if (!on) b.addEventListener('click', () => void (equipPet(d.save, d.pets, slots, index) && changed()));
        card.appendChild(b);
        body.appendChild(card);
      };
      d.windows.open('newPet', t('pets.new'), renderNew, { onNext: () => (d.toShop ? d.toShop() : d.windows.close()) });
      return true;
    },
    buyEgg() {
      const st = stands[near];
      if (!st || hatch) return false;
      if (full()) {
        view.openWindow();
        return false;
      }
      const sim = d.getSim();
      const price = eggPrice(st.egg, sim.tier, d.balance.rebirth);
      if (!(sim.coins >= price)) return false;
      sim.coins -= price;
      d.hud.setCoins(formatNumber(sim.coins, d.numSuffix));
      hatch = { stand: near, t: 0, pet: rollEgg(st.egg, d.rng.next()), egg: st.egg.id };
      return true;
    },
    openWindow() {
      asking = null;
      d.windows.open('pets', t('pets.title'), render);
    },
    menuItem() {
      if ((d.save.totalPlaySec ?? 0) < d.balance.ui.unlockMenusSec) return null;
      const c = collection();
      return { id: 'pets', label: t('btn.pets'), icon: 'pets', badge: t('btn.petsCount', { k: c.k, total: c.total }) };
    },
  };
  return view;
}

/**
 * Gives a reward of the calendar, quests, time rewards and the wheel (docs/01a-content.md 10; docs/01-gdd.md 7.6–7.8,
 * 7.13). Coins are «N gifts» of the player's zone × wallScale[n] (8.1), so a reward never loses its worth up the
 * mountains; trophies count for the records too; the ×2 boost adds play seconds (boosts add up in time, never ×4);
 * an egg hatches at once (`best` — the egg of the farthest mountain open on this tier); looks go through grantLook.
 */
import type { BalanceJson, EggsJson, Reward, SkinsJson, World } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import type { PetsView } from './pets-view.ts';
import { scaled } from '../sim/economy.ts';
import { zoneAt } from '../sim/bonus.ts';
import { addTrophies } from '../meta/trophies.ts';
import { rollEgg, type Egg } from '../meta/pets.ts';
import { grantLook, ownedLooks } from '../meta/cosmetics.ts';
import { formatNumber } from '../ui/format.ts';

export interface RewardsDeps {
  balance: BalanceJson;
  eggs: EggsJson;
  skins: SkinsJson;
  worlds: readonly World[];
  save: SaveData;
  getSim(): Sim;
  hud: Hud;
  pets(): PetsView | null;
  rng: { next(): number };
  numSuffix(k: string): string;
  /** A look was given: the wardrobe and the hero refresh. */
  onLook(): void;
  /** The boost started or grew: the step multiplier refreshes. */
  onBoost(): void;
}

export interface Rewards {
  /** Coins of `gifts` gifts of the player's zone now. */
  coinsOf(gifts: number): number;
  /** The egg a reward hatches (`best` resolved). */
  eggOf(id: string): Egg | undefined;
  /** Is a look of this reward already the player's (calendar `alt`). */
  owns(r: Reward): boolean;
  give(r: Reward): void;
}

export function createRewards(d: RewardsDeps): Rewards {
  const lookItems = (kind: 'skin' | 'wings') => (kind === 'skin' ? d.skins.skins : (d.skins.wings ?? []));
  const r: Rewards = {
    coinsOf(gifts) {
      const sim = d.getSim();
      const zone = zoneAt(sim.level, sim.hero.pos.z);
      const gift = sim.gifts.find((g) => g.zone === zone) ?? sim.gifts[0];
      return scaled(gifts * (gift?.coins ?? 0), sim.tier, d.balance.rebirth);
    },
    eggOf(id) {
      if (id !== 'best') return d.eggs.eggs.find((e) => e.id === id);
      const open = Math.max(d.save.world ?? 1, (d.save.summits ?? 0) + 1);
      const worlds = d.worlds.filter((w) => w.index <= open).sort((a, b) => b.index - a.index);
      for (const w of worlds) {
        const egg = d.eggs.eggs.find((e) => e.id === w.egg);
        if (egg) return egg;
      }
      return d.eggs.eggs[0];
    },
    owns(rw) {
      if (rw.kind === 'skin' || rw.kind === 'wings') return ownedLooks(d.save, rw.kind, lookItems(rw.kind)).includes(rw.id);
      if (rw.kind === 'pet' && rw.wings) return ownedLooks(d.save, 'wings', lookItems('wings')).includes(rw.wings);
      return false;
    },
    give(rw) {
      const sim = d.getSim();
      switch (rw.kind) {
        case 'coins':
          sim.coins += r.coinsOf(rw.gifts);
          d.hud.setCoins(formatNumber(sim.coins, d.numSuffix));
          break;
        case 'trophies':
          addTrophies(d.save, rw.n);
          break;
        case 'boost':
          d.save.boostSec = (d.save.boostSec ?? 0) + rw.min * 60;
          d.onBoost();
          break;
        case 'egg': {
          const egg = r.eggOf(rw.id);
          if (egg) d.pets()?.hatched(rollEgg(egg, d.rng.next()), null, false, egg);
          break;
        }
        case 'skin':
        case 'wings':
          if (grantLook(d.save, rw.kind, lookItems(rw.kind), rw.id)) d.onLook();
          break;
        case 'pet':
          d.pets()?.hatched(rw.id, null);
          if (rw.wings && grantLook(d.save, 'wings', lookItems('wings'), rw.wings)) d.onLook();
          break;
      }
    },
  };
  return r;
}

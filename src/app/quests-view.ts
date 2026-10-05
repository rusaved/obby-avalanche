/**
 * Quests of the day, time rewards and the lucky wheel in the game (docs/01-gdd.md 7.7, 7.8, 7.13; GDD-10). The
 * «Quests» button after the first summit, «!» when something waits; the «Rewards» button (a gift) from 5:00 of play
 * with the timer to the next reward or «!»; the wheel lives in the time rewards window (no HUD button of its own).
 * Counters come from the simulation bus and the meta (eggs, shoes); all of it refreshes with the calendar's game day.
 */
import type { BalanceJson, GameJson, Reward } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud, MenuItem } from '../ui/hud.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { Rewards } from './rewards.ts';
import { REWARD_ICON } from './daily-view.ts';
import {
  anyTimeRewardReady,
  bonusReady,
  claimBonus,
  claimQuest,
  claimTimeReward,
  addPlayToday,
  freeSpinReady,
  gameDay,
  nextTimeRewardSec,
  questDone,
  questProgress,
  questsToClaim,
  refreshDay,
  spinFree,
  timeRewardReady,
} from '../meta/quests.ts';
import { nextShoes, shoesPrice } from '../meta/shoes.ts';
import { scaled } from '../sim/economy.ts';
import { renderQuestsPanel, renderTimePanel } from '../ui/quests-panel.ts';
import { formatNumber, formatTimer } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export interface QuestsViewDeps {
  balance: BalanceJson;
  game: Pick<GameJson, 'threat'>;
  save: SaveData;
  getSim(): Sim;
  hud: Hud;
  windows: WindowFrame;
  rewards: Rewards;
  rng: { next(): number };
  numSuffix(k: string): string;
  /** Seconds to the next game day (the calendar). */
  nextDaySec(): number;
  persist(flush?: boolean): void;
}

export interface QuestsView {
  /** New quests and time rewards when the game day changed (boot, the calendar's new day). */
  refresh(): void;
  wire(sim: Sim): void;
  /** Every simulation tick: play seconds today, treadmill minutes. */
  tick(dt: number): void;
  /** Progress of quest `id` (the bus counters; __TEST__ for the e2e). */
  progress(id: string, amount: number): void;
  /** An egg hatched, shoes bought (meta hooks). */
  hatched(): void;
  shoes(): void;
  openQuests(): void;
  openTime(): void;
  claimQuest(i: number): boolean;
  claimBonus(): boolean;
  claimTime(i: number): boolean;
  spin(): number | null;
  questsItem(): MenuItem | null;
  timeItem(): MenuItem | null;
}

export function createQuestsView(d: QuestsViewDeps): QuestsView {
  const qcfg = d.balance.quests;
  const times = d.balance.timeRewards;
  const sectors = d.balance.wheel.sectors;
  let hit: number | null = null;

  /** The next shoes and the summit: farther than `farWalls` walls from the player's frontier (docs/01a-content.md 10). */
  const far = (): { shoesFar: boolean; summitFar: boolean } => {
    const sim = d.getSim();
    const gates = sim.level.gates;
    const front = gates.reduce((m, g, i) => (sim.gatesPassed[i] ? Math.max(m, g.index) : m), 0);
    const summitFar = gates.length - front > qcfg.farWalls;
    const next = nextShoes(d.balance.upgrade.tiers, d.save.shoes ?? 0);
    if (!next) return { shoesFar: true, summitFar };
    const zTo = gates.find((g) => g.index === front + qcfg.farWalls)?.z ?? Infinity;
    const zFrom = sim.hero.pos.z;
    let income = 0;
    for (const g of gates) if (g.index > front && g.index <= front + qcfg.farWalls) income += g.rewardCoins;
    for (const gift of sim.gifts) if (gift.z >= zFrom && gift.z <= zTo) income += gift.coins;
    const price = shoesPrice(next, sim.tier, d.balance.rebirth);
    return { shoesFar: price > sim.coins + scaled(income, sim.tier, d.balance.rebirth), summitFar };
  };

  const give = (list: readonly Reward[]): void => {
    for (const r of list) d.rewards.give(r);
    d.hud.toast(t('toast.reward'));
    d.persist(true);
    d.windows.refresh();
  };

  const progress = (id: string, amount: number): void => {
    if (questProgress(d.save, id, amount)) {
      d.persist(true);
      if (d.windows.current === 'quests') d.windows.refresh();
    }
  };

  const rewardName = (r: Reward): string => {
    switch (r.kind) {
      case 'coins':
        return `${t('reward.coins')} +${formatNumber(d.rewards.coinsOf(r.gifts), d.numSuffix)}`;
      case 'trophies':
        return `${t('reward.trophies')} +${r.n}`;
      case 'boost':
        return t('reward.boost', { n: r.min });
      case 'egg':
        return r.id === 'best' ? t('reward.bestEgg') : t(`egg.${r.id}`);
      case 'skin':
        return t(`skin.${r.id}`);
      case 'wings':
        return t(`wings.${r.id}`);
      case 'pet':
        return t(`pet.${r.id}`);
    }
  };

  const renderQuests = (body: HTMLElement): void => {
    const q = d.save.quests;
    renderQuestsPanel(
      body,
      {
        rows: (q?.list ?? []).map((x) => ({
          text: t(`quests.${x.id}`, { n: x.n }),
          progress: `${formatNumber(Math.floor(x.k), d.numSuffix)}/${formatNumber(x.n, d.numSuffix)}`,
          frac: x.k / x.n,
          state: x.got ? 'got' : questDone(x) ? 'ready' : 'run',
        })),
        bonus: { text: t('quests.bonus'), state: q?.bonus ? 'got' : bonusReady(d.save) ? 'ready' : 'run' },
        claim: t('btn.claim'),
        next: t('quests.new', { time: formatTimer(d.nextDaySec()) }),
      },
      { claim: (i) => void view.claimQuest(i), bonus: () => void view.claimBonus() },
    );
  };

  const renderTime = (body: HTMLElement, head: HTMLElement): void => {
    const sec = d.save.timeRw?.sec ?? 0;
    const free = freeSpinReady(d.save);
    renderTimePanel(
      body,
      head,
      {
        played: t('time.played', { time: formatTimer(sec) }),
        tiles: times.map((x, i) => ({
          at: t('time.at', { n: x.min }),
          name: rewardName(x.reward),
          icon: REWARD_ICON[x.reward.kind],
          timer: formatTimer(x.min * 60 - sec),
          state: d.save.timeRw?.got.includes(i) ? 'got' : timeRewardReady(d.save, times, i) ? 'ready' : 'run',
        })),
        claim: t('btn.claim'),
        wheel: {
          title: t('wheel.title'),
          sectors: sectors.map((r) => ({ name: rewardName(r), icon: REWARD_ICON[r.kind] })),
          hit,
          spin: free ? t('btn.spin') : null,
          next: free ? t('wheel.free') : t('wheel.next', { time: formatTimer(d.nextDaySec()) }),
        },
      },
      { claim: (i) => void view.claimTime(i), spin: () => void view.spin() },
    );
  };

  let shown = '';
  let lastDay = Number.NaN;
  const view: QuestsView = {
    refresh() {
      lastDay = gameDay(d.save);
      if (refreshDay(d.save, qcfg, { gold: !!d.game.threat.bonus, ...far() })) {
        hit = null;
        d.persist(true);
        d.windows.refresh();
      }
    },
    wire(sim) {
      sim.events.on('gatePass', () => progress('q_walls', 1));
      sim.events.on('waveSurvived', () => progress('q_caves', 1));
      sim.events.on('giftTake', () => progress('q_gifts', 1));
      sim.events.on('gain', () => progress('q_steps', 1));
      sim.events.on('portal', () => progress('q_summit', 1));
      sim.events.on('bonusSaved', () => progress('q_gold', 1));
    },
    tick(dt) {
      if (gameDay(d.save) !== lastDay) view.refresh();
      addPlayToday(d.save, dt);
      if (d.getSim().onBelt) progress('q_treadmill', dt / 60);
      // Open window timers move once a second.
      const w = d.windows.current;
      if (w === 'quests' || w === 'timeRewards') {
        const key = `${w}:${Math.floor(d.save.timeRw?.sec ?? 0)}:${Math.floor(d.nextDaySec())}`;
        if (key !== shown) {
          shown = key;
          d.windows.refresh();
        }
      }
    },
    progress,
    hatched: () => progress('q_egg', 1),
    shoes: () => progress('q_shoes', 1),
    openQuests() {
      d.windows.open('quests', t('quests.title'), renderQuests);
    },
    openTime() {
      d.windows.open('timeRewards', t('time.title'), renderTime);
    },
    claimQuest(i) {
      if (!claimQuest(d.save, i)) return false;
      give(qcfg.reward);
      return true;
    },
    claimBonus() {
      if (!claimBonus(d.save)) return false;
      give(qcfg.bonus);
      return true;
    },
    claimTime(i) {
      if (!claimTimeReward(d.save, times, i)) return false;
      give([times[i]!.reward]);
      return true;
    },
    spin() {
      const i = spinFree(d.save, sectors.length, d.rng.next());
      if (i === null) return null;
      hit = i;
      give([sectors[i]!]);
      return i;
    },
    questsItem() {
      const shown = (d.save.trophiesTotal ?? 0) > 0 || (d.save.tier ?? 0) > 0;
      if (!shown) return null;
      return { id: 'quests', label: t('btn.quests'), icon: 'quests', badge: questsToClaim(d.save) ? '!' : '' };
    },
    timeItem() {
      if ((d.save.totalPlaySec ?? 0) < d.balance.ui.unlockTimeRewardsSec) return null;
      const next = nextTimeRewardSec(d.save, times);
      const badge = anyTimeRewardReady(d.save, times) || freeSpinReady(d.save) ? '!' : next !== null ? formatTimer(next) : '';
      return { id: 'timeRewards', label: t('btn.timeRewards'), icon: 'gift', badge };
    },
  };
  return view;
}

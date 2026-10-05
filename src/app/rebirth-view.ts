/**
 * Rebirth in the game (docs/01-gdd.md 7.5, 6.4, 10.2; GDD-08): the «Rebirth» button of the HUD column from the first
 * summit — with a lock and «Mountain {a}/5» until the summit of the last mountain on this tier; the rebirth window
 * that shows what resets, what stays and what the player gets before the button; the «All mountains cleared!» window
 * at the portal of the last mountain («Rebirth» → the rebirth window, «Stay» → on the summit). The rebirth itself
 * (new tier, mountain 1, camp, stat and coins at zero) is the caller's `onRebirth`; the save rules — meta/rebirth.ts.
 */
import type { BalanceJson, EggsJson, SkinsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { MenuItem } from '../ui/hud.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { LookKind } from '../meta/cosmetics.ts';
import { markSummit, rebirthGoal, rebirthPreview, rebirthReady, summitsDone } from '../meta/rebirth.ts';
import { eggPrice } from '../meta/pets.ts';
import { renderAllDonePanel, renderRebirthPanel } from '../ui/rebirth-panel.ts';
import { formatMult } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

export interface RebirthViewDeps {
  balance: BalanceJson;
  skins: SkinsJson;
  eggs: EggsJson;
  save: SaveData;
  getSim(): Sim;
  windows: WindowFrame;
  numSuffix(k: string): string;
  persist(flush?: boolean): void;
  /** A block figure of a look for the reward card (the wardrobe's picture). */
  lookFigure(kind: LookKind, id: string): HTMLElement;
  /** «Rebirth» pressed in a ready window: the caller runs the rebirth (the window is already closed). */
  onRebirth(): void;
  /** «To eggs»: the shop tab «Eggs» (M3-09); absent — only the hint. */
  toEggs?: () => void;
}

export interface RebirthView {
  readonly ready: boolean;
  openWindow(): void;
  openAllDone(): void;
  /** The summit portal of mountain `world` entered on this tier (the last one opens «All mountains cleared!»). */
  summit(world: number): void;
  /** The «Rebirth» button of the HUD column (null before the first summit). */
  menuItem(): MenuItem | null;
}

export function createRebirthView(d: RebirthViewDeps): RebirthView {
  const goal = rebirthGoal(d.balance);
  const shown = (): boolean => (d.save.trophiesTotal ?? 0) > 0 || (d.save.tier ?? 0) > 0;

  const render = (body: HTMLElement, head: HTMLElement): void => {
    const sim = d.getSim();
    const p = rebirthPreview(d.balance, d.skins, sim.tier);
    const cheapest = Math.min(...d.eggs.eggs.map((e) => eggPrice(e, sim.tier, d.balance.rebirth)));
    renderRebirthPanel(
      body,
      head,
      {
        tier: t('rebirth.toTier', { n: p.tier }),
        ready: view.ready,
        locked: `${t('rebirth.locked')} · ${t('rebirth.progress', { a: summitsDone(d.save) })}`,
        step: t('rebirth.step', { a: formatMult(p.stepNow, d.numSuffix), b: formatMult(p.stepNext, d.numSuffix) }),
        rewards: p.rewards.map((r) => ({ name: t(`${r.kind}.${r.id}`), figure: d.lookFigure(r.kind, r.id) })),
        spendHint: sim.coins >= cheapest,
        toEggs: !!d.toEggs,
      },
      {
        rebirth: () => {
          if (!view.ready) return;
          d.windows.close();
          d.onRebirth();
        },
        later: () => d.windows.close(),
        toEggs: () => {
          d.windows.close();
          d.toEggs?.();
        },
      },
    );
  };

  const view: RebirthView = {
    get ready() {
      return rebirthReady(d.save, d.balance);
    },
    openWindow() {
      d.windows.open('rebirth', t('rebirth.title'), render, { next: false });
    },
    openAllDone() {
      d.windows.open('allDone', t('allDone.title'), (body) =>
        renderAllDonePanel(body, { rebirth: () => view.openWindow(), stay: () => d.windows.close() }),
        { next: false },
      );
    },
    summit(world) {
      markSummit(d.save, world);
      d.persist(true);
      if (world >= goal) view.openAllDone();
    },
    menuItem() {
      if (!shown()) return null;
      return view.ready
        ? { id: 'rebirth', label: t('btn.rebirth'), icon: 'rebirth' }
        : { id: 'rebirth', label: t('rebirth.progress', { a: summitsDone(d.save) }), icon: 'lock' };
    },
  };
  return view;
}

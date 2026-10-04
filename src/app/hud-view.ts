/**
 * Core HUD each frame (docs/01-gdd.md 10.1, 10.4): Speed plaque with «+N per step», the mountain bar (zones, walls,
 * caves, the hero's face, the avalanche mark, the blinking cave on the warning), the goal «Wall 2K · 1.2K/2K» and
 * «Wall open!» for 2 s. Reads the simulation, never changes it.
 */
import type { BalanceJson, ThemeJson, World } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

/** «Wall open!» stays this long (docs/01-gdd.md 6.2: 2 s). */
const GOAL_OPEN_SEC = 2;
/** «+N» over the plaque at most this often (docs/01-gdd.md 10.3: 4 a second). */
const STAT_POP_MIN_SEC = 0.25;

export interface HudViewDeps {
  balance: BalanceJson;
  theme: ThemeJson;
  hud: Hud;
  getSim(): Sim;
  getWorld(): World;
  faceUrl: string;
  numSuffix(k: string): string;
}

export interface HudView {
  /** A new mountain: rebuilds the bar and subscribes to gains and gates. */
  wire(sim: Sim): void;
  update(timeSec: number): void;
}

export function createHudView(d: HudViewDeps): HudView {
  let openedAt = -Infinity;
  let pendingPop: number | null = null;
  let lastPopAt = -Infinity;
  let now = 0;
  const fmt = (n: number): string => formatNumber(n, d.numSuffix);
  return {
    wire(sim) {
      const len = Math.max(1, sim.level.length);
      d.hud.setMountain({
        zones: d.getWorld().zones.map((z) => ({ from: z.zStart / len, to: z.zEnd / len, color: d.theme.rarity[z.rarity] ?? '#ffffff' })),
        walls: sim.level.gates.map((g) => g.z / len),
        caves: sim.level.niches.map((n) => n.z / len),
        faceUrl: d.faceUrl,
      });
      sim.events.on('gateOpen', () => void (openedAt = now));
      // Entering a new gift zone (Q-019: the place is announced): «Rare gifts» when the flag behind a wall starts a new zone.
      sim.events.on('checkpoint', ({ index }) => {
        const c = sim.level.checkpoints[index];
        const prev = sim.level.checkpoints[index - 1];
        if (c && prev && c.rarity !== prev.rarity) d.hud.toast(t(`zone.${c.rarity}`));
      });
      sim.events.on('gain', ({ amount }) => void (pendingPop = (pendingPop ?? 0) + amount));
    },
    update(timeSec) {
      now = timeSec;
      const sim = d.getSim();
      const level = sim.level;
      const len = Math.max(1, level.length);
      const stat = sim.progress.stat;
      d.hud.setStat(fmt(stat), t('hud.perStep', { n: fmt(d.balance.gainPerStep * sim.progress.gainMult) }));
      if (pendingPop !== null && timeSec - lastPopAt >= STAT_POP_MIN_SEC) {
        d.hud.popStatGain(`+${fmt(pendingPop)}`);
        pendingPop = null;
        lastPopAt = timeSec;
      }

      // Mountain bar: k/12 = open walls; the avalanche mark at the crack on warn and at the front while it runs.
      const open = sim.gatesOpen.filter(Boolean).length;
      const ts = sim.threat?.state;
      const wave = ts?.phase === 'warn' ? ts.spawnZ / len : ts?.phase === 'run' ? Math.max(0, ts.frontZ) / len : null;
      d.hud.updateMountain(t('hud.mountain', { a: level.worldIndex, b: open }), sim.hero.pos.z / len, wave, ts?.phase === 'warn' ? ts.shelter : -1);

      // Goal: the next closed wall with the count, «Wall open!» for 2 s, then the summit and the portal.
      const next = sim.gatesOpen.findIndex((o) => !o);
      if (timeSec - openedAt < GOAL_OPEN_SEC) d.hud.setGoal(t('hud.goal.open'), null);
      else if (next >= 0) {
        const req = sim.gateRequirement(next);
        d.hud.setGoal(t('hud.goal.wall', { n: fmt(req) }), { text: `${fmt(stat)}/${fmt(req)}`, frac: stat / req });
      } else {
        const summit = level.safeZones[level.safeZones.length - 1];
        const onSummit = level.safeZones.length > 1 && summit !== undefined && sim.hero.pos.z >= summit[0];
        d.hud.setGoal(t(onSummit ? 'hud.goal.portal' : 'hud.goal.summit'), null);
      }
    },
  };
}

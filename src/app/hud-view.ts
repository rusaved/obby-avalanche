// What: Per-frame core HUD: Speed plaque with +N per step, mountain bar (zones, walls, caves, avalanche mark), wall goal and the Wall open toast.
// Called by: main.ts (createHudView, wire on each new mountain, update every frame).
// Keep: Reads the sim, never changes it; texts via t(), numbers via formatNumber with numSuffix, colours from theme; wire(sim) must run for every new mountain.

/**
 * Core HUD each frame (docs/01-gdd.md 10.1, 10.4): Speed plaque with «+N per step», the mountain bar (zones, walls,
 * caves, the hero's face, the avalanche mark, the blinking cave on the warning), the goal «Wall 2K · 1.2K/2K» and
 * «Wall open!» for 2 s. Reads the simulation, never changes it.
 */
import type { BalanceJson, ThemeJson, World } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import { formatMult, formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';
import { levelProgress } from '../sim/levels.ts';

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
  /** On the base (docs/01-gdd.md 19.4): the goal «To the portal: {mountain}» instead of the bar and the wall; null — off it. */
  baseGoal?: () => string | null;
  /** A new level of the stat (docs/01-gdd.md 22.2): «Level up!», confetti and the chime — main.ts does the effects. */
  onLevelUp?: (level: number) => void;
}

export interface HudView {
  /** A new mountain: rebuilds the bar and subscribes to gains and gates. */
  wire(sim: Sim): void;
  update(timeSec: number): void;
}

export function createHudView(d: HudViewDeps): HudView {
  /** Goal line of the giant's check while it is closed (docs/01-gdd.md 17.6): his advice before the zone, the distance
   * to him inside it; false — no giant ahead. */
  const giantGoal = (sim: Sim): boolean => {
    const i = sim.level.gates.findIndex((g) => g.kind === 'boss');
    if (i < 0 || sim.gatesOpen[i] || !sim.boss) return false;
    const z = sim.hero.pos.z;
    const zone = sim.boss.zoneOf(z);
    if (zone >= 0) {
      const near = Math.min(...sim.boss.zones[zone]!.giants.map((g) => Math.abs(g.z - z)));
      d.hud.setGoal(t('boss.gap', { n: Math.round(near) }), null);
    } else {
      const req = sim.gateRequirement(i);
      const stat = sim.progress.stat;
      d.hud.setGoal(t((sim.level.bosses[0]?.giants.length ?? 0) >= 2 ? 'boss.signPair' : 'boss.sign', { n: fmt(req) }), { text: `${fmt(stat)}/${fmt(req)}`, frac: stat / req });
    }
    return true;
  };
  /** The level the bar showed last frame (0 — not yet): a rise is «Level up!». */
  let shownLevel = 0;
  let openedAt = -Infinity;
  /** The gate that opened last is a ridge of the open slope (docs/01-gdd.md 17.3): «Ridge open!». */
  let openedRidge = false;
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
      sim.events.on('gateOpen', ({ index }) => {
        // The giant's check has its own toast «You slipped past the giant!» (docs/01-gdd.md 17.6).
        if (sim.level.gates[index]?.kind === 'boss') return;
        openedAt = now;
        openedRidge = sim.level.gates[index]?.kind === 'ridge';
      });
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
      // Open slope: «×1.2 this section» by «+N per step» (docs/01-gdd.md 17.4); classic and fast have no sections.
      const section = level.sections.length > 0 ? t('hud.sectionMult', { n: formatMult(sim.sectionMult(), d.numSuffix) }) : null;
      // The blizzard doubles every step on its section (docs/01-gdd.md 18.4): the plaque shows it.
      const perStep = d.balance.gainPerStep * sim.progress.gainMult * (sim.rare?.stepMultAt(sim.hero.pos.z) ?? 1);
      d.hud.setStat(fmt(stat), t('hud.perStep', { n: fmt(perStep) }), section);
      // Level bar of the stages pace (docs/01-gdd.md 22.2); the other paces have no levels.
      const lv = d.balance.levels;
      if (lv) {
        const p = levelProgress(stat, lv);
        d.hud.setLevel({ title: t('level.bar', { n: p.level }), progress: `${fmt(p.have)} / ${fmt(p.need)}`, frac: p.frac });
        if (shownLevel > 0 && p.level > shownLevel) d.onLevelUp?.(p.level);
        shownLevel = p.level;
      } else d.hud.setLevel(null);
      d.hud.setSlow(sim.slow ? t('hud.slow', { n: formatMult(sim.slow.mult, d.numSuffix) }) : null);
      if (pendingPop !== null && timeSec - lastPopAt >= STAT_POP_MIN_SEC) {
        d.hud.popStatGain(`+${fmt(pendingPop)}`);
        pendingPop = null;
        lastPopAt = timeSec;
      }

      const baseGoal = d.baseGoal?.() ?? null;
      if (baseGoal !== null) {
        d.hud.setGoal(baseGoal, null);
        return;
      }
      // Mountain bar: k/n = open walls of the mountain; the avalanche mark at the crack on warn and at the front while it runs.
      const open = sim.gatesOpen.filter(Boolean).length;
      const ts = sim.threat?.state;
      const wave = ts?.phase === 'warn' ? ts.spawnZ / len : ts?.phase === 'run' ? Math.max(0, ts.frontZ) / len : null;
      // Open slope (docs/01a-content.md 16.9): «Mountain 1 · ridge 1/3» — ridges only, the giant has his own mark.
      const ridges = level.gates.filter((g) => g.kind === 'ridge').length;
      const label = ridges > 0
        ? t('summit.progress', { a: level.worldIndex, b: level.gates.filter((g, i) => g.kind === 'ridge' && sim.gatesOpen[i]).length, c: ridges })
        : t('hud.mountain', { a: level.worldIndex, b: open, c: level.gates.length });
      d.hud.updateMountain(label, sim.hero.pos.z / len, wave, ts?.phase === 'warn' ? ts.shelter : -1);

      // Goal: the next closed wall with the count, «Wall open!» for 2 s, then the summit and the portal.
      const next = sim.gatesOpen.findIndex((o, i) => !o && level.gates[i]?.kind !== 'boss');
      if (timeSec - openedAt < GOAL_OPEN_SEC) d.hud.setGoal(t(openedRidge ? 'ridge.open' : 'hud.goal.open'), null);
      else if (next >= 0) {
        const req = sim.gateRequirement(next);
        const key = level.gates[next]?.kind === 'ridge' ? 'ridge.goal' : 'hud.goal.wall';
        d.hud.setGoal(t(key, { n: fmt(req) }), { text: `${fmt(stat)}/${fmt(req)}`, frac: stat / req });
      } else if (!giantGoal(sim)) {
        const summit = level.safeZones[level.safeZones.length - 1];
        const onSummit = level.safeZones.length > 1 && summit !== undefined && sim.hero.pos.z >= summit[0];
        d.hud.setGoal(t(onSummit ? 'hud.goal.portal' : 'hud.goal.summit'), null);
      }
    },
  };
}

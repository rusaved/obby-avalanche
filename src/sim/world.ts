/**
 * Simulation of one mountain (docs/02-tech.md 4.2, 6.1): hero, checkpoints, fall and respawn.
 * Steps and the stat (M2-01, `steps.ts`): run speed follows the stat through the `moveSpeed` effect.
 * Gates that open (M2-02), the summit portal (M2-03), gifts and coins (M2-04), the avalanche (M2-05…M2-07),
 * coins for passing a gate and the free egg of the first minute (M2-08), the golden gift of the warning (M2-12).
 * Pure TS, no DOM, no rendering.
 */
import { createEmitter, type Emitter } from '../core/events.ts';
import type { LevelData } from '../level/types.ts';
import type { BalanceJson, Curve, TuningJson } from '../content/types.ts';
import { moveSpeed } from './effects/moveSpeed.ts';
import { createStepTracker, type StepGain, type StepTracker } from './steps.ts';
import { gateIsOpen, gateRequirement } from './gates.ts';
import { scaled } from './economy.ts';
import { giftsFromLevel, touchesGift, type Gift } from './gifts.ts';
import { createCollisionWorld, type CollisionWorld } from './collision.ts';
import { beltAt, belts, shelterIndex } from './shelter.ts';
import { createThreat, type Threat, type ThreatEvents, type ThreatOptions } from './threat.ts';
import { caughtPosition, caughtTotalSec, createCaught, type CaughtState } from './caught.ts';
import { createGiftEgg, stepGiftEgg, type GiftEggState } from './gift-egg.ts';
import { createMilestones, type Milestones } from './milestones.ts';
import { createBots, type BotContext, type BotCrowd, type BotsOptions } from './bots.ts';
import { placeBonus, touchesBonus, zoneAt, type BonusConfig, type BonusState } from './bonus.ts';
import { createRng } from '../core/rng.ts';
import { inSafeZone } from './shelter.ts';
import { PORTAL_HALF_WIDTH } from '../level/builder.ts';
import { createHero, placeHero, stepHero, type ControllerParams, type HeroInput, type HeroState, NO_INPUT } from './controller.ts';

export interface SimEvents extends Omit<ThreatEvents, 'waveSurvived'>, Record<string, unknown> {
  /**
   * «Phew, made it!» (docs/01-gdd.md 4.4): `coins` = coins.waveSurvived × gift of the cave's zone × wallScale[tier],
   * plus `gold` when the hero brought the golden gift into the cave (one toast, docs/01-gdd.md 4.9).
   */
  waveSurvived: ThreatEvents['waveSurvived'] & { coins: number; total: number; gold: number };
  /** Golden gift (docs/01-gdd.md 4.9): placed on warn, taken, saved (`coins` = mult × zone gift × wallScale) or lost. */
  bonusSpawn: { tick: number; x: number; y: number; z: number; zone: number };
  bonusTake: { tick: number; x: number; y: number; z: number };
  bonusSaved: { tick: number; coins: number; total: number; where: 'cave' | 'portal' | 'gone' };
  bonusLost: { tick: number; x: number; y: number; z: number };
  step: { tick: number };
  checkpoint: { index: number; z: number };
  fall: { tick: number; z: number };
  respawn: { tick: number; z: number; checkpoint: number };
  jump: { tick: number };
  land: { tick: number; airTime: number };
  /** One step taken: the stat grew by `amount` (docs/01-gdd.md 3.3); `belt` — taken on a treadmill belt. */
  gain: StepGain & { tick: number; belt: boolean };
  /** A gate melted open: the stat reached its requirement (docs/01-gdd.md 3.3). */
  gateOpen: { tick: number; index: number; wall: number; z: number; requires: number };
  /** The hero walked through an open gate for the first time: `coins` = gate reward × wallScale[tier] (docs/01-gdd.md 6.2, 10.3). */
  gatePass: { tick: number; index: number; wall: number; coins: number; total: number };
  /** The free egg (docs/01-gdd.md 6.2): touched, then the pet jumps out `ftue.eggHatchSec` later. */
  eggTouch: { tick: number };
  eggHatch: { tick: number; pet: string };
  /** The stat crossed a round number of balance.ui.statMilestones for the first time in this load (M2-13, no analytics). */
  statMilestone: { tick: number; value: number };
  /** A gift touched: `coins` added (zone gift × wallScale[tier]), `total` is the coin balance after it. */
  giftTake: { tick: number; index: number; coins: number; zone: number; rarity: string; total: number };
  /** All gifts back in place (after every avalanche, docs/01-gdd.md 3.2). */
  giftsRespawn: { tick: number; count: number };
  /** «Snowed in!» is over: the ball popped in a cave below (`niche`) or in the camp (−1), controls are back. */
  caughtEnd: { tick: number; sec: number; niche: number; x: number; y: number; z: number };
  /** The hero walked through the summit portal (docs/01-gdd.md 5.2): `next` is the next mountain index, null after the last. */
  portal: { tick: number; from: number; next: number | null };
}

export interface Sim {
  readonly hero: HeroState;
  readonly level: LevelData;
  readonly collision: CollisionWorld;
  readonly events: Emitter<SimEvents>;
  readonly params: ControllerParams;
  /** Stat, steps and the gain multiplier (M2-01). */
  readonly progress: StepTracker;
  /** Mutable: the debug panel re-applies tuning into it. */
  readonly speedCurve: Curve;
  /** Per gate of `level.gates`: open (melted) or still a collider. */
  readonly gatesOpen: boolean[];
  readonly tier: number;
  tick: number;
  checkpoint: number;
  /** -1 when not respawning; otherwise ticks left of the ≤0.5 s fade (docs/02-tech.md 6.1). */
  respawnTicksLeft: number;
  /** Gifts of this mountain (M2-04) and the coin balance. */
  readonly gifts: Gift[];
  coins: number;
  /** Puts every gift back (`balance.gifts.respawn: "onWaveGone"`). */
  respawnGifts(): void;
  /** The avalanche of this mountain (M2-06); null when the sim runs without a threat (unit tests of other parts). */
  readonly threat: Threat | null;
  /** «Snowed in!» clip in progress (M2-07): the hero is a snowball, no control; null otherwise. */
  caught: CaughtState | null;
  /** Per gate: the hero has walked through it after it opened (coins paid once per gate). */
  readonly gatesPassed: boolean[];
  /** The free egg «Mountain Gift» in its cave (M2-08); null when the player already has it or on other mountains. */
  readonly giftEgg: GiftEggState | null;
  /** Round numbers of the stat already celebrated (M2-13); `reset` after a rebirth. */
  readonly milestones: Milestones;
  /** Bots on the track (M2-10); null when the sim runs without them. */
  readonly bots: BotCrowd | null;
  /** Golden gift of this wave (M2-12): on the ground or carried by the hero; null when there is none. */
  bonus: BonusState | null;
  /** __TEST__.giveBonus(): the hero carries a golden gift now (only with threat.bonus in the data, on warn or run). */
  giveBonus(): boolean;
  /** True once the hero has walked through the portal of this mountain (one `portal` event per sim). */
  portalEntered: boolean;
  step(input: HeroInput, dt: number): void;
  teleport(x: number, y: number, z: number): void;
  respawn(): void;
  /** Treadmill multiplier of the belt the hero stands on, 1 on plain ground (docs/02-tech.md 5.3). */
  treadmillAt(): number;
  /** The hero stands on a treadmill belt: he runs in place by himself, steps count at run speed (M2-05). */
  onBelt: boolean;
  /** Index of the cave sheltering the hero (cave volume + niche.graceDist past the entrance), −1 outside. */
  shelterIndex(): number;
  inShelter(): boolean;
  /** Requirement of gate `index` on this tier (docs/01-gdd.md 8.1). */
  gateRequirement(index: number): number;
}

export interface SimOptions {
  balance: Pick<BalanceJson, 'stepLength' | 'gainPerStep' | 'rebirth'> & {
    gifts?: BalanceJson['gifts'];
    niche?: BalanceJson['niche'];
    coins?: BalanceJson['coins'];
    caught?: BalanceJson['caught'];
    ui?: Partial<BalanceJson['ui']>;
  };
  /** The avalanche (docs/02-tech.md 8.1): world threat, balance and tuning, save counters. */
  threat?: ThreatOptions;
  /** Coins carried in (portal to the next mountain). */
  coins?: number;
  /** Rebirth tier n (0 at the start). */
  tier?: number;
  /** Stat → run speed (docs/02-tech.md 6.1): base and max from tuning, k from balance. */
  speedCurve: Curve;
  stat?: number;
  /** Step multiplier of the meta (shoes × pets, docs/01-gdd.md 8.1): set by the meta layer, 1 by default. */
  gainMult?: number;
  /** The free egg of the first minute: placed beside the belt of cave `wall`; omitted once the player has it; `shown`
   * false — not there until the app shows it after the scripted wave (docs/01-gdd.md 16.6). */
  giftEgg?: { wall: number; pet: string; hatchSec: number; shown?: boolean } | undefined;
  /** Bots (docs/01-gdd.md 7.12): bots.json, how many for the quality level and the seed; caught and avalanche come from here. */
  bots?: Pick<BotsOptions, 'cfg' | 'count' | 'seed'> | undefined;
  /** Golden gift (docs/01-gdd.md 4.9): game.json threat.bonus, the seed, normal waves of this load before this mountain. */
  bonus?: { cfg: BonusConfig; seed: number; wavesBefore: number } | undefined;
  /**
   * Back after F5 or another day (docs/01-gdd.md 6.6, M3-07): walls up to `frontierWall` are passed (no coins again),
   * every wall the stat reaches stands open from the start, the hero stands at the flag behind `frontierWall`.
   */
  resume?: { frontierWall: number } | undefined;
}

export const RESPAWN_FADE_TICKS = 18;
/** The hero is past a gate when his centre is this far beyond its plane. */
const GATE_PASS_DIST = 1;

export function controllerParams(tuning: TuningJson, speed: number): ControllerParams {
  const c = tuning.controller;
  return {
    speed,
    accelSec: c.accel,
    decelSec: c.decel,
    airControl: c.airControl,
    jumpSpeed: c.jumpSpeed,
    gravity: c.gravity,
    fallMult: c.fallMult,
    coyoteSec: c.coyoteSec,
    jumpBufferSec: c.jumpBufferSec,
    variableJump: c.variableJump,
    stepUp: c.stepUp,
  };
}

export function createSim(level: LevelData, tuning: TuningJson, opts: SimOptions): Sim {
  const collision = createCollisionWorld(level.staticTriangles);
  const gatesOpen = level.gates.map(() => false);
  const tier = opts.tier ?? 0;
  const syncGates = (): void => collision.setDynamicBoxes(level.gates.filter((_, i) => !gatesOpen[i]).map((g) => g.box));
  syncGates();
  const hero = createHero(level.spawn);
  const events = createEmitter<SimEvents>();
  if ((opts.balance.gifts?.respawn ?? 'onWaveGone') === 'onWaveGone') events.on('waveGone', () => sim.respawnGifts());
  const progress = createStepTracker(opts.balance, opts.stat ?? 0);
  progress.gainMult = opts.gainMult ?? 1;
  const speedCurve: Curve = { ...opts.speedCurve };
  const params = controllerParams(tuning, moveSpeed(progress.stat, speedCurve));
  const prev = { x: hero.pos.x, z: hero.pos.z, onGround: hero.onGround };
  const portal = level.points.find((p) => p.type === 'portal');
  const portalNext = typeof portal?.['next'] === 'number' ? (portal['next'] as number) : null;
  const beltList = belts(level);
  const heroView = { x: 0, y: 0, z: 0, vx: 0, vz: 0 };
  const graceDist = opts.balance.niche?.graceDist ?? 0;

  const sim: Sim = {
    hero,
    level,
    collision,
    events,
    params,
    progress,
    speedCurve,
    gatesOpen,
    gatesPassed: level.gates.map(() => false),
    milestones: createMilestones(opts.balance.ui?.statMilestones ?? [], opts.stat ?? 0),
    giftEgg: opts.giftEgg ? createGiftEgg(level, opts.giftEgg.wall, opts.giftEgg.pet, opts.giftEgg.hatchSec, opts.giftEgg.shown ?? true) : null,
    tier,
    tick: 0,
    checkpoint: -1,
    respawnTicksLeft: -1,
    portalEntered: false,
    onBelt: false,
    threat: null,
    bots: null,
    bonus: null,
    caught: null,
    gifts: giftsFromLevel(level),
    coins: opts.coins ?? 0,
    respawnGifts() {
      for (const gift of sim.gifts) gift.taken = false;
      events.emit('giftsRespawn', { tick: sim.tick, count: sim.gifts.length });
    },
    step(input, dt) {
      sim.tick++;
      if (threat) {
        heroView.x = hero.pos.x;
        heroView.y = hero.pos.y;
        heroView.z = hero.pos.z;
        heroView.vx = hero.vel.x;
        heroView.vz = hero.vel.z;
        threat.step(dt, heroView, gatesOpen, sim.tick);
        // Not taken before the front reached its point: it melts, no event (docs/01-gdd.md 4.9).
        const b = sim.bonus;
        if (b && !b.carried && threat.state.phase === 'run' && threat.state.frontZ <= b.z) sim.bonus = null;
      }
      if (bots) {
        botCtx.hero.x = hero.pos.x;
        botCtx.hero.z = hero.pos.z;
        botCtx.flagZ = level.checkpoints[sim.checkpoint]?.z ?? level.spawn[2];
        bots.step(dt, botCtx);
      }
      if (sim.caught) {
        stepCaught(dt);
        events.emit('step', { tick: sim.tick });
        return;
      }
      if (sim.respawnTicksLeft >= 0) {
        sim.respawnTicksLeft--;
        if (sim.respawnTicksLeft < 0) sim.respawn();
        stepHero(hero, NO_INPUT, dt, collision, params, level.killY);
        events.emit('step', { tick: sim.tick });
        return;
      }
      const zBefore = hero.pos.z;
      stepHero(hero, input, dt, collision, params, level.killY);
      // Portal: the hero crosses the arch plane inside its opening (docs/01-gdd.md 5.2).
      if (portal && !sim.portalEntered && zBefore < portal.z && hero.pos.z >= portal.z && Math.abs(hero.pos.x - portal.x) <= PORTAL_HALF_WIDTH) {
        sim.portalEntered = true;
        if (sim.bonus?.carried) saveBonus('portal');
        events.emit('portal', { tick: sim.tick, from: level.worldIndex, next: portalNext });
      }
      // Gifts: a touch takes the gift and pays the coins of its zone (docs/01-gdd.md 3.2).
      sim.gifts.forEach((gift, index) => {
        if (gift.taken || Math.abs(gift.z - hero.pos.z) > 3 || !touchesGift(gift, hero.pos.x, hero.pos.y, hero.pos.z)) return;
        gift.taken = true;
        const coins = scaled(gift.coins, tier, opts.balance.rebirth);
        sim.coins += coins;
        events.emit('giftTake', { tick: sim.tick, index, coins, zone: gift.zone, rarity: gift.rarity, total: sim.coins });
      });
      // Golden gift: a touch on warn or run and the hero carries it over his head.
      const bonus = sim.bonus;
      if (bonus && !bonus.carried && (threat?.state.phase === 'warn' || threat?.state.phase === 'run') && touchesBonus(bonus, hero.pos.x, hero.pos.y, hero.pos.z)) {
        bonus.carried = true;
        events.emit('bonusTake', { tick: sim.tick, x: bonus.x, y: bonus.y, z: bonus.z });
      }
      // Steps: horizontal path while on the ground before and after the tick; the air and the landing tick count nothing.
      // On a belt the belt runs under the hero at his run speed: he runs in place by himself (docs/02-tech.md 5.3).
      const belt = hero.onGround ? beltAt(beltList, hero.pos.x, hero.pos.y, hero.pos.z) : null;
      sim.onBelt = belt !== null;
      if (hero.onGround && prev.onGround && !hero.jumpedThisTick) {
        const dx = hero.pos.x - prev.x;
        const dz = hero.pos.z - prev.z;
        const path = belt ? params.speed * dt : Math.hypot(dx, dz);
        const mult = belt && typeof belt['mult'] === 'number' ? (belt['mult'] as number) : 1;
        for (const gain of progress.advance(path, mult)) events.emit('gain', { ...gain, tick: sim.tick, belt: belt !== null });
        params.speed = moveSpeed(progress.stat, speedCurve);
      } else if (!hero.onGround) progress.resetCarry();
      // A round number of the stat (docs/01-gdd.md 10.4): one event with the biggest value crossed.
      const milestone = sim.milestones.check(progress.stat);
      if (milestone !== null) events.emit('statMilestone', { tick: sim.tick, value: milestone });
      prev.x = hero.pos.x;
      prev.z = hero.pos.z;
      prev.onGround = hero.onGround;
      // Gates: the number is all that matters; an open gate stays open until rebirth (docs/01-gdd.md 3.3).
      let opened = false;
      level.gates.forEach((gate, i) => {
        if (gatesOpen[i] || !gateIsOpen(progress.stat, sim.gateRequirement(i))) return;
        gatesOpen[i] = true;
        opened = true;
        events.emit('gateOpen', { tick: sim.tick, index: i, wall: gate.index, z: gate.z, requires: sim.gateRequirement(i) });
      });
      if (opened) syncGates();
      // Passing an open gate pays its coins once (the flag rises, coins fly into the plaque; docs/01-gdd.md 10.3).
      level.gates.forEach((gate, i) => {
        if (!gatesOpen[i] || sim.gatesPassed[i] || zBefore >= gate.z + GATE_PASS_DIST || hero.pos.z < gate.z + GATE_PASS_DIST) return;
        sim.gatesPassed[i] = true;
        const coins = scaled(gate.rewardCoins, tier, opts.balance.rebirth);
        sim.coins += coins;
        events.emit('gatePass', { tick: sim.tick, index: i, wall: gate.index, coins, total: sim.coins });
      });
      // The free egg: a touch starts the hatch, the pet jumps out after eggHatchSec (docs/01-gdd.md 6.2).
      if (sim.giftEgg) {
        const r = stepGiftEgg(sim.giftEgg, hero.pos.x, hero.pos.y, hero.pos.z, dt);
        if (r === 'touch') events.emit('eggTouch', { tick: sim.tick });
        else if (r === 'hatch') events.emit('eggHatch', { tick: sim.tick, pet: sim.giftEgg.pet });
      }
      if (hero.jumpedThisTick) events.emit('jump', { tick: sim.tick });
      if (hero.landedThisTick) events.emit('land', { tick: sim.tick, airTime: hero.airTime });
      // Checkpoints: the flag behind the last wall passed (highest z reached on the ground).
      for (let i = level.checkpoints.length - 1; i > sim.checkpoint; i--) {
        const c = level.checkpoints[i];
        if (c && hero.pos.z >= c.z && hero.onGround) {
          sim.checkpoint = i;
          events.emit('checkpoint', { index: i, z: c.z });
          break;
        }
      }
      if (hero.pos.y < level.killY) {
        events.emit('fall', { tick: sim.tick, z: hero.pos.z });
        sim.respawnTicksLeft = RESPAWN_FADE_TICKS;
      }
      events.emit('step', { tick: sim.tick });
    },
    teleport(x, y, z) {
      sim.caught = null;
      placeHero(hero, x, y, z);
      progress.resetCarry();
      prev.onGround = false;
    },
    gateRequirement(index) {
      const gate = level.gates[index];
      return gate ? gateRequirement(gate.requires, level.worldIndex, gate.index, tier, opts.balance.rebirth) : Infinity;
    },
    treadmillAt() {
      const belt = beltAt(beltList, hero.pos.x, hero.pos.y, hero.pos.z);
      return belt && typeof belt['mult'] === 'number' ? (belt['mult'] as number) : 1;
    },
    shelterIndex() {
      return shelterIndex(level, graceDist, hero.pos.x, hero.pos.y, hero.pos.z);
    },
    inShelter() {
      return sim.shelterIndex() >= 0;
    },
    giveBonus() {
      const phase = threat?.state.phase;
      if (!bonusCfg || (phase !== 'warn' && phase !== 'run')) return false;
      if (sim.bonus?.carried) return true;
      const p = hero.pos;
      sim.bonus ??= { x: p.x, y: p.y, z: p.z, zone: zoneAt(level, p.z), carried: false };
      sim.bonus.carried = true;
      events.emit('bonusTake', { tick: sim.tick, x: sim.bonus.x, y: sim.bonus.y, z: sim.bonus.z });
      return true;
    },
    respawn() {
      const c = level.checkpoints[sim.checkpoint];
      const target: [number, number, number] = c ? [c.x, c.y, c.z] : level.spawn;
      placeHero(hero, target[0], target[1] + 0.05, target[2]);
      hero.yaw = 0;
      progress.resetCarry();
      prev.onGround = false;
      sim.respawnTicksLeft = -1;
      events.emit('respawn', { tick: sim.tick, z: target[2], checkpoint: sim.checkpoint });
    },
  };
  // The avalanche emits through the sim bus; «Phew, made it!» pays coins first (docs/01-gdd.md 4.4).
  const zoneGift = new Map<number, number>();
  for (const gift of sim.gifts) if (!zoneGift.has(gift.zone)) zoneGift.set(gift.zone, gift.coins);
  // Golden gift (docs/01-gdd.md 4.9): worth mult gifts of the zone where it lay.
  const bonusCfg = opts.bonus?.cfg ?? null;
  const bonusRng = createRng(opts.bonus?.seed ?? 0);
  const goldCoins = (b: BonusState): number => scaled((bonusCfg?.mult ?? 0) * (zoneGift.get(b.zone) ?? 0), tier, opts.balance.rebirth);
  const saveBonus = (where: 'cave' | 'portal' | 'gone', coins?: number): void => {
    const b = sim.bonus;
    sim.bonus = null;
    if (!b) return;
    const gold = coins ?? goldCoins(b);
    if (coins === undefined) sim.coins += gold;
    events.emit('bonusSaved', { tick: sim.tick, coins: gold, total: sim.coins, where });
  };
  const onWarn = (p: ThreatEvents['waveWarn']): void => {
    sim.bonus = null;
    if (!bonusCfg || p.scripted || (opts.bonus?.wavesBefore ?? 0) + p.normalWaves < bonusCfg.fromWave) return;
    // In the camp or on the summit at the start of the warning: no gift this wave.
    if (inSafeZone(level, hero.pos.z) || p.shelter < 0) return;
    sim.bonus = placeBonus(level, bonusCfg, gatesOpen, p.shelter, bonusRng);
    if (sim.bonus) events.emit('bonusSpawn', { tick: p.tick, x: sim.bonus.x, y: sim.bonus.y, z: sim.bonus.z, zone: sim.bonus.zone });
  };
  const threat = opts.threat
    ? createThreat(level, opts.threat, (name, payload) => {
        if (name === 'waveSurvived') {
          const p = payload as ThreatEvents['waveSurvived'];
          const zone = level.niches[p.niche]?.zone ?? 0;
          let coins = scaled((opts.balance.coins?.waveSurvived ?? 0) * (zoneGift.get(zone) ?? 0), tier, opts.balance.rebirth);
          // The golden gift brought into the cave: one toast with both rewards (docs/01-gdd.md 4.9).
          const gold = sim.bonus?.carried ? goldCoins(sim.bonus) : 0;
          coins += gold;
          sim.coins += coins;
          events.emit('waveSurvived', { ...p, coins, total: sim.coins, gold });
          if (gold > 0) saveBonus('cave', gold);
          return;
        }
        (events.emit as (n: string, p: unknown) => void)(name, payload);
        if (name === 'waveWarn') onWarn(payload as ThreatEvents['waveWarn']);
        else if (name === 'waveCaught' && sim.bonus?.carried) {
          // Snowed in with the gift: it pops, nothing else is lost (a gift left on the ground melts with the front).
          sim.bonus = null;
          events.emit('bonusLost', { tick: sim.tick, x: hero.pos.x, y: hero.pos.y, z: hero.pos.z });
        } else if (name === 'waveGone') {
          // The camp, the summit or a slope the front never reached: the carried gift counts now.
          if (sim.bonus?.carried) saveBonus('gone');
          sim.bonus = null;
        }
      })
    : null;
  (sim as { threat: Threat | null }).threat = threat;

  // Bots (M2-10): speed of the hero on the stretch under them — the stat that opened the wall below (docs/01a 12).
  const bots = opts.bots
    ? createBots(level, {
        ...opts.bots,
        caught: opts.balance.caught,
        avalanche: tuning.avalanche,
        graceDist,
      })
    : null;
  const stretchSpeed = (z: number): number => {
    let below = -1;
    level.gates.forEach((g, i) => {
      if (g.z <= z) below = i;
    });
    return moveSpeed(below < 0 ? 0 : sim.gateRequirement(below), speedCurve);
  };
  const botCtx: BotContext = { hero: { x: 0, z: 0 }, flagZ: level.spawn[2], gatesOpen, threat: threat ? threat.state : null, speedAt: stretchSpeed };
  (sim as { bots: BotCrowd | null }).bots = bots;

  if (opts.resume) {
    const front = opts.resume.frontierWall;
    level.gates.forEach((gate, i) => {
      if (gate.index <= front) sim.gatesPassed[i] = true;
      if (gate.index <= front || gateIsOpen(progress.stat, sim.gateRequirement(i))) gatesOpen[i] = true;
    });
    syncGates();
    const flag = level.checkpoints.findIndex((c) => c.wall === front);
    const c = level.checkpoints[flag];
    if (c) {
      sim.checkpoint = flag;
      placeHero(hero, c.x, c.y + 0.05, c.z);
      hero.yaw = 0;
      prev.x = hero.pos.x;
      prev.z = hero.pos.z;
    }
  }

  // «Snowed in!» (docs/01-gdd.md 4.5): the ball rolls to the cave below; stat, coins and gates stay as they are.
  const ballPos = { x: 0, y: 0, z: 0 };
  const stepCaught = (dt: number): void => {
    const c = sim.caught!;
    c.t += dt;
    caughtPosition(c, level, tuning.avalanche.ballBounce, ballPos);
    hero.pos.set(ballPos.x, ballPos.y, ballPos.z);
    hero.vel.set(0, 0, 0);
    hero.speed = 0;
    hero.onGround = true;
    if (c.t >= caughtTotalSec(c) - 1e-9) {
      sim.caught = null;
      placeHero(hero, c.to.x, c.to.y + 0.05, c.to.z);
      progress.resetCarry();
      prev.onGround = false;
      events.emit('caughtEnd', { tick: sim.tick, sec: c.t, niche: c.niche, x: c.to.x, y: c.to.y, z: c.to.z });
    }
  };
  if (threat && opts.balance.caught) {
    const caughtCfg = opts.balance.caught;
    events.on('waveCaught', ({ x, y, z }) => {
      if (sim.respawnTicksLeft >= 0) sim.respawnTicksLeft = -1;
      sim.caught = createCaught(level, { x, y, z }, caughtCfg, tuning.avalanche);
    });
  }
  return sim;
}

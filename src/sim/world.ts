/**
 * Simulation of one mountain (docs/02-tech.md 4.2, 6.1): hero, checkpoints, fall and respawn.
 * Steps and the stat (M2-01, `steps.ts`): run speed follows the stat through the `moveSpeed` effect.
 * Gates that open (M2-02), the summit portal (M2-03), gifts and coins (M2-04); the avalanche arrives with M2-05…M2-07. Pure TS, no DOM, no rendering.
 */
import { createEmitter, type Emitter } from '../core/events.ts';
import type { LevelData } from '../level/types.ts';
import type { BalanceJson, Curve, TuningJson } from '../content/types.ts';
import { moveSpeed } from './effects/moveSpeed.ts';
import { createStepTracker, type StepGain, type StepTracker } from './steps.ts';
import { gateIsOpen, gateRequirement, wallScale } from './gates.ts';
import { giftsFromLevel, touchesGift, type Gift } from './gifts.ts';
import { createCollisionWorld, type CollisionWorld } from './collision.ts';
import { beltAt, belts, shelterIndex } from './shelter.ts';
import { createThreat, type Threat, type ThreatEvents, type ThreatOptions } from './threat.ts';
import { caughtPosition, caughtTotalSec, createCaught, type CaughtState } from './caught.ts';
import { PORTAL_HALF_WIDTH } from '../level/builder.ts';
import { createHero, placeHero, stepHero, type ControllerParams, type HeroInput, type HeroState, NO_INPUT } from './controller.ts';

export interface SimEvents extends Omit<ThreatEvents, 'waveSurvived'>, Record<string, unknown> {
  /** «Phew, made it!» (docs/01-gdd.md 4.4): `coins` = coins.waveSurvived × gift of the cave's zone × wallScale[tier]. */
  waveSurvived: ThreatEvents['waveSurvived'] & { coins: number; total: number };
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
}

export const RESPAWN_FADE_TICKS = 18;

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
    tier,
    tick: 0,
    checkpoint: -1,
    respawnTicksLeft: -1,
    portalEntered: false,
    onBelt: false,
    threat: null,
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
        events.emit('portal', { tick: sim.tick, from: level.worldIndex, next: portalNext });
      }
      // Gifts: a touch takes the gift and pays the coins of its zone (docs/01-gdd.md 3.2).
      sim.gifts.forEach((gift, index) => {
        if (gift.taken || Math.abs(gift.z - hero.pos.z) > 3 || !touchesGift(gift, hero.pos.x, hero.pos.y, hero.pos.z)) return;
        gift.taken = true;
        const coins = gift.coins * wallScale(tier, opts.balance.rebirth);
        sim.coins += coins;
        events.emit('giftTake', { tick: sim.tick, index, coins, zone: gift.zone, rarity: gift.rarity, total: sim.coins });
      });
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
  const threat = opts.threat
    ? createThreat(level, opts.threat, (name, payload) => {
        if (name === 'waveSurvived') {
          const p = payload as ThreatEvents['waveSurvived'];
          const zone = level.niches[p.niche]?.zone ?? 0;
          const coins = (opts.balance.coins?.waveSurvived ?? 0) * (zoneGift.get(zone) ?? 0) * wallScale(tier, opts.balance.rebirth);
          sim.coins += coins;
          events.emit('waveSurvived', { ...p, coins, total: sim.coins });
          return;
        }
        (events.emit as (n: string, p: unknown) => void)(name, payload);
      })
    : null;
  (sim as { threat: Threat | null }).threat = threat;

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

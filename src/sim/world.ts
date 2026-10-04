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
import { PORTAL_HALF_WIDTH } from '../level/builder.ts';
import { createHero, placeHero, stepHero, type ControllerParams, type HeroInput, type HeroState, NO_INPUT } from './controller.ts';

export interface SimEvents extends Record<string, unknown> {
  step: { tick: number };
  checkpoint: { index: number; z: number };
  fall: { tick: number; z: number };
  respawn: { tick: number; z: number; checkpoint: number };
  jump: { tick: number };
  land: { tick: number; airTime: number };
  /** One step taken: the stat grew by `amount` (docs/01-gdd.md 3.3). */
  gain: StepGain & { tick: number };
  /** A gate melted open: the stat reached its requirement (docs/01-gdd.md 3.3). */
  gateOpen: { tick: number; index: number; wall: number; z: number; requires: number };
  /** A gift touched: `coins` added (zone gift × wallScale[tier]), `total` is the coin balance after it. */
  giftTake: { tick: number; index: number; coins: number; zone: number; rarity: string; total: number };
  /** All gifts back in place (after every avalanche, docs/01-gdd.md 3.2). */
  giftsRespawn: { tick: number; count: number };
  /** The avalanche melted at the camp (phase `gone`, docs/02-tech.md 8.1); the threat emits it from M2-06. */
  waveGone: { tick: number };
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
  /** True once the hero has walked through the portal of this mountain (one `portal` event per sim). */
  portalEntered: boolean;
  step(input: HeroInput, dt: number): void;
  teleport(x: number, y: number, z: number): void;
  respawn(): void;
  /** Treadmill multiplier of the niche the hero stands in, 1 on plain ground (docs/02-tech.md 5.3). */
  treadmillAt(): number;
  /** Requirement of gate `index` on this tier (docs/01-gdd.md 8.1). */
  gateRequirement(index: number): number;
}

export interface SimOptions {
  balance: Pick<BalanceJson, 'stepLength' | 'gainPerStep' | 'rebirth'> & { gifts?: BalanceJson['gifts'] };
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
  const inBox = (b: { min: readonly number[]; max: readonly number[] }, x: number, y: number, z: number): boolean =>
    x >= b.min[0]! && x <= b.max[0]! && y >= b.min[1]! - 0.5 && y <= b.max[1]! && z >= b.min[2]! && z <= b.max[2]!;

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
    gifts: giftsFromLevel(level),
    coins: opts.coins ?? 0,
    respawnGifts() {
      for (const gift of sim.gifts) gift.taken = false;
      events.emit('giftsRespawn', { tick: sim.tick, count: sim.gifts.length });
    },
    step(input, dt) {
      sim.tick++;
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
      if (hero.onGround && prev.onGround && !hero.jumpedThisTick) {
        const dx = hero.pos.x - prev.x;
        const dz = hero.pos.z - prev.z;
        for (const gain of progress.advance(Math.hypot(dx, dz), sim.treadmillAt())) events.emit('gain', { ...gain, tick: sim.tick });
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
      placeHero(hero, x, y, z);
      progress.resetCarry();
      prev.onGround = false;
    },
    gateRequirement(index) {
      const gate = level.gates[index];
      return gate ? gateRequirement(gate.requires, level.worldIndex, gate.index, tier, opts.balance.rebirth) : Infinity;
    },
    treadmillAt() {
      for (const n of level.niches) if (n.treadmill > 1 && inBox(n.box, hero.pos.x, hero.pos.y, hero.pos.z)) return n.treadmill;
      return 1;
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
  return sim;
}

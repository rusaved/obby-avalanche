/**
 * Simulation of one mountain (docs/02-tech.md 4.2, 6.1): hero, checkpoints, fall and respawn.
 * The avalanche, steps and gates that open arrive at M2. Pure TS, no DOM, no rendering.
 */
import { createEmitter, type Emitter } from '../core/events.ts';
import type { LevelData } from '../level/types.ts';
import type { TuningJson } from '../content/types.ts';
import { createCollisionWorld, type CollisionWorld } from './collision.ts';
import { createHero, placeHero, stepHero, type ControllerParams, type HeroInput, type HeroState, NO_INPUT } from './controller.ts';

export interface SimEvents extends Record<string, unknown> {
  step: { tick: number };
  checkpoint: { index: number; z: number };
  fall: { tick: number; z: number };
  respawn: { tick: number; z: number; checkpoint: number };
  jump: { tick: number };
  land: { tick: number; airTime: number };
}

export interface Sim {
  readonly hero: HeroState;
  readonly level: LevelData;
  readonly collision: CollisionWorld;
  readonly events: Emitter<SimEvents>;
  readonly params: ControllerParams;
  tick: number;
  checkpoint: number;
  /** -1 when not respawning; otherwise ticks left of the ≤0.5 s fade (docs/02-tech.md 6.1). */
  respawnTicksLeft: number;
  step(input: HeroInput, dt: number): void;
  teleport(x: number, y: number, z: number): void;
  respawn(): void;
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

export function createSim(level: LevelData, tuning: TuningJson, speed: number): Sim {
  const collision = createCollisionWorld(level.staticTriangles);
  collision.setDynamicBoxes(level.gates.map((g) => g.box));
  const hero = createHero(level.spawn);
  const events = createEmitter<SimEvents>();
  const params = controllerParams(tuning, speed);

  const sim: Sim = {
    hero,
    level,
    collision,
    events,
    params,
    tick: 0,
    checkpoint: -1,
    respawnTicksLeft: -1,
    step(input, dt) {
      sim.tick++;
      if (sim.respawnTicksLeft >= 0) {
        sim.respawnTicksLeft--;
        if (sim.respawnTicksLeft < 0) sim.respawn();
        stepHero(hero, NO_INPUT, dt, collision, params, level.killY);
        events.emit('step', { tick: sim.tick });
        return;
      }
      stepHero(hero, input, dt, collision, params, level.killY);
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
    },
    respawn() {
      const c = level.checkpoints[sim.checkpoint];
      const target: [number, number, number] = c ? [c.x, c.y, c.z] : level.spawn;
      placeHero(hero, target[0], target[1] + 0.05, target[2]);
      hero.yaw = 0;
      sim.respawnTicksLeft = -1;
      events.emit('respawn', { tick: sim.tick, z: target[2], checkpoint: sim.checkpoint });
    },
  };
  return sim;
}

/**
 * Kinematic hero controller (docs/02-tech.md 6.1): capsule against the Octree, fixed step, substeps,
 * coyote time and jump buffer, step-up, slope limit. Pure TS, deterministic, runs in Node.
 */
import { Vector3 } from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import type { CollisionWorld } from './collision.ts';

export const HERO_HEIGHT = 5;
export const HERO_RADIUS = 1;
export const SLOPE_MIN_NY = 0.6;
export const MAX_SUBSTEPS = 8;
export const GROUND_SNAP = 0.35;
/** Contact normal accepted while lowering a raised capsule: a rounded edge gives steep normals near a ledge. */
export const STEP_ACCEPT_NY = 0.3;
export const FACE_TURN_RATE = 12;

export interface ControllerParams {
  /** Current max run speed (stat effect output), units/s. */
  speed: number;
  accelSec: number;
  decelSec: number;
  airControl: number;
  jumpSpeed: number;
  gravity: number;
  fallMult: number;
  coyoteSec: number;
  jumpBufferSec: number;
  variableJump: boolean;
  stepUp: number;
}

export interface HeroInput {
  /** World-space move direction (already rotated by controlYaw), length 0–1. */
  moveX: number;
  moveZ: number;
  /** Jump pressed on this tick (edge). */
  jump: boolean;
  jumpHeld: boolean;
}

export const NO_INPUT: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };

export interface HeroState {
  /** Feet position. */
  pos: Vector3;
  vel: Vector3;
  onGround: boolean;
  groundNormal: Vector3;
  /** Facing angle (radians, around +Y, 0 = +Z). */
  yaw: number;
  coyoteLeft: number;
  jumpBufferLeft: number;
  jumpedThisTick: boolean;
  landedThisTick: boolean;
  airTime: number;
  /** Distance travelled on the ground this tick (for step counting at M2). */
  groundDist: number;
  speed: number;
}

export function createHero(spawn: readonly [number, number, number]): HeroState {
  return {
    pos: new Vector3(spawn[0], spawn[1], spawn[2]),
    vel: new Vector3(),
    onGround: false,
    groundNormal: new Vector3(0, 1, 0),
    yaw: 0,
    coyoteLeft: 0,
    jumpBufferLeft: 0,
    jumpedThisTick: false,
    landedThisTick: false,
    airTime: 0,
    groundDist: 0,
    speed: 0,
  };
}

export function heroCapsule(pos: Vector3, out = new Capsule()): Capsule {
  out.start.set(pos.x, pos.y + HERO_RADIUS, pos.z);
  out.end.set(pos.x, pos.y + HERO_HEIGHT - HERO_RADIUS, pos.z);
  out.radius = HERO_RADIUS;
  return out;
}

const _capsule = new Capsule();
const _probe = new Capsule();
const _move = new Vector3();
const _tmp = new Vector3();
const _n = new Vector3();

function resolve(world: CollisionWorld, capsule: Capsule, vel: Vector3): { onGround: boolean; normal: Vector3 | null } {
  let onGround = false;
  let normal: Vector3 | null = null;
  // Up to 3 iterations: a corner can need two pushes.
  for (let i = 0; i < 3; i++) {
    const hit = world.capsuleHit(capsule);
    if (!hit) break;
    _n.copy(hit.normal);
    if (hit.depth > 1e-9) capsule.translate(_tmp.copy(_n).multiplyScalar(hit.depth));
    const into = _n.dot(vel);
    if (_n.y >= SLOPE_MIN_NY) {
      onGround = true;
      normal = _n.clone();
      if (into < 0) vel.addScaledVector(_n, -into);
    } else {
      if (into < 0) vel.addScaledVector(_n, -into);
      if (!normal) normal = _n.clone();
    }
    if (hit.depth < 1e-6) break;
  }
  return { onGround, normal };
}

/** One simulation tick of `dt` seconds. */
export function stepHero(hero: HeroState, input: HeroInput, dt: number, world: CollisionWorld, p: ControllerParams, killY: number): void {
  hero.jumpedThisTick = false;
  hero.landedThisTick = false;
  hero.groundDist = 0;
  const wasOnGround = hero.onGround;

  // Timers (docs/02-tech.md 6.1: coyote 0.10 s, buffer 0.12 s).
  if (hero.onGround) hero.coyoteLeft = p.coyoteSec;
  else hero.coyoteLeft = Math.max(0, hero.coyoteLeft - dt);
  if (input.jump) hero.jumpBufferLeft = p.jumpBufferSec;
  else hero.jumpBufferLeft = Math.max(0, hero.jumpBufferLeft - dt);

  // Horizontal velocity towards the wanted direction with accel/decel, 75% in the air.
  const wantX = input.moveX * p.speed;
  const wantZ = input.moveZ * p.speed;
  const moving = input.moveX !== 0 || input.moveZ !== 0;
  const rate = (moving ? p.speed / Math.max(1e-3, p.accelSec) : p.speed / Math.max(1e-3, p.decelSec)) * (hero.onGround ? 1 : p.airControl);
  const dx = wantX - hero.vel.x;
  const dz = wantZ - hero.vel.z;
  const dl = Math.hypot(dx, dz);
  const maxDelta = rate * dt;
  if (dl <= maxDelta || dl < 1e-9) {
    hero.vel.x = wantX;
    hero.vel.z = wantZ;
  } else {
    hero.vel.x += (dx / dl) * maxDelta;
    hero.vel.z += (dz / dl) * maxDelta;
  }

  // Jump: buffered press while grounded or within coyote time.
  if (hero.jumpBufferLeft > 0 && (hero.onGround || hero.coyoteLeft > 0)) {
    hero.vel.y = p.jumpSpeed;
    hero.jumpBufferLeft = 0;
    hero.coyoteLeft = 0;
    hero.onGround = false;
    hero.jumpedThisTick = true;
  } else if (p.variableJump && !input.jumpHeld && hero.vel.y > p.jumpSpeed * 0.5 && !hero.onGround) {
    hero.vel.y = p.jumpSpeed * 0.5;
  }

  // Gravity (midpoint integration keeps the parabola exact at tick boundaries).
  const vy0 = hero.vel.y;
  if (!hero.onGround || hero.jumpedThisTick) {
    const g = p.gravity * (hero.vel.y < 0 ? p.fallMult : 1);
    hero.vel.y -= g * dt;
  }
  const vyMid = (vy0 + hero.vel.y) / 2;

  const speed = Math.hypot(hero.vel.x, vyMid, hero.vel.z);
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * dt) / (0.5 * HERO_RADIUS))));
  const h = dt / n;
  heroCapsule(hero.pos, _capsule);
  const startX = hero.pos.x;
  const startZ = hero.pos.z;
  let onGround = false;
  let groundNormal: Vector3 | null = null;

  for (let i = 0; i < n; i++) {
    _move.set(hero.vel.x * h, vyMid * h, hero.vel.z * h);
    // Step-up (docs/02-tech.md 6.1, up to 1 unit): raise, move, lower onto whatever is under the raised capsule.
    let stepped = false;
    if (wasOnGround && !hero.jumpedThisTick && p.stepUp > 0 && (_move.x !== 0 || _move.z !== 0)) {
      _probe.copy(_capsule).translate(_tmp.set(0, p.stepUp, 0)).translate(_tmp.set(_move.x, 0, _move.z));
      if (!world.capsuleHit(_probe)) {
        const total = p.stepUp + Math.max(0, -_move.y) + GROUND_SNAP;
        const parts = 6;
        const inc = total / parts;
        for (let k = 0; k < parts; k++) {
          _probe.translate(_tmp.set(0, -inc, 0));
          const hit = world.capsuleHit(_probe);
          if (!hit) continue;
          if (hit.normal.y >= STEP_ACCEPT_NY) {
            if (hit.depth > 1e-9) _probe.translate(_tmp.copy(hit.normal).multiplyScalar(hit.depth));
            _capsule.copy(_probe);
            if (hero.vel.y < 0) hero.vel.y = 0;
            onGround = true;
            groundNormal = hit.normal.y >= SLOPE_MIN_NY ? hit.normal.clone() : new Vector3(0, 1, 0);
            stepped = true;
          }
          break;
        }
      }
    }
    if (stepped) continue;
    _capsule.translate(_move);
    const res = resolve(world, _capsule, hero.vel);
    if (res.onGround) {
      onGround = true;
      groundNormal = res.normal;
    }
  }

  // Ground snap: keep contact when walking down a slope or a step (no snapping right after a jump).
  if (!onGround && wasOnGround && !hero.jumpedThisTick && hero.vel.y <= 0) {
    _probe.copy(_capsule).translate(_tmp.set(0, -GROUND_SNAP, 0));
    const hit = world.capsuleHit(_probe);
    if (hit && hit.normal.y >= SLOPE_MIN_NY) {
      _capsule.translate(_tmp.set(0, -GROUND_SNAP, 0));
      resolve(world, _capsule, hero.vel);
      onGround = true;
      groundNormal = hit.normal.clone();
    }
  }

  hero.pos.set(_capsule.start.x, _capsule.start.y - HERO_RADIUS, _capsule.start.z);
  if (onGround) {
    if (hero.vel.y < 0) hero.vel.y = 0;
    hero.groundNormal.copy(groundNormal ?? _tmp.set(0, 1, 0));
    hero.groundDist = Math.hypot(hero.pos.x - startX, hero.pos.z - startZ);
    hero.airTime = 0;
    if (!wasOnGround) hero.landedThisTick = true;
  } else {
    hero.airTime += dt;
  }
  hero.onGround = onGround;
  hero.speed = Math.hypot(hero.vel.x, hero.vel.z);

  // Facing: slerp towards the movement direction (12/s).
  if (moving) {
    const target = Math.atan2(input.moveX, input.moveZ);
    let d = target - hero.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const k = Math.min(1, FACE_TURN_RATE * dt);
    hero.yaw += d * k;
  }

  if (hero.pos.y < killY) {
    hero.vel.set(0, 0, 0);
  }
}

/** Fresh state at a position: used for spawn and respawn. */
export function placeHero(hero: HeroState, x: number, y: number, z: number): void {
  hero.pos.set(x, y, z);
  hero.vel.set(0, 0, 0);
  hero.onGround = false;
  hero.coyoteLeft = 0;
  hero.jumpBufferLeft = 0;
  hero.airTime = 0;
}

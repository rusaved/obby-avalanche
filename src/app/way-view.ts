/**
 * «Wrong way» (docs/01-gdd.md 16.7): the hero runs down the slope — over the last `balance.hints.wrongWaySec` he went
 * `wrongWayDist` or more lower and moves down now — on a calm mountain (no avalanche, not in a cave, the camp or a
 * snowball): a small white arrow on a dark plaque by the hero shows on screen the way to the next closed gate. No text.
 * It goes the moment he stands or runs up. Reads the simulation and the camera, never changes them.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { BalanceJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { CameraRig } from '../render/camera.ts';
import type { Hud } from '../ui/hud.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';

/** Down the slope faster than this (units/s) counts as running down. */
const DOWN_SPEED = 1.5;
/** A jump of z faster than this (units/s, plus a margin) is a teleport or a respawn: the history starts again. */
const JUMP_SPEED = 200;
const JUMP_MARGIN = 3;
/** The arrow sits this far from the hero's middle on screen: half his height plus a gap, within these limits (px). */
const ORBIT_GAP = 56;
const ORBIT_MIN = 64;
const ORBIT_MAX = 190;
const EDGE = 30;
const TICK = 1 / 60;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _r = new Vector3();
const _f = new Vector3();
const _d = new Vector3();

/**
 * Screen angle (rad; 0 — right, π/2 — down) of the way from `from` to `to`: towards the projected point when it is in
 * front of the camera; behind it — the way on the ground as the camera faces (ahead is up, behind is down).
 */
export function screenAngle(camera: PerspectiveCamera, from: Vector3, to: Vector3, field: { width: number; height: number }): number {
  const ahead = _c.copy(to).applyMatrix4(camera.matrixWorldInverse).z < -camera.near;
  if (ahead) {
    _a.copy(from).project(camera);
    _b.copy(to).project(camera);
    return Math.atan2(((_a.y - _b.y) * field.height) / 2, ((_b.x - _a.x) * field.width) / 2);
  }
  _r.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  _f.setFromMatrixColumn(camera.matrixWorld, 2).negate().setY(0).normalize();
  _d.subVectors(to, from).setY(0);
  return Math.atan2(-_d.dot(_f), _d.dot(_r));
}

export interface WayViewDeps {
  balance: BalanceJson;
  getSim(): Sim;
  hud: Hud;
  camera: CameraRig;
  field(): { width: number; height: number };
}

export interface WayView {
  /** Every frame after the camera moved; `heroRender` — the hero as drawn. */
  update(heroRender: Vector3): void;
  /** For __TEST__.state(): the arrow is up, its screen angle and centre (field px). */
  readonly shown: boolean;
  readonly angle: number;
  readonly x: number;
  readonly y: number;
}

export function createWayView(d: WayViewDeps): WayView {
  const hints = d.balance.hints;
  const history: Array<{ t: number; z: number }> = [];
  let lastSim: Sim | null = null;
  const mid = new Vector3();
  const target = new Vector3();
  const view: WayView & { shown: boolean; angle: number; x: number; y: number } = {
    shown: false,
    angle: 0,
    x: 0,
    y: 0,
    update(heroRender) {
      const sim = d.getSim();
      const h = sim.hero;
      const t = sim.tick * TICK;
      const last = history[history.length - 1];
      const jumped = last !== undefined && Math.abs(h.pos.z - last.z) > JUMP_MARGIN + JUMP_SPEED * Math.max(0, t - last.t);
      if (sim !== lastSim || jumped || sim.caught || sim.respawnTicksLeft >= 0) history.length = 0;
      lastSim = sim;
      if (!last || t > last.t) history.push({ t, z: h.pos.z });
      while (history.length > 1 && history[0]!.t < t - hints.wrongWaySec) history.shift();
      let top = -Infinity;
      for (const s of history) top = Math.max(top, s.z);

      const ts = sim.threat?.state;
      const camp = sim.level.safeZones[0];
      const inCamp = camp !== undefined && h.pos.z >= camp[0] && h.pos.z <= camp[1];
      // The next closed gate: the lowest closed one above the hero.
      let gate: { y: number; z: number } | null = null;
      for (let i = 0; i < sim.level.gates.length; i++) {
        const g = sim.level.gates[i]!;
        if (!sim.gatesOpen[i] && g.z > h.pos.z && (gate === null || g.z < gate.z)) gate = g;
      }
      const want =
        gate !== null &&
        (!ts || ts.phase === 'idle') &&
        !sim.caught &&
        sim.respawnTicksLeft < 0 &&
        sim.shelterIndex() < 0 &&
        !inCamp &&
        top - h.pos.z >= hints.wrongWayDist &&
        h.vel.z < -DOWN_SPEED;
      let arrow: { x: number; y: number; angle: number } | null = null;
      if (want && gate !== null) {
        const g = gate;
        const cam = d.camera.camera;
        mid.copy(heroRender).y += HERO_HEIGHT / 2;
        target.set(0, g.y + 2, g.z);
        const f = d.field();
        const angle = screenAngle(cam, mid, target, f);
        _a.copy(heroRender).project(cam);
        _b.copy(heroRender).setY(heroRender.y + HERO_HEIGHT).project(cam);
        _c.copy(mid).project(cam);
        if (_c.z < 1) {
          const heroPx = Math.abs(_b.y - _a.y) * 0.5 * f.height;
          const orbit = Math.min(ORBIT_MAX, Math.max(ORBIT_MIN, heroPx / 2 + ORBIT_GAP));
          const cx = (_c.x * 0.5 + 0.5) * f.width;
          const cy = (0.5 - _c.y * 0.5) * f.height;
          arrow = {
            x: Math.min(f.width - EDGE, Math.max(EDGE, cx + Math.cos(angle) * orbit)),
            y: Math.min(f.height - EDGE, Math.max(EDGE, cy + Math.sin(angle) * orbit)),
            angle,
          };
        }
      }
      view.shown = arrow !== null;
      if (arrow) {
        view.angle = arrow.angle;
        view.x = arrow.x;
        view.y = arrow.y;
      }
      d.hud.setWayArrow(arrow);
    },
  };
  return view;
}

/**
 * Third-person camera (docs/02-tech.md, section 7): orbit around a point above the hero, critically damped
 * follow with velocity lead, auto-turn towards +Z only with `camera.autoTurn` (off since 05.10, docs/01-gdd.md 16.7),
 * wall avoidance by a sphere against the Octree, FOV growing with speed. Only `viewYaw` of the control frame is changed here.
 * Playtest M2: the point above the hero never leads into a wall; when a wall is right behind the hero the camera
 * rises over him (pitch up to `raiseMaxDeg`) instead of collapsing into his head; the final position is checked
 * once more after shake and the fixed cave frame; the hero and bots hide only by the real distance to the camera.
 */
import { PerspectiveCamera, Sphere, Vector3 } from 'three';
import type { TuningJson } from '../content/types.ts';
import type { CollisionWorld } from '../sim/collision.ts';
import { angleDiff, wrapAngle, type ControlFrame } from '../input/control-frame.ts';

export interface CameraTarget {
  pos: Vector3;
  vel: Vector3;
  speed: number;
  maxSpeed: number;
}

export interface CameraInputInfo {
  manualCamera: boolean;
  moveX: number;
  moveY: number;
  autoRun: boolean;
}

export interface CameraRig {
  readonly camera: PerspectiveCamera;
  readonly frame: ControlFrame;
  readonly pivot: Vector3;
  /** Current distance after wall avoidance. */
  currentDistance: number;
  heroHidden: boolean;
  /** Seconds since the player last turned the camera by hand. */
  sinceManual: number;
  /** Scripted shot in progress: auto-turn and follow use the shot's yaw instead (M2 avalanche frame). */
  shot: { yaw: number; pitch: number; distance: number } | null;
  shakeAmount: number;
  /** Fixed frame (the wide cave shot during an avalanche, playtest M2): camera point and the point it looks at.
   * The camera blends to it and back in `avalanche.shotReturnSec`. */
  fixed: { pos: Vector3; look: Vector3; fov: number } | null;
  /** Share of the fixed frame in the view now: 1 — the frame, 0 — the player's camera (tests: the way back). */
  readonly fixedBlend: number;
  update(dt: number, target: CameraTarget, input: CameraInputInfo, collision: CollisionWorld | null): void;
  snapTo(target: CameraTarget): void;
  /** Is the camera inside level geometry (sphere test) — for tests. */
  insideGeometry(collision: CollisionWorld): boolean;
  /** Does a character standing at `feet` sit too close to the camera or between it and the hero (hide it). */
  blocksView(feet: Vector3): boolean;
}

const _desired = new Vector3();
const _dir = new Vector3();
const _probe = new Sphere(new Vector3(), 0.4);
const _tmp = new Vector3();
const _head = new Vector3();
const _look = new Vector3();
const _seg = new Vector3();
const _from = new Vector3();
/** Chest height of a character over its feet (hide and occlusion checks). */
const CHEST = 1.5;
/** Steps of the sweep from the hero's head to the lead point. */
const PIVOT_STEPS = 8;
/** A camera this much past hideDistance from the hero's body is still too close to keep the velocity lead. */
const LEAD_MARGIN = 0.5;
/** Head centre of a character over its feet: legs and torso 1.9 each, head 1.24 (src/render/characters.ts PART). */
const HEAD = 4.4;
/** A turn by hand this recent when the fixed frame ends keeps the player's yaw (docs/02-tech.md 7: «a turn in the last 0.5 s»). */
const MANUAL_RECENT_SEC = 0.5;

function smooth01(k: number): number {
  return k * k * (3 - 2 * k);
}

export function createCameraRig(camera: PerspectiveCamera, frame: ControlFrame, tuning: TuningJson, rngNext: () => number): CameraRig {
  const c = tuning.camera;
  camera.near = 0.1;
  camera.far = 400;
  camera.fov = c.fov;
  camera.updateProjectionMatrix();
  const pivot = new Vector3();
  const heroChest = new Vector3();
  const heroHead = new Vector3();
  let fov = c.fov;
  let shakeT = 0;
  /** Extra pitch over the wall right behind the hero (rad), and the blend into the fixed frame (0…1). */
  let raise = 0;
  let fixedK = 0;
  let lastCollision: CollisionWorld | null = null;
  const fixedPos = new Vector3();
  const fixedLook = new Vector3();
  let fixedFov = c.fov;
  /** PR-13: the player's yaw before the fixed frame, and the way back to it after the frame (0…1, 1 — done). */
  let backYaw: number | null = null;
  let wasFixed = false;
  let retFrom = 0;
  let retK = 1;
  /** Distance from a point to the hero's body axis, chest to head (the camera keeps hideDistance off it; PR-13). */
  const bodyDistance = (p: Vector3): number => {
    const y = Math.min(heroHead.y, Math.max(heroChest.y, p.y));
    return Math.hypot(p.x - heroChest.x, p.y - y, p.z - heroChest.z);
  };
  const blocked = (p: Vector3, r: number, collision: CollisionWorld): boolean => {
    _probe.center.copy(p);
    _probe.radius = r;
    return collision.sphereHit(_probe) !== null;
  };
  /** Free distance from the pivot along the direction (yaw, pitch) up to `want`, 0.5 short of the first hit. */
  const freeDistance = (yaw: number, pitch: number, want: number, collision: CollisionWorld): number => {
    _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const step = c.collisionRadius * 0.5;
    for (let d = 0; d <= want; d += step) {
      if (blocked(_tmp.copy(pivot).addScaledVector(_dir, d), c.collisionRadius, collision)) return Math.max(0, d - 0.5);
    }
    return want;
  };

  /** Is the straight way between two camera points through level geometry (then the frame cuts instead of blending). */
  const pathBlocked = (a: Vector3, b: Vector3, collision: CollisionWorld): boolean => {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(len / c.collisionRadius));
    for (let i = 1; i < n; i++) if (blocked(_tmp.copy(a).lerp(b, i / n), c.collisionRadius * 0.5, collision)) return true;
    return false;
  };

  const rig: CameraRig = {
    camera,
    frame,
    pivot,
    currentDistance: c.distance,
    heroHidden: false,
    sinceManual: 999,
    shot: null,
    shakeAmount: 0,
    fixed: null,
    get fixedBlend() {
      return fixedK;
    },
    snapTo(target) {
      pivot.copy(target.pos).y += c.height;
      rig.currentDistance = frame.distance;
      raise = 0;
      rig.update(0, target, { manualCamera: false, moveX: 0, moveY: 0, autoRun: false }, lastCollision);
    },
    blocksView(feet) {
      _tmp.copy(feet).y += CHEST;
      if (_tmp.distanceTo(camera.position) < c.hideDistance) return true;
      // Between the camera and the hero: close to the segment camera → hero chest, nearer than the hero.
      _seg.copy(heroChest).sub(camera.position);
      const len2 = _seg.lengthSq();
      if (len2 < 1e-6) return false;
      const k = _look.copy(_tmp).sub(camera.position).dot(_seg) / len2;
      if (k <= 0 || k >= 1) return false;
      return _look.copy(camera.position).addScaledVector(_seg, k).distanceTo(_tmp) < c.occludeRadius;
    },
    insideGeometry(collision) {
      _probe.center.copy(camera.position);
      _probe.radius = c.collisionRadius;
      return collision.sphereHit(_probe) !== null;
    },
    update(dt, target, input, collision) {
      if (input.manualCamera) rig.sinceManual = 0;
      else rig.sinceManual += dt;

      // Follow with critical damping and lead by velocity.
      _tmp.copy(target.pos);
      _tmp.y += c.height;
      // The lead never takes the camera past the hero (PR-13: out of a cave the camera distance grows back at retreatSpeed,
      // and at 55 units/s a lead longer than it put the camera ahead of the hero; at the next closed gate he ran into it).
      const reach = Math.max(0, rig.currentDistance * Math.cos(frame.pitch) - c.hideDistance - LEAD_MARGIN);
      const lead = Math.hypot(target.vel.x, target.vel.z) * c.leadSec;
      const leadK = lead > reach ? reach / lead : 1;
      _tmp.x += target.vel.x * c.leadSec * leadK;
      _tmp.z += target.vel.z * c.leadSec * leadK;
      const k = dt > 0 ? 1 - Math.exp(-c.damping * dt) : 1;
      pivot.lerp(_tmp, k);
      if (collision) lastCollision = collision;
      heroChest.copy(target.pos).y += CHEST;
      heroHead.copy(target.pos).y += HEAD;
      // The pivot never leads into a wall: swept from the hero's head towards it, stopped before the first hit.
      _head.copy(target.pos).y += c.height;
      if (collision && !blocked(_head, c.collisionRadius, collision)) {
        _seg.copy(pivot).sub(_head);
        let ok = 0;
        for (let i = 1; i <= PIVOT_STEPS; i++) {
          if (blocked(_tmp.copy(_head).addScaledVector(_seg, i / PIVOT_STEPS), c.collisionRadius, collision)) break;
          ok = i;
        }
        if (ok < PIVOT_STEPS) pivot.copy(_head).addScaledVector(_seg, ok / PIVOT_STEPS);
      }

      // After the fixed frame the view comes back to the player's yaw from before it in shotReturnSec (PR-13, playtest of the
      // prototype 2: it stayed 70° to the side, out of the cave, and «forward» led across the slope). The frame's yaw is
      // the start; a movement frame taken from the shot (move started in it) turns back with the view. A turn by hand in
      // the last moments of the frame or on the way back is the player's: no way back then. Not the auto-turn (16.7).
      if (rig.fixed && !wasFixed) {
        if (backYaw === null) backYaw = frame.viewYaw;
        retK = 1;
      } else if (!rig.fixed && wasFixed) {
        if (backYaw !== null && rig.sinceManual >= MANUAL_RECENT_SEC) {
          retFrom = frame.viewYaw;
          retK = 0;
        } else backYaw = null;
      }
      wasFixed = rig.fixed !== null;
      if (!rig.fixed && backYaw !== null) {
        if (input.manualCamera) {
          backYaw = null;
          retK = 1;
        } else if (dt > 0) {
          const follow = Math.abs(angleDiff(frame.controlYaw, frame.viewYaw)) < 1e-4;
          retK = Math.min(1, retK + dt / Math.max(1e-3, tuning.avalanche.shotReturnSec));
          frame.viewYaw = wrapAngle(retFrom + angleDiff(retFrom, backYaw) * smooth01(retK));
          if (follow) frame.controlYaw = frame.viewYaw;
          if (retK >= 1) backYaw = null;
        }
      }

      // Auto-turn towards the track axis +Z (docs/02-tech.md 7), never during manual control or autorun; off unless
      // tuning camera.autoTurn (docs/01-gdd.md 16.7: running down the slope the view stays where the player left it).
      let yaw = frame.viewYaw;
      let pitch = frame.pitch;
      let wantDist = frame.distance;
      if (rig.shot) {
        yaw = rig.shot.yaw;
        pitch = rig.shot.pitch;
        wantDist = rig.shot.distance;
        frame.viewYaw = yaw;
      } else if (c.autoTurn && !input.autoRun && !input.manualCamera && rig.sinceManual >= c.autoTurnDelaySec && dt > 0) {
        const moving = input.moveX !== 0 || input.moveY !== 0;
        if (moving) {
          const moveAngle = Math.atan2(input.moveX, input.moveY);
          const cone = (c.autoTurnConeDeg * Math.PI) / 180;
          if (Math.abs(moveAngle) <= cone) {
            const d = angleDiff(frame.viewYaw, 0);
            const step = Math.sign(d) * Math.min(Math.abs(d), c.autoTurnRate * dt);
            frame.viewYaw += step;
            yaw = frame.viewYaw;
          }
        }
      }

      // Desired position behind the hero, pitched down; a wall right behind: rise over the hero (playtest M2).
      let allowed = wantDist;
      if (collision) {
        allowed = freeDistance(yaw, pitch, wantDist, collision);
        let bestRaise = 0;
        const need = Math.min(wantDist, c.minDistance);
        if (allowed < need) {
          const maxPitch = (c.raiseMaxDeg * Math.PI) / 180;
          const stepR = (c.raiseStepDeg * Math.PI) / 180;
          let best = allowed;
          for (let r = stepR; pitch + r <= maxPitch + 1e-6; r += stepR) {
            const d = freeDistance(yaw, pitch + r, wantDist, collision);
            if (d > best + 0.05) {
              best = d;
              bestRaise = r;
            }
            if (d >= need) break;
          }
        }
        // Up at once, down slowly (raiseReturnRate rad/s), the distance always checked on the pitch in use.
        if (bestRaise >= raise || dt === 0) raise = bestRaise;
        else raise = Math.max(bestRaise, raise - c.raiseReturnRate * dt);
        if (raise > 0) allowed = freeDistance(yaw, pitch + raise, wantDist, collision);
      } else raise = 0;
      const usePitch = pitch + raise;
      _dir.set(-Math.sin(yaw) * Math.cos(usePitch), Math.sin(usePitch), -Math.cos(yaw) * Math.cos(usePitch));
      if (allowed < rig.currentDistance || dt === 0) rig.currentDistance = allowed;
      // Out at retreatSpeed, but never lingering inside minDistance when there is room (the hero would hide).
      else rig.currentDistance = Math.min(allowed, Math.max(rig.currentDistance + c.retreatSpeed * dt, Math.min(allowed, c.minDistance)));

      _desired.copy(pivot).addScaledVector(_dir, rig.currentDistance);
      // The lead ahead of a fast hero never brings the camera back onto him (prototype playtest, item 2: running into a
      // cave the lead point is deep in it, its walls cut the room behind that point to about the lead): no lead then,
      // when that puts the camera farther from him (pressed into a wall the lead point may be the better one). Measured
      // to his body from chest to head (playtest 2: out of a cave the raised camera sat in his hat, 4–5 units off the chest).
      if (collision && bodyDistance(_desired) < c.hideDistance + LEAD_MARGIN && pivot.distanceToSquared(_head) > 1e-4 && !blocked(_head, c.collisionRadius, collision)) {
        _from.copy(pivot);
        pivot.copy(_head);
        const d = Math.min(rig.currentDistance, freeDistance(yaw, usePitch, wantDist, collision));
        _tmp.copy(pivot).addScaledVector(_dir, d);
        if (bodyDistance(_tmp) > bodyDistance(_desired)) {
          rig.currentDistance = d;
          _desired.copy(_tmp);
        } else pivot.copy(_from);
      }
      _look.copy(pivot);
      // Fixed frame (the cave during an avalanche): blend in and out over shotReturnSec.
      if (rig.fixed) {
        fixedPos.copy(rig.fixed.pos);
        fixedLook.copy(rig.fixed.look);
        fixedFov = rig.fixed.fov;
      }
      const kRate = dt > 0 ? dt / Math.max(1e-3, tuning.avalanche.shotReturnSec) : 1;
      // A frame outside the cave (over its roof, PR-07) is reached by a cut, not through the walls: in and out when the straight
      // way between the player's camera and the frame goes through the level (the camera is never inside it). Checked on
      // every frame of the blend: the player's camera moves meanwhile (the hero runs into the cave, PR-11), and a blended
      // point deep in a thick roof touches none of its faces.
      if (collision && (rig.fixed ? fixedK < 1 : fixedK > 0) && pathBlocked(_desired, fixedPos, collision)) fixedK = rig.fixed ? 1 : 0;
      fixedK = rig.fixed ? Math.min(1, fixedK + kRate) : Math.max(0, fixedK - kRate);
      // The hero is far from the frame (moved to another cave): no blend through the level, the player's view at once.
      if (!rig.fixed && fixedPos.distanceTo(pivot) > c.zoomMax + c.distance) fixedK = 0;
      // Nor through the hero (PR-13): a blended point closer than hideDistance to his body — a cut to where the blend goes.
      if (fixedK > 0 && fixedK < 1 && bodyDistance(_tmp.copy(_desired).lerp(fixedPos, smooth01(fixedK))) < c.hideDistance) fixedK = rig.fixed ? 1 : 0;
      if (fixedK > 0) {
        const kk = smooth01(fixedK);
        _tmp.copy(_desired).lerp(fixedPos, kk);
        if (!collision || !blocked(_tmp, c.collisionRadius * 0.5, collision)) _desired.copy(_tmp);
        _look.lerp(fixedLook, kk);
        if (rig.fixed) {
          _seg.copy(fixedLook).sub(fixedPos);
          frame.viewYaw = Math.atan2(_seg.x, _seg.z);
        }
      }
      if (rig.shakeAmount > 0 && dt > 0) {
        shakeT += dt;
        const amp = rig.shakeAmount * c.shake;
        _tmp.copy(_desired);
        _desired.x += (rngNext() - 0.5) * 2 * amp;
        _desired.y += (rngNext() - 0.5) * 2 * amp;
        rig.shakeAmount = Math.max(0, rig.shakeAmount - dt * 2);
        if (collision && blocked(_desired, c.collisionRadius * 0.5, collision)) _desired.copy(_tmp);
      }
      camera.position.copy(_desired);
      if (_desired.distanceToSquared(_look) > 1e-6) camera.lookAt(_look);
      // Projections later in this frame (HUD arrows, signs under the banner) use this view, not the last one.
      camera.updateMatrixWorld();
      rig.heroHidden = camera.position.distanceTo(heroChest) < c.hideDistance;

      // FOV from speed, smoothed.
      const ratio = target.maxSpeed > 0 ? Math.min(1, target.speed / target.maxSpeed) : 0;
      let wantFov = c.fov + c.fovSpeedAdd * ratio;
      if (fixedK > 0) wantFov += (fixedFov - wantFov) * smooth01(fixedK);
      const kf = dt > 0 ? 1 - Math.exp(-dt / Math.max(1e-3, c.fovSmoothSec)) : 1;
      fov += (wantFov - fov) * kf;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
  };
  return rig;
}

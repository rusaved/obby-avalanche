/**
 * Third-person camera (docs/02-tech.md, section 7): orbit around a point above the hero, critically damped
 * follow with velocity lead, auto-turn towards +Z, wall avoidance by a 0.4 sphere against the Octree,
 * FOV growing with speed. Only `viewYaw` of the control frame is changed here.
 */
import { PerspectiveCamera, Sphere, Vector3 } from 'three';
import type { TuningJson } from '../content/types.ts';
import type { CollisionWorld } from '../sim/collision.ts';
import { angleDiff, type ControlFrame } from '../input/control-frame.ts';

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
  /** Keeps the camera inside a box (the cave + 2 units during the avalanche frame, docs/02-tech.md 7). */
  bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] } | null;
  update(dt: number, target: CameraTarget, input: CameraInputInfo, collision: CollisionWorld | null): void;
  snapTo(target: CameraTarget): void;
  /** Is the camera inside level geometry (sphere test) — for tests. */
  insideGeometry(collision: CollisionWorld): boolean;
}

const _desired = new Vector3();
const _dir = new Vector3();
const _probe = new Sphere(new Vector3(), 0.4);
const _tmp = new Vector3();

export function createCameraRig(camera: PerspectiveCamera, frame: ControlFrame, tuning: TuningJson, rngNext: () => number): CameraRig {
  const c = tuning.camera;
  camera.near = 0.1;
  camera.far = 400;
  camera.fov = c.fov;
  camera.updateProjectionMatrix();
  const pivot = new Vector3();
  let fov = c.fov;
  let shakeT = 0;

  const rig: CameraRig = {
    camera,
    frame,
    pivot,
    currentDistance: c.distance,
    heroHidden: false,
    sinceManual: 999,
    shot: null,
    shakeAmount: 0,
    bounds: null,
    snapTo(target) {
      pivot.copy(target.pos).y += c.height;
      rig.currentDistance = frame.distance;
      rig.update(0, target, { manualCamera: false, moveX: 0, moveY: 0, autoRun: false }, null);
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
      _tmp.x += target.vel.x * c.leadSec;
      _tmp.z += target.vel.z * c.leadSec;
      const k = dt > 0 ? 1 - Math.exp(-c.damping * dt) : 1;
      pivot.lerp(_tmp, k);

      // Auto-turn towards the track axis +Z (docs/02-tech.md 7), never during manual control or autorun.
      let yaw = frame.viewYaw;
      let pitch = frame.pitch;
      let wantDist = frame.distance;
      if (rig.shot) {
        yaw = rig.shot.yaw;
        pitch = rig.shot.pitch;
        wantDist = rig.shot.distance;
        frame.viewYaw = yaw;
      } else if (!input.autoRun && !input.manualCamera && rig.sinceManual >= c.autoTurnDelaySec && dt > 0) {
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

      // Desired position behind the hero, pitched down.
      _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      let allowed = wantDist;
      if (collision) {
        const step = c.collisionRadius * 0.5;
        _probe.radius = c.collisionRadius;
        for (let d = 0; d <= wantDist; d += step) {
          _probe.center.copy(pivot).addScaledVector(_dir, d);
          if (collision.sphereHit(_probe)) {
            // Stop 0.5 before the hit (docs/02-tech.md 7); at the pivot itself the camera stays there.
            allowed = Math.max(0, d - 0.5);
            break;
          }
        }
      }
      if (allowed < rig.currentDistance || dt === 0) rig.currentDistance = allowed;
      else rig.currentDistance = Math.min(allowed, rig.currentDistance + c.retreatSpeed * dt);

      _desired.copy(pivot).addScaledVector(_dir, rig.currentDistance);
      if (rig.shakeAmount > 0 && dt > 0) {
        shakeT += dt;
        const amp = rig.shakeAmount * c.shake;
        _desired.x += (rngNext() - 0.5) * 2 * amp;
        _desired.y += (rngNext() - 0.5) * 2 * amp;
        rig.shakeAmount = Math.max(0, rig.shakeAmount - dt * 2);
      }
      if (rig.bounds) {
        const b = rig.bounds;
        _desired.set(
          Math.min(b.max[0], Math.max(b.min[0], _desired.x)),
          Math.min(b.max[1], Math.max(b.min[1], _desired.y)),
          Math.min(b.max[2], Math.max(b.min[2], _desired.z)),
        );
      }
      camera.position.copy(_desired);
      camera.lookAt(pivot);
      rig.heroHidden = rig.currentDistance < c.hideDistance;

      // FOV from speed, smoothed.
      const ratio = target.maxSpeed > 0 ? Math.min(1, target.speed / target.maxSpeed) : 0;
      const wantFov = c.fov + c.fovSpeedAdd * ratio;
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

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { buildLevel } from '../../src/level/builder.ts';
import { createCollisionWorld } from '../../src/sim/collision.ts';
import { createCameraRig, type CameraRig } from '../../src/render/camera.ts';
import { angleDiff, applyManualTurn, createControlFrame } from '../../src/input/control-frame.ts';
import { mergePatch } from '../../src/content/pace.ts';
import tuningJson from '../../content/avalanche/tuning.json' with { type: 'json' };
import openTuning from '../../content/avalanche/pace/open/tuning.json' with { type: 'json' };
import type { TuningJson, World } from '../../src/content/types.ts';

// SP-01 (docs/01-gdd.md 20.2): after the grotto frame and the avalanche frame the view comes back behind the hero where
// he runs (camera.backBehind «run»); «before» keeps the way back of the prototype and the base — the trace below was
// recorded on the camera as it was before SP and must not change. A hand-made slope with one grotto, so the later
// changes of worlds.json do not touch it.
const base = mergePatch(tuningJson, openTuning) as unknown as TuningJson;
const tuningWith = (backBehind: 'run' | 'before'): TuningJson => ({ ...base, camera: { ...base.camera, backBehind } });
const DT = 1 / 60;
const HALF = 28;
const world: World = {
  id: 'cam',
  index: 1,
  length: 240,
  width: HALF * 2,
  spawnZ: 10,
  egg: 'snow',
  stretch: 240,
  wallCount: 0,
  safeZones: [],
  threat: { intervalSec: 50, firstIntervalSec: 30, warnSec: 8, speed: 45, from: 'aboveHero', spawnAhead: 160, firstWaveScripted: false, safeZoneZ: [0, 0], spawnMaxZ: 240 },
  zones: [],
  segments: [
    { type: 'floor', z: 0, length: 240, y: 0 },
    { type: 'niche', z: 100, y: 0, side: 'left', length: 10, depth: 6, treadmill: 0, kind: 'grotto', stretch: 1, zone: 1 },
  ],
  treadmillMult: 1,
};
const level = buildLevel(world);
const collision = createCollisionWorld(level.staticTriangles);
const INSIDE_X = -(HALF + 3 + 3);

interface Run {
  rig: CameraRig;
  trace: number[][];
  /** Per frame of the way out: frame index, hero position and velocity. */
  out: Array<{ i: number; pos: Vector3; vel: Vector3 }>;
}

/** Up the slope, into the grotto, the avalanche frame there, out of it and on up the slope (or across it: `outTo`). */
function play(tuning: TuningJson, outTo: [number, number] = [0, 200], onOut?: (rig: CameraRig, o: Run['out'][number]) => void): Run {
  const camera = new PerspectiveCamera();
  const rig = createCameraRig(camera, createControlFrame((tuning.camera.pitchDeg * Math.PI) / 180, tuning.camera.distance), tuning, () => 0.5);
  const gs = tuning.camera.grottoShot;
  const pos = new Vector3(0, 0, 60);
  const vel = new Vector3();
  const trace: number[][] = [];
  const out: Run['out'] = [];
  let frame = 0;
  const target = { pos, vel, speed: 0, maxSpeed: tuning.controller.maxSpeed };
  rig.snapTo(target);
  const step = (n: number, move: (() => void) | null, turn = 0): void => {
    for (let k = 0; k < n; k++) {
      if (turn) applyManualTurn(rig.frame, turn, 0, -1, 1);
      if (move) move();
      else vel.set(0, 0, 0);
      pos.addScaledVector(vel, DT);
      target.speed = vel.length();
      const inGrotto = pos.x < -HALF + 2;
      if (inGrotto) {
        const f = rig.shelter ?? { pos: new Vector3(), look: new Vector3(), fov: gs.fov };
        f.look.set(pos.x, pos.y + 1.5, pos.z);
        f.pos.set(-(HALF - gs.out), gs.height, 100 - gs.back);
        rig.shelter = f;
      } else rig.shelter = null;
      rig.update(DT, target, { manualCamera: turn !== 0, moveX: 0, moveY: 0, autoRun: false }, collision);
      if (frame % 3 === 0) {
        const p = rig.camera.position;
        trace.push([rig.frame.viewYaw, rig.frame.controlYaw, p.x, p.y, p.z, rig.currentDistance, rig.tight ? 1 : 0, rig.fixedBlend].map((v) => Math.round(v * 1000) / 1000));
      }
      frame++;
    }
  };
  const toward = (x: number, z: number, speed: number): (() => void) => () => {
    const d = new Vector3(x - pos.x, 0, z - pos.z);
    const len = d.length();
    vel.copy(len < speed * DT ? d.divideScalar(DT) : d.multiplyScalar(speed / Math.max(1e-6, len)));
  };
  step(60, toward(0, 100, 20));
  step(40, toward(0, 100, 20));
  step(150, toward(INSIDE_X, 100, 15));
  // Turned round by hand in the grotto (7.5° a frame): pressed into its walls the camera takes the grotto frame.
  step(48, null, Math.PI / 24);
  step(60, null);
  rig.fixed = { pos: new Vector3(-HALF - 2, 9, 96), look: new Vector3(0, 2, 108), fov: 80 };
  step(90, null);
  rig.fixed = null;
  step(60, null);
  const start = frame;
  for (let k = 0; k < 180; k++) {
    step(1, toward(outTo[0], outTo[1], 20));
    out.push({ i: frame - start, pos: pos.clone(), vel: vel.clone() });
    onOut?.(rig, out[out.length - 1]!);
  }
  return { rig, trace, out };
}

describe('SP-01: the way back of the camera after the grotto and the avalanche frame', () => {
  it('«before» — the camera as before SP (trace snapshot)', () => {
    expect(play(tuningWith('before')).trace).toMatchSnapshot();
  });

  const tun = tuningWith('run');
  const pitch = (tun.camera.pitchDeg * Math.PI) / 180;
  for (const [what, to] of [
    ['out and up the slope', [0, 200]],
    ['straight across the slope', [40, 100]],
    ['out and down the slope', [-10, 20]],
  ] as Array<[string, [number, number]]>) {
    it(`«run»: ${what} — within shotReturnSec behind him (≤ 15°), distance ≥ 0.8, no rise`, () => {
      // The view of each frame of the way out, replayed: the camera behind the hero where he runs.
      const runs: Array<{ yaw: number; runYaw: number; dist: number; lift: number; i: number }> = [];
      const r = play(tun, to, (rig, o) => {
        runs.push({ yaw: rig.frame.viewYaw, runYaw: Math.atan2(o.vel.x, o.vel.z), dist: rig.currentDistance, lift: rig.camera.position.y - rig.pivot.y, i: o.i });
      });
      const exit = r.out.findIndex((o) => o.pos.x >= -HALF + 2);
      expect(exit).toBeGreaterThan(0);
      const at = runs[exit + Math.round(tun.avalanche.shotReturnSec / DT)]!;
      const d = Math.abs(angleDiff(at.yaw, at.runYaw)) * (180 / Math.PI);
      expect(d, `view ${at.yaw.toFixed(2)} run ${at.runYaw.toFixed(2)}`).toBeLessThanOrEqual(15);
      expect(at.dist).toBeGreaterThanOrEqual(0.8 * tun.camera.distance);
      expect(Math.abs(at.lift - at.dist * Math.sin(pitch)), 'no rise over him').toBeLessThan(0.3);
    });
  }

  it('«run»: standing in the grotto when the avalanche frame ends — the view turns up the slope (then the grotto frame)', () => {
    const { trace } = play(tun, [INSIDE_X, 100]);
    const last = trace.reduce((k, r, i) => (r[7]! > 0 ? i : k), -1);
    // Rows every 3 frames: within shotReturnSec of the frame's end the view looks up the slope (yaw 0).
    const back = trace.slice(last + 1, last + 1 + Math.ceil(tun.avalanche.shotReturnSec / DT / 3) + 1);
    expect(Math.min(...back.map((r) => Math.abs(r[0]!))), back.map((r) => r[0]).join(' ')).toBeLessThan(0.01);
  });
});

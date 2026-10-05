/**
 * How the avalanche looks and feels each frame (docs/01-gdd.md 4.3, 4.8; docs/02-tech.md 7, 8.3): «Avalanche in N»,
 * frost frame, steady arrow to the lit cave, wide camera frame on the wave from the cave, shake by distance,
 * white veil inside the snow body, the hero covering his head while the front goes over the cave.
 * Reads the simulation, never changes it.
 */
import { Vector3 } from 'three';
import type { TuningJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { CameraRig } from '../render/camera.ts';
import type { CharacterInstance } from '../render/characters.ts';
import type { AvalancheVisual } from '../render/threat/avalanche.ts';
import type { Hud } from '../ui/hud.ts';
import type { ControlFrame } from '../input/control-frame.ts';
import { t } from '../ui/i18n.ts';

/** Shake amplitude share while the front is far (0.05 of 0.3 units, docs/01-gdd.md 4.8) and the longest strong burst. */
const FAR_SHAKE_SHARE = 0.17;
const STRONG_SHAKE_MAX_SEC = 0.3;
/** Frost frame: on warn and while the front is far, and at full when it is near (10% → 25% of the edges). */
const FROST_WARN = 0.4;
/** Arrow inset from the field edge, px, and the visible part of the screen in NDC. */
const ARROW_INSET = 48;
const ON_SCREEN = 0.85;
/** The cave frame keeps this much over the camera radius off the cave walls. */
const WALL_CLEARANCE = 0.2;
/** The hero covers his head while the front is this close (docs/02-tech.md 8.3). */
const COVER_DIST = 10;

export interface WaveViewDeps {
  tuning: TuningJson;
  frame: ControlFrame;
  getSim(): Sim;
  hud: Hud;
  camera: CameraRig;
  hero: CharacterInstance;
  visual: AvalancheVisual;
  field(): { width: number; height: number };
  /** Player turned the camera by hand right now or in the last 0.5 s (docs/02-tech.md 7). */
  manualCamera(): boolean;
}

export interface WaveView {
  update(frameDt: number, timeSec: number): void;
  /** For __TEST__.state(): what the HUD shows now. */
  readonly banner: string | null;
  readonly arrow: boolean;
  readonly shot: boolean;
  readonly veil: boolean;
}

export function createWaveView(d: WaveViewDeps): WaveView {
  const av = d.tuning.avalanche;
  const p = new Vector3();
  let shotCave = -1;
  let strongSec = 0;
  const view: WaveView & { banner: string | null; arrow: boolean; shot: boolean; veil: boolean } = {
    banner: null,
    arrow: false,
    shot: false,
    veil: false,
    update(frameDt, timeSec) {
      const sim = d.getSim();
      const ts = sim.threat?.state;
      if (!ts) return;
      const hero = sim.hero.pos;
      const running = ts.phase === 'run';
      const dz = running ? ts.frontZ - hero.z : Infinity;
      d.visual.update(ts, timeSec, d.camera.camera.position);

      // Banner: «Avalanche in N» on warn, «Avalanche!» until the front reaches the hero.
      let banner: string | null = null;
      if (ts.phase === 'warn') banner = t('wave.warn', { n: Math.max(1, Math.ceil(ts.timer)) });
      else if (running && ts.outcome === 'none' && dz > 0) banner = t('wave.run');
      view.banner = banner;
      d.hud.setWaveBanner(banner);

      // Frost frame and shake by distance (docs/01-gdd.md 4.8).
      let frost = 0;
      let shake = 0;
      if (ts.phase === 'warn') frost = FROST_WARN;
      if (running && Math.abs(dz) <= d.tuning.avalanche.nearDist * 3) {
        const near = Math.abs(dz) < av.nearDist;
        frost = near ? 1 : FROST_WARN;
        strongSec = near ? strongSec + frameDt : 0;
        shake = near && strongSec <= STRONG_SHAKE_MAX_SEC ? 1 - Math.abs(dz) / av.nearDist : FAR_SHAKE_SHARE;
      } else strongSec = 0;
      d.hud.setFrost(frost);
      if (shake > 0) d.camera.shakeAmount = Math.max(d.camera.shakeAmount, Math.max(FAR_SHAKE_SHARE, shake) * av.shakeStrength);

      // Arrow to the lit cave from the first second of the warning until the hero is in it, steady (playtest M2: it
      // came and went with the cave entering the view): at the field edge towards the cave when it is off screen,
      // right above the cave mouth pointing down when it is on screen.
      const cave = sim.level.niches[ts.shelter];
      let arrow: { x: number; y: number; angle: number } | null = null;
      if (cave && (ts.phase === 'warn' || (running && ts.outcome === 'none')) && sim.shelterIndex() < 0) {
        const sign = cave.side === 'left' ? -1 : 1;
        p.set(sign * (sim.level.width / 2), cave.y + 4, cave.z).project(d.camera.camera);
        const behind = p.z > 1;
        let nx = behind ? -p.x : p.x;
        let ny = behind ? -p.y : p.y;
        const f = d.field();
        if (behind || Math.abs(nx) > ON_SCREEN || Math.abs(ny) > ON_SCREEN) {
          const k = Math.max(Math.abs(nx), Math.abs(ny), 1e-3);
          nx = (nx / k) * ON_SCREEN;
          ny = (ny / k) * ON_SCREEN;
          const x = Math.min(f.width - ARROW_INSET, Math.max(ARROW_INSET, (nx * 0.5 + 0.5) * f.width));
          const y = Math.min(f.height - ARROW_INSET, Math.max(ARROW_INSET, (0.5 - ny * 0.5) * f.height));
          arrow = { x, y, angle: Math.atan2(-ny, nx) };
        } else {
          const x = (nx * 0.5 + 0.5) * f.width;
          const y = Math.max(ARROW_INSET, (0.5 - ny * 0.5) * f.height - ARROW_INSET);
          arrow = { x, y, angle: Math.PI / 2 };
        }
      }
      view.arrow = arrow !== null;
      d.hud.setCaveArrow(arrow);

      // Wide cave frame (docs/02-tech.md 7; playtest M2): from the hero in the lit cave on warn until the front is
      // shotTriggerDist past it, the camera stands high in the cave by the downhill wall and looks at the belt and out
      // of the mouth up the slope, where the avalanche comes from. Turned by hand — the player's camera (not scripted).
      const inCave = sim.shelterIndex();
      const wantShot =
        inCave >= 0 && !sim.caught && (ts.phase === 'warn' || (running && dz > -av.shotTriggerDist)) && (ts.scripted || !d.manualCamera());
      if (wantShot) {
        const c = sim.level.niches[inCave]!;
        if (shotCave !== inCave) {
          const sign = c.side === 'left' ? -1 : 1;
          const r = d.tuning.camera.collisionRadius + WALL_CLEARANCE;
          const mouth = sign * (sim.level.width / 2);
          const depth = c.box.max[0] - c.box.min[0];
          const at = (q: readonly [number, number, number], out: Vector3, clamp: boolean): Vector3 => {
            out.set(mouth + sign * q[0] * depth, c.box.min[1] + q[1] * (c.box.max[1] - c.box.min[1]), c.box.min[2] + q[2] * (c.box.max[2] - c.box.min[2]));
            if (clamp) {
              out.x = Math.min(c.box.max[0] - r, Math.max(c.box.min[0] + r, out.x));
              out.y = Math.min(c.box.max[1] - r, Math.max(c.box.min[1] + r, out.y));
              out.z = Math.min(c.box.max[2] - r, Math.max(c.box.min[2] + r, out.z));
            }
            return out;
          };
          d.camera.fixed = { pos: at(av.caveShot.pos, new Vector3(), true), look: at(av.caveShot.look, new Vector3(), false), fov: av.caveShot.fov };
        }
        shotCave = inCave;
      } else if (shotCave >= 0) {
        // Back to the player's view in shotReturnSec (the rig blends out).
        shotCave = -1;
        d.camera.fixed = null;
      }
      view.shot = shotCave >= 0;
      if (inCave >= 0 && running && Math.abs(dz) < COVER_DIST && !sim.caught) d.hero.pose = 'cover';

      // Inside the snow body: the body is hidden by the visual, the HUD shows a soft white veil.
      view.veil = running && d.visual.insideBody(d.camera.camera.position);
      d.hud.setVeil(view.veil);
    },
  };
  return view;
}

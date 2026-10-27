// What: How the avalanche looks and feels each frame: banner, frost frame, cave arrow, the mouth to keep in the view, wide camera frame, shake, white veil and the hero covering his head.
// Called by: main.ts (createWaveView); app/handles.ts (type).
// Keep: Reads the sim, never changes it; feel values live in tuning avalanche (?debug=1 sliders) - new ones go there, not into this file.

/**
 * How the avalanche looks and feels each frame (docs/01-gdd.md 4.3, 4.8; docs/02-tech.md 7, 8.3): «Avalanche in N»,
 * frost frame, steady arrow to the lit cave, wide camera frame on the wave from the cave, shake by distance,
 * white veil inside the snow body, the hero covering his head while the front goes over the cave.
 * Reads the simulation, never changes it.
 */
import { Sphere, Vector3 } from 'three';
import type { TuningJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { CameraRig } from '../render/camera.ts';
import type { CharacterInstance } from '../render/characters.ts';
import type { AvalancheVisual } from '../render/threat/avalanche.ts';
import type { CavePart } from '../render/level-mesh.ts';
import type { Hud } from '../ui/hud.ts';
import type { GameAudio } from '../audio/index.ts';
import type { ControlFrame } from '../input/control-frame.ts';
import { t } from '../ui/i18n.ts';
import { NICHE_WALL } from '../level/builder.ts';
import { distToEntrance, entranceX } from '../sim/shelter.ts';

/** Shake amplitude share while the front is far (0.05 of 0.3 units, docs/01-gdd.md 4.8) and the longest strong burst. */
const FAR_SHAKE_SHARE = 0.17;
/** Z-11: the command under the count holds at least this long before another replaces it. */
const SUB_HOLD_SEC = 1.5;
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
/** M5-02 (docs/01-gdd.md 4.8): the rumble — 20% on warn and while the front is far, 60% at nearDist, 80% at the hero; the
 * front farther than RUMBLE_FAR — the far level. */
const RUMBLE: [number, number, number] = [0.2, 0.6, 0.8];
const RUMBLE_FAR = 160;
const RUMBLE_SFX = 'avalancheRumble';
/** Z-01: the parts of a grotto that stop the camera while the hero is in it (level/builder.ts kinds). */
const GROTTO_WALLS: ReadonlySet<string> = new Set(['nicheWall', 'nicheRoof', 'islandWall', 'islandRoof']);

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
  /** These parts of this cave are not drawn while the frame looks through them (−1 — all drawn; PR-07). */
  hideCaveParts(niche: number, parts: readonly CavePart[]): void;
  /** The sound layer (the rumble), null — no sound yet. */
  audio?(): GameAudio | null;
}

export interface WaveView {
  update(frameDt: number, timeSec: number): void;
  /** For __TEST__.state(): what the HUD shows now. */
  readonly banner: string | null;
  /** Z-01: the command line under the banner (stages pace), null — none. */
  readonly sub: string | null;
  readonly arrow: boolean;
  readonly shot: boolean;
  /** The same wide frame on the belt of a cave outside an avalanche (PR-11). */
  readonly beltShot: boolean;
  readonly veil: boolean;
  /** The mouth of the lit shelter while the arrow leads to it, farther than camera.shelterKeep (closer the view would spin past
   * the mouth); null — none. */
  readonly keep: Vector3 | null;
}

export function createWaveView(d: WaveViewDeps): WaveView {
  const av = d.tuning.avalanche;
  const p = new Vector3();
  let shotCave = -1;
  /** The frame asked for shotCave (avalanche.caveShot, waveShot or firstWaveShot) — it is set anew when that changes. */
  let shotSpec: TuningJson['avalanche']['caveShot'] | null = null;
  /** The cave of the last wide frame: its parts stay hidden while the camera blends back. */
  let wallCave = -1;
  // The frame point behind the back wall (pos[0] > 1) or over the roof (pos[1] > 1): that part is not drawn.
  const cutOf = (shot: TuningJson['avalanche']['caveShot']): CavePart[] => [...(shot.pos[0] > 1 ? (['back'] as const) : []), ...(shot.pos[1] > 1 ? (['roof'] as const) : [])];
  let cutParts: CavePart[] = cutOf(av.caveShot);
  let strongSec = 0;
  let shownSub: string | null = null;
  let subAge = 0;
  /** The player turned the camera by hand on this stay on the belt: his camera until the hero leaves the belt (PR-11). */
  let beltManual = false;
  const keepAt = new Vector3();
  /** Z-01: the cave whose walls stop the camera now and those walls. */
  let solidCave = -1;
  let solidWalls: CameraRig['solid'] = null;
  const view: WaveView & { banner: string | null; sub: string | null; arrow: boolean; shot: boolean; beltShot: boolean; veil: boolean; keep: Vector3 | null } = {
    banner: null,
    sub: null,
    arrow: false,
    shot: false,
    beltShot: false,
    veil: false,
    keep: null,
    update(frameDt, timeSec) {
      const sim = d.getSim();
      const ts = sim.threat?.state;
      if (!ts) {
        // No avalanche here (the base, docs/01-gdd.md 19.2): nothing of the last wave stays on the screen.
        d.visual.group.visible = false;
        view.banner = null;
        view.sub = null;
        view.arrow = false;
        view.shot = false;
        view.beltShot = false;
        view.veil = false;
        view.keep = null;
        d.hud.setWaveBanner(null);
        d.hud.setFrost(0);
        d.hud.setCaveArrow(null);
        d.hud.setVeil(false);
        d.audio?.()?.hum(RUMBLE_SFX, 0);
        d.audio?.()?.duckMusic(false);
        if (shotCave >= 0) d.camera.fixed = null;
        shotCave = -1;
        d.camera.shelter = null;
        d.camera.solid = null;
        solidCave = -1;
        return;
      }
      d.visual.group.visible = true;
      const hero = sim.hero.pos;
      const running = ts.phase === 'run';
      const dz = running ? ts.frontZ - hero.z : Infinity;
      d.visual.update(ts, timeSec, d.camera.camera.position);

      // Up past the point the front starts from (docs/01-gdd.md 17.1, 17.5: the finish straight is the giant's): it rolls
      // down below him, no banner, frost or arrow to a grotto behind him (playtest SP: «Avalanche in 11» 8 units off the
      // end of the giant's zone sent the hero 330 units back down).
      const safeAbove = !ts.scripted && ts.phase !== 'idle' && hero.z >= ts.spawnZ;
      // Banner: «Avalanche in N» on warn, «Avalanche!» until the front reaches the hero.
      let banner: string | null = null;
      if (safeAbove) banner = null;
      else if (ts.phase === 'warn') banner = t('wave.warn', { n: Math.max(1, Math.ceil(ts.timer)) });
      else if (running && ts.outcome === 'none' && dz > 0) banner = t('wave.run');
      view.banner = banner;
      // Z-01 (playtest G: «bring the golden gift», «duck behind a rock» and an arrow at once): on the stages pace one command
      // under the count — behind the rock of the lit grotto (into a cave on the edge), or on to the safe finish with none.
      let sub: string | null = null;
      if (banner !== null && sim.level.stages && !sim.caught && sim.shelterIndex() < 0) {
        const c = sim.level.niches[ts.shelter];
        sub = !c ? t('hint.toFinish') : c.canopy ? t('hint.canopy') : c.kind === 'island' ? t('hint.cover') : t('wave.cave');
      }
      // Z-11 (usability review: at a stage border it jumped 4 times in 3 s): a new command only after SUB_HOLD_SEC of
      // the old one; none — at once.
      subAge += frameDt;
      if (sub !== null && shownSub !== null && sub !== shownSub && subAge < SUB_HOLD_SEC) sub = shownSub;
      if (sub !== shownSub) subAge = 0;
      shownSub = sub;
      view.sub = sub;
      d.hud.setWaveBanner(banner, sub);

      // Frost frame and shake by distance (docs/01-gdd.md 4.8).
      let frost = 0;
      let shake = 0;
      if (ts.phase === 'warn' && !safeAbove) frost = FROST_WARN;
      if (running && Math.abs(dz) <= d.tuning.avalanche.nearDist * 3) {
        const near = Math.abs(dz) < av.nearDist;
        frost = near ? 1 : FROST_WARN;
        strongSec = near ? strongSec + frameDt : 0;
        shake = near && strongSec <= STRONG_SHAKE_MAX_SEC ? 1 - Math.abs(dz) / av.nearDist : FAR_SHAKE_SHARE;
      } else strongSec = 0;
      d.hud.setFrost(frost);
      // The rumble by the distance to the front, in the pitch of this mountain's avalanche (theme.json threat.worlds).
      let rumble = 0;
      if (ts.phase === 'warn' && !safeAbove) rumble = RUMBLE[0];
      else if (running) {
        const a = Math.abs(dz);
        rumble =
          a >= RUMBLE_FAR ? RUMBLE[0] : a >= av.nearDist ? RUMBLE[1] + ((RUMBLE[0] - RUMBLE[1]) * (a - av.nearDist)) / (RUMBLE_FAR - av.nearDist) : RUMBLE[2] + ((RUMBLE[1] - RUMBLE[2]) * a) / av.nearDist;
      }
      d.audio?.()?.hum(RUMBLE_SFX, rumble * av.rumble, d.visual.look.rumble);
      // G-09: the music steps aside while the wave warns and runs.
      d.audio?.()?.duckMusic(rumble > 0);
      if (shake > 0) d.camera.shakeAmount = Math.max(d.camera.shakeAmount, Math.max(FAR_SHAKE_SHARE, shake) * av.shakeStrength);

      // Arrow to the lit cave from the first second of the warning until the hero is in it, steady (playtest M2: it
      // came and went with the cave entering the view): at the field edge towards the cave when it is off screen,
      // right above the cave mouth pointing down when it is on screen.
      const cave = sim.level.niches[ts.shelter];
      let arrow: { x: number; y: number; angle: number } | null = null;
      view.keep = null;
      if (cave && !safeAbove && (ts.phase === 'warn' || (running && ts.outcome === 'none')) && sim.shelterIndex() < 0) {
        // A tunnel (docs/01-gdd.md 18.3) and a grotto in a rock (SP-04): its nearer mouth, not the track edge by its middle.
        if (cave.kind === 'tunnel' || cave.kind === 'island') {
          const e = distToEntrance(sim.level, cave, hero.x, hero.z);
          p.set(e.tx, cave.y + 4, e.tz);
        } else p.set(entranceX(sim.level, cave), cave.y + 4, cave.z);
        // Q-066: the camera keeps that mouth in the view (playtest of «Размах»: back to the first rock the view looked into
        // his face), until he is close to it.
        const near = d.tuning.camera.shelterKeep ?? 0;
        if (near > 0 && !sim.caught && Math.hypot(p.x - hero.x, p.z - hero.z) > near) view.keep = keepAt.copy(p);
        p.project(d.camera.camera);
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

      // Wide cave frame (docs/02-tech.md 7; docs/01-gdd.md 16.7, playtest M3): from the hero in the lit cave on warn
      // until the front is shotTriggerDist past it, the camera stands high on the downhill side by the back wall and
      // looks out of the mouth at the slope, where the avalanche comes from. The cave is too low for the whole hero on
      // the belt at ≤ 30% of the frame, so the camera stands over the roof line (caveShot.pos[1] > 1) and the roof is
      // not drawn meanwhile (behind the back wall with pos[0] > 1 — that wall; docs/допущения.md). Turned by hand —
      // the player's camera (not scripted).
      // The same frame on the belt of a cave outside an avalanche (PR-11; playtest of the prototype, item 2: on every
      // belt the camera flew into the hero): on the belt or in a jump over it; turned by hand — the player's camera
      // until the hero leaves the belt.
      const inCave = sim.shelterIndex();
      // The grotto frame (RG-13, docs/01-gdd.md 18.8 item 3): from the slope off the mouth of the shelter the hero is in,
      // looking at him (a tunnel: from behind him along its hall); the rig cuts to it when pressed into a wall there.
      // SD-01 (docs/01-gdd.md 23.1, camera.grottoFrame false): no frame of its own in grottos and caves — the view behind him.
      const frames = d.tuning.camera.grottoFrame !== false;
      const sh = frames && inCave >= 0 && !sim.caught ? sim.level.niches[inCave]! : null;
      if (sh && sh.kind !== 'ledge') {
        const gs = d.tuning.camera.grottoShot;
        const f = d.camera.shelter ?? { pos: new Vector3(), look: new Vector3(), fov: gs.fov };
        f.fov = gs.fov;
        f.look.set(hero.x, hero.y + 1.5, hero.z);
        if (sh.kind === 'tunnel') f.pos.set((sh.box.min[0] + sh.box.max[0]) / 2, sh.y + gs.height, Math.max(sh.box.min[2] + 1, hero.z - gs.back - gs.out));
        // A grotto in a rock (SP-04): from out of its mouth towards the camp.
        else if (sh.kind === 'island') f.pos.set((sh.box.min[0] + sh.box.max[0]) / 2, sh.y + gs.height, sh.box.min[2] - gs.back - gs.out);
        else {
          const sign = sh.side === 'left' ? -1 : 1;
          f.pos.set(entranceX(sim.level, sh) - sign * gs.out, sh.y + gs.height, sh.z - gs.back);
        }
        d.camera.shelter = f;
      } else d.camera.shelter = null;
      // Z-01 (playtest G, pc-049s: the camera went into the walls of a grotto): with the grotto frame off the level lets the
      // camera pass grotto walls (SD-01) — those of the grotto the hero is in stop it, so the view stays in the room with him.
      const wallsOf = !frames && inCave >= 0 && !sim.caught ? inCave : -1;
      if (wallsOf !== solidCave) {
        solidCave = wallsOf;
        const n = sim.level.niches[wallsOf];
        const m = NICHE_WALL + 0.05;
        solidWalls = n
          ? sim.level.boxes.filter((b) => GROTTO_WALLS.has(b.kind) && b.max[0] >= n.box.min[0] - m && b.min[0] <= n.box.max[0] + m && b.max[2] >= n.box.min[2] - m && b.min[2] <= n.box.max[2] + m && b.max[1] >= n.box.min[1] - m && b.min[1] <= n.box.max[1] + m)
          : null;
      }
      d.camera.solid = solidWalls;
      // Q-067: held until the whole snow body has passed him (shotUntilClear), not only its front.
      const holdPast = av.shotTriggerDist + (av.shotUntilClear ? av.bodyLength : 0);
      const waveShot = inCave >= 0 && !sim.caught && (ts.phase === 'warn' || (running && dz > -holdPast)) && (ts.scripted || !d.manualCamera());
      const belt = inCave >= 0 && !sim.caught && (sim.onBelt || (shotCave === inCave && !sim.hero.onGround));
      // Turned on the belt: the camera input of the last frame, not a turn just before stepping on it.
      if (!belt) beltManual = false;
      else if (d.camera.sinceManual === 0) beltManual = true;
      const beltShot = !waveShot && belt && !beltManual;
      const wantShot = frames && (waveShot || beltShot);
      if (wantShot) {
        const c = sim.level.niches[inCave]!;
        // Q-067: on an avalanche with shotUntilClear its own frame (inside the shelter behind the hero), the belt keeps its.
        const plain = waveShot && av.shotUntilClear && av.waveShot ? av.waveShot : av.caveShot;
        // LV-10 (docs/01-gdd.md 22.11): the scripted first wave in a grotto in a rock — out of its mouth over the roof, up the
        // slope where the front comes from (playtest: pressed to the rock wall, the climax of the first minute was not seen).
        const spec = waveShot && ts.scripted && av.firstWaveShot && c.kind === 'island' ? av.firstWaveShot : plain;
        if (shotCave !== inCave || shotSpec !== spec) {
          shotSpec = spec;
          const sign = c.side === 'left' ? -1 : 1;
          const r = d.tuning.camera.collisionRadius + WALL_CLEARANCE;
          const mouth = entranceX(sim.level, c);
          const depth = c.box.max[0] - c.box.min[0];
          // Behind the back wall or over the roof: at least the camera radius off its outer face.
          const back = sign < 0 ? c.box.min[0] - NICHE_WALL - r : c.box.max[0] + NICHE_WALL + r;
          const roof = c.box.max[1] + NICHE_WALL + r;
          // A grotto in a rock (SP-04) opens to the camp (−z): its depth runs up the slope, its width across it (SP-10:
          // with the axes of a side grotto the frame stood over the rock and its roof hid the hero on the belt).
          const island = c.kind === 'island';
          const at = (q: readonly [number, number, number], out: Vector3, clamp: boolean): Vector3 => {
            if (island) {
              out.set(c.box.min[0] + q[2] * (c.box.max[0] - c.box.min[0]), c.box.min[1] + q[1] * (c.box.max[1] - c.box.min[1]), c.box.min[2] + q[0] * (c.box.max[2] - c.box.min[2]));
              if (clamp && q[1] > 1) out.y = Math.max(roof, out.y);
              else if (clamp) {
                if (q[0] > 1) out.z = Math.max(c.box.max[2] + NICHE_WALL + r, out.z);
                else out.z = Math.min(c.box.max[2] - r, Math.max(c.box.min[2] + r, out.z));
                out.x = Math.min(c.box.max[0] - r, Math.max(c.box.min[0] + r, out.x));
                out.y = Math.min(c.box.max[1] - r, Math.max(c.box.min[1] + r, out.y));
              }
              return out;
            }
            out.set(mouth + sign * q[0] * depth, c.box.min[1] + q[1] * (c.box.max[1] - c.box.min[1]), c.box.min[2] + q[2] * (c.box.max[2] - c.box.min[2]));
            if (clamp && q[1] > 1) out.y = Math.max(roof, out.y);
            else if (clamp) {
              if (q[0] > 1) out.x = sign < 0 ? Math.min(back, out.x) : Math.max(back, out.x);
              else out.x = Math.min(c.box.max[0] - r, Math.max(c.box.min[0] + r, out.x));
              out.y = Math.min(c.box.max[1] - r, Math.max(c.box.min[1] + r, out.y));
              out.z = Math.min(c.box.max[2] - r, Math.max(c.box.min[2] + r, out.z));
            }
            return out;
          };
          let use = spec;
          const pos = at(use.pos, new Vector3(), true);
          // That point inside the level (a rock right below the mouth): the frame of any wave.
          if (use !== plain && sim.collision.sphereHit(new Sphere(pos, r)) !== null) at((use = plain).pos, pos, true);
          cutParts = cutOf(use);
          d.camera.fixed = { pos, look: at(use.look, new Vector3(), false), fov: use.fov };
        }
        shotCave = inCave;
        wallCave = cutParts.length > 0 ? inCave : -1;
      } else if (shotCave >= 0) {
        // Back to the player's view in shotReturnSec (the rig blends out, or cuts when the way is through a wall).
        shotCave = -1;
        shotSpec = null;
        d.camera.fixed = null;
      }
      view.shot = shotCave >= 0 && waveShot;
      view.beltShot = shotCave >= 0 && beltShot;
      if (shotCave < 0 && d.camera.fixedBlend <= 0) wallCave = -1;
      d.hideCaveParts(wallCave, cutParts);
      if (inCave >= 0 && running && Math.abs(dz) < COVER_DIST && !sim.caught) d.hero.pose = 'cover';

      // Inside the snow body: the body is hidden by the visual, the HUD shows a soft white veil — not while the hero is in a
      // shelter (shotUntilClear; playtest of «Размах», cycle 3: the camera turned by hand stood in the snow out of the mouth,
      // and «Phew, made it!» came on white): the snow goes past it, he is seen.
      view.veil = running && !(av.shotUntilClear && inCave >= 0) && d.visual.insideBody(d.camera.camera.position);
      d.hud.setVeil(view.veil);
    },
  };
  return view;
}

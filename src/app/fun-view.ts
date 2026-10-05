/**
 * Fun and the gate reward as the player sees and hears them (docs/01-gdd.md 16.4, 16.5): «boing» and a puff of snow
 * off a trampoline (the plate springs), «whoosh» and a snow trail on an ice slide, «ding» of a gift on the path a note
 * higher each in a row (within tuning fun.giftStreakSec); every gate walked through — its coins as a fountain out of
 * the arch into the coin plaque with «+N», confetti of the zone colour in the arch and a chime of three notes, a
 * semitone higher for each gate within gateReward.streakSec of the last one (up to streakSteps, then it holds; a
 * longer pause starts again). The coins themselves are paid once by the simulation (gatePass). Reads the
 * simulation, never changes it.
 */
import { Vector3 } from 'three';
import type { ThemeJson, TuningJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { CameraRig } from '../render/camera.ts';
import type { LevelMeshes } from '../render/level-mesh.ts';
import type { FxParticles } from '../render/fx.ts';
import type { GameAudio } from '../audio/index.ts';
import type { Hud } from '../ui/hud.ts';
import type { FieldRect } from '../ui/fit.ts';
import { createCoinFountain, type CoinFountain } from '../ui/coin-fountain.ts';
import { formatNumber } from '../ui/format.ts';

/** Notes of the gifts in a row: the major scale up from the sound as made, then it holds at the top. */
const GIFT_SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
/** The gate chime: a major triad, the notes this far apart (s). */
const CHIME = [0, 4, 7];
const CHIME_GAP = 0.09;
/** Particles: the trampoline puff, the slide trail (every this many seconds while on it), the gate confetti. */
const PUFF = 26;
const TRAIL_EVERY = 1 / 30;
const CONFETTI = 60;
/** The points of the arch the fountain and the confetti come out of: these shares of the gate height (the camera is
 * a few units behind the hero who has just walked through: higher would be over the top of the frame). */
const COINS_AT = 0.4;
const CONFETTI_AT = 0.3;

/** A run of events in a row: the step grows by one when the next comes within `withinSec`, up to `steps` − 1. */
export interface Streak {
  step: number;
  at: number;
}

export function nextStreak(prev: Streak, t: number, withinSec: number, steps: number): Streak {
  const step = t - prev.at < withinSec ? Math.min(steps - 1, prev.step + 1) : 0;
  return { step, at: t };
}

export interface FunViewDeps {
  tuning: TuningJson;
  theme: ThemeJson;
  hud: Hud;
  camera: CameraRig;
  fx: FxParticles;
  audio(): GameAudio | null;
  meshes(): LevelMeshes | null;
  field(): FieldRect;
  numSuffix(k: string): string;
}

export interface FunViewState {
  /** Gate fountains started, coins of them in the air, confetti alive, the note of the last chime (0 … streakSteps − 1). */
  fountains: number;
  coinsFlying: number;
  confetti: number;
  gateNote: number;
  /** Gate chimes rung (one per gate passed). */
  chimes: number;
  /** Trampoline puffs, slide trail particles alive, snow puff particles alive, the note step of the last path gift. */
  puffs: number;
  trail: number;
  puffAlive: number;
  giftNote: number;
  slides: number;
}

export interface FunView {
  wire(sim: Sim): void;
  update(gameDt: number, timeSec: number, heroRender: Vector3): void;
  readonly state: FunViewState;
}

export function createFunView(d: FunViewDeps): FunView {
  const fountain: CoinFountain = createCoinFountain(d.hud.root, () => d.hud.coinTarget(), d.theme.ui.coins);
  const st = { fountains: 0, chimes: 0, gateNote: 0, puffs: 0, giftNote: 0, slides: 0 };
  let gateStreak: Streak = { step: 0, at: -Infinity };
  let giftStreak: Streak = { step: 0, at: -Infinity };
  let now = 0;
  let trailAcc = 0;
  let sim: Sim | null = null;
  const p = new Vector3();
  const color = (key: string, def: string): string => d.theme.materials[key]?.color ?? def;

  /** Field px of a world point; behind the camera — the bottom middle of the field. */
  const onScreen = (x: number, y: number, z: number): { x: number; y: number } => {
    const f = d.field();
    p.set(x, y, z).project(d.camera.camera);
    if (p.z > 1) return { x: f.width / 2, y: f.height };
    return { x: Math.min(f.width, Math.max(0, (p.x * 0.5 + 0.5) * f.width)), y: Math.min(f.height, Math.max(0, (0.5 - p.y * 0.5) * f.height)) };
  };

  const view: FunView = {
    wire(s) {
      sim = s;
      fountain.clear();
      s.events.on('padLaunch', ({ index, x, y, z }) => {
        st.puffs++;
        d.audio()?.play('jumpPad');
        d.fx.burst('puff', x, y + 0.2, z, [color('snowPuff', '#ffffff')], PUFF, 7, 1.6);
        d.meshes()?.pressPad(index, now);
      });
      s.events.on('slideEnter', () => {
        st.slides++;
        d.audio()?.play('slide');
      });
      s.events.on('giftTake', ({ path }) => {
        if (!path) return;
        giftStreak = nextStreak(giftStreak, now, d.tuning.fun.giftStreakSec, GIFT_SCALE.length);
        st.giftNote = giftStreak.step;
        d.audio()?.play('pathGift', GIFT_SCALE[giftStreak.step] ?? 0);
      });
      s.events.on('gatePass', ({ index, wall, coins }) => {
        const g = s.level.gates[index];
        if (!g) return;
        const r = d.tuning.gateReward;
        // Fountain: min … max coins by the wall number, out of the arch into the plaque, «+N» when the first is there.
        const n = r.fountain[0] + (wall % (r.fountain[1] - r.fountain[0] + 1));
        const from = onScreen(0, g.y + g.height * COINS_AT, g.z);
        st.fountains++;
        fountain.start(from.x, from.y, n, () => d.hud.popCoinGain(`+${formatNumber(coins, d.numSuffix)}`));
        d.fx.burst('confetti', 0, g.y + g.height * CONFETTI_AT, g.z, [d.theme.rarity[g.rarity] ?? '#ffffff', d.theme.ui.coins, '#ffffff'], CONFETTI, 10, 6);
        // The chime: a semitone higher for each gate in a row (docs/01-gdd.md 16.5).
        gateStreak = nextStreak(gateStreak, now, r.streakSec, r.streakSteps);
        st.gateNote = gateStreak.step;
        st.chimes++;
        const audio = d.audio();
        CHIME.forEach((semi, k) => audio?.play('gate', gateStreak.step + semi, k * CHIME_GAP));
      });
    },
    update(gameDt, timeSec, heroRender) {
      now = timeSec;
      fountain.update(gameDt);
      // The snow trail behind the hero while the slide boost runs on the ground.
      const h = sim?.hero;
      if (sim && h && h.onGround && h.speed > 2 && (sim.fun.onSlide >= 0 || sim.fun.slideLeft > 0)) {
        trailAcc += gameDt;
        while (trailAcc >= TRAIL_EVERY) {
          trailAcc -= TRAIL_EVERY;
          const back = 0.9 / Math.max(1, h.speed);
          d.fx.burst('trail', heroRender.x - h.vel.x * back, heroRender.y + 0.15, heroRender.z - h.vel.z * back, [color('slideTrail', '#ffffff'), '#ffffff'], 3, 2.5, 0.5);
        }
      } else trailAcc = 0;
      d.meshes()?.update(timeSec);
      d.fx.update(gameDt);
    },
    get state() {
      return {
        fountains: st.fountains,
        coinsFlying: fountain.flying,
        confetti: d.fx.alive('confetti'),
        gateNote: st.gateNote,
        chimes: st.chimes,
        puffs: st.puffs,
        trail: d.fx.alive('trail'),
        puffAlive: d.fx.alive('puff'),
        giftNote: st.giftNote,
        slides: st.slides,
      };
    },
  };
  return view;
}

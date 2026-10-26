// What: Simulation of one mountain: ties hero, steps and stat, gates, gifts, caves, avalanche, caught clip, bots, golden gift, egg and fun behind createSim().step().
// Called by: main.ts and 12 app/* modules (*-view, rewards, handles); tests/sim/*, tests/level/mountain.test.ts, tests/meta/*
// Keep: Pure TS, no DOM/render, seeded rng only; the Sim interface and SimEvents are the contract of the app views and the test API - extend, do not rename.

/**
 * Simulation of one mountain (docs/02-tech.md 4.2, 6.1): hero, checkpoints, fall and respawn.
 * Steps and the stat (M2-01, `steps.ts`): run speed follows the stat through the `moveSpeed` effect.
 * Gates that open (M2-02), the summit portal (M2-03), gifts and coins (M2-04), the avalanche (M2-05…M2-07),
 * coins for passing a gate and the free egg of the first minute (M2-08), the golden gift of the warning (M2-12).
 * Pure TS, no DOM, no rendering.
 */
import { createEmitter, type Emitter } from '../core/events.ts';
import type { Aabb, LevelData, LevelGate } from '../level/types.ts';
import type { BalanceJson, Curve, GameEvents, TuningJson } from '../content/types.ts';
import { moveSpeed } from './effects/moveSpeed.ts';
import { jumpPower } from './effects/jumpPower.ts';
import { createStepTracker, type StepGain, type StepTracker } from './steps.ts';
import { gateIsOpen, gateRequirement, type WallCount } from './gates.ts';
import { levelNeeded, levelOf, levelThreshold } from './levels.ts';
import { scaled } from './economy.ts';
import { giftsFromLevel, touchesGift, type Gift } from './gifts.ts';
import { createCollisionWorld, type CollisionWorld } from './collision.ts';
import { beltAt, belts, shelterIndex, shelterNow } from './shelter.ts';
import { createThreat, type Threat, type ThreatEvents, type ThreatOptions } from './threat.ts';
import { caughtPosition, caughtTotalSec, createCaught, type CaughtState } from './caught.ts';
import { createGiftEgg, stepGiftEgg, type GiftEggState } from './gift-egg.ts';
import { createMilestones, type Milestones } from './milestones.ts';
import { createBots, type BotContext, type BotCrowd, type BotsOptions } from './bots.ts';
import { placeBonus, touchesBonus, zoneAt, type BonusConfig, type BonusState } from './bonus.ts';
import { createRng } from '../core/rng.ts';
import { inSafeZone } from './shelter.ts';
import { BORDER_HEIGHT, BORDER_WIDTH, PORTAL_WIDTH } from '../level/builder.ts';
import { createHero, placeHero, stepHero, type ControllerParams, type HeroInput, type HeroState, NO_INPUT } from './controller.ts';
import { createFun, funInput, resetFun, stepFun, type FunState } from './fun.ts';
import { createBoss, type Boss, type BossEvents } from './boss.ts';
import { createEvents, type EventEvents, type EventId, type Events, type EventsContext } from './events.ts';

/** SD-03: from the trophy button to the camp after this many ticks (the toast and the confetti first). */
const CAMP_RETURN_TICKS = 50;

export interface SimEvents extends Omit<ThreatEvents, 'waveSurvived'>, BossEvents, EventEvents, Record<string, unknown> {
  /**
   * «Phew, made it!» (docs/01-gdd.md 4.4): `coins` = coins.waveSurvived × gift of the cave's zone × wallScale[tier],
   * plus `gold` when the hero brought the golden gift into the cave (one toast, docs/01-gdd.md 4.9).
   */
  waveSurvived: ThreatEvents['waveSurvived'] & { coins: number; total: number; gold: number };
  /** Golden gift (docs/01-gdd.md 4.9): placed on warn, taken, saved (`coins` = mult × zone gift × wallScale) or lost. */
  bonusSpawn: { tick: number; x: number; y: number; z: number; zone: number };
  bonusTake: { tick: number; x: number; y: number; z: number };
  bonusSaved: { tick: number; coins: number; total: number; where: 'cave' | 'portal' | 'gone' };
  bonusLost: { tick: number; x: number; y: number; z: number };
  step: { tick: number };
  checkpoint: { index: number; z: number };
  fall: { tick: number; z: number };
  respawn: { tick: number; z: number; checkpoint: number };
  jump: { tick: number };
  /** `z` — where he came down (e2e: the landing of a flight, independent of how often the test looks). */
  land: { tick: number; airTime: number; z: number };
  /** One step taken: the stat grew by `amount` (docs/01-gdd.md 3.3); `belt` — taken on a treadmill belt. */
  gain: StepGain & { tick: number; belt: boolean };
  /** A gate melted open: the stat reached its requirement (docs/01-gdd.md 3.3). */
  gateOpen: { tick: number; index: number; wall: number; z: number; requires: number };
  /** The hero walked through an open gate for the first time: `coins` = gate reward × wallScale[tier] (docs/01-gdd.md 6.2, 10.3). */
  gatePass: { tick: number; index: number; wall: number; coins: number; total: number };
  /** The free egg (docs/01-gdd.md 6.2): touched, then the pet jumps out `ftue.eggHatchSec` later. */
  eggTouch: { tick: number };
  eggHatch: { tick: number; pet: string };
  /** The stat crossed a round number of balance.ui.statMilestones for the first time in this load (M2-13, no analytics). */
  statMilestone: { tick: number; value: number };
  /** A trophy button taken (docs/01-gdd.md 22.8): the stage, the trophies (coins of the stages pace) and the total. */
  trophyTake: { tick: number; stage: number; amount: number; x: number; y: number; z: number; total: number; trophies: boolean; spent?: boolean };
  /** SD-03 (docs/01-gdd.md 23.3): after the trophies of a stage the hero is back in the camp — a new run. */
  campReturn: { tick: number; stage: number };
  /** A gift touched: `coins` added (zone gift × wallScale[tier]), `total` is the coin balance after it; `path` — a gift on the path. */
  giftTake: { tick: number; index: number; coins: number; zone: number; rarity: string; total: number; path: boolean };
  /** A trampoline threw the hero up (docs/01-gdd.md 16.4): `index` of `fun.pads`, where. */
  padLaunch: { tick: number; index: number; x: number; y: number; z: number };
  /** The hero got onto an ice slide (`index` of `fun.slides`). */
  slideEnter: { tick: number; index: number };
  /** All gifts back in place (after every avalanche, docs/01-gdd.md 3.2). */
  giftsRespawn: { tick: number; count: number };
  /** «Snowed in!» is over: the ball popped in a cave below (`niche`) or in the camp (−1), controls are back. */
  caughtEnd: { tick: number; sec: number; niche: number; x: number; y: number; z: number };
  /** The hero walked through the summit portal (docs/01-gdd.md 5.2): `next` is the next mountain index, null after the last. */
  portal: { tick: number; from: number; next: number | null };
  /** Open slope (docs/01-gdd.md 17.7): back up past the record flag after being sent below it — «New height!». */
  recordUp: { tick: number; z: number };
  /** Elements of the slope (docs/01-gdd.md 18.3): down on the bottom of a chasm, into a tunnel — each time he gets there. */
  chasmDown: { tick: number; section: number };
  tunnelEnter: { tick: number; section: number };
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
  /** G-01 (producer 26.10): giant catches left that let the hero go without a roll-back (main sets 1 until the first). */
  giantFreeCatches: number;
  /** G-01: seconds the giants still leave the hero alone after a free catch (`balance.caught.giantFreeSec`). */
  giantGraceSec: number;
  /** Stages pace (docs/01-gdd.md 22.9): the stage of the last roll-back (its «Continue from stage N»), 0 — none. */
  rollFrom: number;
  /** Per stage of `level.stages`: its trophy button taken on this pass (docs/01-gdd.md 22.8). */
  readonly padTaken: boolean[];
  /** The flag of stage n (docs/01-gdd.md 22.9): where «Continue from stage N» puts the hero; the camp for stage 1. */
  stageStart(n: number): { x: number; y: number; z: number };
  /** Gifts of this mountain (M2-04) and the coin balance. */
  readonly gifts: Gift[];
  coins: number;
  /** Puts every gift back (`balance.gifts.respawn: "onWaveGone"`; `"never"` — not on a wave). */
  respawnGifts(): void;
  /** The avalanche of this mountain (M2-06); null when the sim runs without a threat (unit tests of other parts). */
  readonly threat: Threat | null;
  /** «Snowed in!» clip in progress (M2-07): the hero is a snowball, no control; null otherwise. */
  caught: CaughtState | null;
  /** Per gate: the hero has walked through it after it opened (coins paid once per gate). */
  readonly gatesPassed: boolean[];
  /** The free egg «Mountain Gift» in its cave (M2-08); null when the player already has it or on other mountains. */
  readonly giftEgg: GiftEggState | null;
  /** Round numbers of the stat already celebrated (M2-13); `reset` after a rebirth. */
  readonly milestones: Milestones;
  /** Bots on the track (M2-10); null when the sim runs without them. */
  readonly bots: BotCrowd | null;
  /** Golden gift of this wave (M2-12): on the ground or carried by the hero; null when there is none. */
  bonus: BonusState | null;
  /** __TEST__.giveBonus(): the hero carries a golden gift now (only with threat.bonus in the data, on warn or run). */
  giveBonus(): boolean;
  /** True once the hero has walked through the portal of this mountain (one `portal` event per sim). */
  portalEntered: boolean;
  /** Trampolines and ice slides of the mountain: the flight and the boost now (docs/01-gdd.md 16.4). */
  readonly fun: FunState;
  /** Record flag of the open slope (docs/01-gdd.md 17.7): the highest point on the ground of this life on the mountain;
   * null — none yet, or no record flag in this pace. */
  record: { x: number; y: number; z: number } | null;
  /** Giants of the open slope (docs/01-gdd.md 17.6); null when the mountain has none or the sim runs without them. */
  readonly boss: Boss | null;
  /**
   * «Slowed» (docs/01-gdd.md 18.5): one status for a helper's snowball, the rolling ball and the blizzard — the run ×
   * `mult` for `left` more seconds of simulation (a pause or a window steps no sim, so it does not tick); null — none.
   */
  slow: { mult: number; left: number } | null;
  /** Slows the hero × mult for sec: hits in a row do not stack — the stronger mult and the longer time. */
  slowDown(mult: number, sec: number): void;
  /** Rare events of the open slope (docs/01-gdd.md 18.4); null — none in this pace or this sim. */
  readonly rare: Events | null;
  /** Hit by the rolling snowball: the hero tumbles in place for `sec` (t of it gone), then «slowed» × slow for slowSec. */
  tumble: { t: number; sec: number; slow: number; slowSec: number } | null;
  step(input: HeroInput, dt: number): void;
  teleport(x: number, y: number, z: number): void;
  respawn(): void;
  /** Treadmill multiplier of the belt the hero stands on, 1 on plain ground (docs/02-tech.md 5.3). */
  treadmillAt(): number;
  /** Step multiplier of the section the hero is on (open slope, docs/01-gdd.md 17.4); 1 in the camp and elsewhere. */
  sectionMult(): number;
  /** The hero stands on a treadmill belt: he runs in place by himself, steps count at run speed (M2-05). */
  onBelt: boolean;
  /** Index of the cave sheltering the hero (cave volume + niche.graceDist past the entrance), −1 outside. */
  shelterIndex(): number;
  inShelter(): boolean;
  /** Requirement of gate `index` on this tier (docs/01-gdd.md 8.1). */
  gateRequirement(index: number): number;
}

export interface SimOptions {
  balance: Pick<BalanceJson, 'stepLength' | 'gainPerStep' | 'rebirth'> & { upgrade?: { currency?: 'coins' | 'trophies' };
    gifts?: BalanceJson['gifts'];
    niche?: BalanceJson['niche'];
    coins?: BalanceJson['coins'];
    caught?: BalanceJson['caught'];
    levels?: BalanceJson['levels'];
    ui?: Partial<BalanceJson['ui']>;
  };
  /** The avalanche (docs/02-tech.md 8.1): world threat, balance and tuning, save counters. */
  threat?: ThreatOptions;
  /** Coins carried in (portal to the next mountain). */
  coins?: number;
  /** Rebirth tier n (0 at the start). */
  tier?: number;
  /** Stat → run speed (docs/02-tech.md 6.1): base and max from tuning, k from balance. */
  speedCurve: Curve;
  /** M5-09 (docs/01a-content.md 14.2): stat → takeoff speed (effect `jumpPower`); absent — tuning's jumpSpeed. */
  jumpCurve?: Curve | null;
  stat?: number;
  /** Step multiplier of the meta (shoes × pets, docs/01-gdd.md 8.1): set by the meta layer, 1 by default. */
  gainMult?: number;
  /** The free egg of the first minute: placed beside the belt of cave `wall`; omitted once the player has it; `shown`
   * false — not there until the app shows it after the scripted wave (docs/01-gdd.md 16.6). */
  giftEgg?: { wall: number; pet: string; hatchSec: number; shown?: boolean } | undefined;
  /** Bots (docs/01-gdd.md 7.12): bots.json, how many for the quality level and the seed; caught and avalanche come from here. */
  bots?: Pick<BotsOptions, 'cfg' | 'count' | 'seed' | 'belts'> | undefined;
  /** Golden gift (docs/01-gdd.md 4.9): game.json threat.bonus, the seed, normal waves of this load before this mountain. */
  bonus?: { cfg: BonusConfig; seed: number; wavesBefore: number } | undefined;
  /**
   * Back after F5 or another day (docs/01-gdd.md 6.6, M3-07): walls up to `frontierWall` are passed (no coins again),
   * every wall the stat reaches stands open from the start, the hero stands at the flag behind `frontierWall`.
   */
  resume?: { frontierWall: number } | undefined;
  /** Walls before this mountain and in all (worlds.json): the through number of lateEase; absent — 12 a mountain, 60. */
  walls?: WallCount | undefined;
  /** Record flag (open slope, docs/01-gdd.md 17.7): the one of the save on this mountain or null; absent — no record flag. */
  record?: { x: number; y: number; z: number } | null | undefined;
  /** Rare events (game.json events, docs/01-gdd.md 18.4): rolled by `seed`; `force` (?mock_event=) — every entry. */
  events?: { cfg: GameEvents; seed: number; force?: EventId | undefined } | undefined;
  /** The giant (game.json threat.boss): with the zones of the level the mountain has giants. */
  boss?: { margin: number; reach: number; run?: number | undefined } | undefined;
  /** ST-06: whether the pad of stage n still pays this time (meta/trophies.ts padPays); absent — always. The flight to the camp stays. */
  padPay?: ((stage: number) => boolean) | undefined;
}

/** Half side of the trophy button square the hero stands in to take it (docs/01-gdd.md 22.8; the pad is 6 × 6). */
const PAD_REACH = 3.5;

/** The stage the hero is on at z (docs/01-gdd.md 22.4): the last one whose ridge is below him; 0 — no stages. */
export function stageAt(level: Pick<LevelData, 'stages'>, z: number): number {
  let n = 0;
  for (const st of level.stages ?? []) if (z >= st.z0 || n === 0) n = st.n;
  return n;
}

/** «The giant caught you!»: the hero rolls back to this far below the start of the zone (docs/01-gdd.md 17.6). */
const BOSS_BACK = 3;

/** How far past the side borders a closed gate blocks (over the void): a jump around its end never lands back. */
const GATE_SIDE_BLOCK = 20;

/**
 * The collider of a closed gate: its ice across the track, and over the side borders and past them, as much higher as a
 * border is tall — a jump from a border top never clears it (producer's playtest PS: past a wall along the border,
 * every pace). The ice drawn stays `box`.
 */
function gateBlock(g: LevelGate): Aabb {
  const side = BORDER_WIDTH + GATE_SIDE_BLOCK;
  return { min: [g.box.min[0] - side, g.box.min[1], g.box.min[2]], max: [g.box.max[0] + side, g.box.max[1] + BORDER_HEIGHT, g.box.max[2]] };
}

/** The record flag shows, and passing it again says «New height!», once the hero is this far below it. */
export const RECORD_RETURN = 20;

export const RESPAWN_FADE_TICKS = 18;
/** The hero is past a gate when his centre is this far beyond its plane. */
const GATE_PASS_DIST = 1;

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
  const collision = createCollisionWorld(level.staticTriangles, level.boundsTriangles);
  const gatesOpen = level.gates.map(() => false);
  const tier = opts.tier ?? 0;
  // The giant's check (gate of kind boss, docs/01-gdd.md 17.6) is a line, never a collider.
  const syncGates = (): void => collision.setDynamicBoxes(level.gates.filter((g, i) => !gatesOpen[i] && g.kind !== 'boss').map(gateBlock));
  syncGates();
  const hero = createHero(level.spawn);
  const events = createEmitter<SimEvents>();
  if ((opts.balance.gifts?.respawn ?? 'onWaveGone') === 'onWaveGone') events.on('waveGone', () => sim.respawnGifts());
  const progress = createStepTracker(opts.balance, opts.stat ?? 0);
  progress.gainMult = opts.gainMult ?? 1;
  const speedCurve: Curve = { ...opts.speedCurve };
  const params = controllerParams(tuning, moveSpeed(progress.stat, speedCurve));
  const prev = { x: hero.pos.x, z: hero.pos.z, onGround: hero.onGround };
  const portal = level.points.find((p) => p.type === 'portal');
  const portalNext = typeof portal?.['next'] === 'number' ? (portal['next'] as number) : null;
  const portalHalf = (typeof portal?.['width'] === 'number' ? (portal['width'] as number) : PORTAL_WIDTH) / 2;
  const beltList = belts(level);
  const heroView = { x: 0, y: 0, z: 0, vx: 0, vz: 0 };
  const graceDist = opts.balance.niche?.graceDist ?? 0;
  const grace = { graceDist, graceMoving: opts.balance.niche?.graceMoving ?? 0 };
  const recordOn = opts.record !== undefined;
  /** The hero is (or was since the last record) more than RECORD_RETURN below the record flag. */
  let recordBelow = !!opts.record;
  // Elements of the slope (docs/01-gdd.md 18.3): where the hero is now, for «down into a chasm» and «into a tunnel».
  const chasms = (level.shapes ?? []).filter((c) => c.kind === 'chasm');
  const tunnels = level.niches.flatMap((n, i) => (n.kind === 'tunnel' ? [i] : []));
  let inChasm = false;
  let inTunnel = false;
  // RL-02 (docs/01-gdd.md 21.2): `caught.to` «flag» — a fall (below killY or into a pit), «Snowed in!» and the giant's
  // slap roll the hero to the flag of the ridge below (the camp before the first); the avalanche pauses again from zero.
  // LV-08 (docs/01-gdd.md 22.9): `prevStage` — the same roll to the flag of the stage before the hero's (stage 1 — the camp).
  const toPrev = opts.balance.caught?.to === 'prevStage' && !!level.stages;
  const toFlag = opts.balance.caught?.to === 'flag' || toPrev;
  const pits = (level.shapes ?? []).filter((c) => c.kind === 'pit');
  const inPit = (): boolean => pits.some((q) => hero.pos.y < q.y && hero.pos.x > q.x0 && hero.pos.x < q.x1 && hero.pos.z > q.z0 && hero.pos.z < q.z1);
  // No cascade (Q-083, producer 15.10; docs/01-gdd.md 4.5, 22.9): the stage back counts from the farthest stage of the
  // attempt — a fall on the stage the hero was rolled back to returns him to its own start. A teleport starts an attempt.
  let stageFar = 0;
  const flagPoint = (): { x: number; y: number; z: number } => {
    if (toPrev) {
      // A false exit of the maze rolls back to its own way in (LV-12 review: back over the whole stage before it the
      // maze was a lottery with a long walk); any other fall at the farthest stage — to the stage before (22.9).
      const n = stageAt(level, hero.pos.z);
      // MU (Q-MU-12, staff check 19.10: past the giant, the first crack of the next stage rolled him back before the
      // giant again): `pastGiant` «own» — the stage after a giant he passed in this attempt keeps its own start.
      const pastGiant = opts.balance.caught?.pastGiant === 'own' && level.stages?.find((x) => x.n === n - 1)?.type === 'giant' && (sim.boss?.zones.some((zs) => zs.hero === 'passed' && stageAt(level, zs.zone[0]) === n - 1) ?? false);
      const back = n >= stageFar && level.stages?.find((x) => x.n === n)?.type !== 'maze' && !pastGiant;
      stageFar = Math.max(stageFar, n);
      sim.rollFrom = n;
      return stageStart(back ? n - 1 : n);
    }
    const c = level.checkpoints[sim.checkpoint];
    return c ? { x: c.x, y: c.y, z: c.z } : { x: level.spawn[0], y: level.spawn[1], z: level.spawn[2] };
  };
  let waveReset = false;
  /** The flag of stage n (its first checkpoint), the camp for stage 1 and below (docs/01-gdd.md 22.9). */
  const stageStart = (n: number): { x: number; y: number; z: number } => {
    const st = level.stages?.find((x) => x.n === n);
    const c = st && n > 1 ? level.checkpoints.find((k) => k.z >= st.z0 && k.z <= st.start + 1e-6) : undefined;
    return c ? { x: c.x, y: c.y, z: c.z } : { x: level.spawn[0], y: level.spawn[1], z: level.spawn[2] };
  };
  // Trophy buttons (docs/01-gdd.md 22.8): taken once a pass — free again once the hero is below the stage's start.
  const padTaken = (level.stages ?? []).map(() => false);
  // SD-03 (docs/01-gdd.md 23.3): a button is taken once a run, then the camp; SD-11 (Q-088): it pays coins (trophies only
  // with upgrade.currency trophies, the SD-03 test of the stages wallet).
  const padsPayTrophies = opts.balance.upgrade?.currency === 'trophies';
  let campIn = 0;
  let campFrom = 0;

  const sim: Sim = {
    hero,
    level,
    collision,
    events,
    params,
    progress,
    speedCurve,
    gatesOpen,
    gatesPassed: level.gates.map(() => false),
    milestones: createMilestones(opts.balance.ui?.statMilestones ?? [], opts.stat ?? 0),
    giftEgg: opts.giftEgg ? createGiftEgg(level, opts.giftEgg.wall, opts.giftEgg.pet, opts.giftEgg.hatchSec, opts.giftEgg.shown ?? true) : null,
    tier,
    tick: 0,
    checkpoint: -1,
    respawnTicksLeft: -1,
    giantFreeCatches: 0,
    giantGraceSec: 0,
    rollFrom: 0,
    padTaken,
    stageStart,
    portalEntered: false,
    onBelt: false,
    threat: null,
    bots: null,
    bonus: null,
    caught: null,
    fun: createFun(level),
    record: opts.record ? { ...opts.record } : null,
    boss: null,
    rare: null,
    tumble: null,
    slow: null,
    slowDown(mult, sec) {
      const cur = sim.slow;
      sim.slow = cur ? { mult: Math.min(cur.mult, mult), left: Math.max(cur.left, sec) } : { mult, left: sec };
    },
    gifts: giftsFromLevel(level),
    coins: opts.coins ?? 0,
    respawnGifts() {
      for (const gift of sim.gifts) gift.taken = false;
      events.emit('giftsRespawn', { tick: sim.tick, count: sim.gifts.length });
    },
    step(input, dt) {
      sim.tick++;
      if (threat && waveReset) threat.reset(sim.tick);
      waveReset = false;
      if (threat) {
        heroView.x = hero.pos.x;
        heroView.y = hero.pos.y;
        heroView.z = hero.pos.z;
        heroView.vx = hero.vel.x;
        heroView.vz = hero.vel.z;
        threat.step(dt, heroView, gatesOpen, sim.tick);
        // Not taken before the front reached its point: it melts, no event (docs/01-gdd.md 4.9).
        const b = sim.bonus;
        if (b && !b.carried && threat.state.phase === 'run' && threat.state.frontZ <= b.z) sim.bonus = null;
      }
      if (boss) {
        bossHero.x = hero.pos.x;
        bossHero.y = hero.pos.y;
        bossHero.z = hero.pos.z;
        bossHero.vx = hero.vel.x;
        bossHero.vz = hero.vel.z;
        // A hero on the run meets the giant at his run speed: steering and the pick-up after a catch cost him nothing
        // (playtest PS: 14 catches at 1,2–1,4 × the advice); one standing or walking slowly — at the speed he has.
        const moving = Math.hypot(hero.vel.x, hero.vel.z);
        const run = opts.boss?.run;
        bossHero.speed = run !== undefined && moving >= sim.params.speed * run ? Math.max(moving, sim.params.speed) : moving;
        bossHero.top = sim.params.speed;
        if (sim.giantGraceSec > 0) sim.giantGraceSec -= dt;
        boss.step(dt, bossHero, !sim.caught && sim.respawnTicksLeft < 0 && sim.giantGraceSec <= 0, sim.tick, bots ? bots.runners() : undefined);
      }
      if (bots) {
        botCtx.hero.x = hero.pos.x;
        botCtx.hero.z = hero.pos.z;
        botCtx.flagZ = level.checkpoints[sim.checkpoint]?.z ?? level.spawn[2];
        if (boss) botCtx.giants = boss.zones.map((z) => ({ zone: z.zone, active: z.hero !== 'passed', speed: z.giants[0]?.speed ?? 0 }));
        bots.step(dt, botCtx);
      }
      if (rare) {
        rareCtx.tick = sim.tick;
        rareCtx.hero.x = hero.pos.x;
        rareCtx.hero.y = hero.pos.y;
        rareCtx.hero.z = hero.pos.z;
        rareCtx.hero.sheltered = sim.inShelter();
        rareCtx.run = moveSpeed(progress.stat, speedCurve);
        rareCtx.phase = threat?.state.phase ?? 'idle';
        rareCtx.bots = bots ? bots.list.filter(rolling).map((b) => ({ bot: b.index, x: b.x, z: b.z })) : [];
        rare.step(dt, rareCtx);
      }
      if (sim.caught) {
        stepCaught(dt);
        events.emit('step', { tick: sim.tick });
        return;
      }
      if (sim.respawnTicksLeft >= 0) {
        sim.respawnTicksLeft--;
        if (sim.respawnTicksLeft < 0) sim.respawn();
        stepHero(hero, NO_INPUT, dt, collision, params, level.killY);
        events.emit('step', { tick: sim.tick });
        return;
      }
      const zBefore = hero.pos.z;
      // The run speed of the stat, × the «slowed» status while it lasts (docs/01-gdd.md 18.5).
      if (sim.slow) {
        sim.slow.left -= dt;
        if (sim.slow.left <= 0) sim.slow = null;
      }
      // The tumble of the rolling snowball (docs/01-gdd.md 18.4): no control for its seconds, then slowed.
      const tb = sim.tumble;
      if (tb) {
        tb.t += dt;
        if (tb.t >= tb.sec - 1e-9) {
          sim.tumble = null;
          sim.slowDown(tb.slow, tb.slowSec);
        }
      }
      params.speed = runSpeed();
      if (opts.jumpCurve) params.jumpSpeed = jumpPower(progress.stat, opts.jumpCurve);
      params.airSpeedMult = levelReach();
      stepHero(hero, funInput(sim.fun, tb ? NO_INPUT : input, params, tuning.fun), dt, collision, params, level.killY);
      // Trampolines and slides (docs/01-gdd.md 16.4): a launch leaves the ground, so this tick counts no steps.
      const fun = stepFun(sim.fun, hero, tuning.fun, dt);
      // SD-04 (docs/01-gdd.md 23.4): a trampoline throws as far as the level reaches, as a jump does.
      if (fun.pad >= 0 && params.airSpeedMult !== undefined && params.airSpeedMult !== 1) {
        hero.vel.x *= params.airSpeedMult;
        hero.vel.z *= params.airSpeedMult;
      }
      if (fun.pad >= 0) events.emit('padLaunch', { tick: sim.tick, index: fun.pad, x: hero.pos.x, y: hero.pos.y, z: hero.pos.z });
      if (fun.slide >= 0) events.emit('slideEnter', { tick: sim.tick, index: fun.slide });
      // Portal: the hero crosses the arch plane inside its opening (docs/01-gdd.md 5.2).
      if (portal && !sim.portalEntered && zBefore < portal.z && hero.pos.z >= portal.z && Math.abs(hero.pos.x - portal.x) <= portalHalf) {
        sim.portalEntered = true;
        if (sim.bonus?.carried) saveBonus('portal');
        events.emit('portal', { tick: sim.tick, from: level.worldIndex, next: portalNext });
      }
      // Gifts: a touch takes the gift and pays the coins of its zone (docs/01-gdd.md 3.2).
      sim.gifts.forEach((gift, index) => {
        if (gift.taken || Math.abs(gift.z - hero.pos.z) > 3 || !touchesGift(gift, hero.pos.x, hero.pos.y, hero.pos.z)) return;
        gift.taken = true;
        const coins = scaled(gift.coins, tier, opts.balance.rebirth);
        sim.coins += coins;
        events.emit('giftTake', { tick: sim.tick, index, coins, zone: gift.zone, rarity: gift.rarity, total: sim.coins, path: gift.path ?? false });
      });
      // Golden gift: a touch on warn or run and the hero carries it over his head.
      const bonus = sim.bonus;
      if (bonus && !bonus.carried && (threat?.state.phase === 'warn' || threat?.state.phase === 'run') && touchesBonus(bonus, hero.pos.x, hero.pos.y, hero.pos.z)) {
        bonus.carried = true;
        events.emit('bonusTake', { tick: sim.tick, x: bonus.x, y: bonus.y, z: bonus.z });
      }
      // SD-02 (docs/01-gdd.md 23.2): brought into a shelter — it counts at once (not after the wave), the hands are free.
      if (sim.bonus?.carried && !sim.caught && sim.shelterIndex() >= 0) saveBonus('cave');
      // Steps: horizontal path while on the ground before and after the tick; the air and the landing tick count nothing.
      // On a belt the belt runs under the hero at his run speed: he runs in place by himself (docs/02-tech.md 5.3).
      const belt = hero.onGround ? beltAt(beltList, hero.pos.x, hero.pos.y, hero.pos.z) : null;
      sim.onBelt = belt !== null;
      if (hero.onGround && prev.onGround && !hero.jumpedThisTick) {
        const dx = hero.pos.x - prev.x;
        const dz = hero.pos.z - prev.z;
        const path = belt ? params.speed * dt : Math.hypot(dx, dz);
        // A belt gives its own multiplier (the one of its section on the open slope, never the product, 17.4).
        // The blizzard (docs/01-gdd.md 18.4): every step on its section × stepMult, a belt keeps its own.
        const mult = belt ? (typeof belt['mult'] === 'number' ? (belt['mult'] as number) : 1) : sim.sectionMult() * (rare?.stepMultAt(hero.pos.z) ?? 1);
        for (const gain of progress.advance(path, mult)) events.emit('gain', { ...gain, tick: sim.tick, belt: belt !== null });
        params.speed = runSpeed();
      } else if (!hero.onGround) progress.resetCarry();
      // A round number of the stat (docs/01-gdd.md 10.4): one event with the biggest value crossed.
      const milestone = sim.milestones.check(progress.stat);
      if (milestone !== null) events.emit('statMilestone', { tick: sim.tick, value: milestone });
      prev.x = hero.pos.x;
      prev.z = hero.pos.z;
      prev.onGround = hero.onGround;
      // Gates: the number is all that matters; an open gate stays open until rebirth (docs/01-gdd.md 3.3).
      let opened = false;
      level.gates.forEach((gate, i) => {
        if (gatesOpen[i] || gate.kind === 'boss' || !gateIsOpen(progress.stat, sim.gateRequirement(i))) return;
        gatesOpen[i] = true;
        opened = true;
        events.emit('gateOpen', { tick: sim.tick, index: i, wall: gate.index, z: gate.z, requires: sim.gateRequirement(i) });
      });
      if (opened) syncGates();
      // Passing an open gate pays its coins once (the flag rises, coins fly into the plaque; docs/01-gdd.md 10.3).
      level.gates.forEach((gate, i) => {
        if (!gatesOpen[i] || sim.gatesPassed[i] || zBefore >= gate.z + GATE_PASS_DIST || hero.pos.z < gate.z + GATE_PASS_DIST) return;
        sim.gatesPassed[i] = true;
        const coins = scaled(gate.rewardCoins, tier, opts.balance.rebirth);
        sim.coins += coins;
        events.emit('gatePass', { tick: sim.tick, index: i, wall: gate.index, coins, total: sim.coins });
      });
      // The free egg: a touch starts the hatch, the pet jumps out after eggHatchSec (docs/01-gdd.md 6.2).
      if (sim.giftEgg) {
        const r = stepGiftEgg(sim.giftEgg, hero.pos.x, hero.pos.y, hero.pos.z, dt);
        if (r === 'touch') events.emit('eggTouch', { tick: sim.tick });
        else if (r === 'hatch') events.emit('eggHatch', { tick: sim.tick, pet: sim.giftEgg.pet });
      }
      if (hero.jumpedThisTick) events.emit('jump', { tick: sim.tick });
      if (hero.landedThisTick) events.emit('land', { tick: sim.tick, airTime: hero.airTime, z: hero.pos.z });
      // Record flag (docs/01-gdd.md 17.7): follows the highest point on the ground off the camp and the summit; sent below
      // it (snowed in, caught), the hero passing it again hears «New height!».
      if (recordOn && hero.onGround && !sim.caught && !inSafeZone(level, hero.pos.z)) {
        const r = sim.record;
        if (!r) sim.record = { x: hero.pos.x, y: hero.pos.y, z: hero.pos.z };
        else if (hero.pos.z > r.z) {
          if (recordBelow) events.emit('recordUp', { tick: sim.tick, z: hero.pos.z });
          recordBelow = false;
          r.x = hero.pos.x;
          r.y = hero.pos.y;
          r.z = hero.pos.z;
        } else if (r.z - hero.pos.z > RECORD_RETURN) recordBelow = true;
      }
      // Down on the bottom of a chasm, into a tunnel (docs/01-gdd.md 18.3): an event each time he gets there.
      if (hero.onGround) {
        const ch = chasms.find((c) => hero.pos.z >= c.z0 && hero.pos.z <= c.z1 && hero.pos.y < c.y - 1);
        if (ch && !inChasm) events.emit('chasmDown', { tick: sim.tick, section: ch.section });
        inChasm = ch !== undefined;
      }
      if (tunnels.length) {
        const at = sim.shelterIndex();
        const t = tunnels.includes(at);
        if (t && !inTunnel) events.emit('tunnelEnter', { tick: sim.tick, section: level.niches[at]!.stretch });
        inTunnel = t;
      }
      // Checkpoints: the flag behind the last wall passed (highest z reached on the ground).
      for (let i = level.checkpoints.length - 1; i > sim.checkpoint; i--) {
        const c = level.checkpoints[i];
        if (c && hero.pos.z >= c.z && hero.onGround) {
          sim.checkpoint = i;
          events.emit('checkpoint', { index: i, z: c.z });
          break;
        }
      }
      if (level.stages && !sim.caught) stageFar = Math.max(stageFar, stageAt(level, hero.pos.z));
      // Trophy buttons of the stage finishes (docs/01-gdd.md 22.8): stand on one — its trophies, once a pass.
      if (level.stages) for (let k = 0; k < level.stages.length; k++) {
        const st = level.stages[k]!;
        if (hero.pos.z < st.z0) padTaken[k] = false;
        else if (!padTaken[k] && st.trophies > 0 && hero.onGround && Math.abs(hero.pos.x - st.pad.x) <= PAD_REACH && Math.abs(hero.pos.z - st.pad.z) <= PAD_REACH && Math.abs(hero.pos.y - st.pad.y) < 2) {
          padTaken[k] = true;
          // ST-06 (producer 22.10: the first stage farmed for ever): a pad taken its number of times pays nothing, the flight stays.
          const spent = opts.padPay ? !opts.padPay(st.n) : false;
          const amount = spent ? 0 : scaled(st.trophies, tier, opts.balance.rebirth);
          // The flight to the camp stays for a spent pad too (ST-06 criterion; Q-ST-2 — the review asked for none).
          campIn = CAMP_RETURN_TICKS;
          campFrom = st.n;
          if (!padsPayTrophies) sim.coins += amount;
          events.emit('trophyTake', { tick: sim.tick, stage: st.n, amount, x: st.pad.x, y: st.pad.y, z: st.pad.z, total: sim.coins, trophies: padsPayTrophies, ...(spent ? { spent } : {}) });
        }
      }
      if (campIn > 0 && --campIn === 0 && !sim.caught) {
        const at = stageStart(1);
        sim.teleport(at.x, at.y, at.z);
        padTaken.fill(false);
        events.emit('campReturn', { tick: sim.tick, stage: campFrom });
      }
      // MU round 5 (producer 21.10: «Oops! Back to the stage start» almost in a cave, the hero stayed): a hero in a cave by
      // the check the avalanche asks is never rolled back from it.
      if (hero.pos.y < level.killY || (inPit() && sim.shelterIndex() < 0)) {
        if (toFlag && opts.balance.caught) {
          sim.caught = createCaught(level, { x: hero.pos.x, y: hero.pos.y, z: hero.pos.z }, opts.balance.caught, tuning.avalanche, flagPoint());
          waveReset = true;
        } else sim.respawnTicksLeft = RESPAWN_FADE_TICKS;
        events.emit('fall', { tick: sim.tick, z: hero.pos.z });
      }
      events.emit('step', { tick: sim.tick });
    },
    teleport(x, y, z) {
      stageFar = 0;
      sim.caught = null;
      sim.slow = null;
      sim.tumble = null;
      resetFun(sim.fun);
      placeHero(hero, x, y, z);
      progress.resetCarry();
      prev.onGround = false;
    },
    gateRequirement(index) {
      const gate = level.gates[index];
      if (!gate) return Infinity;
      const req = gateRequirement(gate.requires, level.worldIndex, gate.index, tier, opts.balance.rebirth, opts.walls);
      // Stages pace (docs/01-gdd.md 22.3): the ridge asks for a level — the requirement is that level's threshold.
      const lv = opts.balance.levels;
      return lv && gate.kind !== 'boss' ? levelThreshold(levelNeeded(req, lv), lv) : req;
    },
    sectionMult() {
      const z = hero.pos.z;
      for (const s of level.sections) if (z >= s.z0 && z < s.z1) return s.mult;
      return 1;
    },
    treadmillAt() {
      const belt = beltAt(beltList, hero.pos.x, hero.pos.y, hero.pos.z);
      return belt && typeof belt['mult'] === 'number' ? (belt['mult'] as number) : 1;
    },
    shelterIndex() {
      // MU round 5: the one check of «in a cave» — the avalanche (sim/threat.ts) and the roll-back of a fall ask it too.
      return shelterNow(level, grace, { x: hero.pos.x, y: hero.pos.y, z: hero.pos.z, vx: hero.vel.x, vz: hero.vel.z });
    },
    inShelter() {
      return sim.shelterIndex() >= 0;
    },
    giveBonus() {
      const phase = threat?.state.phase;
      if (!bonusCfg || (phase !== 'warn' && phase !== 'run')) return false;
      if (sim.bonus?.carried) return true;
      const p = hero.pos;
      sim.bonus ??= { x: p.x, y: p.y, z: p.z, zone: zoneAt(level, p.z), carried: false };
      sim.bonus.carried = true;
      events.emit('bonusTake', { tick: sim.tick, x: sim.bonus.x, y: sim.bonus.y, z: sim.bonus.z });
      return true;
    },
    respawn() {
      sim.slow = null;
      sim.tumble = null;
      const c = level.checkpoints[sim.checkpoint];
      const target: [number, number, number] = c ? [c.x, c.y, c.z] : level.spawn;
      placeHero(hero, target[0], target[1] + 0.05, target[2]);
      hero.yaw = 0;
      resetFun(sim.fun);
      progress.resetCarry();
      prev.onGround = false;
      sim.respawnTicksLeft = -1;
      events.emit('respawn', { tick: sim.tick, z: target[2], checkpoint: sim.checkpoint });
    },
  };
  // The run speed of the stat × the «slowed» status (docs/01-gdd.md 18.5) × the blizzard where the hero is (18.4).
  // SD-04 (docs/01-gdd.md 23.4): the reach of a jump on a stage by the level against the stage's (controller.levelJump).
  const lj = tuning.controller.levelJump;
  const levelReach = (): number => {
    const levels = opts.balance.levels;
    if (!lj || !levels || !level.stages) return 1;
    const st = level.stages.find((x) => x.n === stageAt(level, hero.pos.z));
    // The first minute of mountain 1 (the intro stage) jumps as it always did.
    if (!st || st.type === 'intro') return 1;
    return Math.min(lj.max, Math.max(lj.min, lj.g ** (levelOf(progress.stat, levels) - st.level)));
  };
  // MU round 5 (producer 21.10): the blizzard holds back the feet only — in a jump it does not slow him.
  const runSpeed = (): number => moveSpeed(progress.stat, speedCurve) * (sim.slow?.mult ?? 1) * (hero.onGround ? (rare?.speedMultAt(hero.pos.z) ?? 1) : 1);
  // The avalanche emits through the sim bus; «Phew, made it!» pays coins first (docs/01-gdd.md 4.4).
  const zoneGift = new Map<number, number>();
  for (const gift of sim.gifts) if (!zoneGift.has(gift.zone)) zoneGift.set(gift.zone, gift.coins);
  // SD-02 (docs/01-gdd.md 23.2): no gifts on the track (pace stages) — the zone's gift value, never «+0».
  for (const [k, v] of Object.entries(level.zoneGifts ?? {})) if (!zoneGift.has(Number(k))) zoneGift.set(Number(k), v);
  // Golden gift (docs/01-gdd.md 4.9): worth mult gifts of the zone where it lay.
  const bonusCfg = opts.bonus?.cfg ?? null;
  const bonusRng = createRng(opts.bonus?.seed ?? 0);
  const goldCoins = (b: BonusState): number => scaled((bonusCfg?.mult ?? 0) * (zoneGift.get(b.zone) ?? 0), tier, opts.balance.rebirth);
  const saveBonus = (where: 'cave' | 'portal' | 'gone', coins?: number): void => {
    const b = sim.bonus;
    sim.bonus = null;
    if (!b) return;
    const gold = coins ?? goldCoins(b);
    if (coins === undefined) sim.coins += gold;
    events.emit('bonusSaved', { tick: sim.tick, coins: gold, total: sim.coins, where });
  };
  const onWarn = (p: ThreatEvents['waveWarn']): void => {
    sim.bonus = null;
    if (!bonusCfg || p.scripted || (opts.bonus?.wavesBefore ?? 0) + p.normalWaves < bonusCfg.fromWave) return;
    // In the camp or on the summit at the start of the warning: no gift this wave.
    if (inSafeZone(level, hero.pos.z) || p.shelter < 0) return;
    sim.bonus = placeBonus(level, bonusCfg, gatesOpen, p.shelter, bonusRng);
    if (sim.bonus) events.emit('bonusSpawn', { tick: p.tick, x: sim.bonus.x, y: sim.bonus.y, z: sim.bonus.z, zone: sim.bonus.zone });
  };
  const threat = opts.threat
    ? createThreat(level, opts.threat, (name, payload) => {
        if (name === 'waveSurvived') {
          const p = payload as ThreatEvents['waveSurvived'];
          const zone = level.niches[p.niche]?.zone ?? 0;
          let coins = scaled((opts.balance.coins?.waveSurvived ?? 0) * (zoneGift.get(zone) ?? 0), tier, opts.balance.rebirth);
          // The golden gift brought into the cave: one toast with both rewards (docs/01-gdd.md 4.9).
          const gold = sim.bonus?.carried ? goldCoins(sim.bonus) : 0;
          coins += gold;
          sim.coins += coins;
          events.emit('waveSurvived', { ...p, coins, total: sim.coins, gold });
          if (gold > 0) saveBonus('cave', gold);
          return;
        }
        (events.emit as (n: string, p: unknown) => void)(name, payload);
        if (name === 'waveWarn') onWarn(payload as ThreatEvents['waveWarn']);
        else if (name === 'waveCaught' && sim.bonus?.carried) {
          // Snowed in with the gift: it pops, nothing else is lost (a gift left on the ground melts with the front).
          sim.bonus = null;
          events.emit('bonusLost', { tick: sim.tick, x: hero.pos.x, y: hero.pos.y, z: hero.pos.z });
        } else if (name === 'waveGone') {
          // The camp, the summit or a slope the front never reached: the carried gift counts now.
          if (sim.bonus?.carried) saveBonus('gone');
          sim.bonus = null;
        }
      })
    : null;
  (sim as { threat: Threat | null }).threat = threat;

  // Bots (M2-10): speed of the hero on the stretch under them — the stat that opened the wall below (docs/01a 12).
  const bots = opts.bots
    ? createBots(level, {
        ...opts.bots,
        caught: opts.balance.caught,
        avalanche: tuning.avalanche,
        graceDist,
        fun: { cfg: tuning.fun, gravity: tuning.controller.gravity },
      })
    : null;
  const stretchSpeed = (z: number): number => {
    let below = -1;
    level.gates.forEach((g, i) => {
      if (g.z <= z) below = i;
    });
    return moveSpeed(below < 0 ? 0 : sim.gateRequirement(below), speedCurve);
  };
  const botCtx: BotContext = {
    hero: { x: 0, z: 0 },
    flagZ: level.spawn[2],
    gatesOpen,
    threat: threat ? threat.state : null,
    speedAt: stretchSpeed,
    slowAt: (z) => rare?.speedMultAt(z) ?? 1,
  };
  (sim as { bots: BotCrowd | null }).bots = bots;

  // Rare events (docs/01-gdd.md 18.4): only a mountain with sections (the open slope) has them; nothing is ever lost.
  const rolling = (b: BotCrowd['list'][number]): boolean =>
    (b.mode === 'up' || b.mode === 'wait' || b.mode === 'zone' || b.mode === 'hide') && shelterIndex(level, graceDist, b.x, b.y, b.z) < 0;
  const rareCtx: EventsContext = { tick: 0, hero: { x: 0, y: 0, z: 0, sheltered: false }, run: 0, phase: 'idle', bots: [] };
  const rare =
    opts.events && level.sections.length > 0
      ? createEvents(
          level,
          opts.events.cfg,
          opts.events.seed,
          gatesOpen,
          (name, payload) => {
            (events.emit as (n: string, p: unknown) => void)(name, payload);
            if (name === 'snowballHit') {
              const p = payload as EventEvents['snowballHit'];
              sim.tumble = { t: 0, sec: p.tumbleSec, slow: p.slow, slowSec: p.slowSec };
              hero.vel.set(0, hero.vel.y, 0);
            } else if (name === 'snowballBotHit') {
              const p = payload as EventEvents['snowballBotHit'];
              bots?.tumble(p.bot, p.tumbleSec, p.slow, p.slowSec);
            }
          },
          opts.events.force,
        )
      : null;
  (sim as { rare: Events | null }).rare = rare;

  if (opts.resume) {
    const front = opts.resume.frontierWall;
    level.gates.forEach((gate, i) => {
      if (gate.index <= front) sim.gatesPassed[i] = true;
      if (gate.index <= front || (gate.kind !== 'boss' && gateIsOpen(progress.stat, sim.gateRequirement(i)))) gatesOpen[i] = true;
    });
    syncGates();
    const flag = level.checkpoints.findIndex((c) => c.wall === front);
    const c = level.checkpoints[flag];
    if (c) {
      sim.checkpoint = flag;
      placeHero(hero, c.x, c.y + 0.05, c.z);
      hero.yaw = 0;
      prev.x = hero.pos.x;
      prev.z = hero.pos.z;
    }
  }

  // Giants (docs/01-gdd.md 17.6): speeds of the tier — the run speed of the scaled advice over the one of tier 0; the
  // zone passed opens the giant's check at its end (the summit line), the slap rolls the hero back to the zone's start.
  const bossGate = level.gates.findIndex((g) => g.kind === 'boss');
  const bossHero = { x: 0, y: 0, z: 0, speed: 0, top: 0, vx: 0, vz: 0 };
  const boss =
    opts.boss && level.bosses.length > 0 && opts.balance.caught
      ? createBoss(
          level.bosses,
          opts.boss,
          (zi) => {
            const g = level.gates[bossGate];
            const req = level.bosses[zi]!.requires;
            const k = g ? sim.gateRequirement(bossGate) / g.requires : 1;
            return moveSpeed(req * k, speedCurve) / moveSpeed(req, speedCurve);
          },
          () => bossGate >= 0 && gatesOpen[bossGate] === true,
          (name, payload) => {
            (events.emit as (n: string, p: unknown) => void)(name, payload);
            if (name === 'bossCaught') {
              const p = payload as BossEvents['bossCaught'];
              // G-01: the first catch only stops the giant (he walks back), the hero stays where he is.
              if (sim.giantFreeCatches > 0) {
                sim.giantFreeCatches--;
                sim.giantGraceSec = opts.balance.caught!.giantFreeSec ?? 0;
                return;
              }
              const a = level.bosses[p.zone]!.zone[0] - BOSS_BACK;
              if (sim.respawnTicksLeft >= 0) sim.respawnTicksLeft = -1;
              // SD-15: `caught.giant` «stage» — back to the start of the giant's own stage, not a stage below (the camp).
              const own = opts.balance.caught!.giant === 'stage' && level.stages ? stageStart(stageAt(level, level.bosses[p.zone]!.zone[0])) : null;
              sim.caught = createCaught(level, { x: p.x, y: p.y, z: p.z }, opts.balance.caught!, tuning.avalanche, own ?? (toFlag ? flagPoint() : { x: 0, y: level.floorAt(0, a), z: a }));
              if (toFlag) waveReset = true;
            } else if (name === 'helperHit') {
              // A helper's snowball (docs/01-gdd.md 18.5): slowed for a moment; nothing is lost.
              const p = payload as BossEvents['helperHit'];
              sim.slowDown(p.slow, p.slowSec);
            } else if (name === 'bossBotCaught') {
              // A bot slapped (docs/01-gdd.md 18.5): it rolls back to the start of the zone as the hero would.
              const p = payload as BossEvents['bossBotCaught'];
              bots?.giantSlap(p.bot, level.bosses[p.zone]!.zone[0] - BOSS_BACK);
            } else if (name === 'bossPassed') {
              const g = level.gates[bossGate];
              if (g && !gatesOpen[bossGate] && Math.abs(level.bosses[(payload as BossEvents['bossPassed']).zone]!.zone[1] - g.z) < 1e-6) {
                gatesOpen[bossGate] = true;
                events.emit('gateOpen', { tick: sim.tick, index: bossGate, wall: g.index, z: g.z, requires: sim.gateRequirement(bossGate) });
              }
            }
          },
          // SD-12 (docs/01-gdd.md 23.9): Speed decides — the giant is quicker against a hero below the stage's level.
          (zi) => {
            const L = level.bosses[zi]!.level;
            const levels = opts.balance.levels;
            return L && levels ? Math.min(L.max, Math.max(L.min, L.g ** (L.n - levelOf(progress.stat, levels)))) : 1;
          },
        )
      : null;
  (sim as { boss: Boss | null }).boss = boss;

  // «Snowed in!» (docs/01-gdd.md 4.5): the ball rolls to the cave below; stat, coins and gates stay as they are.
  const ballPos = { x: 0, y: 0, z: 0 };
  const stepCaught = (dt: number): void => {
    const c = sim.caught!;
    c.t += dt;
    caughtPosition(c, level, tuning.avalanche.ballBounce, ballPos);
    hero.pos.set(ballPos.x, ballPos.y, ballPos.z);
    hero.vel.set(0, 0, 0);
    hero.speed = 0;
    hero.onGround = true;
    if (c.t >= caughtTotalSec(c) - 1e-9) {
      sim.caught = null;
      resetFun(sim.fun);
      placeHero(hero, c.to.x, c.to.y + 0.05, c.to.z);
      // At the flag (RL-02) he faces up the slope, as after a respawn.
      if (toFlag) hero.yaw = 0;
      progress.resetCarry();
      prev.onGround = false;
      events.emit('caughtEnd', { tick: sim.tick, sec: c.t, niche: c.niche, x: c.to.x, y: c.to.y, z: c.to.z });
    }
  };
  if (threat && opts.balance.caught) {
    const caughtCfg = opts.balance.caught;
    events.on('waveCaught', ({ x, y, z }) => {
      if (sim.respawnTicksLeft >= 0) sim.respawnTicksLeft = -1;
      sim.caught = createCaught(level, { x, y, z }, caughtCfg, tuning.avalanche, toFlag ? flagPoint() : undefined);
      if (toFlag) waveReset = true;
    });
  }
  return sim;
}

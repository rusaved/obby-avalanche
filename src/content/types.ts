// What: Types only: the shape of every content/<pack>/*.json file (game, theme, balance, tuning, worlds, skins, pets, eggs, trails, auras, sfx, bots) and ContentPack.
// Called by: Almost every layer: sim/*, level/*, meta/*, render/*, app/*-view, audio, debug, main.ts, scripts/balance-model.ts; tests/content, tests/meta, tests/sim.
// Keep: Must match content/<pack>/*.json and docs/02-tech.md 5.2-5.3 (validate-content checks it); types only, no values; a new field goes here AND into the data.

/** Shapes of content/<pack>/*.json (docs/02-tech.md 5.2–5.3). Numbers and texts live only in the pack. */

export type StatEffect = 'moveSpeed' | 'jumpPower' | 'gateOnly';

export interface GameJson {
  id: string;
  schema: number;
  stat: { key: string; effect: StatEffect };
  threat: {
    kind: 'wave';
    visual: string;
    bonus?: { kind: 'goldGift'; fromWave: number; mult: number; distMin: number; distMax: number };
    /** The giant of the open slope (docs/01-gdd.md 17.6; docs/01a-content.md 16.4): the hero slips past when he runs
     * faster than the giant × (1 + margin); `reach` — how close the giant's slap gets him; `catch: roll` — back to the line. */
    /** `run`: a hero moving at least this share of his run speed meets the giant at his run speed (absent — as he moves). */
    boss?: { kind: 'giant'; margin: number; catch: 'roll'; reach: number; run?: number };
  };
  leaderboard: { name: string; score: string } | null;
  metrikaCounterId: number;
  mobileOrientation: 'landscape' | 'portrait';
  payments: { enabled: boolean };
  ads: { interstitial: string[]; rewarded: string[] };
  flags?: Record<string, { path: string; min?: number; max?: number; values?: string[] }>;
  /** Pace by default (docs/01-gdd.md 16.1): "classic" or a folder of content/<pack>/pace/; absent — classic. */
  pace?: string;
  /** Rare events (docs/01-gdd.md 18.4; docs/01a-content.md 17.3): rolled on entering a section of `sections` [from, to]
   * of a mountain with sections (the open slope); absent — no events. */
  events?: GameEvents;
}

/** The rolling snowball (docs/01-gdd.md 18.4): the trail `trailWidth` wide on the hero's lane, the ball `size` across at
 * speedMult × v(S), the meeting in aheadSec; a hit — the tumble for tumbleSec, then × slow for slowSec. */
export interface SnowballEvent {
  fromWorld: number;
  chance: number;
  aheadSec: number;
  speedMult: number;
  trailWidth: number;
  size: number;
  tumbleSec: number;
  slow: number;
  slowSec: number;
}

/** The blizzard (docs/01-gdd.md 18.4): everyone in its section × speedMult for durationSec, the hero's steps × stepMult
 * (1 — a plain slowdown, Q-041); the fog nearer × fogMult, the snow thicker × snowMult. */
export interface BlizzardEvent {
  fromWorld: number;
  chance: number;
  durationSec: number;
  speedMult: number;
  stepMult: number;
  fogMult: number;
  snowMult: number;
}

export interface GameEvents {
  minGapSec: number;
  /** Not before this long after entering the section: the toast of its gifts goes first. */
  delaySec: number;
  sections: [number, number];
  snowball?: SnowballEvent;
  blizzard?: BlizzardEvent;
}

export interface ThemeJson {
  fx: {
    caught: string;
    gateOpen: string;
    footFx: string;
    weather: string;
    screenFrame: string;
    shelterMesh: string;
    treadmill: string;
  };
  sky: { top: string; mid?: string; bottom: string };
  fog: { color: string; near: number; far: number };
  light: { sun: string; sunIntensity: number; ambient: string; ambientIntensity: number; sunDir: [number, number, number] };
  materials: Record<string, { color: string; roughness?: number; metalness?: number; emissive?: string }>;
  rarity: Record<string, string>;
  /** `plaque`, `plaqueAlpha`, `plaqueText`: the dark see-through plaque under the avalanche banner and the small HUD
   * arrows («wrong way», the way to the belt) with its text colour (docs/01-gdd.md 16.7: contrast ≥ 4.5:1). */
  ui: { stat: string; coins: string; trophies: string; ok: string; no: string; statIcon: string; plaque: string; plaqueAlpha: number; plaqueText: string };
  threat: { front: [string, string]; edge: string; body: string; dust: string; height: number };
  bonus?: { color: string };
  /** The giant (docs/01a-content.md 16.4): height, colours of the parts and the hat, the face, the horizon silhouette. */
  /** `helper` (docs/01a-content.md 17.4): the giant's helpers — their height, the colour of their snowball. */
  boss?: { height: number; colors: { head: string; torso: string; arms: string; legs: string; hat: string }; face: string; silhouette: string; helper?: { height: number; snowball: string } };
  /** Rare events (docs/01a-content.md 17.3): the colours of the snowball's trail and of the ball, of the blizzard's fog, snow and the glow over the shelters. */
  events?: { snowball?: { trail: string; ball: string }; blizzard?: { fog: string; snow: string; glow: string } };
}

export interface Curve {
  base: number;
  k: number;
  max: number;
}

/**
 * A reward of the calendar, quests, time rewards and the wheel (docs/01a-content.md 10): coins as `gifts` gifts of the
 * player's zone × wallScale[n], trophies, the ×2 step boost for `min` minutes, an egg hatched at once (`best` — the best
 * egg of an open mountain), a look, a pet (with wings on day 7).
 */
export type Reward =
  | { kind: 'coins'; gifts: number }
  | { kind: 'trophies'; n: number }
  | { kind: 'boost'; min: number }
  | { kind: 'egg'; id: string }
  | { kind: 'skin'; id: string }
  | { kind: 'wings'; id: string }
  | { kind: 'pet'; id: string; wings?: string };

export type DailyReward = Reward & { alt?: Reward };

export interface BalanceJson {
  stepLength: number;
  gainPerStep: number;
  gainTrigger: 'step';
  speedCurve: Curve;
  jumpCurve?: Curve;
  upgrade: { attach: 'feet' | 'head' | 'back' | 'hand'; tiers: Array<{ id: string; mult: number; price: number }> };
  rebirth: {
    stepMult: number;
    wallScale: number[];
    lateEase: { fromWall: number; toFactor: number };
    wallScaleGrowth: number;
    unlock: string;
  };
  trophies: { perSummit: string };
  gifts: { perZone: number; respawn: 'onWaveGone' };
  coins: { gatePass: number; waveSurvived: number; chest: number };
  pets: { slots: number; inventory: number };
  /** `x2Mult`: the ×2 step boost (ad, rewards); `statNowSec`: treadmill seconds of «speed now» (docs/01-gdd.md 8.1). */
  boost: { x2Sec: number; x2Mult: number; statNowSec: number };
  caught: { rollSec: number; maxSec: number };
  /** `resumeSec`: the first avalanche after F5 or another day comes this late (docs/01-gdd.md 6.6). */
  threat: { newbieWaves: { count: number; warnBonusSec: number }; resumeSec: number };
  niche: { graceDist: number; graceMoving: number };
  /** `statMilestones`: round numbers of the stat that flash the plaque once a load (docs/01-gdd.md 10.4, Q-023). */
  ui: { unlockMenusSec: number; unlockTimeRewardsSec: number; menuStepSec: number; statMilestones: number[] };
  ads: {
    rewardedMinPlaySec: number;
    standStillSec: number;
    interstitialMinSec: number;
    interstitialCooldownSec: number;
    interstitialAfterRewardedSec: number;
    statNowCooldownSec: number;
    /** `enabled` false — no «open the wall» ad at all (pace open, docs/01-gdd.md 17.11); absent — on. */
    skipGate: { cooldownSec: number; standSec: number; distance: number; excludeLastWall: boolean; enabled?: boolean };
    /** «Continue from here» (continue_here, docs/01-gdd.md 17.11): seconds between two offers; absent — no such place. */
    continueCooldownSec?: number;
    /** …and how long the offer stays after the snowball pops (until the first move). */
    continueShowSec?: number;
    eggViews: number;
    eggPauseSec: number;
    skipFirstPortal: boolean;
    wheelCooldownSec: number;
  };
  /** `vipMult`: the step multiplier of the VIP purchase (docs/01-gdd.md 8.1, 9.3). */
  iap: { showAfterPlaySec: number; vipMult: number };
  /** The 7-day calendar (docs/01-gdd.md 7.6, docs/01a-content.md 10): one reward a day, `alt` after the first circle when owned. */
  daily: { resetHours: number; days: DailyReward[] };
  /**
   * Quests of the day (docs/01-gdd.md 7.7): `perDay` of `list`, each pays `reward`, all of them `bonus`; q_shoes and
   * q_summit stay out when they are farther than `farWalls` walls; q_gold only with game.json threat.bonus.
   */
  quests: { perDay: number; farWalls: number; reward: Reward[]; bonus: Reward[]; list: Array<{ id: string; n: number }> };
  /** Time rewards of the day (7.8): minutes of play today → reward. */
  timeRewards: Array<{ min: number; reward: Reward }>;
  /** Lucky wheel (7.13): equal sectors. */
  wheel: { sectors: Reward[] };
  review: { after: string[]; minPlaySec: number };
  ftue: {
    freeEggPet: string;
    scriptedWaveWall: number;
    triggerDist: number;
    spawnAhead: number;
    warnSec: number;
    fallbackSec: number;
    /** The free egg «Mountain Gift» wobbles and cracks this long before the pet jumps out (docs/01-gdd.md 6.2). */
    eggHatchSec: number;
  };
  /** Hint plaque timings (docs/01-gdd.md 6.5). */
  hints: HintsTiming;
  /**
   * Targets of `sim:balance --fit` for a pace (docs/01-gdd.md 16.8); the game never reads them. `keep` — walls of
   * mountain 1 the fit leaves as they are (default 0); `roundDigits` — significant digits of a fitted wall (default:
   * the nice row of 8.5).
   */
  sim?: {
    mountainMin: number[];
    gateCurve: number;
    keep?: number;
    roundDigits?: number;
    /** Thresholds of F1–F8 (pace open, docs/01-gdd.md 17.12); absent — the numbers of 8.5. */
    checks?: Record<string, number | Array<number | number[]>>;
    /** F11: eggs bought by the summit of a mountain (decision 07.10). */
    eggsByMountain?: Array<{ mountain: number; min: number }>;
    /** Words of the report for a wall of the pace: one, of one, many, of many. */
    words?: { one: string; gen: string; many: string; manyGen: string };
  };
}

export interface HintsTiming {
  moveIdleSec: number;
  moveRepeatUntilSec: number;
  moveDoneSec: number;
  moveMax: number;
  jumpNearDist: number;
  shoesSec: number;
  waveCaveMax: number;
  caughtSec: number;
  stuckSec: number;
  stuckDist: number;
  stuckMax: number;
  /** «Wrong way» arrow (docs/01-gdd.md 16.7): the hero went this far down the slope over the last `wrongWaySec`. */
  wrongWaySec: number;
  wrongWayDist: number;
  portalIdleSec: number;
  portalMax: number;
  /** «Two ways: pick one» (open slope, docs/01-gdd.md 17.8): once, after standing this long at a fork; absent — never. */
  forkSec?: number;
}

export interface TuningJson {
  /**
   * HUD feel: «+N» pops `gainHeight` units above the feet (Q-019: at the feet; docs/01-gdd.md 10.3: over the head ≈ 4.5)
   * and `gainSide` of the field width to the right of the hero.
   */
  hud: { gainHeight: number; gainSide: number };
  controller: {
    baseSpeed: number;
    accel: number;
    decel: number;
    airControl: number;
    jumpSpeed: number;
    gravity: number;
    fallMult: number;
    coyoteSec: number;
    jumpBufferSec: number;
    variableJump: boolean;
    stepUp: number;
    maxSpeed: number;
  };
  camera: {
    distance: number;
    height: number;
    pitchDeg: number;
    fov: number;
    fovSpeedAdd: number;
    fovSmoothSec: number;
    damping: number;
    leadSec: number;
    /** Auto-turn towards the track axis +Z (docs/01-gdd.md 16.7: off by the producer's decision 05.10; true — as on M1–M3). */
    autoTurn: boolean;
    autoTurnDelaySec: number;
    autoTurnRate: number;
    autoTurnConeDeg: number;
    zoomMin: number;
    zoomMax: number;
    pitchMinDeg: number;
    pitchMaxDeg: number;
    mouseDegPerPx: number;
    touchDegPerPx: number;
    sensitivity: number;
    shake: number;
    collisionRadius: number;
    retreatSpeed: number;
    /** The hero hides when the camera is closer than this to his chest; a bot too, or near the line camera → hero. */
    hideDistance: number;
    /** Playtest M2: a wall right behind the hero closer than this — the camera rises over him, up to raiseMaxDeg
     * of pitch in raiseStepDeg steps, and comes down at raiseReturnRate rad/s. */
    minDistance: number;
    /** In a shelter the camera never comes closer than this to the hero's body; pressed into a wall there (the free
     * distance under minDistance) it takes the grotto frame `grottoShot` (docs/01-gdd.md 18.8, item 3). */
    minDist: number;
    /** The grotto frame: from the slope `out` units off the mouth, `height` over the floor, `back` downhill, looking at the
     * hero; taken when the free distance behind him in a shelter is under `pressed` (the camera ran into a wall). */
    grottoShot: { out: number; height: number; back: number; fov: number; pressed: number };
    raiseMaxDeg: number;
    raiseStepDeg: number;
    raiseReturnRate: number;
    /** A bot closer than this to the line camera → hero hides. */
    occludeRadius: number;
    /** Pace open (docs/01-gdd.md 17.9): the FOV on a phone is this much wider. */
    mobileFovAdd?: number;
  };
  input: {
    stickRadiusFrac: number;
    deadZoneFrac: number;
    tapMaxMs: number;
    tapMovePx: number;
    zoomStep: number;
    jumpButtonFrac: number;
  };
  avalanche: {
    shakeStrength: number;
    rumble: number;
    /** Phase `gone`: seconds the snow takes to melt at the camp (the pause intervalSec counts from its start). */
    fadeSec: number;
    /** Lowest spawn point: this far above the camp (docs/01-gdd.md 4.2: start of zone 1 + 40). */
    spawnMinFromCamp: number;
    /** Camera frame on the wave from the cave (docs/02-tech.md 7): front closer than this, pull back to shotDistance, return in shotReturnSec. */
    shotTriggerDist: number;
    shotDistance: number;
    shotReturnSec: number;
    /** Wide cave frame while an avalanche is on (playtest M2): camera point and look point in cave coordinates —
     * across from the mouth (0) to the back wall (1), floor (0) to roof (1), downhill (0) to uphill (1) side; its FOV.
     * pos[1] > 1 — over the roof, pos[0] > 1 — behind the back wall: that part is not drawn while the frame lasts
     * (PR-07: the cave is too low for the whole hero at ≤ 30% of the frame). */
    caveShot: { pos: [number, number, number]; look: [number, number, number]; fov: number };
    /** Front surface displacement, units. */
    noise: number;
    /** Snow body behind the front, units uphill. */
    bodyLength: number;
    /** Front closer than this: strong rumble and shake (docs/01-gdd.md 4.8). */
    nearDist: number;
    /** «Snowed in!» (docs/01-gdd.md 4.5): the ball forms, rolls `balance.caught.rollSec`, pops; hop height on bumps. */
    caughtFormSec: number;
    caughtPopSec: number;
    ballBounce: number;
  };
  /**
   * Fun between the gates (docs/01-gdd.md 16.4; docs/01a-content.md 15.5): the trampoline throws up at `padSpeed` and
   * adds `padForward` along the track; on the ice slide the run is × `slideMult` and stays so `slideSec` after it;
   * gifts on the path taken within `giftStreakSec` of each other ring a note higher each.
   */
  fun: { padSpeed: number; padForward: number; slideMult: number; slideSec: number; giftStreakSec: number };
  /**
   * Reward of every gate (docs/01-gdd.md 16.5): a fountain of `fountain` [min, max] coins into the coin plaque; gates
   * coming within `streakSec` of each other ring a semitone higher each, up to `streakSteps` steps.
   */
  gateReward: { fountain: [number, number]; streakSec: number; streakSteps: number };
  /** Pace open (docs/01a-content.md 16.7): the ridge view — up `rise`, back `back`, `sec` long (docs/01-gdd.md 17.9). */
  ridgeShot?: { rise: number; back: number; sec: number };
  /** The giant-zone shot: from the side `side` units, up `rise`, back `back`, `sec` long (docs/01-gdd.md 17.9). */
  bossShot?: { side: number; rise: number; back: number; sec: number };
  /** The giant's stomp shakes the camera this much near him. */
  boss?: { stompShake: number };
  /** Draw distance of the slope parts on a PC and a phone (docs/01-gdd.md 17.10). */
  far?: { pc: number; mobile: number };
}

export type SegmentType =
  | 'floor'
  | 'wall'
  | 'gate'
  | 'niche'
  | 'gap'
  | 'ramp'
  | 'steps'
  | 'treadmill'
  | 'checkpoint'
  | 'coins'
  | 'chest'
  | 'portal'
  | 'decor'
  | 'gift'
  | 'eggStand'
  | 'zoneArch'
  | 'summit'
  | 'jumpPad'
  | 'slide'
  | 'fork'
  | 'cliff'
  | 'chestGrotto'
  | 'chasm'
  | 'throat'
  | 'tunnel'
  | 'hump';

export interface Segment {
  type: SegmentType;
  /** Position along the track, units; the track runs along +Z (docs/02-tech.md 8.1). */
  z: number;
  /** Extra fields depend on type: length, requires, reward, side, treadmill, height, x, zone, egg ... */
  [key: string]: unknown;
}

export interface WorldThreat {
  intervalSec: number;
  firstIntervalSec: number;
  warnSec: number;
  speed: number;
  from: 'aboveHero' | 'end' | 'start';
  spawnAhead: number;
  firstWaveScripted: boolean;
  safeZoneZ: [number, number];
  /** Open slope (docs/01-gdd.md 17.5): the front never starts above this z — the start line of the giant's zone. */
  spawnMaxZ?: number;
}

export interface WorldZone {
  k: number;
  rarity: string;
  gift: number;
  zStart: number;
  zEnd: number;
  /** Open slope (docs/01-gdd.md 17.4): every step on this section gives × stepMult; absent — ×1. */
  stepMult?: number;
}

/**
 * A giant of a zone (docs/01-gdd.md 17.6; docs/01a-content.md 16.4): walks the zone along the slope at `speed` (tier 0),
 * turns to the hero in `turnSec` once he is in the zone (`seeDist` 0 — sees him anywhere in it).
 */
export interface WorldGiant {
  speed: number;
  patrol: 'alongZ';
  seeDist: number;
  turnSec: number;
  /** Where on its patrol (up the zone and back) it starts, a share of the round (docs/01a-content.md 17.4: 0 — at the
   * start going up, 0.5 — at the end coming down); absent — spread evenly over the zone as on PS. */
  phase?: number;
}

/**
 * A helper of the giant (docs/01-gdd.md 18.5; docs/01a-content.md 17.4): stands on the border `side` at `x`; while the
 * hero is in the zone it throws a snowball every `throwEverySec` at where he will be in `flightSec`; a hit within
 * `hitRadius` slows him × `slow` for `slowSec`.
 */
export interface WorldHelper {
  side: 'left' | 'right';
  x: number;
  throwEverySec: number;
  flightSec: number;
  slow: number;
  slowSec: number;
  hitRadius: number;
}

/** A zone of giants before the summit: [zStart, zEnd], the advice number of its sign, back to patrol × returnMult. */
export interface WorldBoss {
  zone: [number, number];
  requires: number;
  returnMult: number;
  giants: WorldGiant[];
  /** From mountain 4 (docs/01-gdd.md 18.5): helpers with snowballs on the borders; absent — none. */
  helpers?: WorldHelper[];
}

export interface World {
  id: string;
  index: number;
  length: number;
  width: number;
  spawnZ: number;
  egg: string;
  /** Stretch length of the classic and gateSide layouts; the open slope (sections of their own lengths) — the longest. */
  stretch: number;
  wallCount: number;
  safeZones: Array<[number, number]>;
  threat: WorldThreat;
  zones: WorldZone[];
  segments: Segment[];
  treadmillMult: number;
  /** Mountain layout of the generator (docs/01-gdd.md 16.3); absent — the classic one of 5.2. */
  layout?: WorldLayout;
  /** Theme of the mountain look (sky, decor; M5) when it differs from the id (docs/01-gdd.md 16.3). */
  look?: string;
  /** Open slope (docs/01-gdd.md 17.6): zones of giants before the summit; absent — no giant. */
  bosses?: WorldBoss[];
}

export type WorldLayout = 'classic' | 'gateSide' | 'openSlope';

export interface WorldsJson {
  schema: number;
  generator: string;
  worlds: World[];
}

export interface WorldsSpecJson {
  schema: number;
  campLength: number;
  summitLength: number;
  width: number;
  spawnZ: number;
  /** `firstIntervalSec` — mountain 1 and any mountain without its own; `laterFirstIntervalSec` — [min, max] of mountains 2+ (Q-022). */
  threat: { spawnAhead: number; firstIntervalSec: number; laterFirstIntervalSec?: [number, number]; from: 'aboveHero' | 'end' | 'start'; firstWaveScripted: boolean };
  rarities: string[];
  /** Layout of every mountain (docs/01-gdd.md 16.3): absent or "classic" — 5.2, "gateSide" — the cave beside each gate. */
  layout?: WorldLayout;
  mountains: Array<{
    id: string;
    /** Theme of the mountain look (M5), see World.look. */
    look?: string;
    stretch: number;
    intervalSec: number;
    /** First avalanche after a load or the portal (docs/01-gdd.md 4.1; M3-12); absent — threat.firstIntervalSec. */
    firstIntervalSec?: number;
    warnSec: number;
    speed: number;
    egg: string;
    gifts: number[];
    walls: Array<{ requires: number; treadmill: number }>;
    campTreadmill?: number;
  }>;
}

/**
 * worlds-spec.json of the open slope (docs/01-gdd.md 17.2; docs/01a-content.md 16.1–16.5): per mountain its sections
 * (length, step multiplier, shelter spacing, gift, a fork or not), the ridges at their ends and the giant's zone.
 */
export interface OpenSpecJson {
  schema: number;
  layout: 'openSlope';
  campLength: number;
  summitLength: number;
  width: number;
  spawnZ: number;
  threat: WorldsSpecJson['threat'];
  rarities: string[];
  /** Defaults of every giant zone (docs/01a-content.md 16.4); a mountain's `boss` may override them. `helper` — the
   * numbers of every helper (docs/01a-content.md 17.4). */
  boss: { turnSec: number; returnMult: number; seeDist: number; zoneGap: number; helper?: Omit<WorldHelper, 'side'> };
  /** Elements of the slope (docs/01-gdd.md 18.3; docs/01a-content.md 17.1): from which mountain each is allowed. */
  shapeFrom?: Record<ShapeKind, number>;
  /** Sizes of the elements (docs/01a-content.md 17.2), read by the generator. */
  shapes?: OpenShapes;
  mountains: OpenSpecMountain[];
}

/** An element of a section of the open slope (docs/01-gdd.md 18.3): chasm, throat, tunnel, hump. */
export type ShapeKind = 'chasm' | 'throat' | 'tunnel' | 'hump';

/** Sizes of the elements (docs/01a-content.md 17.2); `…ByWorld` — the value on that mountain (key: its number). */
export interface OpenShapes {
  /** Grottos of the slope this long along it from mountain `fromWorld` (docs/01-gdd.md 18.8 item 3: 8 → 10; mountain 1 stays as built). */
  grotto?: { width: number; fromWorld: number };
  chasm: { width: number; depth: number; giftsAir: number; giftsBottom: number; ramp: number; padBefore: number; widthByWorld?: Record<string, number> };
  throat: { width: number; length: number; slideMult: number; holdSec?: number; fieldGifts: number; fieldGrotto: number; height: number; funnel: number; lengthByWorld?: Record<string, number> };
  tunnel: { width: number; height: number; length: number; openGifts: number; lengthByWorld?: Record<string, number> };
  hump: { rise: number; slideLength: number; top: number; flight: number; giftsAir: number; landing: number; flightByWorld?: Record<string, number> };
}

export interface OpenSpecMountain {
  id: string;
  look?: string;
  egg: string;
  intervalSec: number;
  firstIntervalSec?: number;
  warnSec: number;
  speed: number;
  /** `shape` — the elements of the section by the slots of docs/01-gdd.md 18.6; absent or empty — as 16.5. */
  sections: Array<{ length: number; stepMult: number; shelterEvery: number; gift: number; fork: boolean; shape?: ShapeKind[] }>;
  ridges: Array<{ requires: number }>;
  /** The finish straight: its length, the advice number, the giant's speed V_b, step multiplier and gift there. */
  boss: { stretch: number; requires: number; margin: number; stepMult: number; gift: number; speed: number; turnSec?: number; returnMult?: number; seeDist?: number; helpers?: Array<{ side: 'left' | 'right' }>; giants?: Array<{ phase: number }> };
}

export type I18nJson = Record<string, string>;

export interface SkinsJson {
  default: string;
  skins: Array<{
    id: string;
    unlock: { kind: 'default' | 'trophies' | 'daily' | 'iap' | 'tier'; value?: number | string };
    colors: { head: string; torso: string; armL: string; armR: string; legL: string; legR: string };
    face: string;
    hat: string | null;
  }>;
  /** Wings (docs/01-gdd.md 7.4): looks only; the accessory of the same id (attach «back») is drawn on the hero. */
  wings?: Array<{ id: string; unlock: SkinsJson['skins'][number]['unlock'] }>;
}

export interface AccessoriesJson {
  accessories: Array<{
    id: string;
    attach: 'head' | 'back' | 'feet' | 'hand';
    parts: Array<{ shape: 'box' | 'sphere' | 'cylinder' | 'cone'; size: [number, number, number]; pos: [number, number, number]; color: string }>;
  }>;
}

/** pets.json (docs/01a-content.md 6): bonus is the step bonus (0.2 = +20%). */
export interface PetsJson {
  pets: Array<{ id: string; rarity: string; bonus: number; color: string; accent: string }>;
}

/** eggs.json (docs/01a-content.md 6): price at tier 0 (× wallScale on tier n), pool of pets with chances summing to 1. */
export interface EggsJson {
  eggs: Array<{ id: string; price: number; pool: Array<{ pet: string; chance: number }> }>;
}

/** trails.json and auras.json (docs/01a-content.md 7): step multiplier, price in trophies, colour of the trail or the glow. */
export interface CosmeticItem {
  id: string;
  mult: number;
  price: number;
  color: string;
}
export interface TrailsJson {
  trails: CosmeticItem[];
}
export interface AurasJson {
  auras: CosmeticItem[];
}

/**
 * bots.json (docs/01a-content.md 12; docs/01-gdd.md 7.12): how many bots per quality level, name keys of i18n,
 * colours of their parts, speed factor and treadmill seconds as [min, max] ranges, the share that hides on warn.
 */
export interface BotsJson {
  count: { high: number; medium: number; low: number };
  showNames: boolean;
  names: string[];
  palette: { jackets: string[]; pants: string[]; hats: string[]; heads: string[]; hat: string; faces: string[] };
  speedFactor: [number, number];
  treadmillSec: [number, number];
  hideChance: number;
  /** A bot more than this many stretches below the hero leaves for the camp and comes back at his flag. */
  leashWalls: number;
  spawnCampMax: number;
  awaySec: [number, number];
  /** Bots waiting in the camp at the start leave it one by one within this range. */
  campReleaseSec: [number, number];
  /** Name labels: full up to `nearDist` from the camera, faded out over the next `fadeDist`. */
  label: { nearDist: number; fadeDist: number };
  /** Open slope (docs/01-gdd.md 18.3): the share of bots that take a tunnel at its fork; absent — the lane decides. */
  tunnelShare?: number;
  /**
   * The giant's zone (docs/01-gdd.md 18.5): a bot waits `waitSec` in the grotto before it and runs it; `passShare` of
   * them run at the giant's speed × speedK[1] (past him), the rest × speedK[0] (caught). Absent — bots walk through.
   */
  boss?: { waitSec: [number, number]; passShare: number; speedK: [number, number] };
}

/** sfx.json (docs/02-tech.md 10): ZzFX parameters per sound event. */
export type SfxJson = Record<string, number[]>;

export interface ContentPack {
  game: GameJson;
  theme: ThemeJson;
  balance: BalanceJson;
  tuning: TuningJson;
  worlds: WorldsJson;
  skins: SkinsJson;
  accessories: AccessoriesJson;
  pets: PetsJson;
  eggs: EggsJson;
  trails: TrailsJson;
  auras: AurasJson;
  sfx: SfxJson;
  bots: BotsJson;
}

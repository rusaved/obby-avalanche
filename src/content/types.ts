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
    /** SP-06 (docs/01-gdd.md 20.6): `coverBonus` — a hero faster than the slip speed × (1 − coverBonus) loses a chasing giant
     * behind a rock for `cover.hideSec`; `cover.pad` — how far off a rock's face the giant goes round it. */
    boss?: { kind: 'giant'; margin: number; catch: 'roll'; reach: number; run?: number; coverBonus?: number; cover?: { hideSec: number; pad: number } };
  };
  leaderboard: { name: string; score: string } | null;
  /** The desktop shortcut for a reward (docs/01-gdd.md 19.10; docs/01a-content.md 18.7): spendable trophies once, the
   * button on the base from summit `fromSummit`; absent or `enabled` false — no button and no shortcut call. */
  shortcut?: { enabled: boolean; reward: { trophies: number }; fromSummit: number; place: 'base' };
  /** The public communities of the game (docs/01-gdd.md 19.10; 03 CNT-05, 4.1; Q-054): a channel address by id — a
   * button each by the side of the pause window under «Promo codes and bonuses in the channel», a new tab, no reward;
   * empty or absent — no button. The only links of the game. */
  community?: { telegram?: string; vk?: string };
  /** FM-16 (producer 14.10): a gift for subscribing to a channel of `community` (once a channel) and for a review of
   * the game (once); absent — no card. */
  communityGifts?: { subscribe?: Extract<Reward, { kind: 'egg' | 'coins' }>; review?: Extract<Reward, { kind: 'egg' | 'coins' }> };
  /** MU-08 (docs/07-mobile-ui.md, w3-pause «Enter a code»): promo codes of the group and their gifts, each once. */
  promo?: { enabled?: boolean; codes: Record<string, Extract<Reward, { kind: 'egg' | 'coins' }>> };
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
  /** RL-07 (docs/01-gdd.md 21.7): one blizzard a mountain for sure on one of these sections (picked by the seed). */
  guaranteed?: number[];
}

export interface GameEvents {
  minGapSec: number;
  /** Not before this long after entering the section: the toast of its gifts goes first. */
  delaySec: number;
  sections: [number, number];
  snowball?: SnowballEvent;
  blizzard?: BlizzardEvent;
}

export interface ThemeTint {
  sky: { top: string; bottom: string };
  fog: string;
  track: string;
}

/** M5-02: how the avalanche looks and sounds on a mountain (theme.json threat, threat.worlds). */
export interface ThreatLook {
  front?: [string, string];
  edge?: string;
  body?: string;
  dust?: string;
  clump?: string;
  shadow?: string;
  clumps?: number;
  rumble?: number;
}

/** Z-06: the winter decor (content/<pack>/decor.json; render/winter-decor.ts): the Kenney models picked (only they are
 * converted by npm run gen:decor), their scale, warm glows (model units: x, y, z, radius), and where they stand. */
export interface DecorJson {
  models: Array<{ id: string; file: string; recolor?: Record<string, string> }>;
  recolor?: Record<string, string>;
  scale: Record<string, number>;
  glow: Record<string, Array<[number, number, number, number]>>;
  glowColor: string;
  glowOpacity: number;
  /** Light left at the foot of a model and the height of that foot (units). */
  ao: number;
  foot: number;
  /** Kinds of boxes and types of points a model never stands on or near. */
  /** `near` — how far past its clear a point keeps the edge decor; `step` — the most its foot may lean (units). */
  clear: { boxKinds: string[]; points: string[]; near: number; step: number };
  edge: { every: number; perStage: number; inset: [number, number]; jitter: number; clear: number; pick: string[] };
  finish: { inset: number; from: number; span: number; clear: number; post: string; garland?: string; garlandLift: number; props: string[] };
  campClear: number;
  camp: Array<{ id: string; x: number; z: number; yaw?: number; lift?: number }>;
}

/** Z-06: decor-models.json — generated (npm run gen:decor): positions in hundredths of a unit, a palette index a vertex, triangles. */
export interface DecorModelsJson {
  palette: string[];
  models: Record<string, { pos: number[]; col: number[]; idx: number[] }>;
}

/** Z-04: the procedural sky dome (render/sky.ts): the sun low ahead, rings of far peaks, puffy clouds. */
export interface ThemeDome {
  sun: string;
  /** Elevation of the sun (rad) and how far it leans ahead of the run (added to |sunDir.z| for its azimuth). */
  sunElev: number;
  sunAhead: number;
  /** Radius of the disc (units on the dome) and of its glow (× the disc). */
  sunSize: number;
  glow: number;
  snow: string;
  cloud: string;
  cloudShade: string;
  seed: number;
  /** Rings of far peaks: distance (× the dome radius), heights of the high and low peaks, how many, haze 0–1 (the
   * farther the paler). */
  peaks: Array<{ dist: number; height: [number, number]; count: number; haze: number }>;
  clouds: { count: number; elev: [number, number]; size: number };
}

export interface ThemeJson {
  dome: ThemeDome;
  fx: {
    caught: string;
    gateOpen: string;
    footFx: string;
    weather: string;
    screenFrame: string;
    shelterMesh: string;
    treadmill: string;
    /** The summit portal and the portals of the base (docs/01a-content.md 18.6): its arch filled with light, a pillar of
     * light `pillar` units tall, `arrows` arrows on the snow to it (and to the way into each element of the slope). */
    portal?: { fill: boolean; pillar: number; arrows: number };
  };
  sky: { top: string; mid?: string; bottom: string };
  /** G-08 (producer 26.10): the hero brighter than the world — his colours ×`saturation` (HSL), a dark `outline`
   * `outlineWidth` units thick, sparks of his steps and his jumps, the confetti of «Level up!». */
  hero?: { saturation: number; outline: string; outlineWidth: number; stepSparks: number; jumpSparks: number; levelConfetti: number };
  fog: { color: string; near: number; far: number };
  /** RL-04 (docs/01-gdd.md 21.4): a mountain's own sky, fog and snow by its id; absent — the colours above. */
  tints?: Record<string, ThemeTint>;
  light: { sun: string; sunIntensity: number; ambient: string; ambientIntensity: number; sunDir: [number, number, number] };
  /** Z-05: `tex` — the layer of the block texture (render/block-tex.ts BLOCK_LAYERS), absent — plain. */
  materials: Record<string, { color: string; roughness?: number; metalness?: number; emissive?: string; tex?: string }>;
  /** Z-05: the block texture — world units a tile and the light left at the foot of standing blocks (vertex AO). */
  blockTex?: { scale: number; ao: number };
  rarity: Record<string, string>;
  /** `plaque`, `plaqueAlpha`, `plaqueText`: the dark see-through plaque under the avalanche banner and the small HUD
   * arrows («wrong way», the way to the belt) with its text colour (docs/01-gdd.md 16.7: contrast ≥ 4.5:1). */
  ui: {
    stat: string;
    coins: string;
    trophies: string;
    ok: string;
    no: string;
    statIcon: string;
    plaque: string;
    plaqueAlpha: number;
    plaqueText: string;
    /** FM-04 (docs/01-gdd.md 19.8): the dark see-through plaque under the toasts (text contrast over snow ≥ 4.5:1). */
    toastPlate?: { bg: string; alpha: number; radius: number; padX: number; padY: number };
    /** FX-07: the glow of rewards — the golden toast, the flying marks, the counter they land on; absent — none. */
    glow?: { color: string; alpha: number; blur: number };
    /** MU-01 tokens of the phone layout (docs/07-mobile-ui.md «Токены»): set as CSS variables --mu-<key> on the page. */
    mu?: Record<string, string>;
    /** FM-04: «+N» `scale` times its old size, in the Speed plaque colour with a dark `outline` (px). */
    gainText?: { scale: number; outline: number };
  };
  /** M5-02: `clump` — colour of the snow clumps, `shadow` — of the shadow ahead of the front, `clumps` — how many,
   * `rumble` — semitones of the rumble; `worlds` — a mountain's own look over these, by its id. */
  threat: ThreatLook & { front: [string, string]; edge: string; body: string; dust: string; height: number; worlds?: Record<string, ThreatLook> };
  bonus?: { color: string };
  /** The giant (docs/01a-content.md 16.4): height, colours of the parts and the hat, the face, the horizon silhouette. */
  /** `helper` (docs/01a-content.md 17.4): the giant's helpers — their height, the colour of their snowball. */
  boss?: { height: number; colors: { head: string; torso: string; arms: string; legs: string; hat: string }; face: string; silhouette: string; helper?: { height: number; snowball: string } };
  /** Rare events (docs/01a-content.md 17.3): the colours of the snowball's trail and of the ball, of the blizzard's fog, snow and the glow over the shelters. */
  events?: { snowball?: { trail: string; ball: string }; blizzard?: { fog: string; snow: string; glow: string } };
  /** Decor of the open slope (docs/01-gdd.md 18.7; docs/01a-content.md 17.5): pets of pets.json walking a patch at the
   * slope edge and birds sitting on cliffs, the borders under a ridge and the giant's sign, on the mountains of `on` looks;
   * none below minQuality. */
  decor?: {
    minQuality: 'low' | 'medium' | 'high';
    walkers: { look: string; on: string[]; perSection: [number, number]; patch: number; speed: number };
    sitters: { looks: string[]; on: string[]; perSection: [number, number]; lookAtDist: number; hopDist: number };
  };
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
  /** SD-03 (docs/01-gdd.md 23.3): `currency` trophies — the shoes are bought with the stage trophies; absent — coins. */
  upgrade: { attach: 'feet' | 'head' | 'back' | 'hand'; tiers: Array<{ id: string; mult: number; price: number }>; currency?: 'coins' | 'trophies'; trophyRate?: number };
  rebirth: {
    stepMult: number;
    wallScale: number[];
    lateEase: { fromWall: number; toFactor: number };
    wallScaleGrowth: number;
    unlock: string;
  };
  trophies: { perSummit: string };
  gifts: { perZone: number; respawn: 'onWaveGone' | 'never' };
  coins: { gatePass: number; waveSurvived: number; chest: number };
  pets: { slots: number; inventory: number };
  /** `x2Mult`: the ×2 step boost (ad, rewards); `statNowSec`: treadmill seconds of «speed now» (docs/01-gdd.md 8.1). */
  boost: { x2Sec: number; x2Mult: number; statNowSec: number };
  /** `to` (RL-02, docs/01-gdd.md 21.2): «flag» — a fall, «Snowed in!» and the giant roll the hero to the flag of the ridge
   * below; absent or «caveBelow» — to the cave below (4.5). SD-15 (review: every slap of the giant sent the hero back to
   * the camp): `giant` «stage» — his slap rolls to the start of his own stage; absent — as `to`. MU (Q-MU-12): `pastGiant`
   * «own» — a fall on the stage right after a giant passed in this attempt rolls to that stage's start, not back to him. */
  caught: { rollSec: number; maxSec: number; to?: 'flag' | 'caveBelow' | 'prevStage'; giant?: 'stage'; pastGiant?: 'own'; giantFreeSec?: number };
  /** Levels of the stat (docs/01-gdd.md 22.2, pace stages): level 2 from `first`, each next ×`growth`; absent — no levels. */
  levels?: { first: number; growth: number };
  /** The wallet of shoes, eggs and coin rewards (docs/01-gdd.md 22.8): `trophies` on the stages pace; absent — coins. */
  currency?: 'coins' | 'trophies';
  /** `resumeSec`: the first avalanche after F5 or another day comes this late (docs/01-gdd.md 6.6). */
  threat: { newbieWaves: { count: number; warnBonusSec: number }; resumeSec: number };
  niche: { graceDist: number; graceMoving: number };
  /** `statMilestones`: round numbers of the stat that flash the plaque once a load (docs/01-gdd.md 10.4, Q-023). */
  /** `summitGroup` (FM-08, docs/01a-content.md 18.4): an element of the summit group → the summit after whose window it
   * comes; absent — all after the first (6.4). */
  ui: { unlockMenusSec: number; unlockTimeRewardsSec: number; menuStepSec: number; statMilestones: number[]; summitGroup?: Record<string, number>; padStandSec?: number };
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
    /** Stages pace (docs/01-gdd.md 22.9): «Continue from stage N» shows this long after a roll-back; absent — 60. */
    stageContinueSec?: number;
    /** ST-07: no fullscreen ad this long after a roll-back (the snowball popped); absent — 0. */
    afterRollSec?: number;
    /** ST-07: eggs for an ad a day at most; absent — no cap. */
    eggPerDay?: number;
    eggViews: number;
    eggPauseSec: number;
    skipFirstPortal: boolean;
    wheelCooldownSec: number;
  };
  /** `vipMult`: the step multiplier of the VIP purchase (docs/01-gdd.md 8.1, 9.3). */
  /** `starter`: what the starter pack gives (docs/01-gdd.md 9.3): its pet and trophies (spendable only); its look is the
   * skin of source «starter» in skins.json. */
  iap: { showAfterPlaySec: number; vipMult: number; starter?: { pet: string; trophies: number } };
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
    /** The stages pace (docs/01-gdd.md 22.1): moved numbers — the model reports, its checks do not fail the run. */
    reportOnly?: string;
    keep?: number;
    roundDigits?: number;
    /** Thresholds of F1–F8 (pace open, docs/01-gdd.md 17.12); absent — the numbers of 8.5. `rhythm` — F14 (docs/01-gdd.md
     * 19.6: the first `sec` seconds, the longest gap between rewards, the stand on a belt at a ridge of mountain 1 for the
     * greedy bot and the novice); `buyer` — F15 (19.7). */
    checks?: Record<string, number | Array<number | number[]> | Record<string, number | boolean>>;
    /** F11: eggs bought by the summit of a mountain (decision 07.10). */
    eggsByMountain?: Array<{ mountain: number; min: number }>;
    /** Words of the report for a wall of the pace: one, of one, many, of many. */
    words?: { one: string; gen: string; many: string; manyGen: string };
    /** SP-09 (docs/01a-content.md 19.8): `--fit` takes the walls of mountain `from` on by this profile of the model. */
    fitProfile?: { from: number; profile: string };
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
  /** «Pets speed up your steps» (docs/01-gdd.md 20.9, Q-065): an open egg with `coins` × its price in hand whose average
   * pet is more than `better` × the weakest pet on; up `sec`, `max` times in the life of the player. The model's
   * profiles take that egg (scripts/balance-model.ts). Absent — no hint. */
  pets?: { better: number; coins: number; sec: number; max: number };
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
    /** SD-04 (docs/01-gdd.md 23.4): on a stage the run speed in the air × g^(level − the stage's level), within min–max:
     * a level above the stage jumps farther, two below falls short; absent — ×1. */
    levelJump?: { g: number; min: number; max: number };
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
    /** `orbitDeg` (Q-066): a turn by hand in the grotto frame takes it round the hero this far either way from the mouth's
     * side (absent — the frame does not turn). */
    grottoShot: { out: number; height: number; back: number; fov: number; pressed: number; orbitDeg?: number };
    raiseMaxDeg: number;
    raiseStepDeg: number;
    raiseReturnRate: number;
    /** A bot closer than this to the line camera → hero hides. */
    occludeRadius: number;
    /** Pace open (docs/01-gdd.md 17.9): the FOV on a phone is this much wider. */
    mobileFovAdd?: number;
    /** MU-10: the phone layout lifts the picture by this share of the height (the hero over the bottom HUD). */
    muLift?: number;
    /** Round of fixes MU (review: running, the hero sank under «N Speed» and the bar): the lead by velocity of the phone
     * layout instead of `leadSec`; 1 / damping keeps a running hero where he stands. */
    muLeadSec?: number;
    /** FM-03 (docs/01-gdd.md 19.8): a giant between the camera and the hero is drawn see-through at this share. */
    fadeAlpha?: number;
    /** FM-03: in a giant's zone running up the view never turns from the giant ahead by more than this (deg), until the
     * player turns the camera by hand. */
    bossKeepDeg?: number;
    /** Q-066 (docs/01-gdd.md 17.9): on the siren the mouth of the lit shelter is kept in the view by bossKeepDeg while the hero
     * is farther than this from it (units) and has not turned the camera by hand (running back to it, the camera never looks
     * into his face); absent or 0 — never. */
    shelterKeep?: number;
    /** Q-066: an arch of the base nearer than this to the camera (units), or on its line to the hero, is not drawn; absent — never. */
    archHide?: number;
    /** RL-09: tall walls (cliffs, throat, tunnel and rock walls) let the camera through and fade at fadeAlpha in its way. */
    seeThrough?: boolean;
    /** SP-03 (docs/01-gdd.md 20.3): the camera backs off this much at the top of the run (distance + add × share). */
    speedDistanceAdd?: number;
    /** SP-03: set — the share of speed for the FOV and the distance is ((v − baseSpeed) / (maxSpeed − baseSpeed))^speedPow over
     * the ceiling of the controller (the run grows on the eye); absent — v over the run speed of the stat now, as before. */
    speedPow?: number;
    /** SP-01 (docs/01-gdd.md 20.2): the record flag is not drawn on the line camera → hero nor nearer than
     * hideDistance × flagHide to the camera; absent — always drawn. */
    flagHide?: number;
    /** SP-01: after the grotto frame and the avalanche frame the view comes back «run» — behind the hero where he runs
     * (up the slope when he stands), or «before» — to the yaw from before the frame (as until SP); absent — «before». */
    backBehind?: 'run' | 'before';
    /** LV-10 (docs/01-gdd.md 22.11): on a PC the mouse moved over the field without a button turns the camera by
     * mouseYawPerPx °/px; mouseReturnSec of no such move — the view eases back behind the hero (a drag keeps it the
     * player's, and a move within mouseReturnSec of a drag is not a look); absent or false — only a drag turns it. */
    mouseLook?: boolean;
    mouseYawPerPx?: number;
    /** LV-12: the outer share of the field where the mouse turns nothing (on its way to the corner buttons). */
    mouseEdge?: number;
    /** SD-01 (docs/01-gdd.md 23.1): the top share of the field and the px round HUD buttons where the mouse turns nothing. */
    mouseTop?: number;
    mouseButtonPad?: number;
    /** SD-01: false — no frame of its own in grottos and caves (the view behind the hero), their walls and roofs see-through. */
    grottoFrame?: boolean;
    mouseReturnSec?: number;
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
    /** M5-02: the ridge of clumps on warn (× clump size), the inner glow of the clumps (0–1), the dust size. */
    warnRidgeScale?: number;
    clumpGlow?: number;
    dustSize?: number;
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
    /** Q-067 (playtest of «Размах», cycle 3: in every shelter the screen went white): the cave frame is held until the whole
     * snow body has passed the hero, a camera inside a shelter is not in the snow (no veil), and «Phew, made it!» with the
     * free egg wait for the snow to pass; absent — as before. */
    shotUntilClear?: boolean;
    /** Q-067: the cave frame on an avalanche with shotUntilClear (inside the shelter behind the hero, in the coordinates of
     * caveShot); absent — caveShot. The belt frame outside an avalanche stays caveShot. */
    waveShot?: { pos: [number, number, number]; look: [number, number, number]; fov: number };
    /** LV-10 (docs/01-gdd.md 22.11): the frame of the scripted first wave in a grotto in a rock (in the coordinates of caveShot
     * in its axes: depth up the slope from the mouth): out of its mouth over the roof, up the slope where the front comes
     * from; absent, or that point inside the level — waveShot. */
    firstWaveShot?: { pos: [number, number, number]; look: [number, number, number]; fov: number };
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
    /** FM-04 (docs/01-gdd.md 19.8): the arrow to the shelter on the warning is this many times its old size; absent — 1. */
    arrowScale?: number;
  };
  /**
   * Fun between the gates (docs/01-gdd.md 16.4; docs/01a-content.md 15.5): the trampoline throws up at `padSpeed` and
   * adds `padForward` along the track; on the ice slide the run is × `slideMult` and stays so `slideSec` after it;
   * gifts on the path taken within `giftStreakSec` of each other ring a note higher each.
   */
  /** `slideSway` (RL-06): the hero sways this many degrees side to side on an ice slide, `slideSwayHz` times a second. */
  fun: { padSpeed: number; padForward: number; slideMult: number; slideSec: number; giftStreakSec: number; slideSway?: number; slideSwayHz?: number };
  /**
   * Reward of every gate (docs/01-gdd.md 16.5): a fountain of `fountain` [min, max] coins into the coin plaque; gates
   * coming within `streakSec` of each other ring a semitone higher each, up to `streakSteps` steps.
   */
  gateReward: { fountain: [number, number]; streakSec: number; streakSteps: number };
  /**
   * FX (producer 22.10): a toast stays `toastMinSec` before the next, `toastGapMs` between two; a counter ticks to its new
   * number over `tickMs`; a window opens and closes over `windowMs` (≤ 150); interface sounds — not more than
   * `uiSoundPerSec` a second; a reward flies `flyIcons` marks to its counter over `flyMs`. Absent — none of it.
   * SP-03 (docs/01-gdd.md 20.3): wind lines past the hero from `windFrom` of the run speed (camera.speedPow); absent — none.
   */
  fx?: { windFrom?: number; toastMinSec?: number; toastGapMs?: number; tickMs?: number; windowMs?: number; uiSoundPerSec?: number; flyIcons?: number; flyMs?: number; musicDuck?: number; musicFanfare?: number };
  /** Pace open (docs/01a-content.md 16.7): the ridge view — up `rise`, back `back`, `sec` long (docs/01-gdd.md 17.9). */
  ridgeShot?: { rise: number; back: number; sec: number };
  /** The giant-zone shot: from the side `side` units, up `rise`, back `back`, `sec` long (docs/01-gdd.md 17.9). */
  bossShot?: { side: number; rise: number; back: number; sec: number };
  /** The giant's stomp shakes the camera this much near him. */
  boss?: { stompShake: number };
  /** Draw distance of the slope parts on a PC and a phone (docs/01-gdd.md 17.10). */
  far?: { pc: number; mobile: number };
  /** Pace open (docs/01-gdd.md 19.9, Q-048): an invisible wall over the side borders, along the summit and behind its
   * portal, `wallHeight` units over the floor; only the hero meets it (not the camera). Absent — no wall. */
  bounds?: { wallHeight: number };
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
  | 'hump'
  // The funnel of the summit (docs/01-gdd.md 20.2): snow walls from the edges of the slope to the portal.
  | 'funnel'
  // SP-04 (docs/01-gdd.md 20.4): the change of width past a ridge; a grotto in a rock in the middle of a wide section.
  | 'taper'
  | 'island'
  // SP-06 (docs/01-gdd.md 20.6): a rock of the giant's zone to hide behind.
  | 'cover'
  // The base between the mountains (docs/01-gdd.md 19; src/level/base-layout.ts): a box, a portal of a mountain, a stand.
  | 'block'
  | 'basePortal'
  | 'stand'
  // LV (docs/01-gdd.md 22.8): the trophy button at the side of a stage finish.
  | 'trophyPad'
  // RL (docs/01-gdd.md 21): where a fall rolls the hero back to the flag; the stairs of plates to a ridge; a dip across the slope.
  | 'pit'
  | 'stairs'
  | 'dip';

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
  /** Stages pace (docs/01-gdd.md 22.5): the avalanche runs only while the hero is inside one of these [z0, z1]; the
   * first wave of an entry comes after `zoneFirstSec`. Absent — the whole slope as before. */
  /** SD-06: a zone's own first delay of the wave (s) as a third number; absent — zoneFirstSec. */
  zones?: Array<[number, number] | [number, number, number]>;
  zoneFirstSec?: number;
  /** The warning of a wave inside a zone (no newbie bonus: the stage is built for it). */
  zoneWarnSec?: number;
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
  /** `alongZ` — walks at the hero along the slope (PS); `chase` — runs at him in the plane of the slope, round the rocks (SP-06). */
  patrol: 'alongZ' | 'chase';
  seeDist: number;
  turnSec: number;
  /** Where on its patrol (up the zone and back) it starts, a share of the round (docs/01a-content.md 17.4: 0 — at the
   * start going up, 0.5 — at the end coming down); absent — spread evenly over the zone as on PS. */
  /** SD-05 (docs/01-gdd.md 23.5): false — within reach it slaps whatever the speed (no slipping past by running at it);
   * absent — a run faster than speed × (1 + margin) slips past. */
  slipPast?: boolean;
  /** SD-05: the share of its step a chasing giant may move across the slope (keeps to the run line); absent — 1. */
  side?: number;
  /** SD-12 (docs/01-gdd.md 23.9): a chasing giant runs at where the hero was this many seconds ago (heavy: a sharp
   * dodge at the last moment beats it, a straight run or an early one does not); absent — 0, where he is. */
  lag?: number;
  /** SD-15: with slipPast false — a run faster than speed × (1 + slipMargin) still slips past (Speed well above). */
  slipMargin?: number;
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
  /** SP-06 (docs/01a-content.md 19.4): the zone's width and its rocks to hide behind (a box 2r × 2r × h); absent — none. */
  width?: number;
  covers?: WorldCover[];
  /** SD-12 (docs/01-gdd.md 23.9): a trial of every run — passed, its giants walk back to patrol (no win pose) and meet
   * the hero again once he is below the zone; absent — passed once and for all (they sit). */
  rearm?: boolean;
  /** SD-12: Speed decides — the giants' speed × g^(n − the hero's level), within [min, max]; absent — × 1. */
  level?: { n: number; g: number; min: number; max: number };
}

export interface WorldCover {
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface World {
  /** ST-06 (worlds-spec stages.padBehindTakes): a stage pad behind the farthest stage reached pays this many times a life. */
  padBehindTakes?: number;
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
  /** SP-04 (docs/01-gdd.md 20.4): half-width of the slope along it — [z, half] points, linear between, constant past the
   * ends (two points at one z — a step); absent — `width` / 2 everywhere. */
  profile?: Array<[number, number]>;
  /** Stages pace (docs/01-gdd.md 22.4): the mountain as a chain of stages; absent — the other layouts. */
  stages?: WorldStage[];
  /** Stages pace (docs/01-gdd.md 22.12): the teleport pad of the camp — the way to the stages passed, for trophies. */
  campTeleport?: { x: number; y: number; z: number };
}

/** Types of a stage (docs/01-gdd.md 22.5); `intro` — the first minute of mountain 1 as built (22.1). */
export type StageType = 'intro' | 'dips' | 'cracks' | 'giant' | 'plates' | 'catapult' | 'chute' | 'throat' | 'avalanche' | 'blizzard' | 'maze' | 'ice' | 'stairs' | 'ball';

/** ST-02 (wave of difficulty, producer 22.10): the tier of a stage — the number of its pieces goes by it (StageSpec.tierAdd). */
export type StageTier = 'veryEasy' | 'easy' | 'mid' | 'hard' | 'veryHard';

/** The maze of a cave stage (docs/01-gdd.md 22.7): a grid of cells, open edges between them, the way in and the exits. */
export interface StageMaze {
  x0: number;
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  /** Open passages between neighbour cells: [col, row, col2, row2]. */
  open: Array<[number, number, number, number]>;
  entrance: number;
  /** Exits through the outer wall: the cell, the side and whether it leads to the finish (one) or into the pit. */
  exits: Array<{ col: number; row: number; side: 'top' | 'left' | 'right'; real: boolean }>;
}

export interface WorldStage {
  n: number;
  type: StageType;
  /** The gate (z of the ridge; the camp end for stage 1), the body [start, end], the safe finish [end, end + finish]. */
  z0: number;
  start: number;
  end: number;
  finish: [number, number];
  y: number;
  /** The level the ridge asks for (1 — no ridge) and the run speed at its threshold (docs/01-gdd.md 22.4). */
  level: number;
  speed: number;
  width: 'field' | 'bridge' | 'cave';
  /** The trophy button at the side of the finish (docs/01-gdd.md 22.8). */
  trophies: number;
  pad: { x: number; z: number; y: number };
  /** The shortcut of 1.3× speed (docs/01-gdd.md 22.4): a long jump to the golden snowflake; absent — none on this stage. */
  cut?: { gap: number; x: number; z: number };
  maze?: StageMaze;
  /** ST-02: the tier of the stage in the wave of its mountain (StageSpec.waves); absent — no wave on this mountain. */
  tier?: StageTier;
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
    /** `ledge` — the height of the ledge of the stretch's third gift (M5-09, docs/01a-content.md 14.3); absent — 2.5. */
    walls: Array<{ requires: number; treadmill: number; ledge?: number }>;
    campTreadmill?: number;
  }>;
}

/**
 * worlds-spec.json of the open slope (docs/01-gdd.md 17.2; docs/01a-content.md 16.1–16.5): per mountain its sections
 * (length, step multiplier, shelter spacing, gift, a fork or not), the ridges at their ends and the giant's zone.
 */
export interface OpenSpecJson {
  schema: number;
  /** `stageSlope` — the stages pace (docs/01-gdd.md 22) over the same fields plus `stages`. */
  layout: 'openSlope' | 'stageSlope';
  /** The stages pace (docs/01-gdd.md 22, layout stageSlope): how a mountain is cut into stages. */
  stages?: StageSpec;
  campLength: number;
  summitLength: number;
  /** Width of the summit portal arch (docs/01-gdd.md 19.8, FM-02): the hero enters across all of it; absent — 10. */
  portalWidth?: number;
  /** SP-01 (docs/01-gdd.md 20.2): the summit is a funnel — snow walls from the edges of the slope to the portal over
   * `funnelLength` units before it, and on beside it to the end; absent — an open summit as until SP. */
  summit?: { funnel: boolean; funnelLength: number };
  width: number;
  /** SP-04 (docs/01-gdd.md 20.4): a change of width between sections goes over this many units past the ridge; absent — 0. */
  widthTaper?: number;
  /** SP-04: a ridge has one passage every `passEvery` units of its width (the nearest whole number, 3–7); absent — the 3 of 16.5. */
  passEvery?: number;
  /** Q-064: the number of passages the nearest odd one — a passage on the axis; absent or false — the nearest whole. */
  passAxis?: boolean;
  /** SP-04: the height of a ridge's digits — on the field (the widest section of a mountain) and on the others; absent — the renderer's. */
  ridgeDigits?: { field: number; other: number };
  /** SP-04: grottos in the middle of each half of a section wider than `minWidth` — a rock `size` across, every `every` ×
   * shelterEvery (docs/01a-content.md 19.2); absent — none. */
  island?: { size: number; every: number; minWidth: number };
  /** SP-05 (docs/01-gdd.md 20.5): a split fork — the crevasse between its two lanes this deep, a slope up to both every
   * `rampEvery` units, the lanes meet `converge` units before the ridge, `bottomGifts` on its bottom; absent — no split. */
  forkSplit?: { depth: number; rampEvery: number; converge: number; bottomGifts: number };
  /** SP-07 (docs/01-gdd.md 20.7): the approach rise and the ridge passages climb at these slopes (rise / length); absent —
   * the approach 20 long, the passages 8. The trampoline of a bold lane's crevasse from mountain `padFrom` (absent — 1). */
  /** `stairs` (RL-05, docs/01-gdd.md 21.5): from mountain `fromWorld` the bold half of a section's rise (from `inner` off
   * the axis to the edge) is a pit with `count` [min, max] plates `plate` wide, about `step` up each, gaps `gapMin`–`gapMax`;
   * its floor `deep` under the slope, a fall counts `fall` under it. */
  relief?: {
    approachSlope: number;
    passSlope: number;
    padFrom?: number;
    stairs?: { fromWorld: number; count: [number, number]; step: number; plate: number; gapMin: number; gapMax: number; inner: number; deep: number; fall: number };
    /** RL-06 (docs/01-gdd.md 21.6): from section `fromSection`, on a section without a fork, an ice slide `width` wide ×`mult`
     * on the axis, `share` [min, max] of the section long, in the longest free stretch of the axis. */
    chute?: { fromSection: number; share: [number, number]; minLength?: number; width: number; mult: number };
  };
  /** SP-04 (docs/01-gdd.md 20.4: the first minute of the game on the same seconds): on `mountain`, the first grotto row of
   * `section` (the first avalanche) — rocks by the lanes `gap` off their lines — and from that section the grottos with the
   * belt under the ridges and before the giant — rocks by the run, not at the edges of a wide field; absent — at the edges. */
  /** `axis` (producer 14.10): the first avalanche has a third rock on the axis, the crevasse of its fork opens past it. */
  nearRun?: { mountain: number; section: number; gap: number; axis?: boolean };
  spawnZ: number;
  threat: WorldsSpecJson['threat'];
  rarities: string[];
  /** Defaults of every giant zone (docs/01a-content.md 16.4); a mountain's `boss` may override them. `helper` — the
   * numbers of every helper (docs/01a-content.md 17.4). */
  /** SP-06: `patrol` of the giants; `cover` — rocks at shares `at` of the zone, x = ±width × `x` by turns; edge grottos
   * before the zone from mountain `edgeGrottos`. */
  boss: {
    turnSec: number;
    returnMult: number;
    seeDist: number;
    zoneGap: number;
    helper?: Omit<WorldHelper, 'side'>;
    patrol?: 'alongZ' | 'chase';
    cover?: { at: number[]; x: number; r: number; h: number };
    edgeGrottos?: number;
  };
  /** Elements of the slope (docs/01-gdd.md 18.3; docs/01a-content.md 17.1): from which mountain each is allowed. */
  shapeFrom?: Record<ShapeKind, number>;
  /** RL-01 (docs/01-gdd.md 18.1, 21.1): every section from `fromSection` on has a fall risk or a flight (chasm, hump, a
   * split fork's crevasse, stairs of plates); absent — no such rule. */
  risk?: { fromSection: number };
  /** Sizes of the elements (docs/01a-content.md 17.2), read by the generator. */
  shapes?: OpenShapes;
  mountains: OpenSpecMountain[];
}

/** An element of a section of the open slope (docs/01-gdd.md 18.3): chasm, throat, tunnel, hump. */
/** SP-05 (docs/01a-content.md 19.3): a fork of two lanes `track` wide with a crevasse `between` wide down the middle,
 * `length` [min, max] long; kind «cliff» — the fork as before SP (a cliff down the middle). */
export interface OpenFork {
  kind: 'split' | 'cliff';
  track: number;
  between: number;
  length: [number, number];
}

export type ShapeKind = 'chasm' | 'throat' | 'tunnel' | 'hump' | 'dip';

/** Sizes of the elements (docs/01a-content.md 17.2); `…ByWorld` — the value on that mountain (key: its number). */
export interface OpenShapes {
  /** Grottos of the slope this long along it from mountain `fromWorld` (docs/01-gdd.md 18.8 item 3: 8 → 10; mountain 1 stays as built). */
  grotto?: { width: number; fromWorld: number };
  /** `pit` (RL-03, docs/01-gdd.md 21.3): the middle of the chasm a pit `margin` units past the outer trampolines (a fall —
   * back to the flag), the walk round its bottom at the edges at least `walk` wide; its floor `deep` under the bottom, the
   * fall counts `fall` under the bottom. Absent — the bottom across the whole slope (RG). */
  chasm: {
    width: number;
    depth: number;
    giftsAir: number;
    giftsBottom: number;
    ramp: number;
    padBefore: number;
    widthByWorld?: Record<string, number>;
    pit?: { margin: number; walk: number; deep: number; fall: number };
  };
  throat: { width: number; length: number; slideMult: number; holdSec?: number; fieldGifts: number; fieldGrotto: number; height: number; funnel: number; lengthByWorld?: Record<string, number> };
  tunnel: { width: number; height: number; length: number; openGifts: number; lengthByWorld?: Record<string, number> };
  hump: { rise: number; slideLength: number; top: number; flight: number; giftsAir: number; landing: number; flightByWorld?: Record<string, number> };
  /** RL-04 (docs/01-gdd.md 21.4): a dip across the slope — `down` units down to `depth`, a `bottom`, the way out `up` long
   * up to `kick` over the slope (a hero running out of it is thrown a little). */
  dip?: { depth: number; down: number; bottom: number; up: number; kick: number; depthByWorld?: Record<string, number> };
}

export interface OpenSpecMountain {
  id: string;
  look?: string;
  egg: string;
  /** SP-07 (docs/01a-content.md 19.5): the rise of a terrace (approach and carniz), of the ridge's carniz, of the ice cliff
   * of the bold lane; absent — 8, 4 and 9 as before. */
  terraceRise?: number;
  ridgeRise?: number;
  cliffHeight?: number;
  intervalSec: number;
  firstIntervalSec?: number;
  warnSec: number;
  speed: number;
  /** `shape` — the elements of the section by the slots of docs/01-gdd.md 18.6; absent or empty — as 16.5. */
  /** `width` — of the section (docs/01-gdd.md 20.4, SP-04); absent — the spec's `width`. */
  sections: Array<{ length: number; stepMult: number; shelterEvery: number; gift: number; fork: boolean | OpenFork; shape?: ShapeKind[]; width?: number }>;
  ridges: Array<{ requires: number }>;
  /** The finish straight: its length, the advice number, the giant's speed V_b, step multiplier and gift there; `width` —
   * of the giant's zone (SP-06), absent — of the last section. */
  boss: { stretch: number; width?: number; covers?: number; requires: number; margin: number; stepMult: number; gift: number; speed: number; turnSec?: number; returnMult?: number; seeDist?: number; helpers?: Array<{ side: 'left' | 'right' }>; giants?: Array<{ phase: number }> };
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
    /** Z-03: the head — a rounded cylinder (default) or a cube (other platforms' canon). */
    headShape?: 'cylinder' | 'cube';
    /** Z-03: the cut of the clothes on the body: a T-shirt (default) or an open jacket. */
    outfit?: 'tee' | 'jacket';
    /** Z-03: a hairstyle of accessories.json `hair` and its colour; absent — none. */
    hair?: { style: string; color: string };
  }>;
  /** Z-03: what every outfit shares — the sneakers, their sole and laces, the shirt under an open jacket. */
  outfit?: { shoe: string; sole: string; lace: string; inner: string };
  /** Wings (docs/01-gdd.md 7.4): looks only; the accessory of the same id (attach «back») is drawn on the hero. */
  wings?: Array<{ id: string; unlock: SkinsJson['skins'][number]['unlock'] }>;
}

export interface AccessoriesJson {
  accessories: Array<{
    id: string;
    attach: 'head' | 'back' | 'feet' | 'hand';
    parts: Array<{ shape: 'box' | 'sphere' | 'cylinder' | 'cone'; size: [number, number, number]; pos: [number, number, number]; color: string }>;
  }>;
  /** Z-03: hairstyles — 6–12 rounded boxes round the head centre (`rot` in radians), coloured by the skin. */
  hair?: Array<{ id: string; parts: Array<{ size: [number, number, number]; pos: [number, number, number]; rot?: [number, number, number] }> }>;
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
  /** SP-04 (docs/01a-content.md 19.2): the lanes spread over the width of a section less this many units; absent — to the borders. */
  laneSpread?: number;
  /** SP-05 (docs/01a-content.md 19.3): the share of bots that take the bold lane of a split fork; absent — the lane decides. */
  boldShare?: number;
  /**
   * The giant's zone (docs/01-gdd.md 18.5): a bot waits `waitSec` in the grotto before it and runs it; `passShare` of
   * them run at the giant's speed × speedK[1] (past him), the rest × speedK[0] (caught). Absent — bots walk through.
   */
  boss?: { waitSec: [number, number]; passShare: number; speedK: [number, number] };
}

/** A set of footsteps (LV-09, docs/01-gdd.md 11): ZzFX parameters of a step on snow and on ice (an ice slide), how
 * the player gets it (`free` at once, `ad` by a rewarded ad forever, `shop` — shown locked «soon in the shop»); `file`
 * — an audio file the producer adds later (null — the synth plays). */
export interface FootstepSet {
  id: string;
  /** How it opens: at once, by a rewarded ad, bought in the shop (`price`), or by the calendar of gifts (`day`, MU-12). */
  unlock: 'free' | 'ad' | 'shop' | 'daily';
  price?: number;
  /** MU-12 (Q-MU-6): the currency of `price` — summit trophies by default, or coins. */
  currency?: 'coins' | 'trophies';
  /** MU-12: the calendar day whose claim opens a `daily` set. */
  day?: number;
  /** MU-07 (w4-footsteps): the colour of the set's circle. */
  color?: string;
  /** SD-14: its snow steps — audio files under assets/audio/ (the variants), `weights` — how often each comes (1 each). */
  files: string[];
  weights?: number[];
  /** MU round 4 (producer 20.10: the sets sounded alike): the set's own pitch (semitones, ± 12) — each one heard apart. */
  semitones?: number;
}

/** sfx.json `footsteps` (LV-09, SD-14): the volume by default (a share of the effects, 0–1), the random pitch of a step
 * (± semitones), at most `perSec` steps a second whatever the run speed, the ice steps of every set; the first `free`
 * set is the one on by default. */
export interface FootstepsJson {
  volume: number;
  pitch: number;
  perSec: number;
  ice: string[];
  sets: FootstepSet[];
}

/** sfx.json (docs/02-tech.md 10): ZzFX parameters per sound event; `footsteps` — the sets of step sounds (LV-09),
 * absent — the hero steps silently. */
export interface SfxJson {
  footsteps?: FootstepsJson;
  /** SD-14: sound events played from audio files under assets/audio/ (instead of ZzFX of the same name). */
  files?: Record<string, string>;
  /** M5-03 (docs/01-gdd.md 10.3): named cues — a sound as notes; `events` — the cues of each sim event. */
  cues?: Record<string, SfxCue>;
  events?: Record<string, string[]>;
  [name: string]: number[] | FootstepsJson | Record<string, string> | Record<string, SfxCue> | Record<string, string[]> | undefined;
}

/** M5-03: a sound `sfx` of sfx.json as `notes` (semitones) `gap` s apart, `delay` s later; `when` — only for an event with
 * these fields; `perSec` — not more often a second. */
export interface SfxCue {
  sfx: string;
  notes?: number[];
  gap?: number;
  delay?: number;
  when?: Record<string, boolean | number | string>;
  perSec?: number;
}

/**
 * pace/<pace>/base.json (docs/01-gdd.md 19.2–19.4; docs/01a-content.md 18.1): the base between the mountains — a flat
 * snow field `size` [x, z] fenced round, the arc of portals of every mountain of the pace, the base treadmill, the stands
 * (shop, records board, daily gift), bots on the belt, decor. Absent or `enabled: false` — no base, the game as before FM.
 */
export interface BaseJson {
  enabled: boolean;
  /** Entering the game after the first summit: on the base (false — 6.6, at the flag of the mountain). */
  startOnReturn: boolean;
  /** The summit of a mountain already passed gives its window, chest and trophies again (false — a toast only, Q-053). */
  replayRewards: boolean;
  size: [number, number];
  spawn: { x: number; z: number };
  /** Arc of the portals: mountains 1…N from `toDeg` (left, as the hero faces +z) to `fromDeg`, angles from +z. */
  portals: { center: [number, number]; radius: number; fromDeg: number; toDeg: number; width: number; height: number };
  treadmill: { x: number; z: number; lanes: number; laneWidth: number; length: number; from: 'lastFinish' };
  stands: { shop: { x: number; z: number; radius: number; standSec: number }; records: { x: number; z: number; radius: number }; daily: { x: number; z: number; radius: number } };
  /** Bots running on the base treadmill; `low` on the low quality. */
  bots: { count: number; low: number };
  /** The model: seconds from the arrival on the base to a portal (F3, docs/01a-content.md 18.5). */
  transitSec: number;
  /** Arrows on the snow from the spawn to the own portal (SP-08: 5 across the doubled field); absent — 3. */
  arrows?: number;
  /** Decor (SP-08, docs/01a-content.md 19.6): tents (solid), fir trees, snowmen, lanterns and flags by the stands. */
  decor: { tents: Array<[number, number]>; trees: Array<[number, number]>; snowmen: Array<[number, number]>; lanterns?: Array<[number, number]>; flags?: Array<[number, number]> };
}

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
  /** The base of the pace (pace/<pace>/base.json); absent — none (classic, fast). */
  base?: BaseJson;
  /** Z-06: the winter decor and its models (decor.json, decor-models.json); absent — none. */
  decor?: DecorJson;
  decorModels?: DecorModelsJson;
}

/** worlds-spec.json → stages (docs/01-gdd.md 22; docs/01a-content.md 20). */
export interface StageSpec {
  /** Flat run past the ridge before the trial, the safe finish, the ridge rise, the depth of the pit floor. */
  start: number;
  finish: number;
  rise: number;
  pitDepth: number;
  /** The field width and the bridge width (1–3 steps). */
  field: number;
  bridge: number;
  /** Trophies of the last stage over the first (×2–3 across a mountain, Q-075); the golden snowflake ×stage trophies. */
  trophyGrowth: number;
  /** SD-03 (docs/01-gdd.md 23.3): trophies of stages 2… of a mountain before scaling (1, 3, 10, 20 …), scaled by
   * balance.json upgrade.trophyRate; absent — the stage pays its coins as before. */
  trophyLadder?: number[];
  /** SD-04 (docs/01-gdd.md 23.4): a crack and a gap between plates as this share of the jump at v(N), the catapult pit of
   * its flight; absent — 0.45 / 0.42 and 0.7 (LV). */
  gapK?: number;
  /** SD-05 (docs/01-gdd.md 23.5): the giant margin of mountains past giantMargin[] and whether a run slips past him. */
  giantMarginRest?: number;
  giantSlipPast?: boolean;
  /** SD-12: by mountain (the last for the rest) — the faster the run on the same field, the less the giant steps aside. */
  giantSide?: number | number[];
  /** SD-12 (docs/01-gdd.md 23.9): the giant meets every run (WorldBoss.rearm), runs at where the hero was `giantLag` s ago
   * (WorldGiant.lag) and his speed goes by the hero's level against the stage's (WorldBoss.level: g^(N − level) within
   * [min, max]); absent — once and for all, where the hero is, × 1. */
  giantEveryRun?: boolean;
  /** MU-11: a number, or by mountain (the last for the rest), as giantSide. */
  giantLag?: number | number[];
  /** MU-11: `g` a number, or by mountain (the last for the rest). */
  giantLevel?: { g: number | number[]; min: number; max: number };
  /** SD-15: WorldGiant.slipMargin of the stage giants; MU-11: or by mountain (the last for the rest). */
  giantSlipMargin?: number | number[];
  catapultK?: number;
  snowflake: { mult: number; stages: number };
  /** The avalanche stage: the first wave after entering, the pause between waves inside, grottos every `every` × v. */
  /** SD-06: `stageExtraSec` — the avalanche on every stage but the giant's, its first wave that long after a clean run. */
  avalanche: { firstSec: number; warnSec: number; intervalSec: number; every: number; x: number; stageExtraSec?: number; through?: boolean };
  maze: { cell: number; wall: number; height: number; cols: number[]; rows: number[]; falseExits: [number, number] };
  /** The giant of a stage slower than v(N) by this share, by mountain (LV-12 review: on mountains 1–2 a gentler one for
   * the first runs); absent — the margin of the mountain's giant. */
  giantMargin?: number[];
  /** Every ridge requirement × this before it becomes a level (LV-12: the gates held the run again); absent — 1. */
  gateK?: number;
  /** The stages of each mountain in order (the types of 22.5). */
  plan: StageType[][];
  /** ST-02 (producer 22.10): the tier of every stage, by mountain (a mountain without one keeps the order rules of 22.5). */
  waves?: StageTier[][];
  /** ST-02: pieces of a trial (cracks, plates, dips, steps, legs) added by its tier; absent tier — 0. */
  tierAdd?: Partial<Record<StageTier, number>>;
  /** ST-02: the rise of a step of the stairs stage (RL-05 stairs) — under controller.stepUp it is walked up from the edge. */
  stairsRise?: number;
  /** ST-04 (producer 22.10: each mountain its own look): by mountain — the decor at the edges of every start pad (`start`)
   * and finish (`finish`), and the landmark by the last finish (`landmark` × `size`); absent — no decor on that mountain. */
  decor?: Array<{ start: string; finish: string; landmark: string; size: number; scale?: number }>;
  /** MT-01 (RG 18.5: «the giant is not alone»): from this mountain on the giant stages bring the helpers of the open
   * mountain's giant to the borders of the field; absent — no helpers on the stages. */
  giantHelpersFrom?: number;
  /** MT-01: the slowdown of the helpers' snowball on the stages; absent — as the open giant's helpers. */
  giantHelperSlow?: number;
  /** MT-06: from mountain `from` on a ridge asks at most `max` levels over the stage before it (`easy` on the first ridge
   * and the easy tiers); absent — as the log scale gives. */
  levelStep?: { from: number; max: number; easy?: number };
  /** ST-06: a stage pad behind the farthest stage reached pays this many times a life, then nothing (World.padBehindTakes). */
  padBehindTakes?: number;
}


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
  };
  leaderboard: { name: string; score: string } | null;
  metrikaCounterId: number;
  mobileOrientation: 'landscape' | 'portrait';
  payments: { enabled: boolean };
  ads: { interstitial: string[]; rewarded: string[] };
  flags?: Record<string, { path: string; min?: number; max?: number; values?: string[] }>;
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
  ui: { stat: string; coins: string; trophies: string; ok: string; no: string; statIcon: string };
  threat: { front: [string, string]; edge: string; body: string; dust: string; height: number };
  bonus?: { color: string };
}

export interface Curve {
  base: number;
  k: number;
  max: number;
}

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
  boost: { x2Sec: number; statNowSec: number };
  caught: { rollSec: number; maxSec: number };
  threat: { newbieWaves: { count: number; warnBonusSec: number } };
  niche: { graceDist: number; graceMoving: number };
  ui: { unlockMenusSec: number; unlockTimeRewardsSec: number };
  ads: {
    rewardedMinPlaySec: number;
    standStillSec: number;
    interstitialMinSec: number;
    interstitialCooldownSec: number;
    interstitialAfterRewardedSec: number;
    statNowCooldownSec: number;
    skipGate: { cooldownSec: number; standSec: number; distance: number; excludeLastWall: boolean };
    eggViews: number;
    eggPauseSec: number;
    skipFirstPortal: boolean;
    wheelCooldownSec: number;
  };
  iap: { showAfterPlaySec: number };
  daily: { resetHours: number };
  quests: { perDay: number };
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
  portalIdleSec: number;
  portalMax: number;
}

export interface TuningJson {
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
    hideDistance: number;
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
  | 'summit';

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
}

export interface WorldZone {
  k: number;
  rarity: string;
  gift: number;
  zStart: number;
  zEnd: number;
}

export interface World {
  id: string;
  index: number;
  length: number;
  width: number;
  spawnZ: number;
  egg: string;
  stretch: number;
  wallCount: number;
  safeZones: Array<[number, number]>;
  threat: WorldThreat;
  zones: WorldZone[];
  segments: Segment[];
  treadmillMult: number;
}

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
  threat: { spawnAhead: number; firstIntervalSec: number; from: 'aboveHero' | 'end' | 'start'; firstWaveScripted: boolean };
  rarities: string[];
  mountains: Array<{
    id: string;
    stretch: number;
    intervalSec: number;
    warnSec: number;
    speed: number;
    egg: string;
    gifts: number[];
    walls: Array<{ requires: number; treadmill: number }>;
    campTreadmill?: number;
  }>;
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
}

export interface AccessoriesJson {
  accessories: Array<{
    id: string;
    attach: 'head' | 'back' | 'feet' | 'hand';
    parts: Array<{ shape: 'box' | 'sphere' | 'cylinder' | 'cone'; size: [number, number, number]; pos: [number, number, number]; color: string }>;
  }>;
}

/** pets.json (docs/01a-content.md 6): bonus is the step bonus (0.2 = +20%); the full list arrives with M3-03. */
export interface PetsJson {
  pets: Array<{ id: string; rarity: string; bonus: number; color: string; accent: string }>;
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
}

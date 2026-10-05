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
  /** `x2Mult`: the ×2 step boost (ad, rewards); `statNowSec`: treadmill seconds of «speed now» (docs/01-gdd.md 8.1). */
  boost: { x2Sec: number; x2Mult: number; statNowSec: number };
  caught: { rollSec: number; maxSec: number };
  /** `resumeSec`: the first avalanche after F5 or another day comes this late (docs/01-gdd.md 6.6). */
  threat: { newbieWaves: { count: number; warnBonusSec: number }; resumeSec: number };
  niche: { graceDist: number; graceMoving: number };
  /** `statMilestones`: round numbers of the stat that flash the plaque once a load (docs/01-gdd.md 10.4, Q-023). */
  ui: { unlockMenusSec: number; unlockTimeRewardsSec: number; statMilestones: number[] };
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
  /** `vipMult`: the step multiplier of the VIP purchase (docs/01-gdd.md 8.1, 9.3). */
  iap: { showAfterPlaySec: number; vipMult: number };
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
    raiseMaxDeg: number;
    raiseStepDeg: number;
    raiseReturnRate: number;
    /** A bot closer than this to the line camera → hero hides. */
    occludeRadius: number;
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
     * across from the mouth (0) to the back wall (1), floor (0) to roof (1), downhill (0) to uphill (1) side; its FOV. */
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
  /** `firstIntervalSec` — mountain 1 and any mountain without its own; `laterFirstIntervalSec` — [min, max] of mountains 2+ (Q-022). */
  threat: { spawnAhead: number; firstIntervalSec: number; laterFirstIntervalSec?: [number, number]; from: 'aboveHero' | 'end' | 'start'; firstWaveScripted: boolean };
  rarities: string[];
  mountains: Array<{
    id: string;
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

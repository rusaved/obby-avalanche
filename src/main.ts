// What: Game entry: boots platform, content, save, sim, renderer and all app/* views in the documented order, then runs the loop.
// Called by: index.html (vite entry script); nothing imports it.
// Keep: Boot order (docs/02-tech.md 11.2): ready() exactly once after the first frame, gameplayStart only unpaused; test-api and debug load dynamically by build flag.

import './styles.css';
import { Vector3 } from 'three';
import { content, i18nUrls, pace, usePace } from './content/index.ts';
import type { EventName } from './analytics/catalog.ts';
import { createIapView, type IapView } from './app/iap-view.ts';
import { equipLook, grantLook } from './meta/cosmetics.ts';
import { applyFlags, flagDefaults, type FlagDef, type FlagRoot } from './content/flags.ts';
import { CLASSIC_PACE } from './content/pace.ts';
import { configureAnalytics, track } from './analytics/index.ts';
import { createPlatform } from './platform/index.ts';
import type { PlatformOptions } from './platform/types.ts';
import { createStorage } from './platform/storage.ts';
import { PauseManager } from './core/pause.ts';
import { createLoop } from './core/loop.ts';
import { log } from './core/log.ts';
import { createRng, seedFrom } from './core/rng.ts';
import { loadDictionary, setDictionary, t } from './ui/i18n.ts';
import { fitField, type FieldRect } from './ui/fit.ts';
import { createHud, type Hud, type MenuItem } from './ui/hud.ts';
import { TOAST_PRIO } from './ui/toast-queue.ts';
import { drawNoGraphics } from './ui/fallback.ts';
import { mountLabel } from './ui/label.ts';
import { icon } from './ui/icons.ts';
import { createGameRenderer, createWebGL2Context, type GameRenderer } from './render/renderer.ts';
import { createLevelMeshes, type LevelMeshes } from './render/level-mesh.ts';
import { createCharacters, runCadence, type CharacterInstance, type Characters } from './render/characters.ts';
import { createBlobShadow } from './render/blob.ts';
import { createRecordFlag } from './render/record-flag.ts';
import { createSnowball, tumbleClip } from './render/threat/snowball.ts';
import { createBonusVisual, type BonusVisual } from './render/threat/bonus.ts';
import { BONUS_HEIGHT } from './sim/bonus.ts';
import { createCameraRig, type CameraRig } from './render/camera.ts';
import { createAvalancheVisual, type AvalancheVisual } from './render/threat/avalanche.ts';
import { createSfxEvents } from './app/sfx-events.ts';
import { statCurves } from './sim/effects/index.ts';
import { createWaveView, type WaveView } from './app/wave-view.ts';
import { createFtueVisual } from './render/ftue.ts';
import { createFtueView, type FtueView } from './app/ftue-view.ts';
import { createWayView, screenAngle, type WayView } from './app/way-view.ts';
import { createAdsView, type AdsView } from './app/ads-view.ts';
import { createFootstepsView, FOOTSTEPS_WINDOW, type FootstepsView } from './app/footsteps-view.ts';
import { BOSS_SIGN_HALF, BOSS_SIGN_TOP, createBossView, type BossView } from './app/boss-view.ts';
import { createEventsView, type EventsView } from './app/events-view.ts';
import { createFunView, type FunView } from './app/fun-view.ts';
import { createFx, type FxParticles } from './render/fx.ts';
import { guardBannerSigns, guardBaseArches, guardBaseSigns, guardRecordFlag, guardSeeThrough } from './app/banner-signs.ts';
import { createMetaView, type MetaView } from './app/meta-view.ts';
import { createPetsView, type PetsView } from './app/pets-view.ts';
import { createRebirthView, type RebirthView } from './app/rebirth-view.ts';
import { applyRebirth, summitsDone } from './meta/rebirth.ts';
import { hudDue } from './meta/hud-schedule.ts';
import { renderGiftsPanel } from './ui/gifts-panel.ts';
import { renderSummitPanel } from './ui/summit-panel.ts';
import { createPetsVisual } from './render/pets.ts';
import { createCosmeticsView, type CosmeticsView } from './app/cosmetics-view.ts';
import { createCosmeticsVisual, type CosmeticsVisual } from './render/cosmetics.ts';
import { createWindowFrame, type WindowFrame } from './ui/window.ts';
import { createHudView, type HudView } from './app/hud-view.ts';
import { createStageView, type StageView } from './app/stage-view.ts';
import { createCampView, type CampView } from './app/camp-view.ts';
import { setWalletTrophies } from './ui/shop-panel.ts';
import { setLineMarks } from './ui/daily-panel.ts';
import { levelNeeded } from './sim/levels.ts';
import { createBotsView, type BotsView, type HudMode } from './app/bots-view.ts';
import { faceDataUrl } from './render/characters.ts';
import { createAudio, type GameAudio } from './audio/index.ts';
import { MUSIC_TRACKS } from './audio/music.ts';
import { createPressFeedback } from './ui/press-feedback.ts';
import { createRewardFly, type RewardFly } from './ui/reward-fly.ts';
import type { ThreatOptions } from './sim/threat.ts';
import type { ThemeJson, ThemeTint, World } from './content/types.ts';
import { freshGifts, keepGift, keptGifts } from './meta/kept-gifts.ts';
import { createQuality, qualityParams, QUALITY_LEVELS, type QualityLevel } from './render/quality.ts';
import { createDecor, type Decor } from './render/decor.ts';
import { buildWinterDecor, type WinterDecorBuilt } from './render/winter-decor.ts';
import { buildLevel } from './level/builder.ts';
import { eggSpotIn } from './sim/gift-egg.ts';
import { createSim, controllerParams, type Sim } from './sim/world.ts';
import { prebuildCollision, prebuildReady, prebuildStep } from './sim/collision.ts';
import { HERO_HEIGHT } from './sim/controller.ts';
import { setFullNumbersBelow, formatNumber, formatTimer, setNumberLocale, shownTier } from './ui/format.ts';
import { moveSpeed } from './sim/effects/moveSpeed.ts';
import { InputManager } from './input/manager.ts';
import { applyManualTurn, createControlFrame, onMoveStarted, toWorld } from './input/control-frame.ts';
import type { InputSnapshot } from './input/types.ts';
import { createRewards } from './app/rewards.ts';
import { createDailyView, type DailyView } from './app/daily-view.ts';
import { createQuestsView, type QuestsView } from './app/quests-view.ts';
import { createSave, type SaveData } from './meta/save.ts';
import { addTrophies, migrateStageTrophies, migrateStageTrophiesBack, padPays } from './meta/trophies.ts';
import { scaled, summitTrophies } from './sim/economy.ts';
import type { GameHandles, BootState } from './app/handles.ts';
import type { TestApi } from './test-api/index.ts';
import type { DebugPanel } from './debug/index.ts';
import { baseBelts, baseTreadMult, buildBase, type BasePortal } from './level/base-layout.ts';
import { nextPlace, ownWorld, type FlowEvent, type FlowState, type Place } from './meta/base-flow.ts';
import { basePortalEntered, nearestPassedPortal } from './sim/base-portals.ts';
import { createBaseView, type BaseView } from './render/base-view.ts';
import { createStandsView, type StandsView } from './app/stands-view.ts';
import { createRecordsView, type RecordsView } from './app/records-view.ts';
import { nextShoes, shoesPrice } from './meta/shoes.ts';
import { eggPrice, type Egg } from './meta/pets.ts';
import { shortcutWanted } from './meta/shortcut.ts';

const DEG = Math.PI / 180;
/** «+N» above the hero at most 4 times a second (docs/01-gdd.md 10.3). */
const GAIN_POP_MIN_SEC = 0.25;
/** MU-05 (docs/07-mobile-ui.md, rule 11): the level toast holds the slot this long. */
const LEVEL_TOAST_SEC = 2.5;
/** D-05: «LEVEL UP!» held at least this long (2 s on screen, with a margin for the timer); the giant and the avalanche toasts come before it. */
const LEVEL_TOAST_MIN_SEC = 2.2;
const THREAT_TOAST = { prio: TOAST_PRIO.threat } as const;
/** M6: the share of a frame the base gives to building the next mountain's collision trees ahead (ms). */
const PREBUILD_SLICE_MS = 6;
/** D-02 (ready() ≤ 5.3 s at CPU ×4): the collision of the boot mountain — a near tree this far behind and ahead of the
 * start serves until the full trees, built after ready() in the prebuild slices, take over. */
const BOOT_NEAR: [number, number] = [40, 110];
/** D-02: the work held back from the boot starts this long after ready() — the first frames of play come first. */
const POST_READY_MS = 600;
/** MU-01: numbers in full below this (above — «1,23M»). */
const FULL_NUMBERS_BELOW = 1_000_000;
/** MU-05: «+N» right of the hero's head — at this share of the hero's height, this many px to the right. */
const MU_GAIN_HEAD = 0.85;
const MU_GAIN_SIDE = 26;
/** MU-03: a ridge sign of the phone layout is drawn this close to the hero (world units) — where it reads; round of fixes
 * MU (docs/допущения.md 96): the smaller sign on its post reads in the last ~10 units, farther it was a speck. */
const SIGN_READ_RANGE = 16;
/** MU-07 (w1-gifts): tiles of the rewards for the time in the «Gifts» window. */
const GIFT_TILES = 4;
/** A gate melts into an arch in 0.4 s (docs/01-gdd.md 3.3). */
const GATE_MELT_SEC = 0.4;
/** The camera's far plane at least (src/render/camera.ts), and over the fog's end by this share. */
const CAMERA_FAR = 400;
const FAR_PLANE_OVER_FOG = 1.15;
const GATE_FUNNEL_WALLS = [1, 2, 3, 4, 6, 9];
/** session_Ns funnel events at these seconds of play in a load (docs/06 section 2). */
const SESSION_MARKS = [60, 180, 300, 600];
/** Play time goes into the save at most this often (seconds of play). */
const PLAY_PERSIST_SEC = 5;
/** A giant this far ahead of the hero in his zone is kept in the view (FM-03); the point it is kept by. */
const BOSS_KEEP_AHEAD = 2;
const bossKeep = new Vector3();
/** Q-067: «Phew, made it!» waiting for the snow to pass the hero (avalanche.shotUntilClear). */
let survivedShow: (() => void) | null = null;

/**
 * Boot order (docs/02-tech.md 11.2): SDK init without a timeout → language → texts → save → world → first frame →
 * LoadingAPI.ready() exactly once → GameplayAPI.start() when nothing pauses the game.
 */
async function boot(): Promise<void> {
  const { game } = content;
  const params = new URLSearchParams(location.search);
  // The test API (e2e builds only) is fetched from the start, alongside the boot, not after it.
  const testApiLoad = __TEST_API__ ? import('./test-api/index.ts') : null;
  // Address parameters exist only in dev, playtest, e2e and pages builds (docs/02-tech.md 9.3).
  const debugParams = __DEBUG_TOOLS__ ? params : new URLSearchParams();
  configureAnalytics({ counterId: game.metrikaCounterId, echoToConsole: __DEBUG_TOOLS__ });

  const pause = new PauseManager();
  const events: string[] = [];
  const bootState: BootState = { firstFrameAt: null, readyAt: null, controllable: false, glRenderer: '' };

  // The channels of the game (Q-054): those with an address, in the order of game.json; `?community=none` (debug builds)
  // — none, for the e2e of the pause window without them.
  const community = debugParams.get('community') === 'none' ? [] : Object.entries(game.community ?? {}).filter(([, url]) => !!url) as Array<[string, string]>;
  /** A channel by the player's press (P1, Q-054): the only window.open of the code, in a new tab; FM-16 goes through it too. */
  const openCommunity = (id: string): void => {
    const url = community.find(([k]) => k === id)?.[1];
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
    track('community_open', { to: id });
  };
  // `?leaderboard=` (debug builds): a leaderboard name for the e2e of the records (game.json has none yet, M4-06).
  // M4-07: purchases behind game.json payments.enabled (off in the game; `?payments=1` for the e2e of debug builds).
  // G-10 (producer 26.10, Q-M6-1): on in the release; the second release archive is built without them (VITE_NO_PAYMENTS).
  // `?payments=0` of a debug build — as the archive without them (the e2e of «off»).
  const paymentsOn = !__NO_PAYMENTS__ && debugParams.get('payments') !== '0' && ((game.payments?.enabled ?? false) || debugParams.get('payments') === '1');
  const platformOpts: PlatformOptions = { packId: game.id, leaderboardName: debugParams.get('leaderboard') ?? game.leaderboard?.name ?? '', track, payments: paymentsOn };
  const platform = await createPlatform(platformOpts);
  // M6 polish (ready() ≤ 4 s): the dictionary comes over the network while the flags are asked, not after them.
  const dictLoad = loadDictionary(i18nUrls[platform.lang]);
  // The remote flag `pace` (docs/06 8.1–8.2) picks the pace before the save is read; each pace keeps its own progress
  // (docs/01-gdd.md 16.1): classic in the old place, other paces in their slot.
  // M4-11 (docs/02-tech.md 11.11): every flag of game.json in the one getFlags call, its defaults from the pack.
  const flagDefs = (game.flags ?? {}) as Record<string, FlagDef>;
  const flagRoot = (): FlagRoot => ({ game: content.game, balance: content.balance, worlds: Object.fromEntries(content.worlds.worlds.map((w) => [String(w.index), w])) });
  const flagDefaultsSent = { ...flagDefaults(flagDefs, flagRoot()), pace: game.pace ?? CLASSIC_PACE };
  const flagValues = await platform.getFlags(flagDefaultsSent);
  const runPace = usePace(flagValues['pace']);
  // The flags set remotely go into the pack of the pace (clamped into their ranges, a warning, never an error).
  const flagsApplied = applyFlags(flagDefs, flagValues, flagDefaultsSent, flagRoot(), (m) => log.warn(m), ['pace']);
  platformOpts.saveSlot = runPace === CLASSIC_PACE ? undefined : runPace;
  const { theme, tuning, balance, skins, accessories, pets, eggs, trails, auras, sfx, bots } = content;
  // Z-06: the winter decor of the pack (none in the sample pack).
  const winterDecor = content.decor && content.decorModels ? { spec: content.decor, models: content.decorModels } : undefined;
  // RL-04 (docs/01-gdd.md 21.4): a mountain's own sky, fog and snow (theme.json tints by its id); the base — the theme's.
  const tintOf = (w: World | undefined): ThemeTint | null => (w ? theme.tints?.[w.id] : undefined) ?? null;
  // RL-09 (docs/01-gdd.md 21.9): tall walls in the way of the camera drawn at camera.fadeAlpha (1 — as before, solid).
  const seeFade = (): number => (tuning.camera.seeThrough ? (tuning.camera.fadeAlpha ?? 0.3) : 1);
  const themeOf = (tint: ThemeTint | null): ThemeJson =>
    tint ? { ...theme, materials: { ...theme.materials, track: { ...theme.materials['track']!, color: tint.track } } } : theme;
  platform.onPause(() => pause.add('sdk'));
  platform.onResume(() => pause.remove('sdk'));
  track('sdk_ready', { platform: platform.kind, lang: platform.lang, device: platform.device });

  const dict = await dictLoad;
  setDictionary(platform.lang, dict);
  setNumberLocale(platform.lang);
  // MU-01 (docs/07-mobile-ui.md «Токены»): the colours of the phone layout from theme.json as CSS variables.
  for (const [k, v] of Object.entries(content.theme.ui.mu ?? {})) document.documentElement.style.setProperty(k === 'ink' ? '--ink' : `--mu-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v);
  // MU-01 (docs/07-mobile-ui.md, rule 10): the stages pace writes numbers below a million in full, «1 024».
  if (content.balance.levels) setFullNumbersBelow(FULL_NUMBERS_BELOW);
  document.documentElement.lang = platform.lang;
  document.title = t('game.title');

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  // MU-02: the phone layout of the stages pace styles the whole interface layer (bot names, windows).
  if (content.balance.levels) ui.classList.add('mu');
  const preloader = document.getElementById('preloader') as HTMLElement;

  // Save and settings (docs/02-tech.md 4.4): settings live in SaveData and survive F5.
  const store = createStorage(game.id);
  const loaded = await platform.loadSave();
  let save: SaveData = loaded ?? createSave(platform.serverTime());
  save.sessions += 1;
  // SD-03 (docs/01-gdd.md 23.3): a save from before the stage trophies gets the trophies of the stages it passed, once.
  if (balance.upgrade.currency === 'trophies') migrateStageTrophies(save, content.worlds);
  // SD-11 (Q-088): the button pays coins again — a save of the SD-03 build gets its stage trophies back as coins, once.
  else migrateStageTrophiesBack(save);
  const persist = (flush = false): void => {
    syncSave();
    save.rev += 1;
    save.savedAt = platform.serverTime();
    platform.markDirty(save, { flush });
  };
  /** Funnel event of kind `player` (docs/06 section 2): sent once in the life of the player, the flag lives in the save. */
  const trackOnce = (name: EventName, params?: Record<string, unknown>): void => {
    const flags = (save.flags ??= {});
    if (flags[name]) return;
    flags[name] = true;
    track(name, params);
    persist();
  };

  const mobile = platform.device !== 'desktop';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const forcedQuality = debugParams.get('quality') as QualityLevel | null;
  const forcedDpr = debugParams.get('dpr');
  const quality = createQuality({
    mobile,
    devicePixelRatio: window.devicePixelRatio || 1,
    store,
    hardwareConcurrency: navigator.hardwareConcurrency || 8,
    deviceMemory: nav.deviceMemory,
    forcedLevel: forcedQuality && ['low', 'medium', 'high'].includes(forcedQuality) ? forcedQuality : undefined,
    forcedDpr: forcedDpr ? Number(forcedDpr) : undefined,
    settingLevel: save.settings.quality,
  });
  const gpuLoad = Math.max(1, Math.min(4, Number(debugParams.get('gpuload') || 1) || 1));
  const seed = seedFrom(debugParams.get('seed'));
  const rng = createRng(seed);
  // Photo studio (docs/04-packaging.md 9): no bot names there (docs/01-gdd.md 7.12).
  const studio = __STUDIO__ && params.get('studio') === '1';

  /**
   * The base between the mountains (docs/01-gdd.md 19): base.json of the pace when enabled; the hero is on it (`onBase`),
   * its portals; `replay` — the mountain now is one passed on this tier, run again (no window, chest or trophies at its
   * summit, the save keeps the own mountain). A place to go after the tick (a base portal entered).
   */
  const baseCfg = content.base?.enabled ? content.base : null;
  let onBase = false;
  let replay = false;
  let basePortals: BasePortal[] = [];
  let pendingPlace: Place | null = null;
  /** Bots on the base treadmill (docs/01a-content.md 18.1): `bots.count`, on the low quality `bots.low`. */
  const baseBotCount = (): number => (baseCfg ? (quality.level === 'low' ? baseCfg.bots.low : baseCfg.bots.count) : 0);
  const flowState = (): FlowState => ({
    base: baseCfg !== null && (g.baseEnabled ?? true),
    startOnReturn: baseCfg?.startOnReturn ?? false,
    baseOpen: save.flags?.['baseOpen'] ?? false,
    worlds: content.worlds.worlds.length,
    summits: summitsDone(save),
    saveWorld: save.world ?? 1,
    frontier: save.frontierWall ?? 0,
  });

  // Mountain simulation (docs/02-tech.md 6.1): starts on mountain 1; the summit portal switches to the next one (M2-03).
  // Back after F5 or another day (docs/01-gdd.md 6.6): the mountain of the save, the hero at its farthest flag.
  let world = content.worlds.worlds.find((w) => w.index === save.world) ?? content.worlds.worlds[0];
  if (!world) throw new Error('worlds.json has no worlds');
  const levelOf = (w: World): ReturnType<typeof buildLevel> => buildLevel(w, { wallHeight: tuning.bounds?.wallHeight, cameraThrough: tuning.camera.seeThrough, grottoThrough: tuning.camera.grottoFrame === false });
  let level = levelOf(world);
  // M6 (docs/02-tech.md 9.5: a switch of mountains ≤ 1 s at CPU ×4): on the base the collision trees of the own mountain
  // are built ahead, a slice a frame; its portal then takes them (src/sim/collision.ts). 0 — none asked yet. M6 polish:
  // slot 1 — a switch not by the own portal: the passed portal nearest to the hero on the base (a run again), and with no
  // base the next mountain once the hero is half way up (its summit portal leads straight there).
  let prebuiltFor = [0, 0];
  /** D-02 (a switch ≤ 1 s at CPU ×4): the level and the winter decor of a prebuilt mountain, taken by its enterWorld. */
  let prebuilt: Array<{ index: number; level: ReturnType<typeof buildLevel>; decor: WinterDecorBuilt | null } | null> = [null, null];
  const prebuildWorld = (index: number, slot = 0): void => {
    const w = content.worlds.worlds.find((x) => x.index === index);
    if (!w || prebuiltFor[slot] === index) return;
    prebuiltFor[slot] = index;
    const l = levelOf(w);
    prebuildCollision(l.staticTriangles, l.boundsTriangles, slot);
    prebuilt[slot] = { index, level: l, decor: winterDecor ? buildWinterDecor(l, winterDecor.spec, winterDecor.models) : null };
  };
  // Feel values (base and ceiling) come from tuning.json sliders; the curve shape from balance.json.
  // M5-09 (docs/01a-content.md 14): what the stat drives — the run (moveSpeed) or the jump (jumpPower, a flat run).
  const curves = () => statCurves(game.stat.effect, { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed }, balance.jumpCurve);
  const speedCurve = () => curves().speed;
  // The avalanche (docs/02-tech.md 8.1): live world threat (debug sliders change it), save counters.
  // ST-06: the stage pads of a mountain pay balance.stagePads.takes times a life (the count in the save).
  // ST-06: a stage pad pays world.padBehindTakes times a life (the count in the save). Z-01 (producer 26.10, Q-ST-2 «B»): every
  // pad, the farthest one too — a stuck newbie does not farm his last stage for ever; a spent one never flies (G-02).
  const padPayOf = (w: World) => (n: number): boolean => {
    const pays = padPays(save, w.index, n, w.padBehindTakes);
    persist();
    return pays;
  };
  const padSpent = (w: World, n: number): boolean => w.padBehindTakes !== undefined && (save.padTakes?.[`${w.index}:${n}`] ?? 0) >= w.padBehindTakes;
  const threatOptions = (w: World, firstSec?: number): ThreatOptions => ({
    firstSec,
    threat: w.threat,
    balance,
    avalanche: tuning.avalanche,
    scriptedPending: !(save.flags?.['firstWaveDone'] ?? false),
    normalWavesDone: save.wavesNormal ?? 0,
  });
  // The free egg of the first minute stands on mountain 1 until the player has it (docs/01-gdd.md 6.2); before the
  // scripted wave is over it is not there yet — it comes with «Phew, made it!» (16.6, playtest M3).
  const giftEggOptions = (w: World): { wall: number; pet: string; hatchSec: number; shown: boolean } | undefined =>
    w.index === 1 && !(save.flags?.['giftEgg'] ?? false)
      ? { wall: balance.ftue.scriptedWaveWall, pet: balance.ftue.freeEggPet, hatchSec: balance.ftue.eggHatchSec, shown: save.flags?.['firstWaveDone'] ?? false }
      : undefined;
  // Bots (docs/01-gdd.md 7.12): count by the quality level, deterministic by the seed and the mountain.
  const botOptions = (w: World): { cfg: typeof bots; count: number; seed: number } => ({ cfg: bots, count: bots.count[quality.level], seed: (seed + w.index * 7919) >>> 0 });
  // Through number of a wall for lateEase (docs/01-gdd.md 8.1): walls of the mountains before, all walls of the pace.
  const wallsOf = (w: World): { before: number; total: number } => ({
    before: content.worlds.worlds.filter((x) => x.index < w.index).reduce((a, x) => a + x.wallCount, 0),
    total: content.worlds.worlds.reduce((a, x) => a + x.wallCount, 0),
  });
  // Golden gift (docs/01-gdd.md 4.9): only with game.json threat.bonus; «from the 2nd normal wave of the load» counts
  // the waves of every mountain since the page opened.
  let loadWaves = 0;
  const bonusOptions = (w: World): { cfg: NonNullable<typeof game.threat.bonus>; seed: number; wavesBefore: number } | undefined =>
    game.threat.bonus ? { cfg: game.threat.bonus, seed: (seed + w.index * 104729) >>> 0, wavesBefore: loadWaves } : undefined;
  // Record flag of the open slope (docs/01-gdd.md 17.7): the one of the save when it is on this mountain.
  const recordOf = (w: World): { x: number; y: number; z: number } | null | undefined => {
    if (w.layout !== 'openSlope') return undefined;
    const r = save.record;
    return r && r.world === w.index && Number.isFinite(r.z) ? { x: r.x, y: r.y, z: r.z } : null;
  };
  // Rare events of the open slope (docs/01-gdd.md 18.4): rolled by the seed and the mountain; ?mock_event= forces one.
  const mockParam = __DEBUG_TOOLS__ ? debugParams.get('mock_event') : null;
  const mockEvent = mockParam === 'snowball' || mockParam === 'blizzard' ? mockParam : undefined;
  const eventsOptions = (w: World): { cfg: NonNullable<typeof game.events>; seed: number; force: typeof mockEvent } | undefined =>
    game.events ? { cfg: game.events, seed: (seed + w.index * 15485863) >>> 0, force: mockEvent } : undefined;
  let sim: Sim = createSim(level, tuning, {
    balance,
    speedCurve: speedCurve(),
    jumpCurve: curves().jump,
    stat: save.stat ?? 0,
    coins: save.coins ?? 0,
    tier: save.tier ?? 0,
    threat: threatOptions(world, loaded ? balance.threat.resumeSec : undefined),
    padPay: padPayOf(world),
    giftEgg: giftEggOptions(world),
    bots: botOptions(world),
    bonus: bonusOptions(world),
    resume: { frontierWall: save.frontierWall ?? 0 },
    record: recordOf(world),
    boss: game.threat.boss,
    walls: wallsOf(world),
    events: eventsOptions(world),
    nearCollision: BOOT_NEAR,
  });
  // RL-08 (docs/01-gdd.md 21.8): with gifts.respawn «never» the gifts taken on this mountain stay taken after F5.
  const keepTaken = (balance.gifts?.respawn ?? 'onWaveGone') === 'never';
  if (keepTaken) for (const i of keptGifts(save, world.index, sim.gifts.length)) sim.gifts[i]!.taken = true;
  /** The climb into the save (docs/01-gdd.md 7.10): stat, best stat, coins, mountain, farthest wall passed. */
  const frontierOf = (s: Sim): number => {
    const passed = s.level.gates.reduce((m, g, i) => (s.gatesPassed[i] ? Math.max(m, g.index) : m), 0);
    // MU round of fixes 2 (staff: F5 after stage 3 stood him on stage 2): on the stages pace the ridges under the farthest
    // stage reached count too — the camp teleport skips them on foot; after F5 he stands at the start of that stage (6.6).
    const far = s.level.stages?.find((x) => x.n === (save.stageBest?.[String(s.level.worldIndex)] ?? 0));
    return far ? s.level.gates.reduce((m, g) => (g.kind === 'ridge' && g.z <= far.z0 + 0.01 ? Math.max(m, g.index) : m), passed) : passed;
  };
  function syncSave(): void {
    save.stat = sim.progress.stat;
    save.bestStat = Math.max(save.bestStat ?? 0, sim.progress.stat);
    save.coins = sim.coins;
    // The base and a mountain run again (docs/01-gdd.md 19.4) never move the mountain, the flag or the record of the save.
    if (onBase || replay) return;
    save.world = sim.level.worldIndex;
    save.frontierWall = frontierOf(sim);
    const r = sim.record;
    if (r) save.record = { world: sim.level.worldIndex, x: r.x, y: r.y, z: r.z };
    else delete save.record;
  }
  /** Every change of the climb goes to the mirror at once; a new wall or mountain also to the cloud (SAV-01). */
  const saveClimb = (): void => {
    const far = !onBase && !replay && (save.world !== sim.level.worldIndex || save.frontierWall !== frontierOf(sim));
    if (far || save.stat !== sim.progress.stat || save.coins !== sim.coins) persist(far);
  };
  let maxSpeed = sim.params.speed;
  const simEvents: GameHandles['simEvents'] = [];
  let pendingPortal: number | null = null;
  /** Summit portal entered this tick: counted for the rebirth after the tick (M3-06). */
  let pendingSummit: number | null = null;

  /** The «Mountain cleared» window of the portal entered this tick (docs/01-gdd.md 10.2): chest, trophies, time. */
  let summitInfo: { from: number; chest: number; trophies: number; sec: number } | null = null;
  /** Play second the hero came onto this mountain (the time in the «Mountain cleared» window). */
  let worldSince = save.totalPlaySec ?? 0;
  /**
   * HUD schedule (docs/01-gdd.md 6.4; GDD-12): play second when the «Mountain cleared» window of the first summit
   * closed — the summit group comes one by one from it; Infinity while that window is open; null — earlier summit.
   */
  let summitAt: number | null = null;
  const hudDueNow = (): Set<string> =>
    hudDue(balance.ui, {
      playSec: save.totalPlaySec ?? 0,
      summit: (save.trophiesTotal ?? 0) > 0 || (save.tier ?? 0) > 0,
      summitAt,
      payments: paymentsOn,
      summits: (save.tier ?? 0) > 0 ? Infinity : summitsDone(save),
    });
  /** The summit of mountain `n` on tier 0 brings elements of the summit group (6.4: the first; FM-08: by `ui.summitGroup`). */
  const summitBrings = (n: number): boolean => {
    const group = balance.ui.summitGroup;
    return group ? n > summitsDone(save) && Object.values(group).includes(n) : (save.trophiesTotal ?? 0) === 0;
  };
  const frame = createControlFrame(tuning.camera.pitchDeg * DEG, tuning.camera.distance);
  const inputOpts = {
    stickRadiusFrac: tuning.input.stickRadiusFrac,
    deadZoneFrac: tuning.input.deadZoneFrac,
    mouseDegPerPx: tuning.camera.mouseDegPerPx,
    touchDegPerPx: tuning.camera.touchDegPerPx,
    // LV-10: on a PC the mouse moved without a button turns the camera; a phone keeps its swipe only.
    mouseLook: !!tuning.camera.mouseLook && !mobile,
    mouseYawPerPx: tuning.camera.mouseYawPerPx ?? tuning.camera.mouseDegPerPx,
    mouseEdge: tuning.camera.mouseEdge ?? 0,
    mouseTop: tuning.camera.mouseTop ?? 0,
    mouseButtonPad: tuning.camera.mouseButtonPad ?? 0,
    lookAfterDragMs: (tuning.camera.mouseReturnSec ?? 0) * 1000,
    sensitivity: tuning.camera.sensitivity * save.settings.cameraSens,
    tapMaxMs: tuning.input.tapMaxMs,
    tapMovePx: tuning.input.tapMovePx,
    zoomStep: tuning.input.zoomStep,
  };
  const input = new InputManager(inputOpts);
  input.autoRun = save.settings.autoRun;

  let gr: GameRenderer | null = null;
  let levelMeshes: LevelMeshes | null = null;
  let characters: Characters | null = null;
  let heroChar: CharacterInstance | null = null;
  let cameraRig: CameraRig | null = null;
  let hud: Hud | null = null;
  let debug: DebugPanel | null = null;
  let avalanche: AvalancheVisual | null = null;
  let waveView: WaveView | null = null;
  let ftueView: FtueView | null = null;
  let wayView: WayView | null = null;
  let adsView: AdsView | null = null;
  let bossView: BossView | null = null;
  let baseView: BaseView | null = null;
  let eventsView: EventsView | null = null;
  let decor: Decor | null = null;
  // Decor of the open slope (docs/01-gdd.md 18.7): placed by the seed and the mountain, its look picks penguins or birds.
  const decorWire = (s: Sim): void => {
    const w = content.worlds.worlds.find((x) => x.index === s.level.worldIndex);
    decor?.wire(s.level, w?.look ?? w?.id, (seed + s.level.worldIndex * 6007) >>> 0);
  };
  let funView: FunView | null = null;
  let fx: FxParticles | null = null;
  let meta: MetaView | null = null;
  let petsView: PetsView | null = null;
  let standsView: StandsView | null = null;
  let recordsView: RecordsView | null = null;
  let cosmeticsView: CosmeticsView | null = null;
  let iapView: IapView | null = null;
  let rebirthView: RebirthView | null = null;
  let dailyView: DailyView | null = null;
  let questsView: QuestsView | null = null;
  let windows: WindowFrame | null = null;
  let hudView: HudView | null = null;
  let stageView: StageView | null = null;
  let campView: CampView | null = null;
  let audio: GameAudio | null = null;
  // M5-03, M5-04 (docs/01-gdd.md 10.3): the cues of sfx.json on the sim events and by name.
  const sfxEvents = createSfxEvents(sfx, () => audio);
  /** M5-05: the figures of the contact sheet (test API showLineup), made once and reused. */
  const LINEUP = 6;
  /** M5-06: the hero's face on the mountain bar, made after ready(). */
  let heroFace = '';
  const lineup: CharacterInstance[] = [];
  let rewardFly: RewardFly | null = null;
  /** Footsteps (LV-09): a sound at every step, the «Footsteps» window; null — the pack has no footsteps. */
  let footstepsView: FootstepsView | null = null;
  let botsView: BotsView | null = null;
  let bonusVisual: BonusVisual | null = null;
  let cosmeticsVisual: CosmeticsVisual | null = null;
  let hudMode: HudMode = 'normal';
  let field: FieldRect = { width: 1, height: 1, left: 0, top: 0 };
  let lastSnap: InputSnapshot | null = null;
  /** The camera was turned by hand in a tick since the last rendered frame (a turn is an edge of one tick; PR-13). */
  let turnedByHand = false;
  /** LV-10: the last turn by hand since the last camera update was a look by the mouse without a button. */
  let lookedByMouse = false;
  let pendingGain: number | null = null;
  let lastGainPopAt = -1;
  // Gates melt into an arch over GATE_MELT_SEC; funnel events gate_N for mountain 1 on tier 0 (docs/06, steps 5–15).
  const melting = new Map<number, number>();
  const wireSim = (s: Sim): void => {
    sfxEvents.wire(s.events);
    // G-01 (producer 26.10): the very first catch by a giant lets the hero go — no roll-back, once a player.
    s.giantFreeCatches = balance.caught.giantFreeSec && !save.flags?.['giantFree'] ? 1 : 0;
    const recorded = ['checkpoint', 'fall', 'respawn', 'jump', 'land', 'gain', 'gateOpen', 'gatePass', 'portal', 'giftTake', 'giftsRespawn', 'eggTouch', 'eggHatch', 'statMilestone'] as const;
    const waves = ['waveWarn', 'waveStart', 'waveSurvived', 'waveCaught', 'caughtEnd', 'waveDusted', 'waveGone', 'waveEnd', 'bonusSpawn', 'bonusTake', 'bonusSaved', 'bonusLost', 'bossEnter', 'bossPassed', 'bossCaught', 'bossBotCaught', 'helperThrow', 'helperHit', 'recordUp', 'chasmDown', 'tunnelEnter', 'eventStart', 'eventEnd', 'snowballHit', 'snowballBotHit'] as const;
    for (const name of [...recorded, ...waves]) {
      s.events.on(name, (payload) => {
        simEvents.push({ name, world: s.level.worldIndex, ...(payload as Record<string, unknown>), tick: s.tick });
        if (simEvents.length > 2000) simEvents.splice(0, simEvents.length - 2000);
      });
    }
    s.events.on('gain', ({ amount, steps, belt }) => {
      pendingGain = amount;
      // A soft step (LV-09): ice while the feet are on an ice slide, snow elsewhere (a belt too).
      footstepsView?.step(s.fun.onSlide >= 0 ? 'ice' : 'snow');
      if (steps === 1) track('gameTutorialStart');
      if (belt) trackOnce('treadmill_first');
    });
    // Gifts (M2-04): a taken gift disappears, the coin plaque slides in on the first coin.
    s.events.on('giftTake', ({ index, total }) => {
      levelMeshes?.setGiftShown(index, false);
      if (keepTaken && !onBase && !replay) keepGift(save, s.level.worldIndex, index);
      hud?.setCoins(formatNumber(total, numSuffix));
    });
    s.events.on('gatePass', ({ total, index }) => {
      hud?.setCoins(formatNumber(total, numSuffix));
      // Up on a ridge (docs/01-gdd.md 17.3, 17.9): the view frame over the next section, its grottos and number.
      const shot = tuning.ridgeShot;
      if (shot && cameraRig && s.level.gates[index]?.kind === 'ridge') cameraRig.view = { rise: shot.rise, back: shot.back, sec: shot.sec, t: 0 };
    });
    // The free egg hatched (docs/01-gdd.md 6.2): the pet jumps out, +20% per step, egg_1 (docs/06 step 11).
    s.events.on('eggHatch', ({ pet }) => {
      const egg = s.giftEgg;
      petsView?.hatched(pet, egg ? new Vector3(egg.x, egg.y + 1, egg.z) : null, true);
    });
    // Round number of Speed (M2-13, Q-023): flash, bounce, chime, toast; no analytics.
    // Back above the record flag after «Snowed in!» or the giant (docs/01-gdd.md 17.7): «New height!».
    s.events.on('recordUp', () => {
      hud?.toast(t('toast.recordUp'));
      track('record_up');
    });
    // Elements of the slope (docs/01a-content.md 17.6): a toast once a save at the first chasm bottom and the first tunnel.
    const toastOnce = (key: string): void => {
      const flags = (save.flags ??= {});
      if (flags[key]) return;
      flags[key] = true;
      hud?.toast(t(key));
      persist();
    };
    s.events.on('chasmDown', () => toastOnce('toast.chasm'));
    s.events.on('tunnelEnter', () => toastOnce('toast.tunnel'));
    // The giant (docs/01-gdd.md 17.6): into his zone, past him, caught — a toast each; nothing is lost on a catch.
    // Funnel (docs/06 8.2): the first giant — into his zone and past him once a player, every catch.
    const firstGiant = (): boolean => s.level.worldIndex === 1 && s.tier === 0;
    s.events.on('bossEnter', () => {
      // Z-01 (playtest G: 0,7 s on screen, cut by «LEVEL UP!»): its whole 3 s, the toasts that come meanwhile wait after it.
      // Z-11 (usability review): an avalanche warning or run keeps its banner — no giant toast over it then.
      const ws = s.threat?.state;
      const waveOn = !!ws && (ws.phase === 'warn' || (ws.phase === 'run' && ws.outcome === 'none'));
      if (!waveOn) hud?.toast(t('boss.start'), 3, false, undefined, undefined, true);
      hud?.peekStrip();
      if (firstGiant()) trackOnce('boss_enter');
      // Into the giant's zone (docs/01-gdd.md 17.9): a second from the side, the hero and the giant, then back behind.
      const shot = tuning.bossShot;
      if (shot && cameraRig) cameraRig.view = { rise: shot.rise, back: shot.back, side: shot.side, sec: shot.sec, t: 0 };
    });
    // SP-06 (docs/01-gdd.md 20.13): `cover` — past him behind a rock or straight.
    s.events.on('bossPassed', ({ cover }) => {
      hud?.toast(t('boss.passed'), 3, false, undefined, undefined, false, THREAT_TOAST);
      audio?.play('gate');
      if (firstGiant()) trackOnce('boss_passed', { cover });
    });
    s.events.on('bossCaught', ({ zone, cover }) => {
      if (s.giantFreeCatches > 0) {
        (save.flags ??= {})['giantFree'] = true;
        persist();
        hud?.toast(t('boss.free'), 3, false, undefined, undefined, false, THREAT_TOAST);
        track('boss_caught', { world: s.level.worldIndex, cover });
        return;
      }
      // The first catch in a zone with rocks (docs/01-gdd.md 20.6): «Duck behind a rock!» instead, 3 s, once a player.
      const flags = (save.flags ??= {});
      if ((s.level.bosses[zone]?.covers?.length ?? 0) > 0 && !flags['hint.cover']) {
        flags['hint.cover'] = true;
        hud?.toast(t('hint.cover'), 3, false, undefined, undefined, false, THREAT_TOAST);
        persist();
      } else hud?.toast(t('boss.caught'), 2, false, undefined, undefined, false, THREAT_TOAST);
      track('boss_caught', { world: s.level.worldIndex, cover });
    });
    // The giant slapped a bot (docs/01-gdd.md 18.5): nothing on screen but the slap; the funnel counts it (docs/06).
    s.events.on('bossBotCaught', () => track('boss_bot_caught', { world: s.level.worldIndex }));
    // A helper's snowball (docs/01-gdd.md 18.5): its whistle in the air; a hit — «Snowball!» and the badge on the plaque.
    s.events.on('helperThrow', () => audio?.play('helper_throw'));
    // Rare events (docs/01-gdd.md 18.4): «Snowball!» with its rumble and the trail; a hit — «Hit by a snowball!» and ×0,6.
    // The blizzard: «Blizzard! steps ×2» with the wind, «Blizzard is over» when it ends by itself (the siren has its banner).
    s.events.on('eventStart', ({ id }) => {
      if (id === 'snowball') {
        hud?.toast(t('event.snowball'));
        audio?.play('event_snowball_warn');
        track('event_snowball', { world: s.level.worldIndex });
      } else {
        // MU round 5 (producer 21.10): the first blizzard teaches the way through it — a jump is not slowed.
        // (the camp view keeps the hint in the slot while he is in it, until his first jump there).
        const first = !!balance.levels && !save.flags?.['blizzardTaught'];
        hud?.toast(t(first ? 'event.blizzardJump' : 'event.blizzard'), first ? 4 : 2, false, first ? t('event.blizzardSub') : undefined);
        audio?.play('event_blizzard');
        track('event_blizzard', { world: s.level.worldIndex });
      }
    });
    s.events.on('eventEnd', ({ id, why }) => {
      if (id === 'blizzard' && why === 'over') hud?.toast(t('event.blizzardOver'));
    });
    s.events.on('snowballHit', () => {
      hud?.toast(t('event.snowballHit'));
      audio?.play('event_snowball_hit');
    });
    s.events.on('helperHit', () => {
      hud?.toast(t('helper.hit'));
      audio?.play('helper_hit');
      track('helper_hit', { world: s.level.worldIndex });
    });
    s.events.on('statMilestone', ({ value }) => {
      hud?.flashStat();
      hud?.toast(t('toast.statMilestone', { n: formatNumber(value, numSuffix) }));
      audio?.play('statMilestone');
    });
    s.events.on('giftsRespawn', () => {
      s.gifts.forEach((_, i) => levelMeshes?.setGiftShown(i, true));
    });
    s.events.on('gateOpen', ({ index, wall }) => {
      melting.set(index, playSec);
      const kind = s.level.gates[index]?.kind;
      // A ridge melts all its passages at once: its own fanfare (docs/01-gdd.md 10.3).
      if (kind === 'ridge') sfxEvents.cue('ridge');
      if (s.level.worldIndex !== 1 || s.tier !== 0) return;
      // The open slope counts its ridges (docs/06 8.2: ridge_1…ridge_3), the other paces their walls.
      if (kind === 'ridge') trackOnce(`ridge_${wall}`);
      else if (kind !== 'boss' && GATE_FUNNEL_WALLS.includes(wall)) trackOnce(`gate_${wall}`);
    });
    // Avalanche (M2-06): newbie counter and first-wave flag in the save, toasts, funnel steps 9 and 15 (docs/06).
    s.events.on('waveWarn', ({ scripted, normalWavesDone }) => {
      if (scripted) return;
      loadWaves++;
      save.wavesNormal = normalWavesDone;
      persist();
    });
    survivedShow = null;
    // The free egg comes on its stand after the scripted wave: with its «Phew, made it!» (docs/01-gdd.md 16.6).
    const showEgg = (): void => {
      const egg = s.giftEgg;
      if (!egg) return;
      // In the cave the hero hid in: on the open slope either lane of the fork has its grotto (docs/01-gdd.md 17.8).
      const at = s.shelterIndex();
      const spot = at >= 0 && at !== egg.niche && egg.phase === 'idle' ? eggSpotIn(s.level, at) : null;
      if (spot) Object.assign(egg, spot);
      egg.shown = true;
    };
    // MU round 5: the phone layout (that of the stages pace).
    const phone = !!balance.levels;
    s.events.on('waveSurvived', ({ coins, total, gold, scripted }) => {
      // The scripted wave passed the hero in a cave (docs/01-gdd.md 4.6): step 9 of docs/06 with «Phew, made it!», so
      // before its egg — on the fast pace the front still runs on for seconds down to the camp (waveEnd below).
      if (scripted) trackOnce('first_wave_survived', { inShelter: true });
      // With the golden gift: one toast, bigger and golden, both rewards in it (docs/01-gdd.md 4.9). Q-067: once the snow
      // has passed him (avalanche.shotUntilClear), so neither it nor the egg comes while the snow still goes by.
      const show = (): void => {
        // SD-02: never «+0» (pace stages: no gifts on the track, the zone value may still be 0). MU round 5 (producer
        // 21.10: «+100» with no word, «Phew, made it! +», «Golden gift! +150» — a mess): on the phone «Phew, made it!»
        // carries no number of its own (the coins go to the counter), and with the golden gift handed in now its one
        // toast «Gift saved! +N» says it all (bonusSaved below).
        if (gold <= 0 || !phone) hud?.toast(coins > 0 && !phone ? t('wave.survived', { n: formatNumber(coins, numSuffix) }) : t('wave.survivedPlain'), gold > 0 ? 3 : 2, gold > 0, undefined, scripted ? showEgg : undefined, false, THREAT_TOAST);
        else if (scripted) showEgg();
        if (coins > 0) hud?.setCoins(formatNumber(total, numSuffix));
        // SD-14: a reward of coins — its sound from ui/.
        if (coins > 0 && gold <= 0) audio?.play('rewardCoins');
      };
      if (tuning.avalanche.shotUntilClear) survivedShow = show;
      else show();
    });
    // Golden gift (M2-12): chime on its warning, carried over the head, saved or popped; docs/06 goldGift params.
    s.events.on('bonusSpawn', () => audio?.play('goldSpawn'));
    s.events.on('bonusTake', () => track('gold_take'));
    s.events.on('bonusSaved', ({ coins, total, where }) => {
      track('gold_saved');
      // SD-02: saved in the shelter at once — its own golden toast (no longer folded into «Phew» after the wave).
      // MU round 5: one toast at the moment the gift is handed in, with the mark of what it gave.
      if (coins > 0) {
        hud?.toast(t(phone ? 'wave.giftSaved' : 'wave.goldSaved', { n: formatNumber(coins, numSuffix) }), 3, true, undefined, undefined, phone);
        audio?.play('rewardCoins');
      }
      hud?.setCoins(formatNumber(total, numSuffix));
    });
    s.events.on('bonusLost', (at) => {
      track('gold_lost');
      bonusVisual?.pop(at, playSec);
    });
    s.events.on('waveDusted', () => {
      trackOnce('first_wave_survived', { inShelter: false });
      hud?.toast(t('wave.firstMiss'), 3, false, undefined, undefined, false, THREAT_TOAST);
    });
    // «Snowed in!» (M2-07, docs/01-gdd.md 4.5): toast; the ball and the pose follow sim.caught in renderFrame.
    // M4-R2 (producer 22.10): one outcome per wave — snowed in or rolled back drops a «Phew» still waiting for the snow.
    s.events.on('waveCaught', () => {
      survivedShow = null;
      hud?.toast(t('wave.caught'), 2, false, undefined, undefined, false, THREAT_TOAST);
    });
    // RL-02 (docs/01-gdd.md 21.2): a fall rolls him back to the flag of the ridge (caught.to «flag») — a short toast.
    s.events.on('fall', ({ shelter, plate }) => {
      // SD-09: on the stages pace the roll-back goes to a stage start, not to a flag.
      // MU round 5: said only when he really goes back — a roll to where he stands is no «back».
      // Z-01: back into the cave that has just saved him — no «back», and his «Phew» stays.
      const c = s.caught;
      if (shelter) return;
      if (c) survivedShow = null;
      // D-08: back onto the plate he stood on — «try again», not «back to the stage start».
      if (c && Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z) > 1) hud?.toast(t(plate ? 'toast.fallBackPlate' : s.level.stages ? 'toast.fallBackStage' : 'toast.fallBack'), 2);
    });
    s.events.on('waveEnd', ({ scripted, outcome }) => {
      if (scripted) {
        // Not in a cave (no «Phew»), or the toast was dropped from a full queue: the egg is there now anyway.
        showEgg();
        (save.flags ??= {})['firstWaveDone'] = true;
        // Already sent when the front passed the hero; here only for a wave that never reached him.
        trackOnce('first_wave_survived', { inShelter: outcome === 'survived' });
        persist();
      } else if (outcome === 'survived' || outcome === 'caught') {
        trackOnce('wave_real_1', { caught: outcome === 'caught' });
      }
    });
    // The switch happens after the tick, not inside the emitter (docs/06 step 21: mountain 1 done on tier 0).
    s.events.on('portal', ({ from, next }) => {
      // Z-09: the fanfare of a passed mountain, once, the loop stepping aside under it.
      audio?.playFanfare();
      // A mountain passed on this tier, run again from the base (docs/01-gdd.md 19.4, Q-053): no window, chest or
      // trophies — «Top again!» and back to the base.
      if (replay && !(baseCfg?.replayRewards ?? false)) {
        hud?.toast(t('toast.replaySummit'), 2);
        pendingPlace = { kind: 'base' };
        return;
      }
      if (from === 1 && s.tier === 0) track('gameTutorialComplete', { levelComplete: 'world_1' });
      // The first summit (FM-08: a summit of ui.summitGroup): the trophy plaque and its buttons wait for the «Mountain
      // cleared» window (6.4).
      if (s.tier === 0 && summitBrings(from)) summitAt = Infinity;
      // Trophies of the summit g × (1 + n) (docs/01-gdd.md 8.1): to spend and over all time (the leaderboard, 7.9).
      const trophies = summitTrophies(balance, from, s.tier);
      addTrophies(save, trophies);
      // M4-06 (docs/01-gdd.md 7.9): the trophies over all time to the table on a summit (signed in, a leaderboard on).
      void platform.submitScore(save.trophiesTotal ?? 0);
      // The summit chest (docs/01-gdd.md 5.2, 8.1): its coins × wallScale[n], shown in the window.
      const chestAt = s.level.points.find((p) => p.type === 'chest');
      const chest = scaled(Number(chestAt?.['coins'] ?? 0), s.tier, balance.rebirth);
      s.coins += chest;
      hud?.setCoins(formatNumber(s.coins, numSuffix));
      summitInfo = { from, chest, trophies, sec: (save.totalPlaySec ?? 0) - worldSince };
      persist(true);
      pendingSummit = from;
      if (next !== null) pendingPortal = next;
    });
    ftueView?.wire(s);
    funView?.wire(s);
    hudView?.wire(s);
    stageView?.wire(s);
    bossView?.wire(s);
    decorWire(s);
    questsView?.wire(s);
    petsView?.wire(s);
  };
  wireSim(sim);
  const numSuffix = (k: string): string => t(`num.${k}`);
  const headPos = new Vector3();
  const prevPos = new Vector3().copy(sim.hero.pos);
  const curPos = new Vector3().copy(sim.hero.pos);
  const renderPos = new Vector3();
  let playSec = 0;
  const sessionMarks = [...SESSION_MARKS];
  let playPersistAt = 0;
  let lastRenderTicks = 0;
  const blob = createBlobShadow();
  // Record flag of the open slope (docs/01-gdd.md 17.7) in the colour of the hero's jacket.
  const heroLook = skins.skins.find((x) => x.id === skins.default);
  const recordFlag = createRecordFlag(heroLook?.colors.torso ?? theme.materials['flag']?.color ?? '#ffffff', theme.materials['pole']?.color ?? '#ffffff');
  const snowball = createSnowball(theme.threat.body);

  const g: GameHandles = {
    loop: null as unknown as GameHandles['loop'],
    pause,
    platform,
    sim,
    level,
    world,
    input,
    frame,
    camera: null,
    renderer: () => gr,
    characters: null,
    hero: null,
    quality,
    tuning,
    save,
    boot: bootState,
    events,
    simEvents,
    packId: game.id,
    lang: platform.lang,
    get field() {
      return field;
    },
    set field(v) {
      field = v;
    },
    lastFrameMs: 0,
    lastSimMs: 0,
    lastStepMs: 0,
    gpuLoad,
    framesPresented: 0,
    framesRendered: 0,
    persist(flush) {
      persist(flush);
    },
    applyTuning() {
      Object.assign(sim.speedCurve, speedCurve());
      maxSpeed = moveSpeed(sim.progress.stat, sim.speedCurve);
      Object.assign(sim.params, controllerParams(tuning, maxSpeed));
      inputOpts.mouseDegPerPx = tuning.camera.mouseDegPerPx;
      inputOpts.touchDegPerPx = tuning.camera.touchDegPerPx;
      inputOpts.mouseLook = !!tuning.camera.mouseLook && !mobile;
      inputOpts.mouseYawPerPx = tuning.camera.mouseYawPerPx ?? tuning.camera.mouseDegPerPx;
      inputOpts.lookAfterDragMs = (tuning.camera.mouseReturnSec ?? 0) * 1000;
      inputOpts.sensitivity = tuning.camera.sensitivity * save.settings.cameraSens;
      inputOpts.stickRadiusFrac = tuning.input.stickRadiusFrac;
      inputOpts.deadZoneFrac = tuning.input.deadZoneFrac;
      if (cameraRig && !cameraRig.shot) {
        cameraRig.camera.fov = tuning.camera.fov;
        cameraRig.camera.updateProjectionMatrix();
      }
    },
    setAutoRun(on) {
      input.autoRun = on;
      save.settings.autoRun = on;
      hud?.setAutoRun(on);
      persist(true);
      track('setting_autorun', { on });
    },
    setQualitySetting(level) {
      save.settings.quality = level;
      persist(true);
      if (level === 'auto') store.remove('quality');
      else quality.setLevel(level);
      hud?.setQuality(level);
      applyQualityNow();
    },
    toggleMenu(open) {
      // Pause and settings: a window of the common frame (docs/01-gdd.md 10.2), the game stands while it is open.
      const want = open ?? windows?.current !== 'pause';
      if (!windows || !hud) {
        pause.set_('menu', want);
        return;
      }
      if (want === (windows.current === 'pause')) return;
      if (!want) {
        windows.close();
        return;
      }
      const panel = hud.pausePanel;
      syncGiftCards();
      askReviewCan();
      // MU-07 (w3-pause): «Pause» with the name of the game small under it; the set of steps on by «Steps».
      if (muLayout) {
        const on = footstepsView?.state().set;
        hud.setPauseSteps(on ? t(`footsteps.set.${on}`) : '');
        windows.open('pause', t('settings.title'), (body) => body.appendChild(panel), { next: false, sub: t('game.title'), size: 'cards' });
      } else windows.open('pause', t('game.title'), (body) => body.appendChild(panel), { next: false, fitTitle: true });
      track('menu_open');
      // M4-04 (point menu): the player opened the pause himself — a fullscreen ad may come over it.
      adsView?.interstitial('menu', () => undefined);
    },
    teleport(x, y, z) {
      sim.teleport(x, y, z);
      prevPos.copy(sim.hero.pos);
      curPos.copy(sim.hero.pos);
      cameraRig?.snapTo({ pos: sim.hero.pos, vel: sim.hero.vel, speed: 0, maxSpeed });
    },
    gotoWorld(index) {
      enterWorld(index);
    },
    prebuildWorld(index) {
      prebuildWorld(index);
    },
    prebuildReady: () => prebuildReady(),
    rebirth() {
      rebirth();
    },
    renderOnce() {
      renderFrame(1, 0);
    },
    gateSign: (index) => levelMeshes?.gateSign(index) ?? { text: '', open: false },
    get onBase() {
      return onBase;
    },
    get basePortals() {
      return basePortals;
    },
    get replay() {
      return replay;
    },
    get baseTreadSign() {
      return baseView?.treadSign ?? null;
    },
    get baseGiftReady() {
      return baseView?.giftReady ?? false;
    },
    get baseBoard() {
      return baseView?.board ?? [];
    },
    baseArchHidden: (i) => baseView?.archHidden(i) ?? false,
    showToast: (text, sec, gold) => hud?.toast(text, sec, gold),
    showFaces() {
      if (!characters || !cameraRig) return;
      const base = sim.hero.pos;
      for (let i = 0; i < 8; i++) {
        const c = characters.create(skins.default);
        c.face = i;
        c.position.set(base.x - 10.5 + i * 3, base.y, base.z + 6);
        c.yaw = Math.PI;
        c.pose = 'idle';
      }
      cameraRig.shot = { yaw: 0, pitch: 0.12, distance: 14 };
      frame.pitch = 0.12;
    },
    showLineup(ids, wings) {
      if (!characters || !cameraRig) return;
      const base = sim.hero.pos;
      for (let i = 0; i < LINEUP; i++) {
        const c = (lineup[i] ??= characters.create(skins.default));
        c.visible = i < ids.length;
        if (!c.visible) continue;
        characters.setSkin(c, ids[i]!);
        characters.setWings(c, wings[i] ?? null);
        c.position.set(base.x - ((LINEUP - 1) * 2.6) / 2 + i * 2.6, base.y, base.z + 5);
        // Wings are on the back: those figures turn their side to the camera.
        c.yaw = wings[i] ? Math.PI * 0.45 : Math.PI * 0.75;
        c.pose = 'idle';
      }
      if (heroChar) heroChar.visible = ids.length === 0;
      cameraRig.shot = { yaw: 0, pitch: 0.1, distance: 9 };
      frame.pitch = 0.12;
    },
    get avalanche() {
      return avalanche;
    },
    get waveView() {
      return waveView;
    },
    get standsView() {
      return standsView;
    },
    get campView() {
      return campView;
    },
    get eventsView() {
      return eventsView;
    },
    get decor() {
      return decor;
    },
    triggerWave() {
      sim.threat?.trigger();
    },
    showAd(kind) {
      return kind === 'rewarded' ? platform.showRewarded('e2e') : platform.showInterstitial('e2e');
    },
    botPath: null,
    onTick: null,
    onFrame: null,
    get meta() {
      return meta;
    },
    get ftue() {
      return ftueView;
    },
    get bossView() {
      return bossView;
    },
    get ads() {
      return adsView;
    },
    get way() {
      return wayView;
    },
    get fun() {
      return funView;
    },
    get levelMeshes() {
      return levelMeshes;
    },
    recordFlag,
    get pets() {
      return petsView;
    },
    get windows() {
      return windows;
    },
    get rebirthView() {
      return rebirthView;
    },
    get audio() {
      return audio;
    },
    get footsteps() {
      return footstepsView;
    },
    get botsView() {
      return botsView;
    },
    get hudMode() {
      return hudMode;
    },
    get daily() {
      return dailyView;
    },
    get quests() {
      return questsView;
    },
    setHudMode(mode) {
      hudMode = mode;
      ui.dataset['hudMode'] = mode;
    },
  };

  // Draw distance (docs/01-gdd.md 17.10): the open slope sees far — tuning `far` (PC / phone) for the high level, the
  // lower levels shorter by the same share as their fog; other paces — the fog of the quality level.
  const highFog = qualityParams('high', mobile).fogFar;
  const drawFar = (): number => (tuning.far ? (mobile ? tuning.far.mobile : tuning.far.pc) * (quality.params.fogFar / highFog) : quality.params.fogFar);
  const applyQualityNow = (): void => {
    if (!gr) return;
    gr.applyQuality({ ...quality.params, fogFar: drawFar() });
    // The far plane keeps the fog's end in view (the giant's silhouette stands inside it, src/app/boss-view.ts).
    gr.camera.far = Math.max(CAMERA_FAR, drawFar() * FAR_PLANE_OVER_FOG);
    gr.camera.updateProjectionMatrix();
    gr.resize(field.width, field.height, quality.dpr);
    // Bodies cast the shadow, accessories do not: 4 draw calls fewer in the shadow pass (docs/02-tech.md 9.5; PS-09).
    if (characters) characters.group.traverse((o) => void (o.castShadow = quality.params.shadowMap > 0 && o.name.startsWith('char-') && o.name !== 'char-hair'));
    levelMeshes?.chunks.forEach((c) => void (c.receiveShadow = quality.params.shadowMap > 0));
    avalanche?.setParticles(quality.params.particles);
    fx?.setShare(quality.params.particles);
    if (sim.bots) sim.bots.limit = Math.min(sim.bots.list.length, onBase ? baseBotCount() : bots.count[quality.level]);
  };

  /**
   * Portal → mountain `index` (docs/01-gdd.md 5.2): new level, colliders and meshes; the stat and the tier carry
   * over, the hero stands at the spawn of the new camp. The «Mountain done» window arrives with the meta (M3).
   */
  const enterWorld = (index: number, reset?: { stat: number; coins: number; tier: number }, how: { resume?: boolean; replay?: boolean } = {}): void => {
    const next = content.worlds.worlds.find((w) => w.index === index);
    if (!next) return;
    const stat = reset?.stat ?? sim.progress.stat;
    const coins = reset?.coins ?? sim.coins;
    const tier = reset?.tier ?? sim.tier;
    world = next;
    onBase = false;
    // Z-09: the loop of the slope.
    audio?.setMusicRole('mountain');
    replay = how.replay === true;
    basePortals = [];
    const pre = prebuilt.find((p) => p?.index === index) ?? null;
    prebuilt = [null, null];
    prebuiltFor = [0, 0];
    baseView?.clear();
    hud?.setMountainShown(true);
    level = pre?.level ?? levelOf(world);
    // A new entry (a portal, the rebirth): all its gifts back (RL-08); a run again from the base keeps the save's own.
    if (!replay) freshGifts(save, index);
    // From the base portal of the own mountain begun (docs/01-gdd.md 19.4): at the flag of its farthest ridge, as 6.6.
    const resume = how.resume ? { frontierWall: save.frontierWall ?? 0 } : undefined;
    sim = createSim(level, tuning, { balance, speedCurve: speedCurve(), jumpCurve: curves().jump, stat, coins, tier, threat: threatOptions(world), giftEgg: giftEggOptions(world), bots: botOptions(world), bonus: bonusOptions(world), walls: wallsOf(world), record: replay ? undefined : world.layout === 'openSlope' ? recordOf(world) : undefined, boss: game.threat.boss, events: eventsOptions(world), resume, padPay: padPayOf(world) });
    avalanche?.setLevel(level);
    wireSim(sim);
    g.sim = sim;
    meta?.apply();
    g.level = level;
    g.world = world;
    melting.clear();
    pendingGain = null;
    worldSince = save.totalPlaySec ?? 0;
    if (gr && levelMeshes) {
      gr.scene.remove(levelMeshes.group);
      levelMeshes.dispose();
      gr.setTint(tintOf(world));
      levelMeshes = createLevelMeshes(level, themeOf(tintOf(world)), (k) => t(`num.${k}`), seeFade(), t('gate.needLevel'), winterDecor && { ...winterDecor, built: pre?.decor ?? undefined });
      gr.scene.add(levelMeshes.group);
      applyQualityNow();
    }
    maxSpeed = sim.params.speed;
    frame.controlYaw = 0;
    frame.viewYaw = 0;
    if (resume) {
      // createSim stood the hero at the flag: the camera follows him there.
      const h = sim.hero.pos;
      g.teleport(h.x, h.y + 0.05, h.z);
    } else g.teleport(level.spawn[0], level.spawn[1] + 0.05, level.spawn[2]);
  };

  /**
   * The base between the mountains (docs/01-gdd.md 19.2–19.4): its level from base.json and the progress (portals of the
   * passed mountains open, the own one lit, the rest iced), no avalanche, giant or events; the hero at its spawn facing
   * the own portal. The first time: «This is your base», the save flag and base_first.
   */
  const enterBase = (reset?: { stat: number; coins: number; tier: number }): void => {
    if (!baseCfg) return;
    const own = ownWorld(flowState());
    const ownW = content.worlds.worlds.find((w) => w.index === own);
    const begun = ownW && save.world === own && (save.frontierWall ?? 0) > 0;
    const ridges = ownW ? ownW.segments.filter((x) => x.type === 'gate' && x['kind'] === 'ridge').length : 0;
    const summits = summitsDone(save);
    // The base treadmill: the finish straight of the last mountain passed on this tier (docs/01a-content.md 18.2).
    const treadMult = baseTreadMult(content.worlds.worlds, summits);
    const b = buildBase(
      baseCfg,
      {
        mountains: content.worlds.worlds.map((w) => ({ index: w.index, id: w.id })),
        summits,
        ridge: begun ? { b: Math.min(ridges, save.frontierWall ?? 0), c: ridges } : null,
        treadMult,
      },
      tuning.bounds?.wallHeight,
    );
    const stat = reset?.stat ?? sim.progress.stat;
    const coins = reset?.coins ?? sim.coins;
    const tier = reset?.tier ?? sim.tier;
    onBase = true;
    // Z-09: the loop of the base.
    audio?.setMusicRole('base');
    replay = false;
    prebuiltFor = [0, 0];
    prebuilt = [null, null];
    basePortals = b.portals;
    world = b.world;
    level = b.level;
    // Bots run on its belt (docs/01-gdd.md 19.2), nothing else of a mountain: no avalanche, giant or events.
    sim = createSim(level, tuning, { balance, speedCurve: speedCurve(), jumpCurve: curves().jump, stat, coins, tier, bots: { cfg: bots, count: baseCfg.bots.count, seed: (seed + 7919 * 97) >>> 0, belts: baseBelts(baseCfg) } });
    avalanche?.setLevel(level);
    wireSim(sim);
    g.sim = sim;
    meta?.apply();
    g.level = level;
    g.world = world;
    melting.clear();
    pendingGain = null;
    if (gr && levelMeshes) {
      gr.scene.remove(levelMeshes.group);
      levelMeshes.dispose();
      gr.setTint(null);
      levelMeshes = createLevelMeshes(level, theme, (k) => t(`num.${k}`), 1, t('gate.needLevel'));
      gr.scene.add(levelMeshes.group);
      applyQualityNow();
    }
    const light = muLayout ? { sub: portalPlaque } : undefined;
    baseView?.set(level, basePortals, t, `×${formatNumber(treadMult, numSuffix)}`, recordsView?.boardLines(save, summits, content.worlds.worlds.length), light);
    hud?.setMountainShown(false);
    // RL-11: the gift cards of the base column are those of the pause, shown without it.
    syncGiftCards();
    askReviewCan();
    maxSpeed = sim.params.speed;
    frame.controlYaw = b.spawnYaw;
    frame.viewYaw = b.spawnYaw;
    g.teleport(level.spawn[0], level.spawn[1] + 0.05, level.spawn[2]);
    sim.hero.yaw = b.spawnYaw;
    // A new summit of the tier: the base treadmill has a new step — said once (19.2); the first base says only itself.
    const treadMark = (save.tier ?? 0) * 100 + summits;
    const newTread = treadMult > 1 && save.baseTread !== treadMark;
    save.baseTread = treadMark;
    if (!(save.flags?.['baseOpen'] ?? false)) {
      save.flags = { ...(save.flags ?? {}), baseOpen: true };
      trackOnce('base_first');
      hud?.toast(t('toast.baseFirst'), 3);
      persist(true);
    } else if (newTread) {
      hud?.toast(t('toast.baseTreadmill', { n: formatNumber(treadMult, numSuffix) }), 3);
      persist(true);
    }
  };

  /** Goes to a place of base-flow (docs/01-gdd.md 19.2): the base or a mountain; `stay` — nothing. */
  const go = (place: Place, reset?: { stat: number; coins: number; tier: number }): void => {
    if (place.kind === 'base') enterBase(reset);
    else if (place.kind === 'world') enterWorld(place.world, reset, { resume: place.resume, replay: place.replay });
  };
  const flow = (e: FlowEvent): Place => nextPlace(e, flowState());

  /**
   * «Mountain N cleared!» after the portal (docs/01-gdd.md 10.2, 6.3): the game stands while it is open; «Next», the
   * cross, Esc or the veil — on to mountain `next`; the first summit's buttons start coming then (6.4).
   */
  const openSummit = (next: number): boolean => {
    const info = summitInfo;
    summitInfo = null;
    const to = content.worlds.worlds.find((w) => w.index === next);
    if (!windows || !info || !to) return false;
    const model = {
      time: formatTimer(info.sec),
      chest: formatNumber(info.chest, numSuffix),
      trophies: formatNumber(info.trophies, numSuffix),
      next: t(`world.${to.id}`),
      nextColor: theme.materials['portal']?.color ?? theme.sky.top,
      tomorrow: dailyView?.tomorrow() ?? null,
    };
    // MU-07 (w5-summit): no cross (the way out is «Next»); the quiet «Ad: ×2» by the chest, once.
    let doubled = false;
    const muModel = (): typeof model & { mu?: NonNullable<Parameters<typeof renderSummitPanel>[1]['mu']> } =>
      muLayout
        ? {
            ...model,
            mu: {
              nextName: model.next,
              ad: adsView && info.chest > 0 && !doubled
                ? { text: t('summit.ad'), busy: adsView.busy === 'x2_chest', press: () => adsView?.chestAd(info.chest, (granted) => {
                    // ST-07 (producer: «×2» went away after a failed load): gone only once the coins are given.
                    if (granted && windows?.current === 'summit') doubled = true;
                    windows?.refresh();
                  }) }
                : null,
            },
          }
        : model;
    windows.open('summit', t('summit.title', { n: info.from }), (body) => renderSummitPanel(body, muModel()), {
      ...(muLayout ? { closable: false, sub: t('summit.sub', { time: model.time }), size: 'summary' as const } : {}),
      next: t('btn.next'),
      onClose: () => {
        if (summitAt === Infinity) summitAt = save.totalPlaySec ?? 0;
        // M4-04 (docs/01-gdd.md 9.2, point portal): «Next» may bring a fullscreen ad, the way on after it.
        const next = (): void => go(flow({ kind: 'summit', world: info.from, replay: false }));
        if (adsView) adsView.interstitial('portal', next);
        else next();
      },
    });
    // SD-14: the trophy of the summit — its fanfare from ui/ (the window keeps the sound, see createAudio).
    if (info.trophies > 0) audio?.play('rewardTrophy');
    return true;
  };

  /** A button of the HUD column (docs/01-gdd.md 10.1); «More» lists them all with captions on a short window. */
  let menuShown: MenuItem[] = [];
  /** MU-02: how many pets the player had when the pets window was last open (−1 — not counted yet). */
  let petsSeen = -1;
  /** MU-02 (docs/07-mobile-ui.md): the phone layout of the mockups is the layout of the stages pace. */
  const muLayout = !!balance.levels;
  // MU-06 (l5-camp): «level L · open», «any level» on a mountain passed, a lock and its condition on a locked one.
  const firstLevel = (world: number): number => content.worlds.worlds.find((w) => w.index === world)?.stages?.[0]?.level ?? 1;
  const portalPlaque = (p: BasePortal): { text: string; locked: boolean } =>
    p.state === 'locked' ? { text: t('base.portalLocked', { n: p.world - 1 }), locked: true } : p.state === 'passed' ? { text: t('base.portalAny'), locked: false } : { text: t('base.portalOpen', { n: firstLevel(p.world) }), locked: false };
  /**
   * The desktop shortcut (FM-13; docs/01-gdd.md 19.10, 03 SDK-08): on the base from summit `fromSummit` with the
   * summit group, when the platform can offer it (asked once a session) and its reward was never given; declined —
   * gone until the next session. Accepted — spendable trophies once (not the records count), `shortcut_ok`.
   */
  const shortcutCfg = game.shortcut?.enabled ? game.shortcut : null;
  let shortcutCan: boolean | null = null;
  let shortcutAsked = false;
  let shortcutOff = false;
  const shortcutItem = (due: Set<string>): MenuItem | null => {
    const want = shortcutWanted({ cfg: shortcutCfg, onBase, done: save.flags?.['shortcutDone'] ?? false, off: shortcutOff, due: due.has('shortcut'), tier: save.tier ?? 0, summits: summitsDone(save) });
    if (!want || !shortcutCfg) return null;
    if (!shortcutAsked) {
      shortcutAsked = true;
      void platform.shortcutCanShow().then((ok) => void (shortcutCan = ok));
    }
    return shortcutCan ? { id: 'shortcut', label: t('btn.shortcut', { n: shortcutCfg.reward.trophies }), icon: 'trophy' } : null;
  };
  const addShortcut = (): void => {
    if (!shortcutCfg) return;
    void platform.shortcutShow().then((outcome) => {
      if (outcome !== 'accepted') {
        shortcutOff = true;
        return;
      }
      if (save.flags?.['shortcutDone']) return;
      save.flags = { ...(save.flags ?? {}), shortcutDone: true };
      save.trophies = (save.trophies ?? 0) + shortcutCfg.reward.trophies;
      trackOnce('shortcut_ok');
      hud?.toast(t('toast.shortcutOk', { n: shortcutCfg.reward.trophies }), 3, true);
      persist(true);
    });
  };
  /**
   * Gifts for subscribing and for a review (FM-16, producer 14.10): by the channels of the pause window a card «Egg for
   * subscribing» a channel until its gift is given; its window's «Go» opens the channel (the one window.open, as the
   * channel button) and the gift comes once the player is back in the game (away — blur or hidden, back — focus or
   * visible): a subscription cannot be checked, the save flag gives it once a channel. «Chest for a review» — while the
   * platform can ask for a review (asked once a session) and its chest was never given; the chest only for a sent review.
   * A coins gift waits for a mountain (the base has no gifts to count them by).
   */
  const communityGifts = game.communityGifts ?? {};
  let reviewCan: boolean | null = null;
  let subAway: { id: string; away: boolean } | null = null;
  const giftFlag = (k: string): boolean => save.flags?.[k] ?? false;
  const giftReady = (r: { kind: string; gifts?: number } | undefined): boolean => !!r && (r.kind !== 'coins' || rewards.coinsOf(1) > 0);
  const syncGiftCards = (): void => {
    hud?.setCommunityGifts({
      subscribe: giftReady(communityGifts.subscribe) ? community.map(([id]) => id).filter((id) => !giftFlag(`giftSub_${id}`)) : [],
      review: giftReady(communityGifts.review) && reviewCan === true && !giftFlag('giftReview'),
    });
  };
  const askReviewCan = (): void => {
    if (!communityGifts.review || reviewCan !== null || giftFlag('giftReview')) return;
    reviewCan = false;
    void platform.reviewCan().then((ok) => {
      reviewCan = ok;
      syncGiftCards();
      // MU round 3 (D19: «Rate» grey — the window opened before the answer came): the open «Gifts» takes it at once.
      if (windows?.current === 'gifts') windows.refresh();
    });
  };
  const subscribeGift = (id: string): void => {
    windows?.open(
      'communityGift',
      t('communityGift.title'),
      (body) => {
        const p = document.createElement('p');
        p.className = 'rb-text';
        p.textContent = t('communityGift.text');
        body.appendChild(p);
      },
      {
        next: t('communityGift.go'),
        onNext: () => {
          subAway = { id, away: false };
          openCommunity(id);
          windows?.close();
        },
      },
    );
  };
  /** MU-07 (w1-gifts): the gift plaque of the HUD — the rewards for the time, the group, the review, Speed for an ad. */
  const openGifts = (): void => {
    askReviewCan();
    const visitGift = communityGifts.subscribe;
    windows?.open(
      'gifts',
      t('gifts.title'),
      (body) =>
        renderGiftsPanel(
          body,
          {
            tiles: questsView?.timeTiles(GIFT_TILES) ?? [],
            // G-04, G-05 (producer 26.10): no gift for a visit — no group card here (the channels stay in the pause), the
            // rewards for the time get the room.
            groups: community.length > 0 && visitGift ? { ids: community.map(([id]) => id), sub: t(visitGift.kind === 'egg' ? 'gifts.visit' : 'gifts.visitCoins') } : null,
            // MU round 3 (D19): the card only while the platform can ask for a review — «Rate» always a live button.
            review: communityGifts.review && !giftFlag('giftReview') && reviewCan === true ? { sub: t('gifts.reviewSub'), can: true } : null,
            ad: (() => {
              const offer = adsView?.giftOffer();
              if (!adsView || !offer) return null;
              const wait = offer.wait > 0 ? { wait: t('daily.soon', { time: formatTimer(offer.wait) }) } : {};
              return { title: t('gifts.speed', { n: formatNumber(adsView.giftStat(), numSuffix) }), busy: adsView.busy === 'stat_now', ...wait };
            })(),
            // ST-07 (Q-M4-1 B): «×2 per step · 3 min» beside it; grey with the boost's time while it runs.
            boost: (() => {
              const offer = adsView?.boostOffer();
              if (!adsView || !offer) return null;
              const wait = offer.run > 0 ? { running: t('gifts.boostRun', { time: formatTimer(offer.run) }) } : offer.wait > 0 ? { wait: t('daily.soon', { time: formatTimer(offer.wait) }) } : {};
              return { title: t('gifts.boost', { n: Math.round(balance.boost.x2Sec / 60) }), busy: adsView.busy === 'x2_stat', ...wait };
            })(),
          },
          {
            claim: (i) => {
              if (!questsView?.claimTime(i)) return;
              windows?.refresh();
              // FX-03: the gift taken opens on its tile.
              ui.querySelector(`[data-role="window"].open [data-tile="${i}"]`)?.classList.add('opened');
            },
            visit: (id) => {
              // The reward is for the visit (no «subscribe»): given when the player is back from the group.
              if (visitGift && !giftFlag(`giftSub_${id}`)) subAway = { id, away: false };
              openCommunity(id);
            },
            review: () => reviewGift(),
            ad: () => adsView?.giftAd(() => windows?.refresh()),
            boostAd: () => adsView?.boostAd(() => windows?.refresh()),
          },
        ),
      { sub: t('gifts.sub'), size: 'cards' },
    );
  };
  /** MU-08 (Q-MU-7): «Enter a code» of the pause window — a code of the group gives its gift once. */
  const openPromo = (): void => {
    let note = '';
    windows?.open(
      'promo',
      t('promo.title'),
      (body) => {
        const row = document.createElement('div');
        row.className = 'promo-row';
        const input = document.createElement('input');
        input.className = 'promo-input';
        input.dataset['hud'] = 'promo-input';
        input.maxLength = 16;
        input.autocomplete = 'off';
        input.placeholder = t('promo.hint');
        const ok = document.createElement('button');
        ok.className = 'card-btn';
        ok.dataset['hud'] = 'promo-ok';
        ok.textContent = t('promo.ok');
        const msg = document.createElement('div');
        msg.className = 'promo-note';
        msg.dataset['role'] = 'promo-note';
        msg.textContent = note;
        ok.addEventListener('click', () => {
          const code = input.value.trim().toUpperCase();
          const gift = content.game.promo?.codes[code];
          if (!gift) note = t('promo.bad');
          else if (giftFlag(`promo_${code}`)) note = t('promo.used');
          else {
            save.flags = { ...(save.flags ?? {}), [`promo_${code}`]: true };
            rewards.give(gift);
            persist(true);
            hud?.toast(t('promo.done'), 2, true);
            windows?.close();
            return;
          }
          msg.textContent = note;
        });
        row.append(input, ok);
        body.append(row, msg);
      },
      { sub: t('promo.sub'), size: 'summary' },
    );
  };
  const subscribeBack = (): void => {
    const id = subAway?.id;
    subAway = null;
    const gift = communityGifts.subscribe;
    if (!id || !gift || giftFlag(`giftSub_${id}`)) return;
    save.flags = { ...(save.flags ?? {}), [`giftSub_${id}`]: true };
    hud?.toast(t('toast.communityGift'), 3, true);
    rewards.give(gift);
    track('community_gift', { to: id });
    persist(true);
    syncGiftCards();
  };
  window.addEventListener('blur', () => void (subAway && (subAway.away = true)));
  window.addEventListener('focus', () => void (subAway?.away && subscribeBack()));
  document.addEventListener('visibilitychange', () => {
    if (!subAway) return;
    if (document.hidden) subAway.away = true;
    else if (subAway.away) subscribeBack();
  });
  const reviewGift = (): void => {
    const gift = communityGifts.review;
    if (!gift) return;
    void platform.reviewAsk().then((sent) => {
      reviewCan = false;
      if (sent && !giftFlag('giftReview')) {
        save.flags = { ...(save.flags ?? {}), giftReview: true };
        const n = gift.kind === 'coins' ? rewards.coinsOf(gift.gifts) : 0;
        rewards.give(gift);
        hud?.toast(t('toast.reviewGift', { n: formatNumber(n, numSuffix) }), 3, true);
        trackOnce('review_gift');
        persist(true);
      }
      syncGiftCards();
    });
  };
  const openMenuWindow = (id: string): void => {
    if (id === 'pets') petsView?.openWindow();
    else if (id === 'teleport') campView?.open();
    else if (id === 'shortcut') addShortcut();
    else if (id === 'shop') cosmeticsView?.openShop();
    else if (id === 'wardrobe') cosmeticsView?.openWardrobe();
    else if (id === 'rebirth') rebirthView?.openWindow();
    else if (id === 'daily') dailyView?.openWindow();
    else if (id === 'quests') questsView?.openQuests();
    else if (id === 'timeRewards') questsView?.openTime();
    else if (id === 'records') {
      if (recordsView?.available) recordsView.open();
      else recordsView?.openOwn(recordsView.boardLines(save, summitsDone(save), content.worlds.worlds.length));
    }
    else if (id === 'footsteps') footstepsView?.openWindow();
    else if (id === 'more' && muLayout) {
      // MU-07 (w6-more): six tiles into the windows of the second wave.
      const tiles: MenuItem[] = [
        { id: 'footsteps', label: t('footsteps.title'), icon: 'footsteps' },
        { id: 'wardrobe', label: t('btn.wardrobe'), icon: 'shirt' },
        { id: 'rebirth', label: t('btn.rebirth'), icon: 'rebirthArrow' },
        { id: 'records', label: t('btn.records'), icon: 'records' },
        { id: 'quests', label: t('btn.quests'), icon: 'task' },
        { id: 'daily', label: t('btn.daily'), icon: 'calendarLine' },
      ];
      windows?.open(
        'more',
        t('btn.more'),
        (body) => {
          const grid = document.createElement('div');
          grid.className = 'more-grid';
          for (const item of tiles) {
            const b = document.createElement('button');
            b.className = 'card-btn more-btn';
            b.dataset['hud'] = `more-${item.id}`;
            const ic = document.createElement('span');
            ic.className = 'hud-menu-icon';
            ic.innerHTML = icon(item.icon);
            b.append(ic, item.label);
            b.addEventListener('click', () => openMenuWindow(item.id));
            grid.appendChild(b);
          }
          body.appendChild(grid);
        },
        { size: 'summary' },
      );
    } else if (id === 'more') {
      windows?.open('more', t('btn.more'), (body) => {
        const grid = document.createElement('div');
        grid.className = 'more-grid';
        for (const item of menuShown) {
          const b = document.createElement('button');
          b.className = 'card-btn more-btn';
          b.dataset['hud'] = `more-${item.id}`;
          const ic = document.createElement('span');
          ic.className = 'hud-menu-icon';
          ic.innerHTML = icon(item.icon);
          b.append(ic, item.badge ? `${item.label} · ${item.badge}` : item.label);
          b.addEventListener('click', () => openMenuWindow(item.id));
          grid.appendChild(b);
        }
        body.appendChild(grid);
      });
    }
  };

  /**
   * Rebirth (docs/01-gdd.md 7.5; GDD-08): tier + 1 in the save (shoes back to the starting pair, the looks of the tier),
   * the camp of mountain 1 with the stat and the coins at zero; pets, looks, trails, auras and trophies stay.
   * The interstitial before it — M4 (docs/01-gdd.md 9.2).
   */
  const rebirth = (): void => {
    if (!rebirthView?.ready) return;
    const r = applyRebirth(save, balance, skins);
    // With the base the rebirth leads there (docs/01-gdd.md 19.4): portal 1 lit, the rest iced.
    go(flow({ kind: 'rebirth' }), { stat: r.stat, coins: r.coins, tier: r.tier });
    sfxEvents.cue('rebirth');
    meta?.resetShoes();
    cosmeticsView?.syncHero();
    hud?.setCoins(formatNumber(r.coins, numSuffix));
    hud?.toast(t('toast.tier', { n: shownTier(r.tier) }), 3, true);
    const flash = document.createElement('div');
    flash.className = 'fade-flash';
    ui.appendChild(flash);
    setTimeout(() => flash.remove(), 1000);
    if (r.tier === 1) trackOnce('rebirth_1', { rebirth: r.tier });
    // M4-06: and on a rebirth.
    void platform.submitScore(save.trophiesTotal ?? 0);
    persist(true);
  };

  // Simulation tick (1/60 s): input → control frame → hero.
  let firstInputSent = false;
  const simStep = (dt: number): void => {
    const t0 = performance.now();
    const snap = input.consume();
    lastSnap = snap;
    // M4-09 (docs/06 step 3): the first move, jump or turn of the camera of the player's life.
    if (!firstInputSent && (snap.moveX !== 0 || snap.moveY !== 0 || snap.jumpPressed || snap.manualCamera)) {
      firstInputSent = true;
      trackOnce('first_input');
    }
    if (snap.manualCamera) {
      turnedByHand = true;
      lookedByMouse = snap.mouseLook;
    }
    if (snap.moveStarted) onMoveStarted(frame);
    applyManualTurn(frame, snap.camYawDelta, snap.camPitchDelta, tuning.camera.pitchMinDeg * DEG, tuning.camera.pitchMaxDeg * DEG);
    if (snap.zoomDelta !== 0) frame.distance = Math.min(tuning.camera.zoomMax, Math.max(tuning.camera.zoomMin, frame.distance + snap.zoomDelta));
    let moveX = snap.moveX;
    let moveY = snap.moveY;
    if (input.autoRun) {
      moveX = 0;
      moveY = 1;
    }
    const w = toWorld(moveX, moveY, frame.controlYaw);
    // e2e bot (build:e2e only): walks the given points in world space, ignoring the camera. A point counts as reached
    // when the last tick's move passed within its reach (0.6 or its own; on a slide or in a flight a tick is ~1 unit).
    if (g.botPath) {
      const bp = g.botPath;
      const reached = (p: [number, number, number?]): boolean => {
        const ax = prevPos.x;
        const az = prevPos.z;
        const dx = sim.hero.pos.x - ax;
        const dz = sim.hero.pos.z - az;
        const k = dx * dx + dz * dz > 1e-9 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz))) : 1;
        return Math.hypot(p[0] - (ax + dx * k), p[1] - (az + dz * k)) < (p[2] ?? 0.6);
      };
      while (bp.length > 0 && reached(bp[0]!)) bp.shift();
      const target = bp[0];
      if (target) {
        const dx = target[0] - sim.hero.pos.x;
        const dz = target[1] - sim.hero.pos.z;
        const len = Math.hypot(dx, dz);
        w.x = dx / len;
        w.z = dz / len;
      } else {
        w.x = 0;
        w.z = 0;
      }
    }
    // e2e bot (LV-04): jumps at the edge of a pit on its way — the floor 1.5 units ahead along the move more than 1 below.
    const botJump = !!g.botJump && !!g.botPath && sim.hero.onGround && level.floorAt(sim.hero.pos.x + w.x * 1.5, sim.hero.pos.z + w.z * 1.5) < sim.hero.pos.y - 1;
    prevPos.copy(sim.hero.pos);
    const s0 = performance.now();
    sim.step({ moveX: w.x, moveZ: w.z, jump: snap.jumpPressed || botJump, jumpHeld: snap.jumpHeld || botJump }, dt);
    g.lastStepMs = performance.now() - s0;
    curPos.copy(sim.hero.pos);
    maxSpeed = sim.params.speed;
    if (pendingSummit !== null) {
      const from = pendingSummit;
      pendingSummit = null;
      rebirthView?.summit(from);
    }
    if (pendingPortal !== null) {
      const next = pendingPortal;
      pendingPortal = null;
      if (!openSummit(next)) go(flow({ kind: 'summit', world: next - 1, replay: false }));
    }
    // A portal of the base walked into (docs/01-gdd.md 19.4): the own mountain, or one passed — run again.
    if (onBase) {
      prebuildWorld(ownWorld(flowState()));
      const near = nearestPassedPortal(basePortals, sim.hero.pos.x, sim.hero.pos.z);
      if (near !== null) prebuildWorld(near, 1);
    } else if (sim.hero.pos.z > level.length / 2 && !flowState().base && world) prebuildWorld(world.index + 1, 1);
    prebuildStep(performance.now() + PREBUILD_SLICE_MS);
    if (onBase && pendingPlace === null) {
      const w = basePortalEntered(basePortals, prevPos.x, prevPos.z, sim.hero.pos.x, sim.hero.pos.z);
      if (w !== null) {
        const place = flow({ kind: 'portal', world: w });
        if (place.kind === 'world') {
          track('base_portal', { world: w, replay: place.replay });
          pendingPlace = place;
        }
      }
    }
    if (pendingPlace !== null) {
      const place = pendingPlace;
      pendingPlace = null;
      go(place);
    }
    saveClimb();
    playSec += dt;
    // Minutes of play in this load, pauses not counted (docs/06 steps 12, 17, 20, 22).
    while (sessionMarks.length > 0 && playSec >= sessionMarks[0]!) track(`session_${sessionMarks.shift()!}s`);
    questsView?.tick(dt);
    // The ×2 step boost runs on play seconds (stands on pause, survives F5; docs/01-gdd.md 9.1).
    // ST-07 (Q-M4-1 B): the badge of the boost by the Speed while it runs.
    hud?.setBoost((save.boostSec ?? 0) > 0 ? t('hud.boost', { time: formatTimer(save.boostSec!) }) : null);
    if ((save.boostSec ?? 0) > 0) {
      save.boostSec = Math.max(0, save.boostSec! - dt);
      if (save.boostSec === 0) {
        meta?.apply();
        persist();
      }
    }
    // Play time of the player (docs/01-gdd.md 6.1): survives F5, written every few seconds of play.
    save.totalPlaySec = (save.totalPlaySec ?? 0) + dt;
    if (playSec - playPersistAt >= PLAY_PERSIST_SEC) {
      playPersistAt = playSec;
      persist();
    }
    g.onTick?.(dt);
    g.lastSimMs = performance.now() - t0;
  };

  const renderFrame = (alpha: number, frameDt: number): void => {
    if (!gr) return;
    // Esc closes the open window first (docs/01-gdd.md 10.2), otherwise it toggles the pause.
    if (input.consumePause()) {
      if (windows?.current) windows.close();
      else g.toggleMenu();
    }
    // The footsteps window plays its previews while only `menu` holds the game: a new reason (ad, sdk, hidden) stops it.
    if (windows?.current === FOOTSTEPS_WINDOW) audio?.sync();
    const hero = sim.hero;
    renderPos.copy(prevPos).lerp(curPos, alpha);
    if (heroChar) {
      heroChar.position.copy(renderPos);
      // RL-06 (docs/01-gdd.md 21.6): a light sway on an ice slide — the model only, the run and the camera keep the course.
      const sway = sim.fun.onSlide >= 0 && hero.onGround ? ((tuning.fun.slideSway ?? 0) * Math.PI) / 180 : 0;
      heroChar.yaw = hero.yaw + sway * Math.sin(playSec * 2 * Math.PI * (tuning.fun.slideSwayHz ?? 0));
      heroChar.speedFactor = Math.min(1, hero.speed / Math.max(1, maxSpeed));
      // On a belt the hero runs in place by himself (docs/01-gdd.md 3.4).
      heroChar.pose = hero.onGround ? (hero.speed > 0.5 || sim.onBelt ? 'run' : 'idle') : hero.vel.y > 2 ? 'jump' : 'fall';
      // G-08: the outline on the mountains; the base keeps its draw calls (SP-08, ≤ 30).
      if (characters) characters.outlined = !onBase;
      if (sim.onBelt) heroChar.speedFactor = 1;
      heroChar.cadence = runCadence(tuning, hero.speed);
      heroChar.carry = (sim.bonus?.carried ?? false) && !sim.caught;
      // The tumble of the rolling snowball (docs/01-gdd.md 18.4): the same ball round the hero, on the spot.
      const tb = sim.tumble;
      snowball.update(sim.caught ?? (tb ? tumbleClip(tb.t, tb.sec, renderPos) : null), renderPos, heroChar, playSec);
      decor?.update(renderPos, frameDt, playSec, QUALITY_LEVELS.indexOf(quality.level) >= QUALITY_LEVELS.indexOf(theme.decor?.minQuality ?? 'medium'), quality.level === 'low');
      if (hero.landedThisTick) heroChar.squash = 0.1;
      heroChar.visible = !(cameraRig?.heroHidden ?? false) && sim.respawnTicksLeft < 0;
    }
    blob.update(renderPos, sim.collision);
    recordFlag.update(sim.record, renderPos.z);
    bonusVisual?.update(sim.bonus, renderPos, playSec);
    // K-01: a «LEVEL UP!» grown under the wave waits for its «Phew, made it!» (more important, TOAST_PRIO.threat) — held
    // before the banner goes, let go once it is shown.
    hud?.holdToasts(survivedShow !== null);
    waveView?.update(frameDt, playSec);
    // Q-067: «Phew, made it!» of the last wave once its snow has passed the hero (or the wave is over).
    if (survivedShow) {
      const ts = sim.threat?.state;
      if (!ts || ts.phase !== 'run' || ts.frontZ + tuning.avalanche.bodyLength < sim.hero.pos.z) {
        const show = survivedShow;
        survivedShow = null;
        show();
      }
    }
    hud?.holdToasts(survivedShow !== null);
    const gameDt = (loop.ticks - lastRenderTicks) * loop.step;
    lastRenderTicks = loop.ticks;
    meta?.update();
    petsView?.update(gameDt, playSec, renderPos, hero.yaw, hero.speed > 1.5 || sim.onBelt);
    standsView?.update(gameDt);
    if (onBase) baseView?.setGiftReady(dailyView?.canClaim ?? false);
    cosmeticsView?.update();
    if (cosmeticsVisual) {
      cosmeticsVisual.group.visible = heroChar?.visible ?? false;
      cosmeticsVisual.update(renderPos, hero.onGround && (hero.speed > 1.5 || sim.onBelt), gameDt, playSec);
    }
    // HUD column (docs/01-gdd.md 10.1): shop, pets, wardrobe … — each by the schedule of 6.4, never earlier.
    const cm = cosmeticsView?.menuItems();
    dailyView?.tick();
    const due = hudDueNow();
    menuShown = [cm?.shop, petsView?.menuItem(), cm?.wardrobe, dailyView?.menuItem(), questsView?.questsItem(), questsView?.timeItem(), rebirthView?.menuItem(), shortcutItem(due)].filter(
      (x): x is MenuItem => !!x && due.has(x.id),
    );
    if (muLayout) {
      // MU-02 (docs/07-mobile-ui.md, Q-MU-3): the column is always Teleport · Shop · Pets · More; a dot on Pets — a new pet.
      const pets = save.pets?.length ?? 0;
      if (petsSeen < 0) petsSeen = pets;
      if (windows?.current === 'pets') petsSeen = pets;
      hud?.setMenu([
        { id: 'teleport', label: t('btn.teleport'), icon: 'teleport' },
        // ST-01 (usability review: nothing led to the purchase): «!» on the shop while the step of the sneakers is on.
        { id: 'shop', label: t('btn.shop'), icon: 'bag', badge: campView?.step === 'shoes' && shopAfford().shoes ? '!' : '' },
        { id: 'pets', label: t('btn.pets'), icon: 'paw', badge: pets > petsSeen ? '!' : '' },
        { id: 'more', label: t('btn.more'), icon: 'dots' },
      ]);
      // Rule 8: the balance of coins and trophies always in the counters (the test hooks and the windows change it too).
      hud?.setCoins(formatNumber(sim.coins, numSuffix));
      hud?.setTrophies(formatNumber(save.trophies ?? 0, numSuffix));
      const gift = questsView?.timeItem(muLayout);
      hud?.setGift(gift ? { text: gift.badge === '!' ? t('btn.claim') : (gift.badge ?? ''), ready: gift.badge === '!' } : null);
    } else hud?.setMenu(menuShown);
    ftueView?.update(gameDt, playSec, renderPos);
    hudView?.update(playSec);
    stageView?.update();
    campView?.update();
    if (cameraRig) {
      // FM-03 (docs/01-gdd.md 19.8): running up a giant's zone, the giant ahead stays in the view.
      const zone = sim.boss?.zones.find((z) => renderPos.z >= z.zone[0] && renderPos.z <= z.zone[1]);
      const ahead = zone?.giants.find((x) => x.z > renderPos.z + BOSS_KEEP_AHEAD);
      // Q-066: on the siren the mouth of the lit shelter (camera.shelterKeep), only while the player stands.
      const giant = ahead && hero.vel.z > 0.5;
      cameraRig.keep = giant ? bossKeep.set(ahead.x, sim.level.floorAt(ahead.x, ahead.z) + (theme.boss?.height ?? 0) / 2, ahead.z) : (waveView?.keep ?? null);
      cameraRig.keepIdle = !giant;
      // RL-02 (docs/01-gdd.md 21.2): the ball rolls back to the flag of the ridge — up to hundreds of units in a second; the
      // damped follow would lag behind it and the ball run through the camera: the camera rides with the ball (LV-08: and to
      // the stage before).
      if (sim.caught && (balance.caught?.to === 'flag' || balance.caught?.to === 'prevStage')) cameraRig.snapTo({ pos: renderPos, vel: hero.vel, speed: 0, maxSpeed });
      else
        cameraRig.update(
          frameDt,
          { pos: renderPos, vel: hero.vel, speed: hero.speed, maxSpeed, yaw: hero.yaw },
          { manualCamera: turnedByHand, moveX: lastSnap?.moveX ?? 0, moveY: lastSnap?.moveY ?? 0, autoRun: input.autoRun, mouseLook: lookedByMouse },
          sim.collision,
        );
      turnedByHand = false;
      lookedByMouse = false;
      // Hidden by this frame's camera: a cut into or out of a fixed frame moves it many units at once (PR-11).
      if (heroChar) {
        heroChar.visible = !cameraRig.heroHidden && sim.respawnTicksLeft < 0;
        if (cosmeticsVisual) cosmeticsVisual.group.visible = heroChar.visible;
      }
    }
    botsView?.update(alpha, playSec);
    bossView?.update(sim);
    eventsView?.update(sim, frameDt);
    wayView?.update(renderPos);
    adsView?.update(frameDt, save.totalPlaySec ?? 0);
    funView?.update(gameDt, playSec, renderPos);
    characters?.update(frameDt);
    if (levelMeshes) {
      for (const [index, startedAt] of melting) {
        const k = Math.min(1, (playSec - startedAt) / GATE_MELT_SEC);
        levelMeshes.setGateOpen(index, k);
        if (k >= 1) melting.delete(index);
      }
      const statText = formatNumber(sim.progress.stat, numSuffix);
      const lv = balance.levels;
      level.gates.forEach((_, i) => {
        const open = sim.gatesOpen[i] ?? false;
        // Stages pace (docs/01-gdd.md 22.3): the ridge shows the level it asks for under «LEVEL NEEDED».
        if (lv) return levelMeshes!.setGateSign(i, String(levelNeeded(sim.gateRequirement(i), lv)), open);
        const req = formatNumber(sim.gateRequirement(i), numSuffix);
        levelMeshes!.setGateSign(i, open ? req : `${statText}/${req}`, open);
      });
      // MU-03 (l2-gate): on the phone layout an open ridge has nothing to say and a far one does not read — not drawn.
      if (hud && cameraRig) guardBannerSigns(hud, levelMeshes, level, cameraRig.camera, field, renderPos, muLayout ? sim.gatesPassed.map((p, i) => p || sim.gatesOpen[i] === true) : sim.gatesPassed, muLayout ? SIGN_READ_RANGE : Infinity, muLayout);
      if (cameraRig) levelMeshes.wayMarks.guard(cameraRig.camera.position);
    }
    // SP-01: the record flag is never drawn in the way of the camera (docs/01-gdd.md 20.2).
    if (cameraRig) guardRecordFlag(recordFlag, cameraRig.camera, renderPos, tuning.camera.hideDistance * (tuning.camera.flagHide ?? 0));
    if (cameraRig && baseView?.drawn) guardBaseArches(baseView, cameraRig.camera, renderPos, tuning.camera.archHide ?? 0);
    if (muLayout && hud && cameraRig && baseView?.drawn) guardBaseSigns(hud, baseView, cameraRig.camera, field);
    if (cameraRig && levelMeshes) guardSeeThrough(levelMeshes, cameraRig.camera, renderPos);
    // Test hooks see the frame as it is drawn: camera, hero and the signs hidden for it (PR-11).
    g.onFrame?.();
    gr.follow(renderPos);
    levelMeshes?.cullByDistance(renderPos.z, drawFar());
    if (hud) {
      if (pendingGain !== null && cameraRig && playSec - lastGainPopAt >= GAIN_POP_MIN_SEC && heroChar?.visible) {
        headPos.copy(renderPos);
        // «+N» at the feet (Q-019; tuning.hud.gainHeight), floating up past the hero; over the golden gift while carried.
        headPos.y += sim.bonus?.carried ? HERO_HEIGHT + BONUS_HEIGHT : muLayout ? HERO_HEIGHT * MU_GAIN_HEAD : tuning.hud.gainHeight;
        headPos.project(cameraRig.camera);
        // MU-05 (docs/07-mobile-ui.md): on the phone layout «+N» stands right of the head, MU_GAIN_SIDE px off it.
        const gx = (headPos.x * 0.5 + 0.5) * field.width + (muLayout ? MU_GAIN_SIDE : tuning.hud.gainSide * field.width);
        if (headPos.z < 1) hud.popGain(`+${formatNumber(pendingGain, (k) => t(`num.${k}`))}`, gx, (0.5 - headPos.y * 0.5) * field.height);
        lastGainPopAt = playSec;
        pendingGain = null;
      }
      hud.updateStick(input.stick, field.left, field.top);
      hud.setTouchMode(input.touchActive);
    }
    const fade = sim.respawnTicksLeft >= 0 ? Math.min(1, (sim.respawnTicksLeft + 1) / 10) : 0;
    fadeEl.style.opacity = String(fade);
    for (let i = 0; i < gpuLoad; i++) {
      gr.render();
      g.framesRendered++;
    }
    g.framesPresented++;
    g.lastFrameMs = frameDt * 1000;
    if (frameDt > 0 && quality.sample(frameDt * 1000)) applyQualityNow();
    debug?.update(frameDt * 1000);
  };

  const loop = createLoop({
    update: simStep,
    render: renderFrame,
    scheduler: { request: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id) },
  });
  g.loop = loop;

  const fadeEl = document.createElement('div');
  fadeEl.className = 'fade';
  fadeEl.dataset['role'] = 'fade';
  ui.appendChild(fadeEl);

  let testApi: TestApi | null = null;
  if (__TEST_API__) {
    const mod = (await testApiLoad)!;
    testApi = mod.installTestApi(g);
    const sync = mod.mockClockSync;
    const base = loop.tick.bind(loop);
    let lastTicks = 0;
    let lastMs: number | null = null;
    loop.tick = (nowMs: number) => {
      base(nowMs);
      const realDt = lastMs === null ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      sync((loop.ticks - lastTicks) * loop.step, realDt);
      lastTicks = loop.ticks;
    };
  }

  const gl = createWebGL2Context(canvas, quality.params.antialias);
  if (!gl) {
    canvas.classList.add('fallback');
    drawNoGraphics(canvas, t('game.title'), t('fallback.noGraphics'), theme);
    preloader.classList.add('hidden');
    track('webgl_unavailable');
    platform.ready();
    events.push('ready');
    bootState.readyAt = 0;
    if (testApi) testApi.ready = true;
    return;
  }

  gr = createGameRenderer(canvas, gl, theme, quality.params.antialias);
  // MU-10 (review): on the phone layout the hero stands over «N Speed» and the bar (tuning camera.muLift).
  if (muLayout) gr.setLift(tuning.camera.muLift ?? 0);
  bootState.glRenderer = gr.glRenderer;
  gr.setTint(tintOf(world));
  // D-02 (ready() ≤ 5.3 s at CPU ×4): the boot mountain without its winter decor; merged into the chunks after ready().
  levelMeshes = createLevelMeshes(level, themeOf(tintOf(world)), (k) => t(`num.${k}`), seeFade(), t('gate.needLevel'));
  const bootMeshes = levelMeshes;
  gr.scene.add(levelMeshes.group);
  // Walls open from the save stand as arches at once (M3-07), no melt; gifts taken before F5 are gone (RL-08).
  sim.gatesOpen.forEach((open, i) => open && levelMeshes!.setGateOpen(i, 1));
  sim.gifts.forEach((g, i) => g.taken && levelMeshes!.setGiftShown(i, false));
  characters = createCharacters(skins, accessories, undefined, theme.hero);
  gr.scene.add(characters.group);
  heroChar = characters.create(skins.default);
  // G-08: the hero brighter than the world (theme.json hero).
  characters.setHero(heroChar);
  // The giant of the open slope and his silhouette (docs/01-gdd.md 17.6).
  bossView = createBossView({ theme, characters, scene: gr.scene, camera: () => cameraRig?.camera ?? null, numSuffix: (k) => t(`num.${k}`), skinId: skins.default, fadeAlpha: () => tuning.camera.fadeAlpha ?? 1 });
  bossView.wire(sim);
  baseView = createBaseView(theme, baseCfg?.arrows);
  gr.scene.add(baseView.group);
  decor = createDecor(gr.scene, theme, pets.pets, { top: BOSS_SIGN_TOP, half: BOSS_SIGN_HALF });
  decorWire(sim);
  eventsView = createEventsView({ theme, scene: gr.scene, camera: () => cameraRig?.camera ?? null, snowflakes: () => quality.params.snowflakes, lightSnow: () => (onBase ? 0 : quality.params.lightSnow) });
  botsView = createBotsView({
    cadence: (v) => runCadence(tuning, v),
    cfg: bots,
    characters,
    scene: gr.scene,
    ui,
    snowColor: theme.threat.body,
    getSim: () => sim,
    camera: () => cameraRig?.camera ?? null,
    hides: (feet) => cameraRig?.blocksView(feet) ?? false,
    field: () => field,
    hudMode: () => hudMode,
    studio,
    clear: (r) => hud?.clearOfHud(r) ?? true,
  });
  g.characters = characters;
  g.hero = heroChar;
  gr.scene.add(blob.mesh);
  gr.scene.add(recordFlag.mesh);
  gr.scene.add(snowball.mesh);
  if (game.threat.bonus && theme.bonus) {
    bonusVisual = createBonusVisual(theme.bonus.color);
    gr.scene.add(bonusVisual.group);
  }
  avalanche = createAvalancheVisual(level, theme, tuning, rng.next);
  gr.scene.add(avalanche.group);
  cameraRig = createCameraRig(gr.camera, frame, tuning, rng.next, mobile);
  applyQualityNow();
  g.camera = cameraRig;
  cameraRig.snapTo({ pos: sim.hero.pos, vel: sim.hero.vel, speed: 0, maxSpeed });

  hud = createHud(ui, {
    jumpButtonFrac: tuning.input.jumpButtonFrac,
    onJumpDown: () => input.jumpButtonDown(),
    onPause: () => g.toggleMenu(true),
    onContinue: () => g.toggleMenu(false),
    // The channels of the game (P1, Q-054): the only window.open of the code, by the player's press, no reward.
    ...(community.length > 0
      ? {
          community: {
            ids: community.map(([id]) => id),
            open: openCommunity,
            gifts: { subscribe: !!communityGifts.subscribe, review: !!communityGifts.review, onSubscribe: subscribeGift, onReview: reviewGift },
          },
        }
      : {}),
    onAutoRun: (on) => g.setAutoRun(on),
    onQuality: (level) => g.setQualitySetting(level),
    ...(sfx.footsteps ? { onFootsteps: () => footstepsView?.openWindow() } : {}),
    coinColor: theme.ui.coins,
    coinsAsTrophies: balance.currency === 'trophies',
    onPadLabel: () => campView?.open(),
    threatColor: theme.threat.front[1],
    bonusColor: theme.bonus?.color,
    onShoes: () => {
      if (meta?.buyShoes()) sfxEvents.cue('shoes');
    },
    onShoesShort: () => meta?.shoesShort(),
    onAd: (id) => adsView?.press(id),
    onEgg: () => void petsView?.buyEgg(),
    onStand: () => standsView?.press(),
    onMenu: (id) => openMenuWindow(id),
    trophyColor: theme.ui.trophies,
    plaqueColor: theme.ui.plaque,
    plaqueAlpha: theme.ui.plaqueAlpha,
    plaqueText: theme.ui.plaqueText,
    toastPlate: theme.ui.toastPlate,
    glow: theme.ui.glow,
    toastMinSec: tuning.fx?.toastMinSec,
    toastGapMs: tuning.fx?.toastGapMs,
    onToast: () => audio?.play('uiToast'),
    gainText: theme.ui.gainText,
    arrowScale: tuning.avalanche.arrowScale,
    okColor: theme.ui.ok,
    statColor: theme.ui.stat,
    statIcon: theme.ui.statIcon,
    mu: muLayout,
    onGift: () => openGifts(),
    volume: save.settings.volume,
    onVolume: (v) => {
      save.settings.volume = v;
      audio?.setVolume(v);
      persist();
    },
    // G-09: «Music» in the pause only with a loop in assets/audio/music.
    ...(MUSIC_TRACKS.length > 0
      ? {
          music: {
            on: save.settings.music,
            volume: save.settings.musicVolume ?? 1,
            onToggle: (on: boolean) => {
              save.settings.music = on;
              audio?.setMusic(on);
              persist();
            },
            onVolume: (v: number) => {
              save.settings.musicVolume = v;
              audio?.setMusicVolume(v);
              persist();
            },
          },
        }
      : {}),
    // G-06 (producer 26.10, Q-M6-3 A): «Enter a code» only with `game.promo` on — off for the first submission.
    ...(content.game.promo && content.game.promo.enabled !== false ? { onPromo: () => openPromo() } : {}),
    onSound: () => {
      save.settings.sound = !save.settings.sound;
      hud?.setSound(save.settings.sound);
      audio?.setEnabled(save.settings.sound);
      persist(true);
    },
  });
  hud.setSound(save.settings.sound);
  if (sim.coins > 0) hud.setCoins(formatNumber(sim.coins, numSuffix));
  audio = createAudio({
    sfx,
    enabled: save.settings.sound,
    // Any pause reason stops the sound; a window alone (reason `menu` only) keeps it: the previews of «Footsteps», the
    // trophy fanfare of the summit (SD-14), the interface sounds of every window (FX-06). The game stands there, so
    // nothing of the run sounds; an ad, a blur, a hidden tab add their reason and silence it.
    paused: () => pause.paused && !(pause.reasons.length === 1 && pause.has('menu')),
    // FX-06: on every change of the reasons — an ad over a window adds one while the game already stands.
    onPauseChange: (fn) => void pause.onReasons(fn),
    gestureTarget: window,
    uiPerSec: tuning.fx?.uiSoundPerSec,
    // G-09: the music loop of assets/audio/music (none there — silent), its switch and volume of the save.
    music: { on: save.settings.music, volume: save.settings.musicVolume ?? 1, duckK: tuning.fx?.musicDuck ?? 0.5, fanfareK: tuning.fx?.musicFanfare },
  });
  // Z-09: the base of a load that starts on it plays its own loop.
  if (onBase) audio.setMusicRole('base');
  audio.setVolume(save.settings.volume);
  waveView = createWaveView({
    tuning,
    frame,
    getSim: () => sim,
    hud,
    camera: cameraRig,
    hero: heroChar,
    visual: avalanche,
    field: () => field,
    manualCamera: () => turnedByHand || (cameraRig?.sinceManual ?? 99) < 0.5,
    hideCaveParts: (niche, parts) => levelMeshes?.setCaveCut(niche, parts),
    audio: () => audio,
  });
  wayView = createWayView({ balance, getSim: () => sim, hud, camera: cameraRig, field: () => field });
  // Rewarded ads by the common rules of docs/01-gdd.md 9.1 (stat_now in a grotto with a belt; continue_here, 17.11).
  adsView = createAdsView({
    mu: muLayout,
    balance,
    hud,
    platform,
    pause,
    save,
    getSim: () => sim,
    windowOpen: () => !!windows?.current,
    moving: () => input.autoRun || (lastSnap ? lastSnap.moveX !== 0 || lastSnap.moveY !== 0 : false) || !!g.botPath,
    numSuffix,
    onStat: () => persist(),
    rewardedPlaces: game.ads?.rewarded ?? [],
    onBoost: () => meta?.apply(),
    interstitialPoints: game.ads?.interstitial ?? [],
    sessionSec: () => playSec,
    noAds: () => !!save.flags?.['noAds'],
  });
  // Fun between the gates and the reward of every gate (docs/01-gdd.md 16.4, 16.5): sounds, particles, the fountain.
  fx = createFx();
  fx.setShare(quality.params.particles);
  gr.scene.add(fx.points, fx.lines);
  funView = createFunView({ tuning, theme, hud, camera: cameraRig, fx, audio: () => audio, meshes: () => levelMeshes, field: () => field, numSuffix });
  funView.wire(sim);
  const ftueVisual = createFtueVisual(theme);
  gr.scene.add(ftueVisual.group);
  meta = createMetaView({ balance, pets, trails, auras, save, getSim: () => sim, hud, numSuffix, trackOnce, persist, onShoes: () => questsView?.shoes(), shoesColor: theme.ui.stat });
  meta.apply();
  // Windows (docs/01-gdd.md 10.2): one at a time, the game and the avalanche stand while it is open (pause `menu`).
  windows = createWindowFrame(ui, {
    mu: muLayout,
    closeLabel: t('btn.close'),
    okLabel: t('btn.ok'),
    animMs: tuning.fx?.windowMs,
    onChange: (id) => {
      pause.set_('menu', id !== null);
      // MU-07 (rule 13): the HUD under an open window is hidden whole.
      ui.classList.toggle('win-open', id !== null);
      // FX-06: a window opens and closes with its own short sound; FX-02: a reason bubble never outlives its window.
      audio?.play(id !== null ? 'uiOpen' : 'uiClose');
      press?.hideWhy();
    },
  });
  // FX-02: every press of the HUD and of the windows squeezes and taps; what cannot act now shakes and tells why.
  const press = createPressFeedback(ui, { sound: (n) => audio?.play(n) });
  // FX-03: the rewards fly to their counter and it ticks (calendar, quests, «Gifts», the stage pad).
  if (tuning.fx?.flyMs && tuning.fx.tickMs) {
    const fxs = tuning.fx;
    const h = hud;
    rewardFly = createRewardFly(ui, {
      flyIcons: fxs.flyIcons ?? 8,
      flyMs: fxs.flyMs ?? 650,
      tickMs: fxs.tickMs ?? 600,
      format: (n) => formatNumber(n, numSuffix),
      counter: (k) => h.counterBox(k),
      hold: (k, on) => h.holdCounter(k, on),
      onTick: () => audio?.play('uiTick'),
    });
    ui.addEventListener('pointerdown', (ev) => rewardFly?.pressedAt(ev.clientX, ev.clientY), true);
  }
  if (sfx.footsteps)
    footstepsView = createFootstepsView({
      manifest: sfx.footsteps,
      save,
      windows,
      platform,
      pause,
      hud,
      audio: () => audio,
      persist,
      numSuffix,
      onTrophies: (n) => hud.setTrophies(formatNumber(n, numSuffix)),
      coins: () => sim.coins,
      setCoins: (n) => {
        sim.coins = n;
        hud?.setCoins(formatNumber(n, numSuffix));
      },
      toShop: () => cosmeticsView?.openShop('steps'),
      // ST-07: the sets for an ad through the common logic of the ads (app/ads-view.ts).
      ...(adsView ? { rewarded: adsView.rewarded, adBusy: () => adsView?.busy ?? null } : {}),
    });
  const petsVisual = createPetsVisual(theme);
  gr.scene.add(petsVisual.group);
  petsView = createPetsView({
    eggAd: () => adsView?.eggOffer() ?? null,
    balance,
    pets,
    eggs,
    theme,
    save,
    getSim: () => sim,
    hud,
    windows,
    visual: petsVisual,
    camera: cameraRig,
    field: () => field,
    // Egg rolls: their own stream of the seed (docs/02-tech.md 4.2), so other draws do not move them.
    rng: createRng((seed ^ 0x2545f491) >>> 0),
    numSuffix,
    persist,
    trackOnce,
    onChange: () => meta?.apply(),
    onHatch: () => questsView?.hatched(),
    onRare: () => sfxEvents.cue('petRare'),
    // The shop tab «Eggs» (M3-09): eggs of the mountains open on this tier (docs/01-gdd.md 7.2).
    // An egg opens on the first mountain that has it (the fast pace has one egg per two mountains, docs/01-gdd.md 16.3).
    eggWorlds: Object.fromEntries([...content.worlds.worlds].reverse().filter((w) => w.egg).map((w) => [w.egg!, w.index])),
    openWorld: () => Math.max(sim.level.worldIndex, summitsDone(save) + 1),
    toShop: () => cosmeticsView?.openShop('eggs'),
  });
  petsView.wire(sim);
  // Trails, auras and the wardrobe (docs/01-gdd.md 7.3, 7.4): the hero wears the skin of the save or the default one.
  cosmeticsVisual = createCosmeticsVisual();
  gr.scene.add(cosmeticsVisual.group);
  // M4-07 (docs/01-gdd.md 9.3): purchases behind the flag — the «Special» tab and the show after a purchase.
  if (paymentsOn)
    iapView = createIapView({
      platform,
      balance,
      save,
      hud,
      getSim: () => sim,
      pets: () => petsView,
      heroPos: () => sim.hero.pos,
      numSuffix,
      applyMeta: () => meta?.apply(),
      setAutoRun: (on) => g.setAutoRun(on),
      wearSkin: (id) => {
        grantLook(save, 'skin', skins.skins, id);
        equipLook(save, 'skin', skins.skins, id);
        cosmeticsView?.syncHero();
      },
      play: (name) => audio?.play(name),
      persist,
      track,
      closeWindow: () => windows?.close(),
      gold: theme.ui.mu?.['gold'] ?? theme.ui.coins,
    });
  cosmeticsView = createCosmeticsView({
    balance,
    trails,
    auras,
    skins,
    accessories,
    save,
    hud,
    windows,
    visual: cosmeticsVisual,
    numSuffix,
    persist,
    onChange: () => meta?.apply(),
    setHeroSkin: (id) => {
      if (characters && heroChar) characters.setSkin(heroChar, id);
    },
    setHeroWings: (id) => {
      if (characters && heroChar) characters.setWings(heroChar, id);
    },
    specialDue: () => hudDueNow().has('special'),
    shopTabs: {
      ...(iapView ? { special: iapView.shop } : {}),
      // MU-12 (Q-090 decided: B): the sets of steps are bought in the shop, the «Footsteps» window only chooses.
      ...(footstepsView && muLayout ? { steps: footstepsView.shopTab } : {}),
      shoes: {
        cards: () => meta?.shopCards() ?? [],
        balance: () => formatNumber(meta?.shoeFunds() ?? sim.coins, numSuffix),
        trophies: () => meta?.shoesInTrophies ?? false,
        buy: () => {
          if (meta?.buyShoes()) sfxEvents.cue('shoes');
          windows?.refresh();
        },
      },
      eggs: {
        cards: () => petsView?.shopCards() ?? [],
        balance: () => formatNumber(sim.coins, numSuffix),
        buy: (id) => {
          if (!petsView?.buyFromShop(id)) windows?.refresh();
        },
        // M4-03 (place egg): the egg of the mountain for an ad — it hatches on `rewarded` («New pet!»).
        ad: (id) =>
          adsView?.eggAd(
            () => {
              petsView?.buyFromShop(id, true);
              return t('toast.adEgg', { egg: t(`egg.${id}`) });
            },
            () => windows?.refresh(),
          ),
      },
    },
    trophiesDue: () => hudDueNow().has('trophies'),
    stageTrophies: balance.upgrade.currency === 'trophies',
    // Round of fixes MU (staff 19.10): the phone shop shows both balances in its head.
    ...(muLayout ? { wallet: () => ({ coins: formatNumber(sim.coins, numSuffix), trophies: formatNumber(save.trophies ?? 0, numSuffix) }) } : {}),
  });
  // The points of the base (docs/01-gdd.md 19.3). The shop: with «Shop» of the HUD; its tab — the sneakers if they are
  // affordable, else the eggs if the egg of the own mountain is, else the sneakers; the hand when one is affordable.
  const ownEgg = (): Egg | null => {
    const own = ownWorld(flowState()) || content.worlds.worlds.length;
    const w = [...content.worlds.worlds].reverse().find((x) => x.index <= own && x.egg);
    return eggs.eggs.find((e) => e.id === w?.egg) ?? null;
  };
  const shopAfford = (): { shoes: boolean; egg: boolean } => {
    const next = nextShoes(balance.upgrade.tiers, meta?.shoeLevel ?? 0);
    const egg = ownEgg();
    return {
      shoes: next !== null && (meta?.shoeFunds() ?? sim.coins) >= shoesPrice(next, sim.tier, balance.rebirth, balance.upgrade),
      egg: egg !== null && sim.coins >= eggPrice(egg, sim.tier, balance.rebirth),
    };
  };
  recordsView = createRecordsView({
    windows,
    leaderboard: platformOpts.leaderboardName !== '',
    topScores: (n) => platform.topScores(n),
    numSuffix,
    authorized: () => platform.authorized,
    signIn: () => platform.signIn(),
  });
  standsView = createStandsView({
    getSim: () => sim,
    hud,
    camera: cameraRig,
    field: () => field,
    onBase: () => onBase,
    windowOpen: () => !!windows?.current,
    stands: {
      shop: {
        due: () => hudDueNow().has('shop'),
        text: () => t('btn.shop'),
        hand: () => {
          const a = shopAfford();
          return a.shoes || a.egg;
        },
        press: () => {
          const a = shopAfford();
          cosmeticsView?.openShop(a.shoes ? 'shoes' : a.egg ? 'eggs' : 'shoes');
        },
      },
      // The gift of the day (P1): with «Calendar» of the HUD; «Claim» while the reward of the calendar waits, else the
      // timer of the «Calendar» button over the closed box.
      // G-07 (producer 26.10: «a gold gift by the way out, I did not get what it is, cannot take it»): the stand of the
      // gift calendar — always there on the base with its name over it; walking up opens the calendar window (19.3, 27.4).
      daily: {
        due: () => true,
        text: () => null,
        // Lit with «!» instead of a hand (19.3).
        hand: () => false,
        label: () => (dailyView ? `${t('btn.daily')} · ${dailyView.canClaim ? '!' : t('daily.soon', { time: formatTimer(dailyView.nextSec) })}` : null),
        press: () => dailyView?.openWindow('base'),
        // Opens by itself only while the reward waits (a run past it later does not stop the hero); its «Claim» counts
        // as the base's (daily_claim from: base, docs/06).
        approach: () => void (dailyView?.canClaim && dailyView.openWindow('base')),
      },
      // The «My records» board (P1, Q-051): its numbers from the first base; «Records» by it with a leaderboard on.
      records: {
        due: () => true,
        text: () => (recordsView?.available ? t('btn.records') : null),
        hand: () => false,
        press: () => recordsView?.open(),
      },
    },
  });
  if (heroChar.skinId !== cosmeticsView.skin) characters.setSkin(heroChar, cosmeticsView.skin);
  characters.setWings(heroChar, cosmeticsView.wings);
  cosmeticsView.update();
  // Rebirth (docs/01-gdd.md 7.5): the button from the first summit, the window, «All mountains cleared!» at the last portal.
  rebirthView = createRebirthView({
    // «Stay» in the All mountains cleared window: with the base — to the base (docs/01-gdd.md 19.4).
    onStay: () => {
      if (flow({ kind: 'stay' }).kind === 'base') pendingPlace = { kind: 'base' };
    },
    balance,
    skins,
    eggs,
    save,
    getSim: () => sim,
    windows,
    numSuffix,
    persist,
    lookFigure: (kind, id) => cosmeticsView!.lookFigure(kind, id),
    // M4-04 (point rebirth): «Rebirth» may bring a fullscreen ad, the rebirth after it.
    onRebirth: () => (adsView ? adsView.interstitial('rebirth', rebirth) : rebirth()),
    toEggs: () => cosmeticsView?.openShop('eggs'),
  });
  // Calendar (docs/01-gdd.md 7.6): rewards by the data, the game day by server time; the window opens only by its button.
  const rewards = createRewards({
    balance,
    eggs,
    skins,
    worlds: content.worlds.worlds,
    save,
    getSim: () => sim,
    hud,
    pets: () => petsView,
    rng: createRng((seed ^ 0x6c8e9cf5) >>> 0),
    numSuffix,
    onLook: () => cosmeticsView?.syncHero(),
    onBoost: () => meta?.apply(),
    onGain: (kind, before, after) => rewardFly?.play(kind, before, after),
  });
  dailyView = createDailyView({
    balance,
    save,
    hud,
    windows,
    rewards,
    now: () => platform.serverTime(),
    track,
    persist,
    onNewDay: () => questsView?.refresh(),
    numSuffix,
    // M4-R4: a set of steps the calendar gives on its day — named on that day's card too.
    dayExtra: (day) => {
      const set = sfx.footsteps?.sets.find((s) => s.unlock === 'daily' && s.day === day);
      return set ? t('daily.steps', { name: t(`footsteps.set.${set.id}`) }) : null;
    },
  });
  dailyView.tick(true);
  // Quests, time rewards and the wheel (docs/01-gdd.md 7.7, 7.8, 7.13): the game day of the calendar.
  questsView = createQuestsView({
    balance,
    game,
    save,
    getSim: () => sim,
    hud,
    windows,
    rewards,
    rng: createRng((seed ^ 0x2f6b7d19) >>> 0),
    numSuffix,
    nextDaySec: () => dailyView?.nextSec ?? 0,
    persist,
  });
  questsView.refresh();
  questsView.wire(sim);
  ftueView = createFtueView({
    balance,
    pets,
    save,
    getSim: () => sim,
    hud,
    camera: cameraRig,
    visual: ftueVisual,
    field: () => field,
    touch: () => input.touchActive,
    shoes: () => ({ shown: meta?.shoesShown ?? false, level: meta?.shoeLevel ?? 0 }),
    // Only with the «Shop» button on screen (its tab «Eggs»): a hint the player can act on (docs/01-gdd.md 20.9).
    petsOffered: () => (petsView?.petsHint() ?? false) && hudDueNow().has('shop'),
    basePortal: () => (onBase ? (basePortals.find((p) => p.state === 'own') ?? null) : null),
  });
  ftueView.wire(sim);
  const skin = skins.skins.find((x) => x.id === skins.default) ?? skins.skins[0];
  // Stages pace (docs/01-gdd.md 22.8): the coin wallet is trophies in the windows too.
  setWalletTrophies(balance.currency === 'trophies');
  setLineMarks(muLayout);
  // MU round 5: the screen angle from the hero's chest to a place — the arrows of the slot plaques.
  const aimFrom = new Vector3();
  const aimTo = new Vector3();
  const aim = (x: number, y: number, z: number): number =>
    screenAngle(cameraRig.camera, aimFrom.set(sim.hero.pos.x, sim.hero.pos.y + HERO_HEIGHT / 2, sim.hero.pos.z), aimTo.set(x, y, z), field);
  hudView = createHudView({
    aim,
    firstPass: () => (save.summits ?? 0) === 0 && (save.tier ?? 0) === 0,
    balance,
    theme,
    hud,
    getSim: () => sim,
    getWorld: () => g.world,
    faceUrl: () => heroFace,
    numSuffix,
    mu: muLayout,
    baseLabel: () => t('camp.label', { n: basePortals.find((p) => p.state === 'own')?.world ?? 1 }),
    baseGoal: () => {
      if (!onBase) return null;
      const own = basePortals.find((p) => p.state === 'own');
      return own ? t('base.goal', { name: t(`world.${own.id}`) }) : t('base.name');
    },
    // «Level up!» (docs/01-gdd.md 22.2): the toast, confetti over the hero and the chime.
    onLevelUp: (n) => {
      // The toast on every 5th level (LV-12 review: every 1–3 s it was noise); the confetti and the chime always.
      // MU-05 (l4-level-up): «LEVEL UP!» gold in the slot for 1.2 s with «Level N» under it.
      if (n % 5 === 0) {
        // K-01 (review D20): the level in the toast itself — «LEVEL UP! 7».
        if (muLayout) hud?.toast(t('level.upN', { n }).toLocaleUpperCase(), LEVEL_TOAST_SEC, true, undefined, undefined, false, { minSec: LEVEL_TOAST_MIN_SEC, key: 'levelUp' });
        else hud?.toast(t('level.up'));
      }
      const p = sim.hero.pos;
      fx?.burst('confetti', p.x, p.y + 3, p.z, [theme.ui.coins, theme.ui.stat, '#ffffff'], theme.hero?.levelConfetti ?? 40, 9, 3);
      audio?.play('levelUp');
      g.levelUps = (g.levelUps ?? 0) + 1;
    },
  });
  hudView.wire(sim);
  // The stage finishes of the stages pace (docs/01-gdd.md 22.8): the trophy buttons.
  stageView = createStageView({ padSpent: (n) => padSpent(g.world, n), getSim: () => sim, hud, camera: cameraRig, theme, field: () => field, fx: () => fx, play: (n) => audio?.play(n), numSuffix, mu: muLayout,
    basePortals: () => (onBase ? basePortals.map((p) => ({ x: p.x, z: p.z, height: p.height, text: t(`world.${p.id}`), sub: portalPlaque(p).text, locked: portalPlaque(p).locked })) : null),
    onTrophy: (n, trophies) => {
      campView?.trophyTaken();
      // SD-03 (docs/01-gdd.md 23.3): the stage trophies to spend (not the all-time count of summits: it opens the summit group).
      if (trophies) {
        save.trophies = Math.min(Number.MAX_SAFE_INTEGER, (save.trophies ?? 0) + Math.max(0, Math.floor(n)));
        hud.setTrophies(formatNumber(save.trophies, numSuffix));
        persist(true);
      }
    },
    onGain: (kind, amount, at) => {
      const after = kind === 'trophies' ? (save.trophies ?? 0) : sim.coins;
      rewardFly?.play(kind, after - amount, after, at ?? undefined);
    },
    onCampReturn: () => {
      const flash = document.createElement('div');
      flash.className = 'fade-flash';
      ui.appendChild(flash);
      setTimeout(() => flash.remove(), 1000);
    }, campTeleport: () => (campView?.known() ? g.world.campTeleport : undefined) });
  stageView.wire(sim);
  // The stage tutorial and the camp teleport (docs/01-gdd.md 22.12).
  const seenAt = new Vector3();
  const seen = (x: number, y: number, z: number): boolean => {
    seenAt.set(x, y, z).project(cameraRig.camera);
    return seenAt.z < 1 && Math.abs(seenAt.x) <= 1 && Math.abs(seenAt.y) <= 1;
  };
  campView = createCampView({ aim, seen, getSim: () => sim, getWorld: () => g.world, hud, windows, save, levels: balance.levels, persist, numSuffix, trophyWallet: balance.upgrade.currency === 'trophies', shoesAffordable: () => shopAfford().shoes, onTrophies: (n) => hud.setTrophies(formatNumber(n, numSuffix)),
    // ST-01: the gift step and the portal step of the tutorial.
    giftReady: () => questsView?.timeItem(muLayout)?.badge === '!',
    basePortal: (world) => {
      const p = onBase ? basePortals.find((q) => q.world === world) : undefined;
      return p ? { x: p.x, y: 0, z: p.z } : null;
    } });
  hud.setAutoRun(save.settings.autoRun);
  hud.setQuality(save.settings.quality);
  hud.setTouchMode(mobile);
  input.touchActive = mobile;
  input.attach(canvas, ui);
  // M4-10 (docs/03 7.1.5): the WebGL context lost — the game stands (no step of a world it cannot draw); restored —
  // the renderer rebuilds its state by itself and the game goes on.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    pause.add('transition');
  });
  canvas.addEventListener('webglcontextrestored', () => pause.remove('transition'));

  // Field (docs/02-tech.md 6.4): the canvas and the HUD share one rectangle; margins show sky.bottom. A phone-sized touch
  // screen — the whole window whatever the SDK says (the producer's link runs the mock, a desktop by default).
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  // MU round 3 (producer 19.10: Yandex Browser on Android gives the game 815 × 290 and its bottom panel lies over the
  // page): the field is the visible part of the window, not the window under the panels.
  const viewport = window.visualViewport;
  const fit = (): void => {
    const w = viewport ? Math.min(window.innerWidth, viewport.width) : window.innerWidth;
    const h = viewport ? Math.min(window.innerHeight, viewport.height) : window.innerHeight;
    field = fitField(w, h, platform.device, coarsePointer.matches);
    for (const el of [canvas, ui]) {
      el.style.position = 'absolute';
      el.style.left = `${field.left}px`;
      el.style.top = `${field.top}px`;
      el.style.width = `${field.width}px`;
      el.style.height = `${field.height}px`;
    }
    gr?.resize(field.width, field.height, quality.dpr);
    hud?.layout(field.width, field.height);
  };
  // MU round 4 (producer 20.10: after folding the app or leaving the whole screen the field kept the old size): the
  // browser settles the visible part a few frames after the event, so the field is measured again then too.
  const refit = (): void => {
    fit();
    requestAnimationFrame(fit);
    setTimeout(fit, 250);
  };
  window.addEventListener('resize', refit);
  viewport?.addEventListener('resize', refit);
  document.addEventListener('fullscreenchange', refit);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refit();
  });
  coarsePointer.addEventListener('change', refit);
  fit();
  // MU round 4 (producer 20.10: the game never went back to the whole screen without a reload): any tap of a finger
  // outside the whole screen asks for it again (a browser lets it only from a tap); a refusal leaves the game whole in
  // the window and the next tap asks again, at most once a second.
  let askedAt = -Infinity;
  const askWholeScreen = (ev: PointerEvent): void => {
    if (ev.pointerType === 'mouse' || document.fullscreenElement) return;
    const now = performance.now();
    if (now - askedAt < 1000) return;
    askedAt = now;
    void platform.requestFullscreen().then(refit);
  };
  window.addEventListener('pointerup', askWholeScreen, true);
  applyQualityNow();

  pause.onChange((paused) => {
    loop.paused = paused;
    events.push(paused ? 'pause' : 'resume');
    input.reset();
    if (paused) {
      platform.gameplayStop();
    } else {
      loop.resetAccumulator();
      platform.gameplayStart();
    }
  });
  document.addEventListener('visibilitychange', () => {
    pause.set_('hidden', document.hidden);
    // Hidden page or closing tab: the latest save to the cloud now, within the bucket (docs/02-tech.md 11.6).
    if (document.hidden) {
      persist(true);
      void platform.flushNow();
    }
  });
  window.addEventListener('pagehide', () => {
    persist(true);
    void platform.flushNow();
  });
  window.addEventListener('blur', () => pause.add('blur'));
  window.addEventListener('focus', () => pause.remove('blur'));
  if (document.hidden) pause.add('hidden');
  {
    // MU-09 (p1-rotate, MU-13: a phone upright played on without it): «Turn your phone» over everything while a touch
    // screen stands upright — the sign is the touch and the orientation of the window, not the kind of device.
    const portrait = window.matchMedia('(orientation: portrait)');
    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = (): void => {
      const on = portrait.matches && (coarse.matches || mobile);
      pause.set_('orientation', on);
      hud?.setRotate(on);
    };
    portrait.addEventListener('change', apply);
    coarse.addEventListener('change', apply);
    apply();
  }

  // Entering the game after the first summit: the base (docs/01-gdd.md 19.4, startOnReturn), otherwise 6.6 as before.
  const onBaseAtBoot = flow({ kind: 'boot' }).kind === 'base';
  if (onBaseAtBoot) {
    enterBase();
    dailyView.tick(true);
  }
  // First frame drawn and controls live, then ready() (11.2, steps 6–7).
  gr.render();
  // Back in the game with the gift of the day waiting (docs/01-gdd.md 19.2): it says so, by the box at the spawn — after the
  // first frame, so its 3 s are not spent on the first draw of a slow device.
  if (onBaseAtBoot && dailyView.canClaim && hudDueNow().has('daily')) hud.toast(t('toast.welcomeGift'), 3);
  bootState.firstFrameAt = gr.info().frame;
  events.push('firstFrame');
  loop.paused = pause.paused;
  loop.start();
  preloader.classList.add('hidden');
  bootState.controllable = true;
  platform.ready();
  bootState.readyAt = gr.info().frame;
  // D-02 (ready() ≤ 5.3 s at CPU ×4): the first frame compiled only the shaders it draws; the rest of the scene (the
  // avalanche, the giant, the base, the effects) soon after ready(), before the first of them is seen. Then the winter
  // decor of the boot mountain into its chunks (unless a switch of mountains built them with it already).
  setTimeout(() => {
    void gr?.compile();
    if (!gr || !winterDecor || levelMeshes !== bootMeshes || onBase) return;
    gr.scene.remove(levelMeshes.group);
    levelMeshes.dispose();
    levelMeshes = createLevelMeshes(level, themeOf(tintOf(world)), (k) => t(`num.${k}`), seeFade(), t('gate.needLevel'), winterDecor);
    gr.scene.add(levelMeshes.group);
    sim.gatesOpen.forEach((open, i) => open && levelMeshes!.setGateOpen(i, 1));
    sim.gifts.forEach((gift, i) => gift.taken && levelMeshes!.setGiftShown(i, false));
    applyQualityNow();
  }, POST_READY_MS);
  // M5-06: the hero's face of the mountain bar after ready() (a canvas read back cost 0.3 s of the boot at CPU ×4).
  setTimeout(() => {
    heroFace = skin ? faceDataUrl(skin.colors.head, skin.face, 48, characters?.faceAtlas.image as HTMLCanvasElement | undefined) : '';
    hud?.setHeroFace(heroFace);
  }, 0);
  events.push('ready');
  // The pace of the run goes with gameReady: the reports split the open/fast comparison by it (docs/06 4, 8.2).
  track('game_ready', { pace, flags: flagsApplied });
  persist();
  if (!pause.paused) platform.gameplayStart();
  // M4-07: the catalog and the purchases made before (IAP-01), granted with their show.
  void iapView?.start();

  // SD-08 (docs/01-gdd.md 23.8): the build label of the producer link only with ?debug=1 — the game itself is clean.
  if (__BUILD_LABEL__ && params.get('debug') === '1') mountLabel(__BUILD_LABEL__, ui);
  if (__DEBUG_TOOLS__ && params.get('debug') === '1') {
    const mod = await import('./debug/index.ts');
    debug = mod.mountDebug(g, ui, mobile);
  }
  if (testApi) testApi.ready = true;
}

boot().catch((err: unknown) => {
  log.error('boot failed', err);
});

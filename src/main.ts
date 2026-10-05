import './styles.css';
import { Vector3 } from 'three';
import { content, i18nUrls, pace } from './content/index.ts';
import { CLASSIC_PACE } from './content/pace.ts';
import { configureAnalytics, track } from './analytics/index.ts';
import { createPlatform } from './platform/index.ts';
import { createStorage } from './platform/storage.ts';
import { PauseManager } from './core/pause.ts';
import { createLoop } from './core/loop.ts';
import { log } from './core/log.ts';
import { createRng, seedFrom } from './core/rng.ts';
import { loadDictionary, setDictionary, t } from './ui/i18n.ts';
import { fitField, type FieldRect } from './ui/fit.ts';
import { createHud, type Hud, type MenuItem } from './ui/hud.ts';
import { drawNoGraphics } from './ui/fallback.ts';
import { mountLabel } from './ui/label.ts';
import { icon } from './ui/icons.ts';
import { createGameRenderer, createWebGL2Context, type GameRenderer } from './render/renderer.ts';
import { createLevelMeshes, type LevelMeshes } from './render/level-mesh.ts';
import { createCharacters, type CharacterInstance, type Characters } from './render/characters.ts';
import { createBlobShadow } from './render/blob.ts';
import { createSnowball } from './render/threat/snowball.ts';
import { createBonusVisual, type BonusVisual } from './render/threat/bonus.ts';
import { BONUS_HEIGHT } from './sim/bonus.ts';
import { createCameraRig, type CameraRig } from './render/camera.ts';
import { createAvalancheVisual, type AvalancheVisual } from './render/threat/avalanche.ts';
import { createWaveView, type WaveView } from './app/wave-view.ts';
import { createFtueVisual } from './render/ftue.ts';
import { createFtueView, type FtueView } from './app/ftue-view.ts';
import { createWayView, type WayView } from './app/way-view.ts';
import { guardBannerSigns } from './app/banner-signs.ts';
import { createMetaView, type MetaView } from './app/meta-view.ts';
import { createPetsView, type PetsView } from './app/pets-view.ts';
import { createRebirthView, type RebirthView } from './app/rebirth-view.ts';
import { applyRebirth, summitsDone } from './meta/rebirth.ts';
import { hudDue } from './meta/hud-schedule.ts';
import { renderSummitPanel } from './ui/summit-panel.ts';
import { createPetsVisual } from './render/pets.ts';
import { createCosmeticsView, type CosmeticsView } from './app/cosmetics-view.ts';
import { createCosmeticsVisual, type CosmeticsVisual } from './render/cosmetics.ts';
import { createWindowFrame, type WindowFrame } from './ui/window.ts';
import { createHudView, type HudView } from './app/hud-view.ts';
import { createBotsView, type BotsView, type HudMode } from './app/bots-view.ts';
import { faceDataUrl } from './render/characters.ts';
import { createAudio, type GameAudio } from './audio/index.ts';
import type { ThreatOptions } from './sim/threat.ts';
import type { World } from './content/types.ts';
import { createQuality, type QualityLevel } from './render/quality.ts';
import { buildLevel } from './level/builder.ts';
import { createSim, controllerParams, type Sim } from './sim/world.ts';
import { HERO_HEIGHT } from './sim/controller.ts';
import { formatNumber, formatTimer, setNumberLocale } from './ui/format.ts';
import { moveSpeed } from './sim/effects/moveSpeed.ts';
import { InputManager } from './input/manager.ts';
import { applyManualTurn, createControlFrame, onMoveStarted, toWorld } from './input/control-frame.ts';
import type { InputSnapshot } from './input/types.ts';
import { createRewards } from './app/rewards.ts';
import { createDailyView, type DailyView } from './app/daily-view.ts';
import { createQuestsView, type QuestsView } from './app/quests-view.ts';
import { createSave, type SaveData } from './meta/save.ts';
import { addTrophies } from './meta/trophies.ts';
import { scaled, summitTrophies } from './sim/economy.ts';
import type { GameHandles, BootState } from './app/handles.ts';
import type { TestApi } from './test-api/index.ts';
import type { DebugPanel } from './debug/index.ts';

const DEG = Math.PI / 180;
/** «+N» above the hero at most 4 times a second (docs/01-gdd.md 10.3). */
const GAIN_POP_MIN_SEC = 0.25;
/** A gate melts into an arch in 0.4 s (docs/01-gdd.md 3.3). */
const GATE_MELT_SEC = 0.4;
const GATE_FUNNEL_WALLS = [1, 2, 3, 4, 6, 9];
/** Play time goes into the save at most this often (seconds of play). */
const PLAY_PERSIST_SEC = 5;

/**
 * Boot order (docs/02-tech.md 11.2): SDK init without a timeout → language → texts → save → world → first frame →
 * LoadingAPI.ready() exactly once → GameplayAPI.start() when nothing pauses the game.
 */
async function boot(): Promise<void> {
  const { game, theme, tuning, balance, skins, accessories, pets, eggs, trails, auras, sfx, bots } = content;
  const params = new URLSearchParams(location.search);
  // Address parameters exist only in dev, playtest, e2e and pages builds (docs/02-tech.md 9.3).
  const debugParams = __DEBUG_TOOLS__ ? params : new URLSearchParams();
  configureAnalytics({ counterId: game.metrikaCounterId, echoToConsole: __DEBUG_TOOLS__ });

  const pause = new PauseManager();
  const events: string[] = [];
  const bootState: BootState = { firstFrameAt: null, readyAt: null, controllable: false, glRenderer: '' };

  // Each pace keeps its own progress (docs/01-gdd.md 16.1): classic in the old place, other paces in their slot.
  const saveSlot = pace === CLASSIC_PACE ? undefined : pace;
  const platform = await createPlatform({ packId: game.id, saveSlot, leaderboardName: game.leaderboard?.name ?? '', track });
  platform.onPause(() => pause.add('sdk'));
  platform.onResume(() => pause.remove('sdk'));
  track('sdk_ready', { platform: platform.kind, lang: platform.lang, device: platform.device });

  const dict = await loadDictionary(i18nUrls[platform.lang]);
  setDictionary(platform.lang, dict);
  setNumberLocale(platform.lang);
  document.documentElement.lang = platform.lang;
  document.title = t('game.title');

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const preloader = document.getElementById('preloader') as HTMLElement;

  // Save and settings (docs/02-tech.md 4.4): settings live in SaveData and survive F5.
  const store = createStorage(game.id);
  const loaded = await platform.loadSave();
  let save: SaveData = loaded ?? createSave(platform.serverTime());
  save.sessions += 1;
  const persist = (flush = false): void => {
    syncSave();
    save.rev += 1;
    save.savedAt = platform.serverTime();
    platform.markDirty(save, { flush });
  };
  /** Funnel event of kind `player` (docs/06 section 2): sent once in the life of the player, the flag lives in the save. */
  const trackOnce = (name: string, params?: Record<string, unknown>): void => {
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

  // Mountain simulation (docs/02-tech.md 6.1): starts on mountain 1; the summit portal switches to the next one (M2-03).
  // Back after F5 or another day (docs/01-gdd.md 6.6): the mountain of the save, the hero at its farthest flag.
  let world = content.worlds.worlds.find((w) => w.index === save.world) ?? content.worlds.worlds[0];
  if (!world) throw new Error('worlds.json has no worlds');
  let level = buildLevel(world);
  // Feel values (base and ceiling) come from tuning.json sliders; the curve shape from balance.json.
  const speedCurve = () => ({ ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed });
  // The avalanche (docs/02-tech.md 8.1): live world threat (debug sliders change it), save counters.
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
  let sim: Sim = createSim(level, tuning, {
    balance,
    speedCurve: speedCurve(),
    stat: save.stat ?? 0,
    coins: save.coins ?? 0,
    tier: save.tier ?? 0,
    threat: threatOptions(world, loaded ? balance.threat.resumeSec : undefined),
    giftEgg: giftEggOptions(world),
    bots: botOptions(world),
    bonus: bonusOptions(world),
    resume: { frontierWall: save.frontierWall ?? 0 },
    walls: wallsOf(world),
  });
  /** The climb into the save (docs/01-gdd.md 7.10): stat, best stat, coins, mountain, farthest wall passed. */
  const frontierOf = (s: Sim): number => s.level.gates.reduce((m, g, i) => (s.gatesPassed[i] ? Math.max(m, g.index) : m), 0);
  function syncSave(): void {
    save.stat = sim.progress.stat;
    save.bestStat = Math.max(save.bestStat ?? 0, sim.progress.stat);
    save.coins = sim.coins;
    save.world = sim.level.worldIndex;
    save.frontierWall = frontierOf(sim);
  }
  /** Every change of the climb goes to the mirror at once; a new wall or mountain also to the cloud (SAV-01). */
  const saveClimb = (): void => {
    const far = save.world !== sim.level.worldIndex || save.frontierWall !== frontierOf(sim);
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
      payments: game.payments?.enabled ?? false,
    });
  const frame = createControlFrame(tuning.camera.pitchDeg * DEG, tuning.camera.distance);
  const inputOpts = {
    stickRadiusFrac: tuning.input.stickRadiusFrac,
    deadZoneFrac: tuning.input.deadZoneFrac,
    mouseDegPerPx: tuning.camera.mouseDegPerPx,
    touchDegPerPx: tuning.camera.touchDegPerPx,
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
  let meta: MetaView | null = null;
  let petsView: PetsView | null = null;
  let cosmeticsView: CosmeticsView | null = null;
  let rebirthView: RebirthView | null = null;
  let dailyView: DailyView | null = null;
  let questsView: QuestsView | null = null;
  let windows: WindowFrame | null = null;
  let hudView: HudView | null = null;
  let audio: GameAudio | null = null;
  let botsView: BotsView | null = null;
  let bonusVisual: BonusVisual | null = null;
  let cosmeticsVisual: CosmeticsVisual | null = null;
  let hudMode: HudMode = 'normal';
  let field: FieldRect = { width: 1, height: 1, left: 0, top: 0 };
  let lastSnap: InputSnapshot | null = null;
  let pendingGain: number | null = null;
  let lastGainPopAt = -1;
  // Gates melt into an arch over GATE_MELT_SEC; funnel events gate_N for mountain 1 on tier 0 (docs/06, steps 5–15).
  const melting = new Map<number, number>();
  const wireSim = (s: Sim): void => {
    const recorded = ['checkpoint', 'fall', 'respawn', 'jump', 'land', 'gain', 'gateOpen', 'gatePass', 'portal', 'giftTake', 'giftsRespawn', 'eggTouch', 'eggHatch', 'statMilestone'] as const;
    const waves = ['waveWarn', 'waveStart', 'waveSurvived', 'waveCaught', 'caughtEnd', 'waveDusted', 'waveGone', 'waveEnd', 'bonusSpawn', 'bonusTake', 'bonusSaved', 'bonusLost'] as const;
    for (const name of [...recorded, ...waves]) {
      s.events.on(name, (payload) => {
        simEvents.push({ name, world: s.level.worldIndex, ...(payload as Record<string, unknown>), tick: s.tick });
        if (simEvents.length > 2000) simEvents.splice(0, simEvents.length - 2000);
      });
    }
    s.events.on('gain', ({ amount, steps, belt }) => {
      pendingGain = amount;
      if (steps === 1) track('gameTutorialStart');
      if (belt) trackOnce('treadmill_first');
    });
    // Gifts (M2-04): a taken gift disappears, the coin plaque slides in on the first coin.
    s.events.on('giftTake', ({ index, total }) => {
      levelMeshes?.setGiftShown(index, false);
      hud?.setCoins(formatNumber(total, numSuffix));
    });
    s.events.on('gatePass', ({ total }) => hud?.setCoins(formatNumber(total, numSuffix)));
    // The free egg hatched (docs/01-gdd.md 6.2): the pet jumps out, +20% per step, egg_1 (docs/06 step 11).
    s.events.on('eggHatch', ({ pet }) => {
      const egg = s.giftEgg;
      petsView?.hatched(pet, egg ? new Vector3(egg.x, egg.y + 1, egg.z) : null, true);
    });
    // Round number of Speed (M2-13, Q-023): flash, bounce, chime, toast; no analytics.
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
      if (s.level.worldIndex === 1 && s.tier === 0 && GATE_FUNNEL_WALLS.includes(wall)) trackOnce(`gate_${wall}`);
    });
    // Avalanche (M2-06): newbie counter and first-wave flag in the save, toasts, funnel steps 9 and 15 (docs/06).
    s.events.on('waveWarn', ({ scripted, normalWavesDone }) => {
      if (scripted) return;
      loadWaves++;
      save.wavesNormal = normalWavesDone;
      persist();
    });
    // The free egg comes on its stand after the scripted wave: with its «Phew, made it!» (docs/01-gdd.md 16.6).
    const showEgg = (): void => {
      if (s.giftEgg) s.giftEgg.shown = true;
    };
    s.events.on('waveSurvived', ({ coins, total, gold, scripted }) => {
      // With the golden gift: one toast, bigger and golden, both rewards in it (docs/01-gdd.md 4.9).
      hud?.toast(t('wave.survived', { n: formatNumber(coins, numSuffix) }), gold > 0 ? 3 : 2, gold > 0, undefined, scripted ? showEgg : undefined);
      if (coins > 0) hud?.setCoins(formatNumber(total, numSuffix));
    });
    // Golden gift (M2-12): chime on its warning, carried over the head, saved or popped; docs/06 goldGift params.
    s.events.on('bonusSpawn', () => audio?.play('goldSpawn'));
    s.events.on('bonusTake', () => track('gold_take'));
    s.events.on('bonusSaved', ({ coins, total, where }) => {
      track('gold_saved');
      if (where !== 'cave') hud?.toast(t('wave.goldSaved', { n: formatNumber(coins, numSuffix) }), 3, true);
      hud?.setCoins(formatNumber(total, numSuffix));
    });
    s.events.on('bonusLost', (at) => {
      track('gold_lost');
      bonusVisual?.pop(at, playSec);
    });
    s.events.on('waveDusted', () => hud?.toast(t('wave.firstMiss'), 3));
    // «Snowed in!» (M2-07, docs/01-gdd.md 4.5): toast; the ball and the pose follow sim.caught in renderFrame.
    s.events.on('waveCaught', () => hud?.toast(t('wave.caught')));
    s.events.on('waveEnd', ({ scripted, outcome }) => {
      if (scripted) {
        // Not in a cave (no «Phew»), or the toast was dropped from a full queue: the egg is there now anyway.
        showEgg();
        (save.flags ??= {})['firstWaveDone'] = true;
        trackOnce('first_wave_survived', { inShelter: outcome === 'survived' });
        persist();
      } else if (outcome === 'survived' || outcome === 'caught') {
        trackOnce('wave_real_1', { caught: outcome === 'caught' });
      }
    });
    // The switch happens after the tick, not inside the emitter (docs/06 step 21: mountain 1 done on tier 0).
    s.events.on('portal', ({ from, next }) => {
      if (from === 1 && s.tier === 0) track('gameTutorialComplete', { levelComplete: 'world_1' });
      // The first summit: the trophy plaque and its buttons wait for the «Mountain cleared» window (6.4).
      if ((save.trophiesTotal ?? 0) === 0 && s.tier === 0) summitAt = Infinity;
      // Trophies of the summit g × (1 + n) (docs/01-gdd.md 8.1): to spend and over all time (the leaderboard, 7.9).
      const trophies = summitTrophies(balance, from, s.tier);
      addTrophies(save, trophies);
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
    hudView?.wire(s);
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
  let playPersistAt = 0;
  let lastRenderTicks = 0;
  const blob = createBlobShadow();
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
      windows.open('pause', t('game.title'), (body) => body.appendChild(panel), { next: false, fitTitle: true });
      track('menu_open');
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
    rebirth() {
      rebirth();
    },
    renderOnce() {
      renderFrame(1, 0);
    },
    gateSign: (index) => levelMeshes?.gateSign(index) ?? { text: '', open: false },
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
    get avalanche() {
      return avalanche;
    },
    get waveView() {
      return waveView;
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
    get way() {
      return wayView;
    },
    get levelMeshes() {
      return levelMeshes;
    },
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

  const applyQualityNow = (): void => {
    if (!gr) return;
    gr.applyQuality(quality.params);
    gr.resize(field.width, field.height, quality.dpr);
    if (characters) characters.group.traverse((o) => void (o.castShadow = quality.params.shadowMap > 0));
    levelMeshes?.chunks.forEach((c) => void (c.receiveShadow = quality.params.shadowMap > 0));
    avalanche?.setParticles(quality.params.particles);
    if (sim.bots) sim.bots.limit = Math.min(sim.bots.list.length, bots.count[quality.level]);
  };

  /**
   * Portal → mountain `index` (docs/01-gdd.md 5.2): new level, colliders and meshes; the stat and the tier carry
   * over, the hero stands at the spawn of the new camp. The «Mountain done» window arrives with the meta (M3).
   */
  const enterWorld = (index: number, reset?: { stat: number; coins: number; tier: number }): void => {
    const next = content.worlds.worlds.find((w) => w.index === index);
    if (!next) return;
    const stat = reset?.stat ?? sim.progress.stat;
    const coins = reset?.coins ?? sim.coins;
    const tier = reset?.tier ?? sim.tier;
    world = next;
    level = buildLevel(world);
    sim = createSim(level, tuning, { balance, speedCurve: speedCurve(), stat, coins, tier, threat: threatOptions(world), giftEgg: giftEggOptions(world), bots: botOptions(world), bonus: bonusOptions(world), walls: wallsOf(world) });
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
      levelMeshes = createLevelMeshes(level, theme, (k) => t(`num.${k}`));
      gr.scene.add(levelMeshes.group);
      applyQualityNow();
    }
    maxSpeed = sim.params.speed;
    frame.controlYaw = 0;
    frame.viewYaw = 0;
    g.teleport(level.spawn[0], level.spawn[1] + 0.05, level.spawn[2]);
  };

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
    windows.open('summit', t('summit.title', { n: info.from }), (body) => renderSummitPanel(body, model), {
      next: t('btn.next'),
      onClose: () => {
        if (summitAt === Infinity) summitAt = save.totalPlaySec ?? 0;
        enterWorld(next);
      },
    });
    return true;
  };

  /** A button of the HUD column (docs/01-gdd.md 10.1); «More» lists them all with captions on a short window. */
  let menuShown: MenuItem[] = [];
  const openMenuWindow = (id: string): void => {
    if (id === 'pets') petsView?.openWindow();
    else if (id === 'shop') cosmeticsView?.openShop();
    else if (id === 'wardrobe') cosmeticsView?.openWardrobe();
    else if (id === 'rebirth') rebirthView?.openWindow();
    else if (id === 'daily') dailyView?.openWindow();
    else if (id === 'quests') questsView?.openQuests();
    else if (id === 'timeRewards') questsView?.openTime();
    else if (id === 'more') {
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
    enterWorld(r.world, { stat: r.stat, coins: r.coins, tier: r.tier });
    meta?.resetShoes();
    cosmeticsView?.syncHero();
    hud?.setCoins(formatNumber(r.coins, numSuffix));
    hud?.toast(t('toast.tier', { n: r.tier }), 3, true);
    const flash = document.createElement('div');
    flash.className = 'fade-flash';
    ui.appendChild(flash);
    setTimeout(() => flash.remove(), 1000);
    if (r.tier === 1) trackOnce('rebirth_1', { rebirth: r.tier });
    persist(true);
  };

  // Simulation tick (1/60 s): input → control frame → hero.
  const simStep = (dt: number): void => {
    const t0 = performance.now();
    const snap = input.consume();
    lastSnap = snap;
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
    // e2e bot (build:e2e only): walks the given points in world space, ignoring the camera.
    if (g.botPath) {
      const bp = g.botPath;
      while (bp.length > 0 && Math.hypot(bp[0]![0] - sim.hero.pos.x, bp[0]![1] - sim.hero.pos.z) < 0.6) bp.shift();
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
    prevPos.copy(sim.hero.pos);
    sim.step({ moveX: w.x, moveZ: w.z, jump: snap.jumpPressed, jumpHeld: snap.jumpHeld }, dt);
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
      if (!openSummit(next)) enterWorld(next);
    }
    saveClimb();
    playSec += dt;
    questsView?.tick(dt);
    // The ×2 step boost runs on play seconds (stands on pause, survives F5; docs/01-gdd.md 9.1).
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
    const hero = sim.hero;
    renderPos.copy(prevPos).lerp(curPos, alpha);
    if (heroChar) {
      heroChar.position.copy(renderPos);
      heroChar.yaw = hero.yaw;
      heroChar.speedFactor = Math.min(1, hero.speed / Math.max(1, maxSpeed));
      // On a belt the hero runs in place by himself (docs/01-gdd.md 3.4).
      heroChar.pose = hero.onGround ? (hero.speed > 0.5 || sim.onBelt ? 'run' : 'idle') : hero.vel.y > 2 ? 'jump' : 'fall';
      if (sim.onBelt) heroChar.speedFactor = 1;
      heroChar.carry = (sim.bonus?.carried ?? false) && !sim.caught;
      snowball.update(sim.caught, renderPos, heroChar, playSec);
      if (hero.landedThisTick) heroChar.squash = 0.1;
      heroChar.visible = !(cameraRig?.heroHidden ?? false) && sim.respawnTicksLeft < 0;
    }
    blob.update(renderPos, sim.collision);
    bonusVisual?.update(sim.bonus, renderPos, playSec);
    waveView?.update(frameDt, playSec);
    const gameDt = (loop.ticks - lastRenderTicks) * loop.step;
    lastRenderTicks = loop.ticks;
    meta?.update();
    petsView?.update(gameDt, playSec, renderPos, hero.yaw, hero.speed > 1.5 || sim.onBelt);
    cosmeticsView?.update();
    if (cosmeticsVisual) {
      cosmeticsVisual.group.visible = heroChar?.visible ?? false;
      cosmeticsVisual.update(renderPos, hero.onGround && (hero.speed > 1.5 || sim.onBelt), gameDt, playSec);
    }
    // HUD column (docs/01-gdd.md 10.1): shop, pets, wardrobe … — each by the schedule of 6.4, never earlier.
    const cm = cosmeticsView?.menuItems();
    dailyView?.tick();
    const due = hudDueNow();
    menuShown = [cm?.shop, petsView?.menuItem(), cm?.wardrobe, dailyView?.menuItem(), questsView?.questsItem(), questsView?.timeItem(), rebirthView?.menuItem()].filter(
      (x): x is MenuItem => !!x && due.has(x.id),
    );
    hud?.setMenu(menuShown);
    ftueView?.update(gameDt, playSec, renderPos);
    hudView?.update(playSec);
    if (cameraRig) {
      cameraRig.update(
        frameDt,
        { pos: renderPos, vel: hero.vel, speed: hero.speed, maxSpeed },
        { manualCamera: lastSnap?.manualCamera ?? false, moveX: lastSnap?.moveX ?? 0, moveY: lastSnap?.moveY ?? 0, autoRun: input.autoRun },
        sim.collision,
      );
    }
    botsView?.update(alpha, playSec);
    wayView?.update(renderPos);
    g.onFrame?.();
    characters?.update(frameDt);
    if (levelMeshes) {
      for (const [index, startedAt] of melting) {
        const k = Math.min(1, (playSec - startedAt) / GATE_MELT_SEC);
        levelMeshes.setGateOpen(index, k);
        if (k >= 1) melting.delete(index);
      }
      const statText = formatNumber(sim.progress.stat, numSuffix);
      level.gates.forEach((_, i) => {
        const req = formatNumber(sim.gateRequirement(i), numSuffix);
        const open = sim.gatesOpen[i] ?? false;
        levelMeshes!.setGateSign(i, open ? req : `${statText}/${req}`, open);
      });
      if (hud && cameraRig) guardBannerSigns(hud, levelMeshes, level, cameraRig.camera, field);
    }
    gr.follow(renderPos);
    levelMeshes?.cullByDistance(renderPos.z, quality.params.fogFar);
    if (hud) {
      if (pendingGain !== null && cameraRig && playSec - lastGainPopAt >= GAIN_POP_MIN_SEC && heroChar?.visible) {
        headPos.copy(renderPos);
        // «+N» at the feet (Q-019; tuning.hud.gainHeight), floating up past the hero; over the golden gift while carried.
        headPos.y += sim.bonus?.carried ? HERO_HEIGHT + BONUS_HEIGHT : tuning.hud.gainHeight;
        headPos.project(cameraRig.camera);
        if (headPos.z < 1) hud.popGain(`+${formatNumber(pendingGain, (k) => t(`num.${k}`))}`, (headPos.x * 0.5 + 0.5 + tuning.hud.gainSide) * field.width, (0.5 - headPos.y * 0.5) * field.height);
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
    const mod = await import('./test-api/index.ts');
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
  bootState.glRenderer = gr.glRenderer;
  levelMeshes = createLevelMeshes(level, theme, (k) => t(`num.${k}`));
  gr.scene.add(levelMeshes.group);
  // Walls open from the save stand as arches at once (M3-07), no melt.
  sim.gatesOpen.forEach((open, i) => open && levelMeshes!.setGateOpen(i, 1));
  characters = createCharacters(skins, accessories);
  gr.scene.add(characters.group);
  heroChar = characters.create(skins.default);
  botsView = createBotsView({
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
  });
  g.characters = characters;
  g.hero = heroChar;
  gr.scene.add(blob.mesh);
  gr.scene.add(snowball.mesh);
  if (game.threat.bonus && theme.bonus) {
    bonusVisual = createBonusVisual(theme.bonus.color);
    gr.scene.add(bonusVisual.group);
  }
  avalanche = createAvalancheVisual(level, theme, tuning, rng.next);
  gr.scene.add(avalanche.group);
  cameraRig = createCameraRig(gr.camera, frame, tuning, rng.next);
  g.camera = cameraRig;
  cameraRig.snapTo({ pos: sim.hero.pos, vel: sim.hero.vel, speed: 0, maxSpeed });

  hud = createHud(ui, {
    jumpButtonFrac: tuning.input.jumpButtonFrac,
    onJumpDown: () => input.jumpButtonDown(),
    onPause: () => g.toggleMenu(true),
    onContinue: () => g.toggleMenu(false),
    onAutoRun: (on) => g.setAutoRun(on),
    onQuality: (level) => g.setQualitySetting(level),
    coinColor: theme.ui.coins,
    threatColor: theme.threat.front[1],
    bonusColor: theme.bonus?.color,
    onShoes: () => void meta?.buyShoes(),
    onEgg: () => void petsView?.buyEgg(),
    onMenu: (id) => openMenuWindow(id),
    trophyColor: theme.ui.trophies,
    plaqueColor: theme.ui.plaque,
    plaqueAlpha: theme.ui.plaqueAlpha,
    plaqueText: theme.ui.plaqueText,
    okColor: theme.ui.ok,
    statColor: theme.ui.stat,
    statIcon: theme.ui.statIcon,
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
    paused: () => pause.paused,
    onPauseChange: (fn) => void pause.onChange(fn),
    gestureTarget: window,
  });
  waveView = createWaveView({
    tuning,
    frame,
    getSim: () => sim,
    hud,
    camera: cameraRig,
    hero: heroChar,
    visual: avalanche,
    field: () => field,
    manualCamera: () => (lastSnap?.manualCamera ?? false) || (cameraRig?.sinceManual ?? 99) < 0.5,
    hideCaveParts: (niche, parts) => levelMeshes?.setCaveCut(niche, parts),
  });
  wayView = createWayView({ balance, getSim: () => sim, hud, camera: cameraRig, field: () => field });
  const ftueVisual = createFtueVisual(theme);
  gr.scene.add(ftueVisual.group);
  meta = createMetaView({ balance, pets, trails, auras, save, getSim: () => sim, hud, numSuffix, trackOnce, persist, onShoes: () => questsView?.shoes(), shoesColor: theme.ui.stat });
  meta.apply();
  // Windows (docs/01-gdd.md 10.2): one at a time, the game and the avalanche stand while it is open (pause `menu`).
  windows = createWindowFrame(ui, { closeLabel: t('btn.close'), okLabel: t('btn.ok'), onChange: (id) => pause.set_('menu', id !== null) });
  const petsVisual = createPetsVisual(theme);
  gr.scene.add(petsVisual.group);
  petsView = createPetsView({
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
    shopTabs: {
      shoes: {
        cards: () => meta?.shopCards() ?? [],
        balance: () => formatNumber(sim.coins, numSuffix),
        buy: () => {
          meta?.buyShoes();
          windows?.refresh();
        },
      },
      eggs: {
        cards: () => petsView?.shopCards() ?? [],
        balance: () => formatNumber(sim.coins, numSuffix),
        buy: (id) => {
          if (!petsView?.buyFromShop(id)) windows?.refresh();
        },
      },
    },
    trophiesDue: () => hudDueNow().has('trophies'),
  });
  if (heroChar.skinId !== cosmeticsView.skin) characters.setSkin(heroChar, cosmeticsView.skin);
  characters.setWings(heroChar, cosmeticsView.wings);
  cosmeticsView.update();
  // Rebirth (docs/01-gdd.md 7.5): the button from the first summit, the window, «All mountains cleared!» at the last portal.
  rebirthView = createRebirthView({
    balance,
    skins,
    eggs,
    save,
    getSim: () => sim,
    windows,
    numSuffix,
    persist,
    lookFigure: (kind, id) => cosmeticsView!.lookFigure(kind, id),
    onRebirth: () => rebirth(),
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
  });
  dailyView = createDailyView({ balance, save, hud, windows, rewards, now: () => platform.serverTime(), track, persist, onNewDay: () => questsView?.refresh() });
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
  });
  ftueView.wire(sim);
  const skin = skins.skins.find((x) => x.id === skins.default) ?? skins.skins[0];
  hudView = createHudView({
    balance,
    theme,
    hud,
    getSim: () => sim,
    getWorld: () => g.world,
    faceUrl: skin ? faceDataUrl(skin.colors.head, skin.face) : '',
    numSuffix,
  });
  hudView.wire(sim);
  hud.setAutoRun(save.settings.autoRun);
  hud.setQuality(save.settings.quality);
  hud.setTouchMode(mobile);
  input.touchActive = mobile;
  input.attach(canvas, ui);

  // Field (docs/02-tech.md 6.4): the canvas and the HUD share one rectangle; margins show sky.bottom.
  const fit = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    field = fitField(w, h, platform.device);
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
  window.addEventListener('resize', fit);
  fit();
  applyQualityNow();
  await gr.compile();

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
  if (mobile) {
    const portrait = window.matchMedia('(orientation: portrait)');
    const apply = (): void => pause.set_('orientation', portrait.matches);
    portrait.addEventListener('change', apply);
    apply();
  }

  // First frame drawn and controls live, then ready() (11.2, steps 6–7).
  gr.render();
  bootState.firstFrameAt = gr.info().frame;
  events.push('firstFrame');
  loop.paused = pause.paused;
  loop.start();
  preloader.classList.add('hidden');
  bootState.controllable = true;
  platform.ready();
  bootState.readyAt = gr.info().frame;
  events.push('ready');
  track('game_ready');
  persist();
  if (!pause.paused) platform.gameplayStart();

  if (__BUILD_LABEL__) mountLabel(__BUILD_LABEL__, ui);
  if (__DEBUG_TOOLS__ && params.get('debug') === '1') {
    const mod = await import('./debug/index.ts');
    debug = mod.mountDebug(g, ui, mobile);
  }
  if (testApi) testApi.ready = true;
}

boot().catch((err: unknown) => {
  log.error('boot failed', err);
});

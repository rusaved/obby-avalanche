import './styles.css';
import { Vector3 } from 'three';
import { content, i18nUrls } from './content/index.ts';
import { configureAnalytics, track } from './analytics/index.ts';
import { createPlatform } from './platform/index.ts';
import { createStorage } from './platform/storage.ts';
import { PauseManager } from './core/pause.ts';
import { createLoop } from './core/loop.ts';
import { log } from './core/log.ts';
import { createRng, seedFrom } from './core/rng.ts';
import { loadDictionary, setDictionary, t } from './ui/i18n.ts';
import { fitField, type FieldRect } from './ui/fit.ts';
import { createHud, type Hud } from './ui/hud.ts';
import { drawNoGraphics } from './ui/fallback.ts';
import { mountLabel } from './ui/label.ts';
import { createGameRenderer, createWebGL2Context, type GameRenderer } from './render/renderer.ts';
import { createLevelMeshes, type LevelMeshes } from './render/level-mesh.ts';
import { createCharacters, type CharacterInstance, type Characters } from './render/characters.ts';
import { createBlobShadow } from './render/blob.ts';
import { createCameraRig, type CameraRig } from './render/camera.ts';
import { createQuality, type QualityLevel } from './render/quality.ts';
import { buildLevel } from './level/builder.ts';
import { createSim, controllerParams, type Sim } from './sim/world.ts';
import { moveSpeed } from './sim/effects/moveSpeed.ts';
import { InputManager } from './input/manager.ts';
import { applyManualTurn, createControlFrame, onMoveStarted, toWorld } from './input/control-frame.ts';
import type { InputSnapshot } from './input/types.ts';
import { createSave, type SaveData } from './meta/save.ts';
import type { GameHandles, BootState } from './app/handles.ts';
import type { TestApi } from './test-api/index.ts';
import type { DebugPanel } from './debug/index.ts';

const DEG = Math.PI / 180;
const KEYS_HINT_SEC = 30;

/**
 * Boot order (docs/02-tech.md 11.2): SDK init without a timeout → language → texts → save → world → first frame →
 * LoadingAPI.ready() exactly once → GameplayAPI.start() when nothing pauses the game.
 */
async function boot(): Promise<void> {
  const { game, theme, tuning, balance, skins, accessories } = content;
  const params = new URLSearchParams(location.search);
  // Address parameters exist only in dev, playtest, e2e and pages builds (docs/02-tech.md 9.3).
  const debugParams = __DEBUG_TOOLS__ ? params : new URLSearchParams();
  configureAnalytics({ counterId: game.metrikaCounterId, echoToConsole: __DEBUG_TOOLS__ });

  const pause = new PauseManager();
  const events: string[] = [];
  const bootState: BootState = { firstFrameAt: null, readyAt: null, controllable: false, glRenderer: '' };

  const platform = await createPlatform({ packId: game.id, leaderboardName: game.leaderboard?.name ?? '', track });
  platform.onPause(() => pause.add('sdk'));
  platform.onResume(() => pause.remove('sdk'));
  track('sdk_ready', { platform: platform.kind, lang: platform.lang, device: platform.device });

  const dict = await loadDictionary(i18nUrls[platform.lang]);
  setDictionary(platform.lang, dict);
  document.documentElement.lang = platform.lang;
  document.title = t('game.title');

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const preloader = document.getElementById('preloader') as HTMLElement;

  // Save and settings (docs/02-tech.md 4.4): settings live in SaveData and survive F5.
  const store = createStorage(game.id);
  let save: SaveData = (await platform.loadSave()) ?? createSave(platform.serverTime());
  save.sessions += 1;
  const persist = (flush = false): void => {
    save.rev += 1;
    save.savedAt = platform.serverTime();
    platform.markDirty(save, { flush });
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
  const rng = createRng(seedFrom(debugParams.get('seed')));

  // World 1 simulation (docs/02-tech.md 6.1): stat 0 until the loop arrives at M2.
  const world = content.worlds.worlds[0];
  if (!world) throw new Error('worlds.json has no worlds');
  const level = buildLevel(world);
  const stat = 0;
  // Feel values (base and ceiling) come from tuning.json sliders; the curve shape from balance.json.
  const speedCurve = () => ({ ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed });
  let maxSpeed = moveSpeed(stat, speedCurve());
  const sim: Sim = createSim(level, tuning, maxSpeed);
  const simEvents: GameHandles['simEvents'] = [];
  for (const name of ['checkpoint', 'fall', 'respawn', 'jump', 'land'] as const) {
    sim.events.on(name, (payload) => {
      simEvents.push({ name, ...(payload as Record<string, unknown>), tick: sim.tick });
      if (simEvents.length > 2000) simEvents.splice(0, simEvents.length - 2000);
    });
  }
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
  let field: FieldRect = { width: 1, height: 1, left: 0, top: 0 };
  let lastSnap: InputSnapshot | null = null;
  const prevPos = new Vector3().copy(sim.hero.pos);
  const curPos = new Vector3().copy(sim.hero.pos);
  const renderPos = new Vector3();
  let jumpedOnce = false;
  let playSec = 0;
  const blob = createBlobShadow();

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
    applyTuning() {
      maxSpeed = moveSpeed(stat, speedCurve());
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
      const want = open ?? !pause.has('menu');
      pause.set_('menu', want);
      hud?.setPaused(want);
      if (want) track('menu_open');
    },
    teleport(x, y, z) {
      sim.teleport(x, y, z);
      prevPos.copy(sim.hero.pos);
      curPos.copy(sim.hero.pos);
      cameraRig?.snapTo({ pos: sim.hero.pos, vel: sim.hero.vel, speed: 0, maxSpeed });
    },
    renderOnce() {
      renderFrame(1, 0);
    },
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
    showAd(kind) {
      return kind === 'rewarded' ? platform.showRewarded('e2e') : platform.showInterstitial('e2e');
    },
  };

  const applyQualityNow = (): void => {
    if (!gr) return;
    gr.applyQuality(quality.params);
    gr.resize(field.width, field.height, quality.dpr);
    if (characters) characters.group.traverse((o) => void (o.castShadow = quality.params.shadowMap > 0));
    levelMeshes?.chunks.forEach((c) => void (c.receiveShadow = quality.params.shadowMap > 0));
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
    prevPos.copy(sim.hero.pos);
    sim.step({ moveX: w.x, moveZ: w.z, jump: snap.jumpPressed, jumpHeld: snap.jumpHeld }, dt);
    curPos.copy(sim.hero.pos);
    if (sim.hero.jumpedThisTick) jumpedOnce = true;
    playSec += dt;
    g.lastSimMs = performance.now() - t0;
  };

  const renderFrame = (alpha: number, frameDt: number): void => {
    if (!gr) return;
    if (input.consumePause()) g.toggleMenu();
    const hero = sim.hero;
    renderPos.copy(prevPos).lerp(curPos, alpha);
    if (heroChar) {
      heroChar.position.copy(renderPos);
      heroChar.yaw = hero.yaw;
      heroChar.speedFactor = Math.min(1, hero.speed / Math.max(1, maxSpeed));
      heroChar.pose = hero.onGround ? (hero.speed > 0.5 ? 'run' : 'idle') : hero.vel.y > 2 ? 'jump' : 'fall';
      if (hero.landedThisTick) heroChar.squash = 0.1;
      heroChar.visible = !(cameraRig?.heroHidden ?? false) && sim.respawnTicksLeft < 0;
    }
    blob.update(renderPos, sim.collision);
    if (cameraRig) {
      cameraRig.update(
        frameDt,
        { pos: renderPos, vel: hero.vel, speed: hero.speed, maxSpeed },
        { manualCamera: lastSnap?.manualCamera ?? false, moveX: lastSnap?.moveX ?? 0, moveY: lastSnap?.moveY ?? 0, autoRun: input.autoRun },
        sim.collision,
      );
    }
    characters?.update(frameDt);
    gr.follow(renderPos);
    levelMeshes?.cullByDistance(renderPos.z, quality.params.fogFar);
    if (hud) {
      hud.updateStick(input.stick, field.left, field.top);
      hud.setTouchMode(input.touchActive);
      hud.showKeysHint(playSec < KEYS_HINT_SEC && !jumpedOnce && !input.touchActive);
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
  characters = createCharacters(skins, accessories);
  gr.scene.add(characters.group);
  heroChar = characters.create(skins.default);
  g.characters = characters;
  g.hero = heroChar;
  gr.scene.add(blob.mesh);
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
  });
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
  document.addEventListener('visibilitychange', () => pause.set_('hidden', document.hidden));
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

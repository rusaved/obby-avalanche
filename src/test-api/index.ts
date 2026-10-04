/**
 * window.__TEST__ (docs/02-tech.md 17.3, docs/04-packaging.md 11.2): only in build:e2e. Tests read state, not pixels.
 * Time in tests is game time: setTimeScale(k) and runSim(sec) also move the SDK mock clock (__YA_MOCK__.advance).
 */
import type { RenderInfo } from '../render/renderer.ts';
import type { GameHandles, SimEventRecord } from '../app/handles.ts';
import { analyticsEvents, onTrack } from '../analytics/index.ts';
import type { QualityLevel } from '../render/quality.ts';
import { content } from '../content/index.ts';

export type { BootState as TestBootState } from '../app/handles.ts';

export interface TestState {
  platform: 'yandex' | 'null';
  lang: string;
  pack: string;
  world: string;
  controllable: boolean;
  pauseReasons: string[];
  paused: boolean;
  ticks: number;
  timeSec: number;
  firstFrameAt: number | null;
  readyAt: number | null;
  glRenderer: string;
  hero: { x: number; y: number; z: number; vx: number; vy: number; vz: number; speed: number; onGround: boolean; yaw: number } | null;
  /** Stat (Speed) and steps taken (M2-01). */
  stat: number;
  steps: number;
  /** Open state per gate of the current mountain (M2-02). */
  gatesOpen: boolean[];
  /** Coin balance and taken state per gift of the current mountain (M2-04). */
  coins: number;
  giftsTaken: boolean[];
  gifts: Array<{ x: number; y: number; z: number; coins: number; rarity: string }>;
  /** On a treadmill belt; inside a cave shelter (cave volume + graceDist) and its index (M2-05). */
  onBelt: boolean;
  inShelter: boolean;
  shelter: number;
  /** Avalanche (M2-06): phase, timers, front, lit cave, how the wave ended; HUD banner, cave arrow, camera frame, veil. */
  wave: {
    phase: string;
    timer: number;
    warnSec: number;
    spawnZ: number;
    frontZ: number;
    scripted: boolean;
    scriptedPending: boolean;
    outcome: string;
    shelter: number;
    normalWaves: number;
    normalWavesDone: number;
  } | null;
  waveHud: { banner: string | null; arrow: boolean; shot: boolean; veil: boolean; toast: string };
  /** «Snowed in!» clip (M2-07): seconds since the catch, total length, target cave (−1 camp); null when not caught. */
  caught: { t: number; total: number; niche: number } | null;
  /** Bots out on the mountain (M2-10): name key, label as shown (text '' when hidden), mode, cave, position. */
  bots: Array<{ name: string; label: string; labelShown: boolean; mode: string; cave: number; x: number; y: number; z: number }>;
  /** Visible bot name labels in the DOM and decisions on warn so far (ran to a cave / dawdled / snowballs). */
  botLabels: number;
  botStats: { hid: number; dawdled: number; caught: number };
  hudMode: string;
  /** Golden gift of this wave (M2-12): null when there is none; x and zone for the e2e run to it. */
  bonus: { x: number; z: number; zone: number; carried: boolean } | null;
  /** First minute (M2-08): play time of the player (save.totalPlaySec), the hint on screen and how many plaques are
   * visible, arrows on the snow, the hand over the egg, the free egg, pets, shoes and the step multiplier. */
  playSec: number;
  hint: string | null;
  hintsVisible: number;
  hintText: string;
  arrows: boolean;
  hand: boolean;
  egg: { phase: string; x: number; y: number; z: number } | null;
  pets: string[];
  shoeLevel: number;
  shoesButton: { shown: boolean; text: string; can: boolean };
  gainMult: number;
  gatesPassed: boolean[];
  /** Round numbers of Speed (M2-13): the plaque has its flash class; sounds started so far; the audio context runs. */
  statFlash: boolean;
  sfx: string[];
  audioRunning: boolean;
  /** Coin plaque on the HUD: shown (slid in) and its text. */
  coinPlaque: { shown: boolean; text: string };
  controlYaw: number;
  viewYaw: number;
  cameraDistance: number;
  cameraFov: number;
  cameraPos: [number, number, number];
  autoRun: boolean;
  checkpoint: number;
  respawning: boolean;
  touchMode: boolean;
  stickActive: boolean;
  quality: { level: QualityLevel; dpr: number; locked: boolean };
  field: { width: number; height: number; left: number; top: number };
  menuOpen: boolean;
  lastFrameMs: number;
  lastSimMs: number;
  gpuLoad: number;
  framesPresented: number;
  framesRendered: number;
}

export interface TestApi {
  ready: boolean;
  state(): TestState;
  events: string[];
  simEvents: SimEventRecord[];
  analytics(): ReadonlyArray<{ name: string; t: number; params?: Record<string, unknown> }>;
  renderInfo(): RenderInfo | null;
  setTimeScale(k: number): void;
  runSim(sec: number): void;
  stepFrames(n: number): void;
  teleport(z: number, x?: number, y?: number): void;
  press(code: string, holdMs?: number): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  stick(x: number, y: number): void;
  jump(): void;
  setAutoRun(on: boolean): void;
  setCamera(opts: { yaw?: number; pitch?: number; dist?: number; fov?: number } | 'auto'): void;
  cameraInsideGeometry(): boolean;
  forceSlowFrames(sec: number): boolean;
  setQuality(level: QualityLevel | 'auto'): void;
  /** Puts the auto controller at a level without locking it (tests of the downgrade on a weak machine). */
  qualityAutoFrom(level: QualityLevel): void;
  openMenu(open: boolean): void;
  showFaces(): void;
  setFace(index: number): void;
  charactersDrawCalls(): number;
  gateSign(index: number): { text: string; open: boolean };
  showAd(kind: 'interstitial' | 'rewarded'): Promise<{ shown?: boolean; rewarded?: boolean; error?: string }>;
  /** Emits the avalanche phase `gone` into the simulation bus (gifts come back), without a wave. */
  waveGone(): void;
  /** Starts the next avalanche now (scripted if the first wave is still pending). */
  triggerWave(): void;
  /** The hero carries a golden gift now (threat.bonus in the data, on warn or run); false otherwise (docs/02-tech.md 17). */
  giveBonus(): boolean;
  /** Is the camera inside the snow body of the avalanche (docs/02-tech.md 7). */
  cameraInsideAvalanche(): boolean;
  /** Sets the stat (docs/02-tech.md 17.3); gates whose number it reaches open on the next tick. */
  setStat(n: number): void;
  /** e2e bot: the hero walks these world points [x, z] in order, ignoring the camera; null stops the bot. */
  botPath(points: Array<[number, number]> | null): void;
  /** Points the bot has not reached yet. */
  botLeft(): number;
  /** Longest stand (game seconds) right below a closed gate since the page opened (GDD-01). */
  gateStandMax(): number;
  /** Highest (bot z − z of a wall closed for the hero) over every tick since the page opened; < 0 means never above (M2-10). */
  botsOverClosedMax(): number;
  /** Analytics events with the play time (save.totalPlaySec) when they were sent. */
  analyticsPlay(): Array<{ name: string; playSec: number; params?: Record<string, unknown> }>;
  /** HUD mode of the shots and the promo video (docs/04-packaging.md 11.2). */
  setHudMode(mode: 'normal' | 'shots' | 'promo'): void;
  /** Flips bots.json showNames live (the e2e check of `showNames: false`). */
  botsShowNames(on: boolean): void;
}

declare global {
  interface Window {
    __TEST__?: TestApi;
    __YA_MOCK__?: { advance(ms: number): void; calls: Array<{ name: string; args: unknown[]; t: number }>; violations: string[] };
  }
}

function coinPlaque(): { shown: boolean; text: string } {
  const node = document.querySelector('[data-role="coins"]');
  return { shown: node?.classList.contains('shown') ?? false, text: node?.querySelector('.hud-coin-value')?.textContent ?? '' };
}

function shoesButton(): { shown: boolean; text: string; can: boolean } {
  const node = document.querySelector('[data-hud="shoes"]');
  return { shown: node?.classList.contains('shown') ?? false, text: node?.textContent ?? '', can: node?.classList.contains('can') ?? false };
}

/** A hero closer than this to a closed gate below it, and slower than STAND_SPEED, stands at the gate. */
const STAND_GATE_DIST = 2.5;
const STAND_SPEED = 1;

export function installTestApi(g: GameHandles): TestApi {
  const played: Array<{ name: string; playSec: number; params?: Record<string, unknown> }> = [];
  onTrack((ev) => played.push(ev.params ? { name: ev.name, playSec: g.save.totalPlaySec ?? 0, params: ev.params } : { name: ev.name, playSec: g.save.totalPlaySec ?? 0 }));
  let standSec = 0;
  let standMax = 0;
  let overClosed = -Infinity;
  g.onTick = (dt) => {
    const sim = g.sim;
    if (!sim) return;
    const h = sim.hero;
    const atGate = sim.level.gates.some((gate, i) => !sim.gatesOpen[i] && gate.z - h.pos.z > 0 && gate.z - h.pos.z < STAND_GATE_DIST);
    standSec = atGate && h.speed < STAND_SPEED ? standSec + dt : 0;
    standMax = Math.max(standMax, standSec);
    sim.level.gates.forEach((gate, i) => {
      if (sim.gatesOpen[i]) return;
      for (const b of sim.bots?.list ?? []) if (b.mode !== 'away' && b.mode !== 'off') overClosed = Math.max(overClosed, b.z - gate.z);
    });
  };
  const advanceMock = (ms: number): void => {
    if (ms > 0) window.__YA_MOCK__?.advance(ms);
  };
  const api: TestApi = {
    ready: false,
    state() {
      const h = g.sim?.hero ?? null;
      const cam = g.camera;
      return {
        platform: g.platform.kind,
        lang: g.lang,
        pack: g.packId,
        world: g.world.id,
        controllable: g.boot.controllable,
        pauseReasons: g.pause.reasons,
        paused: g.pause.paused,
        ticks: g.loop.ticks,
        timeSec: g.loop.timeSec,
        firstFrameAt: g.boot.firstFrameAt,
        readyAt: g.boot.readyAt,
        glRenderer: g.boot.glRenderer,
        hero: h
          ? { x: h.pos.x, y: h.pos.y, z: h.pos.z, vx: h.vel.x, vy: h.vel.y, vz: h.vel.z, speed: h.speed, onGround: h.onGround, yaw: h.yaw }
          : null,
        stat: g.sim?.progress.stat ?? 0,
        steps: g.sim?.progress.steps ?? 0,
        gatesOpen: g.sim ? [...g.sim.gatesOpen] : [],
        coins: g.sim?.coins ?? 0,
        giftsTaken: g.sim ? g.sim.gifts.map((x) => x.taken) : [],
        gifts: g.sim ? g.sim.gifts.map((x) => ({ x: x.x, y: x.y, z: x.z, coins: x.coins, rarity: x.rarity })) : [],
        coinPlaque: coinPlaque(),
        wave: g.sim?.threat ? { ...g.sim.threat.state } : null,
        waveHud: {
          banner: g.waveView?.banner ?? null,
          arrow: g.waveView?.arrow ?? false,
          shot: g.waveView?.shot ?? false,
          veil: g.waveView?.veil ?? false,
          toast: document.querySelector('[data-role="toast"].shown')?.textContent ?? '',
        },
        bots: (() => {
          const labels = g.botsView?.labels() ?? [];
          return (g.sim?.bots?.list ?? [])
            .map((b, i) => ({ b, l: labels[i] }))
            .filter(({ b }) => b.mode !== 'away' && b.mode !== 'off')
            .map(({ b, l }) => ({ name: b.name, label: l?.text ?? '', labelShown: l?.shown ?? false, mode: b.mode, cave: b.cave, x: b.x, y: b.y, z: b.z }));
        })(),
        botLabels: [...document.querySelectorAll<HTMLElement>('[data-role="bot-label"]')].filter((e) => Number(e.style.opacity || 0) > 0 && e.textContent !== '').length,
        botStats: { ...(g.sim?.bots?.stats ?? { hid: 0, dawdled: 0, caught: 0 }) },
        hudMode: g.hudMode,
        bonus: g.sim?.bonus ? { x: g.sim.bonus.x, z: g.sim.bonus.z, zone: g.sim.bonus.zone, carried: g.sim.bonus.carried } : null,
        playSec: g.save.totalPlaySec ?? 0,
        hint: g.ftue?.hint ?? null,
        hintsVisible: document.querySelectorAll('[data-role="hint"].shown').length,
        hintText: document.querySelector('[data-role="hint"].shown .hud-hint-text')?.textContent ?? '',
        arrows: g.ftue?.arrows ?? false,
        hand: g.ftue?.hand ?? false,
        egg: g.sim?.giftEgg ? { phase: g.sim.giftEgg.phase, x: g.sim.giftEgg.x, y: g.sim.giftEgg.y, z: g.sim.giftEgg.z } : null,
        pets: [...(g.save.pets ?? [])],
        shoeLevel: g.meta?.shoeLevel ?? 0,
        shoesButton: shoesButton(),
        gainMult: g.sim?.progress.gainMult ?? 1,
        gatesPassed: g.sim ? [...g.sim.gatesPassed] : [],
        statFlash: document.querySelector('[data-role="stat"]')?.classList.contains('flash') ?? false,
        sfx: [...(g.audio?.played ?? [])],
        audioRunning: g.audio?.running ?? false,
        caught: g.sim?.caught
          ? { t: g.sim.caught.t, total: g.sim.caught.formSec + g.sim.caught.rollSec + g.sim.caught.popSec, niche: g.sim.caught.niche }
          : null,
        onBelt: g.sim?.onBelt ?? false,
        inShelter: g.sim?.inShelter() ?? false,
        shelter: g.sim?.shelterIndex() ?? -1,
        controlYaw: g.frame.controlYaw,
        viewYaw: g.frame.viewYaw,
        cameraDistance: cam?.currentDistance ?? 0,
        cameraFov: cam?.camera.fov ?? 0,
        cameraPos: cam ? [cam.camera.position.x, cam.camera.position.y, cam.camera.position.z] : [0, 0, 0],
        autoRun: g.input.autoRun,
        checkpoint: g.sim?.checkpoint ?? -1,
        respawning: (g.sim?.respawnTicksLeft ?? -1) >= 0,
        touchMode: g.input.touchActive,
        stickActive: g.input.stick.active,
        quality: { level: g.quality.level, dpr: g.quality.dpr, locked: g.quality.locked },
        field: { ...g.field },
        menuOpen: g.pause.has('menu'),
        lastFrameMs: g.lastFrameMs,
        lastSimMs: g.lastSimMs,
        gpuLoad: g.gpuLoad,
        framesPresented: g.framesPresented,
        framesRendered: g.framesRendered,
      };
    },
    events: g.events,
    simEvents: g.simEvents,
    analytics: () => analyticsEvents(),
    renderInfo: () => g.renderer()?.info() ?? null,
    setTimeScale(k) {
      g.loop.timeScale = k;
      g.loop.unlimited = k !== 1;
    },
    runSim(sec) {
      g.loop.runSim(sec);
      advanceMock(sec * 1000);
    },
    stepFrames(n) {
      // Game paused; each frame is 1/30 s: two simulation steps and one render (docs/04-packaging.md 10.3).
      const wasPaused = g.loop.paused;
      g.loop.paused = false;
      for (let i = 0; i < n; i++) g.loop.runSim(2 / 60);
      g.loop.paused = wasPaused;
    },
    teleport(z, x = 0, y) {
      const level = g.level;
      const yy = y ?? (level ? level.floorYAt(z) + 0.05 : 0);
      g.teleport(x, yy, z);
    },
    press(code, holdMs = 120) {
      g.input.injectKey(code, true);
      setTimeout(() => g.input.injectKey(code, false), holdMs);
    },
    keyDown: (code) => g.input.injectKey(code, true),
    keyUp: (code) => g.input.injectKey(code, false),
    stick: (x, y) => g.input.setVirtualStick(x, y),
    jump: () => g.input.injectJump(),
    setAutoRun: (on) => g.setAutoRun(on),
    setCamera(opts) {
      if (!g.camera) return;
      if (opts === 'auto') {
        g.camera.shot = null;
        return;
      }
      if (opts.fov !== undefined) {
        g.camera.camera.fov = opts.fov;
        g.camera.camera.updateProjectionMatrix();
      }
      g.camera.shot = {
        yaw: opts.yaw ?? g.frame.viewYaw,
        pitch: opts.pitch ?? g.frame.pitch,
        distance: opts.dist ?? g.frame.distance,
      };
    },
    gateSign: (index) => g.gateSign(index),
    cameraInsideGeometry() {
      if (!g.camera || !g.sim) return false;
      return g.camera.insideGeometry(g.sim.collision);
    },
    forceSlowFrames: (sec) => g.quality.forceSlow(sec),
    setQuality: (level) => g.setQualitySetting(level),
    qualityAutoFrom: (level) => g.quality.setLevel(level, false),
    openMenu: (open) => g.toggleMenu(open),
    showFaces: () => g.showFaces(),
    setFace(index) {
      if (g.hero) g.hero.face = index;
    },
    charactersDrawCalls: () => g.characters?.drawCalls ?? 0,
    showAd: (kind) => g.showAd(kind),
    waveGone() {
      g.sim?.events.emit('waveGone', { tick: g.sim.tick });
    },
    triggerWave: () => g.triggerWave(),
    giveBonus: () => g.sim?.giveBonus() ?? false,
    setStat(n) {
      if (g.sim) g.sim.progress.stat = n;
    },
    botPath(points) {
      g.botPath = points ? points.map((p) => [p[0], p[1]] as [number, number]) : null;
    },
    botLeft: () => g.botPath?.length ?? 0,
    gateStandMax: () => standMax,
    botsOverClosedMax: () => overClosed,
    analyticsPlay: () => played,
    setHudMode: (mode) => g.setHudMode(mode),
    botsShowNames(on) {
      content.bots.showNames = on;
    },
    cameraInsideAvalanche() {
      const cam = g.camera?.camera.position;
      return cam ? (g.avalanche?.insideBody(cam) ?? false) : false;
    },
  };
  window.__TEST__ = api;
  return api;
}

/** Called by the loop after every frame so the mock clock keeps up with accelerated game time. */
export function mockClockSync(gameDtSec: number, realDtSec: number): void {
  const extra = (gameDtSec - realDtSec) * 1000;
  if (extra > 0) window.__YA_MOCK__?.advance(extra);
}

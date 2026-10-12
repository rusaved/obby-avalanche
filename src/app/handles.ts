// What: Types only: the GameHandles bag of live game objects that main.ts assembles for the test API and the debug panel.
// Called by: main.ts (builds it); test-api/index.ts and debug/index.ts (read it).
// Keep: Type-only imports, no runtime code (no import cycle with main.ts); a new field must be filled in main.ts; e2e specs and the debug panel rely on this shape.

/** Everything the test API and the debug panel reach into; assembled by main.ts. */
import type { Loop } from '../core/loop.ts';
import type { PauseManager } from '../core/pause.ts';
import type { Platform } from '../platform/types.ts';
import type { GameRenderer } from '../render/renderer.ts';
import type { Sim } from '../sim/world.ts';
import type { InputManager } from '../input/manager.ts';
import type { ControlFrame } from '../input/control-frame.ts';
import type { CameraRig } from '../render/camera.ts';
import type { QualityController, QualityLevel } from '../render/quality.ts';
import type { TuningJson, World } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { LevelData } from '../level/types.ts';
import type { Characters, CharacterInstance } from '../render/characters.ts';
import type { FieldRect } from '../ui/fit.ts';
import type { AvalancheVisual } from '../render/threat/avalanche.ts';
import type { WaveView } from './wave-view.ts';
import type { MetaView } from './meta-view.ts';
import type { FtueView } from './ftue-view.ts';
import type { PetsView } from './pets-view.ts';
import type { WindowFrame } from '../ui/window.ts';
import type { RebirthView } from './rebirth-view.ts';
import type { GameAudio } from '../audio/index.ts';
import type { BotsView, HudMode } from './bots-view.ts';
import type { DailyView } from './daily-view.ts';
import type { QuestsView } from './quests-view.ts';
import type { WayView } from './way-view.ts';
import type { FunView } from './fun-view.ts';
import type { LevelMeshes } from '../render/level-mesh.ts';

export interface BootState {
  firstFrameAt: number | null;
  readyAt: number | null;
  controllable: boolean;
  glRenderer: string;
}

export interface SimEventRecord {
  name: string;
  tick: number;
  [key: string]: unknown;
}

export interface GameHandles {
  /** Rewarded-ad buttons (docs/01-gdd.md 9.1). */
  readonly ads: import('./ads-view.ts').AdsView | null;
  /** The giant's look (docs/01-gdd.md 17.6). */
  readonly bossView: import('./boss-view.ts').BossView | null;
  readonly eventsView: import('./events-view.ts').EventsView | null;
  readonly decor: import('../render/decor.ts').Decor | null;
  loop: Loop;
  pause: PauseManager;
  platform: Platform;
  sim: Sim | null;
  level: LevelData | null;
  world: World;
  input: InputManager;
  frame: ControlFrame;
  camera: CameraRig | null;
  renderer: () => GameRenderer | null;
  characters: Characters | null;
  hero: CharacterInstance | null;
  quality: QualityController;
  tuning: TuningJson;
  save: SaveData;
  boot: BootState;
  events: string[];
  simEvents: SimEventRecord[];
  packId: string;
  lang: string;
  field: FieldRect;
  lastFrameMs: number;
  lastSimMs: number;
  /** Of it, sim.step alone (the budget of docs/02-tech.md 9.5; the rest is the save mirror and the views). */
  lastStepMs: number;
  gpuLoad: number;
  framesPresented: number;
  framesRendered: number;
  applyTuning(): void;
  /** The save changed: mirror now, cloud by the queue (`flush` — at once within the bucket). */
  persist(flush?: boolean): void;
  setAutoRun(on: boolean): void;
  setQualitySetting(level: QualityLevel | 'auto'): void;
  toggleMenu(open?: boolean): void;
  teleport(x: number, y: number, z: number): void;
  /** To the camp of mountain `index` as through a portal: the stat, coins and tier carry over (M3-05). */
  gotoWorld(index: number): void;
  /** Runs the rebirth now when it is open (the «Rebirth» button of the window, M3-06). */
  rebirth(): void;
  /** The rebirth button and windows (M3-06). */
  readonly rebirthView: RebirthView | null;
  renderOnce(): void;
  /** Eight characters in a row with the eight faces, camera on them (faces.png evidence). */
  showFaces(): void;
  /** The base of the pace switched off for this run (FM-07 e2e: «enabled false — the game as before FM»); absent — on. */
  baseEnabled?: boolean;
  /** The hero is on the base (docs/01-gdd.md 19); its portals; the mountain now is one passed, run again. */
  readonly onBase: boolean;
  readonly basePortals: ReadonlyArray<{ world: number; x: number; z: number; yaw: number; width: number; state: string }>;
  readonly replay: boolean;
  /** The sign of the base treadmill («×6», FM-09); null — not on the base. */
  readonly baseTreadSign: string | null;
  /** A toast as the game shows them (FM-04 e2e: its plaque and contrast). */
  showToast(text: string, sec?: number, gold?: boolean): void;
  /** Gate sign as rendered: text and open colour (M2-02 e2e). */
  gateSign(index: number): { text: string; open: boolean };
  showAd(kind: 'interstitial' | 'rewarded'): Promise<{ shown?: boolean; rewarded?: boolean; error?: string }>;
  /** Avalanche visual and its per-frame presentation (M2-06). */
  readonly avalanche: AvalancheVisual | null;
  readonly waveView: WaveView | null;
  /** Starts the next avalanche now (debug «Avalanche now», __TEST__.triggerWave). */
  triggerWave(): void;
  /** e2e bot: world points [x, z] the hero walks to one after another (overrides the input), a third number — the reach
   * of that point (0.6 by default); null — off. */
  botPath: Array<[number, number, number?]> | null;
  /** Called after every simulation tick (e2e monitors). */
  onTick: ((dt: number) => void) | null;
  /** Called after every rendered frame, once the camera has moved (e2e camera monitor). */
  onFrame: (() => void) | null;
  /** Shoes and pets (M2-08) and the teaching layer: hints, arrows, egg (M2-08). */
  readonly meta: MetaView | null;
  readonly ftue: FtueView | null;
  /** «Wrong way» arrow (docs/01-gdd.md 16.7). */
  readonly way: WayView | null;
  /** Trampolines, slides, path gifts and the gate reward as seen and heard (docs/01-gdd.md 16.4, 16.5). */
  readonly fun: FunView | null;
  /** Meshes of the mountain: gate signs and the cave back walls as drawn (e2e of PR-07, PR-08). */
  readonly levelMeshes: LevelMeshes | null;
  /** Eggs, pets and the «Pets» window (M3-03); the window frame (docs/01-gdd.md 10.2). */
  readonly pets: PetsView | null;
  readonly windows: WindowFrame | null;
  /** Sound (M2-13: minimal, ZzFX by the first gesture). */
  readonly audio: GameAudio | null;
  /** Bots on screen and their name labels (M2-10). */
  readonly botsView: BotsView | null;
  /** HUD mode (docs/04-packaging.md 11.2): `shots` and `promo` hide the bot names (the rest of the modes — M5/M6). */
  readonly hudMode: HudMode;
  /** The calendar (M3-08). */
  readonly daily: DailyView | null;
  /** Quests, time rewards and the wheel (M3-08b). */
  readonly quests: QuestsView | null;
  setHudMode(mode: HudMode): void;
}

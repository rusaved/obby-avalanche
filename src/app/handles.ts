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
  gpuLoad: number;
  framesPresented: number;
  framesRendered: number;
  applyTuning(): void;
  setAutoRun(on: boolean): void;
  setQualitySetting(level: QualityLevel | 'auto'): void;
  toggleMenu(open?: boolean): void;
  teleport(x: number, y: number, z: number): void;
  renderOnce(): void;
  /** Eight characters in a row with the eight faces, camera on them (faces.png evidence). */
  showFaces(): void;
  /** Gate sign as rendered: text and open colour (M2-02 e2e). */
  gateSign(index: number): { text: string; open: boolean };
  showAd(kind: 'interstitial' | 'rewarded'): Promise<{ shown?: boolean; rewarded?: boolean; error?: string }>;
}

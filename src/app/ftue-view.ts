/**
 * Teaching in the world (docs/01-gdd.md 6.1, 6.2, 6.5): hint plaques above the hero (one at a time), white arrows
 * on the snow to the cave entrance on the warning, the free egg «Mountain Gift» with a hand over it, the pet that
 * jumps out of it. Reads the simulation, never changes it; the hints controller lives in meta/hints.ts.
 */
import { Vector3 } from 'three';
import type { BalanceJson, PetsJson } from '../content/types.ts';
import type { SaveData } from '../meta/save.ts';
import type { Sim } from '../sim/world.ts';
import type { Hud } from '../ui/hud.ts';
import type { CameraRig } from '../render/camera.ts';
import type { FtueVisual } from '../render/ftue.ts';
import { createHints, type HintFrame, type HintId, type Hints } from '../meta/hints.ts';
import { entranceX } from '../sim/shelter.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';
import { t } from '../ui/i18n.ts';

/** A hero slower than this stands (units/s). */
const MOVING_SPEED = 1.5;
/** The plaque floats this share of the field height above the head (docs/01-gdd.md 6.5: 15%). */
const PLAQUE_ABOVE = 0.15;
/** The hand floats this high above the egg (units). */
const HAND_ABOVE = 2.4;

export interface FtueViewDeps {
  balance: BalanceJson;
  pets: PetsJson;
  save: SaveData;
  getSim(): Sim;
  hud: Hud;
  camera: CameraRig;
  visual: FtueVisual;
  field(): { width: number; height: number };
  touch(): boolean;
  shoes(): { shown: boolean; level: number };
}

export interface FtueView {
  /** Subscribes to a new simulation (start and every portal). */
  wire(sim: Sim): void;
  update(frameDt: number, timeSec: number, heroRender: Vector3): void;
  /** The pet jumped out of the egg at `from` (or is already with the player at the start: no `from`). */
  showPet(pet: string, from?: Vector3): void;
  readonly hint: HintId | null;
  readonly hints: Hints;
  readonly arrows: boolean;
  readonly hand: boolean;
}

export function createFtueView(d: FtueViewDeps): FtueView {
  const hints = createHints(d.balance.hints, (d.save.hints ??= {}));
  const p = new Vector3();
  const from = new Vector3();
  const to = new Vector3();
  let jumped = false;
  let caughtNow = false;
  let waveId = 0;
  let ledge: { x: number; y: number; z: number; index: number } | null = null;
  const scriptedCave = d.balance.ftue.scriptedWaveWall - 1;

  const project = (x: number, y: number, z: number): { x: number; y: number } | null => {
    p.set(x, y, z).project(d.camera.camera);
    if (p.z > 1) return null;
    const f = d.field();
    return { x: (p.x * 0.5 + 0.5) * f.width, y: (0.5 - p.y * 0.5) * f.height };
  };

  const view: FtueView & { hint: HintId | null; arrows: boolean; hand: boolean } = {
    hint: null,
    arrows: false,
    hand: false,
    hints,
    wire(sim) {
      sim.events.on('jump', () => void (jumped = true));
      sim.events.on('waveCaught', () => void (caughtNow = true));
      sim.events.on('waveWarn', ({ tick }) => void (waveId = tick + 1));
      // The first ledge with a gift on this mountain (docs/01-gdd.md 6.2, 12–20 s): a gift above its floor.
      const i = sim.gifts.findIndex((g) => g.y > sim.level.floorYAt(g.z) + 1);
      const g = sim.gifts[i];
      ledge = g ? { x: g.x, y: g.y, z: g.z, index: i } : null;
    },
    showPet(pet, at) {
      const def = d.pets.pets.find((x) => x.id === pet);
      d.visual.setPet(def ? { color: def.color, accent: def.accent } : null, at);
    },
    update(frameDt, timeSec, heroRender) {
      const sim = d.getSim();
      const hero = sim.hero;
      const ts = sim.threat?.state;
      const inShelter = sim.inShelter();
      const firstWaveDone = d.save.flags?.['firstWaveDone'] ?? false;
      const shoes = d.shoes();
      // Wave hint: the scripted wave and the first normal ones (wave.cave counts the shows, docs/01-gdd.md 6.5).
      const warn = ts?.phase === 'warn';
      const active = ts !== undefined && (warn || (ts.phase === 'run' && ts.outcome === 'none'));
      // Closed gate ahead within stuckDist (docs/01-gdd.md 6.5, hint.stuck).
      let nearClosedGate = false;
      sim.level.gates.forEach((g, i) => {
        const dz = g.z - hero.pos.z;
        if (!sim.gatesOpen[i] && dz > 0 && dz < d.balance.hints.stuckDist) nearClosedGate = true;
      });
      const summitZone = sim.level.safeZones[sim.level.safeZones.length - 1];
      const onSummit = sim.level.safeZones.length > 1 && summitZone !== undefined && hero.pos.z >= summitZone[0];
      const portal = sim.level.points.find((x) => x.type === 'portal');
      const towardsPortal = portal !== undefined && hero.vel.x * (portal.x - hero.pos.x) + hero.vel.z * (portal.z - hero.pos.z) > 0 && hero.speed > MOVING_SPEED;
      const nearLedge =
        ledge !== null && !(sim.gifts[ledge.index]?.taken ?? true) && Math.hypot(hero.pos.x - ledge.x, hero.pos.z - ledge.z) < d.balance.hints.jumpNearDist && hero.pos.y < ledge.y - 0.5;
      const frame: HintFrame = {
        playSec: d.save.totalPlaySec ?? 0,
        moving: hero.speed > MOVING_SPEED || sim.onBelt,
        jumped,
        touch: d.touch(),
        nearLedge,
        shoesOffered: shoes.shown && shoes.level === 0,
        shoesBought: shoes.level > 0,
        waveWarnId: warn ? waveId : 0,
        waveActive: active,
        goldOnGround: sim.bonus !== null && !sim.bonus.carried,
        goldCarried: sim.bonus?.carried ?? false,
        inShelter,
        caughtNow,
        treadmillCave: firstWaveDone && sim.level.worldIndex === 1 && sim.shelterIndex() === scriptedCave,
        onBelt: sim.onBelt,
        nearClosedGate: nearClosedGate && !inShelter,
        onSummit,
        towardsPortal,
      };
      jumped = false;
      caughtNow = false;
      const id = hints.update(frame, frameDt);
      view.hint = id;

      // The plaque: above the head by 15% of the field height.
      const head = id ? project(heroRender.x, heroRender.y + HERO_HEIGHT, heroRender.z) : null;
      if (id && head) {
        const f = d.field();
        const pict = id === 'hint.move' ? (d.touch() ? 'stick' : 'keys') : null;
        d.hud.setHint({ text: t(id), pict, x: head.x, y: head.y - PLAQUE_ABOVE * f.height });
      } else d.hud.setHint(null);

      // Arrows on the snow from the hero to the cave entrance, together with «To the cave!».
      const cave = ts ? sim.level.niches[ts.shelter] : undefined;
      if (id === 'wave.cave' && cave) {
        from.set(hero.pos.x, hero.pos.y, hero.pos.z);
        to.set(entranceX(sim.level, cave), cave.y, Math.min(cave.box.max[2] - 1, Math.max(cave.box.min[2] + 1, hero.pos.z)));
        d.visual.setArrows({ from, to, floorY: (z) => sim.level.floorYAt(z) });
      } else d.visual.setArrows(null);
      view.arrows = d.visual.arrowsShown;

      // The free egg and the hand over it (hint.egg: near the egg, until the touch).
      const egg = sim.giftEgg;
      d.visual.setEgg(egg, timeSec);
      const handAt = egg && egg.phase === 'idle' && sim.shelterIndex() === egg.niche ? project(egg.x, egg.y + HAND_ABOVE, egg.z) : null;
      d.hud.setHand(handAt);
      view.hand = handAt !== null;
      d.visual.updatePet(heroRender, hero.yaw, hero.speed > MOVING_SPEED || sim.onBelt, frameDt, timeSec);
    },
  };
  return view;
}

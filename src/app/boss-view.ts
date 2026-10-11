// What: How the giant looks: the blocky giant of the hero's parts walking his zone, his flat silhouette on the horizon, the start line and the advice sign.
// Called by: main.ts (createBossView, wire on each new mountain, update every frame); app/handles.ts (BossView type).
// Keep: Reads the sim, never changes it; colours, height and face from theme.json boss, texts via t(); the silhouette is one draw call and never fogged out.

/**
 * The giant (docs/01-gdd.md 17.6; docs/01a-content.md 16.4): seen from the foot of the mountain always — far away as a
 * flat silhouette of the same blocky shape in the fog colour (kept within the far plane at the same angular size),
 * nearer as the blocky giant of the hero's parts in the colours of theme.json boss. The start of his zone: a line
 * across the snow and the sign «Giant: Speed ~4.1K» (the advice of the tier). Walks — run pose, turns — stands,
 * passed — sits with hands up (the «win» pose).
 */
import { BoxGeometry, CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type PerspectiveCamera, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemeJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { CharacterInstance, Characters } from '../render/characters.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';

/** At most this many giants on a mountain are drawn (data may have more; docs/01a-content.md 16.4). */
const MAX_GIANTS = 2;
/** The silhouette takes over past this share of the far plane, and stands at this share of it. */
const SILHOUETTE_FROM = 0.6;
const SILHOUETTE_AT = 0.9;
/** The silhouette is never smaller than this angle of view (a 20-unit giant 800 units away would be a speck). */
const SILHOUETTE_MIN_RAD = (6 * Math.PI) / 180;
const SIGN_SIZE: [number, number] = [18, 3.6];
const SIGN_HEIGHT = 6;
const LINE_THICK = 0.6;

export interface BossViewDeps {
  theme: ThemeJson;
  characters: Characters;
  scene: Scene;
  camera: () => PerspectiveCamera | null;
  numSuffix(k: string): string;
  /** Any skin of the pack: the giant is painted over it. */
  skinId: string;
}

export interface BossView {
  /** A new mountain: places the line and the sign of its first zone. */
  wire(sim: Sim): void;
  update(sim: Sim): void;
  /** The silhouette is drawn now (tests). */
  readonly silhouetteShown: boolean;
  /** World point of the silhouette's chest as drawn now, null when hidden (tests: its pixel on the screen). */
  silhouetteChest(): [number, number, number] | null;
}

/** A blocky figure of 5 units as flat rectangles: legs, torso, arms, head (src/render/characters.ts proportions). */
function silhouetteGeometry(height: number): PlaneGeometry | ReturnType<typeof mergeGeometries> {
  const k = height / HERO_HEIGHT;
  const rect = (w: number, h: number, x: number, y: number): PlaneGeometry => new PlaneGeometry(w * k, h * k).translate(x * k, y * k, 0) as PlaneGeometry;
  const parts = [rect(0.9, 1.9, -0.5, 0.95), rect(0.9, 1.9, 0.5, 0.95), rect(1.9, 1.9, 0, 2.85), rect(0.85, 1.8, -1.45, 2.9), rect(0.85, 1.8, 1.45, 2.9), rect(1.1, 1.1, 0, 4.4)];
  const geo = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return geo;
}

export function createBossView(d: BossViewDeps): BossView {
  const look = d.theme.boss;
  const giants: CharacterInstance[] = [];
  const silGeo = silhouetteGeometry(look?.height ?? 20);
  const silMat = new MeshBasicMaterial({ color: look?.silhouette ?? '#ffffff', fog: false, transparent: true, opacity: 0.9, depthWrite: false });
  const silhouette = new Mesh(silGeo, silMat);
  silhouette.frustumCulled = false;
  silhouette.visible = false;
  const lineGeo = new BoxGeometry(1, LINE_THICK, LINE_THICK);
  const line = new Mesh(lineGeo, new MeshBasicMaterial({ color: look?.colors.hat ?? '#ffffff' }));
  line.visible = false;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 102;
  const signTex = new CanvasTexture(canvas);
  const sign = new Mesh(new PlaneGeometry(...SIGN_SIZE), new MeshBasicMaterial({ map: signTex, transparent: true }));
  sign.rotation.y = Math.PI;
  sign.visible = false;
  d.scene.add(silhouette, line, sign);
  let signText = '';
  let shown = false;
  const _to = new Vector3();

  const drawSign = (text: string): void => {
    if (text === signText) return;
    signText = text;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = 'rgba(27, 42, 58, 0.85)';
    c.beginPath();
    c.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 18);
    c.fill();
    c.fillStyle = '#ffffff';
    c.font = '800 46px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, canvas.width / 2, canvas.height / 2 + 2, canvas.width - 24);
    signTex.needsUpdate = true;
  };

  return {
    get silhouetteShown() {
      return shown;
    },
    silhouetteChest() {
      if (!shown) return null;
      const h = (look?.height ?? 0) * silhouette.scale.y * 0.55;
      return [silhouette.position.x, silhouette.position.y + h, silhouette.position.z];
    },
    wire(sim) {
      const zone = sim.level.bosses[0]?.zone;
      line.visible = sign.visible = zone !== undefined && !!look;
      if (!zone) return;
      const y = sim.level.floorAt(0, zone[0]);
      line.position.set(0, y + LINE_THICK / 2, zone[0]);
      line.scale.set(sim.level.width, 1, 1);
      sign.position.set(0, y + SIGN_HEIGHT, zone[0] - 1);
    },
    update(sim) {
      const zones = sim.boss?.zones ?? [];
      const all = zones.flatMap((z) => z.giants);
      while (look && giants.length < Math.min(MAX_GIANTS, all.length)) {
        const g = d.characters.create(d.skinId);
        d.characters.paint(g, { head: look.colors.head, torso: look.colors.torso, arms: look.colors.arms, legs: look.colors.legs, hat: null, hatColor: look.colors.hat, face: look.face });
        g.scale = look.height / HERO_HEIGHT;
        giants.push(g);
      }
      giants.forEach((ch, i) => {
        const g = all[i];
        ch.visible = !!g;
        if (!g) return;
        ch.position.set(0, sim.level.floorAt(0, g.z), g.z);
        ch.yaw = g.dir > 0 ? 0 : Math.PI;
        ch.pose = g.mode === 'sit' ? 'win' : g.mode === 'turn' ? 'idle' : 'run';
        ch.speedFactor = g.mode === 'chase' ? 1 : 0.6;
      });
      const bossGate = sim.level.gates.findIndex((g) => g.kind === 'boss');
      if (bossGate >= 0) drawSign(t('boss.sign', { n: formatNumber(sim.gateRequirement(bossGate), d.numSuffix) }));
      // The silhouette: far away the giant is the flat shape facing the camera, inside the far plane at his angular size.
      const cam = d.camera();
      const g0 = all[0];
      shown = false;
      if (cam && g0 && look) {
        _to.set(0, sim.level.floorAt(0, g0.z), g0.z);
        const dist = _to.distanceTo(cam.position);
        shown = dist > cam.far * SILHOUETTE_FROM;
        if (shown) {
          const at = Math.min(dist, cam.far * SILHOUETTE_AT);
          silhouette.position.copy(cam.position).addScaledVector(_to.sub(cam.position).normalize(), at);
          const height = look.height;
          silhouette.scale.setScalar(Math.max(at / dist, (Math.tan(SILHOUETTE_MIN_RAD) * at) / height));
          silhouette.lookAt(cam.position);
        }
      }
      silhouette.visible = shown;
    },
  };
}

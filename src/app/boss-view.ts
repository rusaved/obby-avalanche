// What: How the giant looks: the blocky giant of the hero's parts walking his zone, his helpers with their snowballs, his flat silhouette on the horizon, the start line and the advice sign.
// Called by: main.ts (createBossView, wire on each new mountain, update every frame); app/handles.ts (BossView type).
// Keep: Reads the sim, never changes it; colours, height and face from theme.json boss, texts via t(); the silhouette is one draw call and never fogged out.

/**
 * The giant (docs/01-gdd.md 17.6; docs/01a-content.md 16.4): seen from the foot of the mountain always — far away as a
 * flat silhouette of the same blocky shape in the fog colour (kept within the far plane at the same angular size),
 * nearer as the blocky giant of the hero's parts in the colours of theme.json boss. The start of his zone: a line
 * across the snow and the sign «Giant: Speed ~4.1K» (the advice of the tier). Walks — run pose, turns — stands,
 * passed — sits with hands up (the «win» pose); a zone of every run (SD-12, `rearm`) never sits — he walks back.
 */
import { BoxGeometry, CanvasTexture, Color, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Vector3, type PerspectiveCamera, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemeJson } from '../content/types.ts';
import type { Sim } from '../sim/world.ts';
import type { CharacterInstance, Characters } from '../render/characters.ts';
import { HERO_HEIGHT } from '../sim/controller.ts';
import { formatNumber } from '../ui/format.ts';
import { t } from '../ui/i18n.ts';
import { segmentMeetsBox } from './banner-signs.ts';

/** At most this many giants on a mountain are drawn (data may have more; docs/01a-content.md 16.4). */
const MAX_GIANTS = 2;
/** Helpers of the giant (docs/01-gdd.md 18.5): at most this many drawn, their snowballs this big and this high an arc. */
const MAX_HELPERS = 4;
const SNOWBALL = 0.55;
const BALL_RISE = 4;
/** The silhouette takes over past this share of the far plane, and stands at this share of it. */
const SILHOUETTE_FROM = 0.6;
const SILHOUETTE_AT = 0.9;
/** The silhouette is never smaller than this angle of view (a 20-unit giant 800 units away would be a speck). */
const SILHOUETTE_MIN_RAD = (6 * Math.PI) / 180;
const SIGN_SIZE: [number, number] = [18, 3.6];
const SIGN_HEIGHT = 6;
/** Top of the advice sign over the floor at the zone's line and its half width (birds sit on it, render/decor.ts). */
export const BOSS_SIGN_TOP = SIGN_HEIGHT + SIGN_SIZE[1] / 2;
export const BOSS_SIGN_HALF = SIGN_SIZE[0] / 2;
const LINE_THICK = 0.6;

export interface BossViewDeps {
  theme: ThemeJson;
  characters: Characters;
  scene: Scene;
  camera: () => PerspectiveCamera | null;
  numSuffix(k: string): string;
  /** Any skin of the pack: the giant is painted over it. */
  skinId: string;
  /** A giant between the camera and the hero is drawn see-through at this share (tuning camera.fadeAlpha, a ?debug=1 slider; 1 — never). */
  fadeAlpha: () => number;
}

export interface BossView {
  /** A new mountain: places the line and the sign of its first zone. */
  wire(sim: Sim): void;
  update(sim: Sim): void;
  /** The silhouette is drawn now (tests); how many of them (two giants). */
  readonly silhouetteShown: boolean;
  readonly silhouettesShown: number;
  /** World point of the silhouette's chest as drawn now, null when hidden (tests: its pixel on the screen). */
  silhouetteChest(): [number, number, number] | null;
  /** The giants as drawn: their boxes (centre, size) and whether one is faded now (tests, FM-03). */
  giantBoxes(): Array<{ center: [number, number, number]; size: [number, number, number]; faded: boolean }>;
}

/** The blocky figure across its arms and its depth at the hero's size (src/render/characters.ts PART). */
const GIANT_WIDTH = 3.8;
const GIANT_DEPTH = 1.2;

/** Heights over the hero's feet the camera must see (chest, head) and the pad of the giant's box for that line. */
const SIGHT = [1.5, 4.4];
const SIGHT_PAD = 0.3;
const _eye = new Vector3();

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
  const giantBox = (ch: CharacterInstance): { center: [number, number, number]; size: [number, number, number] } => {
    const h = look?.height ?? 0;
    const k = h / HERO_HEIGHT;
    return { center: [ch.position.x, ch.position.y + h / 2, ch.position.z], size: [GIANT_WIDTH * k, h, GIANT_DEPTH * k] };
  };
  const helpers: CharacterInstance[] = [];
  // The snowballs in the air: one instanced mesh, a draw call only while one flies (docs/01-gdd.md 18.9).
  const balls = new InstancedMesh(new IcosahedronGeometry(SNOWBALL, 1), new MeshLambertMaterial({ color: new Color(look?.helper?.snowball ?? '#ffffff') }), MAX_HELPERS);
  balls.frustumCulled = false;
  balls.count = 0;
  const _m = new Matrix4();
  d.scene.add(balls);
  const silGeo = silhouetteGeometry(look?.height ?? 20);
  const silMat = new MeshBasicMaterial({ color: look?.silhouette ?? '#ffffff', fog: false, transparent: true, opacity: 0.9, depthWrite: false });
  // One silhouette a giant (two giants of mountains 9–10, docs/01-gdd.md 18.5): one draw call each while far.
  const silhouettes = Array.from({ length: MAX_GIANTS }, () => {
    const m = new Mesh(silGeo, silMat);
    m.frustumCulled = false;
    m.visible = false;
    return m;
  });
  const silhouette = silhouettes[0]!;
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
  d.scene.add(...silhouettes, line, sign);
  let signText = '';
  let shown = false;
  let shownCount = 0;
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
    get silhouettesShown() {
      return shownCount;
    },
    giantBoxes() {
      return giants.filter((ch) => ch.visible).map((ch) => ({ ...giantBox(ch), faded: ch.fade < 1 }));
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
      const camNow = d.camera();
      giants.forEach((ch, i) => {
        const g = all[i];
        ch.visible = !!g;
        if (!g) return;
        ch.position.set(g.x, sim.level.floorAt(g.x, g.z), g.z);
        // Between the camera and the hero (his chest or head) — see-through until it no longer is (docs/01-gdd.md 19.8).
        const box = giantBox(ch);
        const hero = sim.hero.pos;
        ch.fade =
          camNow && SIGHT.some((h) => segmentMeetsBox(camNow.position, _eye.set(hero.x, hero.y + h, hero.z), box.center, box.size, SIGHT_PAD)) ? d.fadeAlpha() : 1;
        ch.yaw = g.face;
        ch.pose = g.mode === 'sit' ? 'win' : g.mode === 'turn' ? 'idle' : 'run';
        ch.speedFactor = g.mode === 'chase' ? 1 : 0.6;
      });
      // Helpers on the borders: a third of the giant, facing the track; they wave when the zone is passed or the hero caught.
      const hs = zones.flatMap((z) => z.helpers);
      while (look?.helper && helpers.length < Math.min(MAX_HELPERS, hs.length)) {
        const h = d.characters.create(d.skinId);
        d.characters.paint(h, { head: look.colors.head, torso: look.colors.torso, arms: look.colors.arms, legs: look.colors.legs, hat: null, hatColor: look.colors.hat, face: look.face });
        h.scale = look.helper.height / HERO_HEIGHT;
        helpers.push(h);
      }
      let flying = 0;
      helpers.forEach((ch, i) => {
        const h = hs[i];
        ch.visible = !!h;
        if (!h) return;
        ch.position.set(h.x, sim.level.floorYAt(h.z), h.z);
        ch.yaw = h.x < 0 ? Math.PI / 2 : -Math.PI / 2;
        ch.pose = h.wave ? 'win' : 'idle';
        const b = h.ball;
        if (!b || flying >= MAX_HELPERS) return;
        const k = Math.min(1, b.t / b.flight);
        _to.set(b.from[0] + (b.to[0] - b.from[0]) * k, b.from[1] + (b.to[1] - b.from[1]) * k + 4 * BALL_RISE * k * (1 - k), b.from[2] + (b.to[2] - b.from[2]) * k);
        balls.setMatrixAt(flying++, _m.makeTranslation(_to.x, _to.y, _to.z));
      });
      balls.count = flying;
      balls.visible = flying > 0;
      if (flying > 0) balls.instanceMatrix.needsUpdate = true;
      const bossGate = sim.level.gates.findIndex((g) => g.kind === 'boss');
      // Two giants: «Two giants: Speed ~N» (docs/01a-content.md 17.6).
      const key = (zones[0]?.giants.length ?? 0) >= 2 ? 'boss.signPair' : 'boss.sign';
      if (bossGate >= 0) drawSign(t(key, { n: formatNumber(sim.gateRequirement(bossGate), d.numSuffix) }));
      // The silhouettes: far away a giant is the flat shape facing the camera, inside the far plane at his angular size.
      const cam = d.camera();
      shownCount = 0;
      silhouettes.forEach((sil, i) => {
        const g = all[i];
        let on = false;
        if (cam && g && look) {
          _to.set(g.x, sim.level.floorAt(g.x, g.z), g.z);
          const dist = _to.distanceTo(cam.position);
          on = dist > cam.far * SILHOUETTE_FROM;
          if (on) {
            const at = Math.min(dist, cam.far * SILHOUETTE_AT);
            sil.position.copy(cam.position).addScaledVector(_to.sub(cam.position).normalize(), at);
            sil.scale.setScalar(Math.max(at / dist, (Math.tan(SILHOUETTE_MIN_RAD) * at) / look.height));
            sil.lookAt(cam.position);
          }
        }
        sil.visible = on;
        if (on) shownCount++;
      });
      shown = silhouette.visible;
    },
  };
}

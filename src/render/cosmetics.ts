/**
 * Trail and aura on the hero (docs/01-gdd.md 7.3): the trail is a ribbon of small cubes of its colour left at the
 * feet while he runs, shrinking away; the aura is a ring of glowing bits circling the body. Colours from trails.json
 * and auras.json. Instanced: one draw call each, none when nothing is on.
 */
import { BoxGeometry, Color, Group, InstancedMesh, MeshBasicMaterial, Object3D, OctahedronGeometry, Vector3 } from 'three';

const TRAIL_MAX = 28;
/** A new trail bit every this many seconds of running; each lives TRAIL_LIFE seconds. */
const TRAIL_EVERY = 0.035;
const TRAIL_LIFE = 0.9;
const TRAIL_SIZE = 0.38;
const AURA_BITS = 10;
const AURA_RADIUS = 1.35;
const AURA_SPIN = 1.6;
/** Body height the aura circles around (units above the feet). */
const AURA_BAND: [number, number] = [0.6, 3.6];

export interface CosmeticsVisual {
  group: Group;
  /** Colour of the trail and of the aura on; null — none. */
  set(trail: string | null, aura: string | null): void;
  update(hero: Vector3, running: boolean, dt: number, timeSec: number): void;
  readonly trailOn: boolean;
  readonly auraOn: boolean;
  dispose(): void;
}

export function createCosmeticsVisual(): CosmeticsVisual {
  const group = new Group();
  group.name = 'cosmetics';
  const trailGeo = new BoxGeometry(TRAIL_SIZE, TRAIL_SIZE, TRAIL_SIZE);
  const trailMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
  const trail = new InstancedMesh(trailGeo, trailMat, TRAIL_MAX);
  const auraGeo = new OctahedronGeometry(0.28, 0);
  const auraMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
  const aura = new InstancedMesh(auraGeo, auraMat, AURA_BITS);
  for (const m of [trail, aura]) {
    m.count = 0;
    m.frustumCulled = false;
    m.visible = false;
    group.add(m);
  }
  const bits = Array.from({ length: TRAIL_MAX }, () => ({ x: 0, y: 0, z: 0, age: TRAIL_LIFE }));
  let next = 0;
  let since = 0;
  const dummy = new Object3D();
  const color = new Color();

  const visual: CosmeticsVisual & { trailOn: boolean; auraOn: boolean } = {
    group,
    trailOn: false,
    auraOn: false,
    set(trailColor, auraColor) {
      visual.trailOn = trailColor !== null;
      visual.auraOn = auraColor !== null;
      trail.visible = visual.trailOn;
      aura.visible = visual.auraOn;
      if (trailColor) trailMat.color.copy(color.set(trailColor));
      if (auraColor) auraMat.color.copy(color.set(auraColor));
      aura.count = visual.auraOn ? AURA_BITS : 0;
      if (!visual.trailOn) for (const b of bits) b.age = TRAIL_LIFE;
    },
    update(hero, running, dt, timeSec) {
      if (visual.trailOn) {
        since += dt;
        if (running && since >= TRAIL_EVERY) {
          since = 0;
          const b = bits[next]!;
          next = (next + 1) % TRAIL_MAX;
          b.x = hero.x + Math.sin(timeSec * 13) * 0.25;
          b.y = hero.y + 0.3;
          b.z = hero.z;
          b.age = 0;
        }
        let n = 0;
        for (const b of bits) {
          b.age += dt;
          if (b.age >= TRAIL_LIFE) continue;
          const k = 1 - b.age / TRAIL_LIFE;
          dummy.position.set(b.x, b.y + (1 - k) * 0.4, b.z);
          dummy.rotation.set(b.age * 3, b.age * 4, 0);
          dummy.scale.setScalar(k);
          dummy.updateMatrix();
          trail.setMatrixAt(n++, dummy.matrix);
        }
        trail.count = n;
        trail.instanceMatrix.needsUpdate = true;
      }
      if (visual.auraOn) {
        for (let i = 0; i < AURA_BITS; i++) {
          const a = timeSec * AURA_SPIN + (i / AURA_BITS) * Math.PI * 2;
          const h = AURA_BAND[0] + ((i * 0.37 + timeSec * 0.25) % 1) * (AURA_BAND[1] - AURA_BAND[0]);
          dummy.position.set(hero.x + Math.cos(a) * AURA_RADIUS, hero.y + h, hero.z + Math.sin(a) * AURA_RADIUS);
          dummy.rotation.set(0, a * 2, 0);
          dummy.scale.setScalar(0.7 + 0.3 * Math.sin(timeSec * 5 + i));
          dummy.updateMatrix();
          aura.setMatrixAt(i, dummy.matrix);
        }
        aura.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      trailGeo.dispose();
      trailMat.dispose();
      auraGeo.dispose();
      auraMat.dispose();
    },
  };
  return visual;
}

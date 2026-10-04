/**
 * The golden gift (docs/01-gdd.md 4.9): the gift box 1.5 times bigger in theme.json bonus.color, sparks around it and
 * a pillar of light up to the sky while it lies on the slope (seen from the cave); over the hero's head while he
 * carries it; a short golden puff when it pops. Three draw calls, hidden when there is no gift. Reads the sim only.
 */
import { AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Points, PointsMaterial, type Vector3 } from 'three';
import type { BonusState } from '../../sim/bonus.ts';
import { BONUS_HALF, BONUS_HEIGHT } from '../../sim/bonus.ts';
import { HERO_HEIGHT } from '../../sim/controller.ts';

/** Pillar of light: tall enough to be seen from the cave over the slope. */
const PILLAR_HEIGHT = 80;
const PILLAR_RADIUS = 0.9;
const PILLAR_OPACITY = 0.35;
const SPARKS = 24;
const SPARK_RADIUS = 2.2;
const SPARK_SIZE = 0.25;
/** Carried: the box rests on the raised hands, this far above the head. */
const CARRY_LIFT = 0.5;
/** Pop (gold_lost): the box swells and fades out over this many seconds. */
const POP_SEC = 0.5;

export interface BonusVisual {
  readonly group: Group;
  /** Every frame: the gift on the ground (with pillar and sparks), carried over `heroPos`, or popping where it was lost. */
  update(bonus: BonusState | null, heroPos: Vector3, timeSec: number): void;
  /** The hero was snowed in with the gift: a golden puff at the hero. */
  pop(at: { x: number; y: number; z: number }, timeSec: number): void;
  /** For __TEST__: the gift is drawn (on the ground or carried). */
  readonly shown: boolean;
}

export function createBonusVisual(color: string): BonusVisual {
  const gold = new Color(color);
  const group = new Group();
  group.name = 'bonus';
  const boxGeo = new BoxGeometry(BONUS_HALF * 2, BONUS_HEIGHT, BONUS_HALF * 2);
  boxGeo.translate(0, BONUS_HEIGHT / 2, 0);
  const boxMat = new MeshLambertMaterial({ color: gold, emissive: gold.clone().multiplyScalar(0.55), transparent: true });
  const box = new Mesh(boxGeo, boxMat);
  const pillarGeo = new CylinderGeometry(PILLAR_RADIUS, PILLAR_RADIUS, PILLAR_HEIGHT, 12, 1, true);
  pillarGeo.translate(0, PILLAR_HEIGHT / 2, 0);
  const pillar = new Mesh(pillarGeo, new MeshBasicMaterial({ color: gold, transparent: true, opacity: PILLAR_OPACITY, blending: AdditiveBlending, depthWrite: false, fog: false }));
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkGeo = new BufferGeometry();
  sparkGeo.setAttribute('position', new BufferAttribute(sparkPos, 3));
  const sparks = new Points(sparkGeo, new PointsMaterial({ color: gold, size: SPARK_SIZE, depthWrite: false }));
  sparks.frustumCulled = false;
  group.add(box, pillar, sparks);
  group.visible = false;
  let popAt: { x: number; y: number; z: number; t: number } | null = null;
  let shown = false;

  return {
    group,
    get shown() {
      return shown;
    },
    pop(at, timeSec) {
      popAt = { ...at, t: timeSec };
    },
    update(bonus, heroPos, timeSec) {
      shown = bonus !== null;
      if (!bonus && popAt) {
        // Golden puff: the box swells and fades where the hero was caught.
        const k = (timeSec - popAt.t) / POP_SEC;
        if (k >= 1) popAt = null;
        else {
          group.visible = true;
          pillar.visible = false;
          sparks.visible = false;
          box.position.set(popAt.x, popAt.y + HERO_HEIGHT + CARRY_LIFT, popAt.z);
          box.scale.setScalar(1 + k);
          boxMat.opacity = 1 - k;
          return;
        }
      }
      group.visible = bonus !== null;
      if (!bonus) return;
      popAt = null;
      box.scale.setScalar(1);
      boxMat.opacity = 1;
      const onGround = !bonus.carried;
      pillar.visible = onGround;
      sparks.visible = true;
      if (onGround) {
        box.position.set(bonus.x, bonus.y, bonus.z);
        box.rotation.y = timeSec * 0.8;
        pillar.position.set(bonus.x, bonus.y, bonus.z);
      } else {
        box.position.set(heroPos.x, heroPos.y + HERO_HEIGHT + CARRY_LIFT, heroPos.z);
        box.rotation.y = 0;
      }
      // Sparks circle the box and twinkle up and down.
      const c = box.position;
      for (let i = 0; i < SPARKS; i++) {
        const a = (i / SPARKS) * Math.PI * 2 + timeSec * 1.5;
        const r = SPARK_RADIUS * (0.7 + 0.3 * Math.sin(timeSec * 3 + i));
        sparkPos[i * 3] = c.x + Math.cos(a) * r;
        sparkPos[i * 3 + 1] = c.y + ((i * 0.37 + timeSec * 1.2) % 1) * BONUS_HEIGHT * 1.6;
        sparkPos[i * 3 + 2] = c.z + Math.sin(a) * r;
      }
      sparkGeo.attributes['position']!.needsUpdate = true;
    },
  };
}

// What: The record flag of the open slope: a pole with a cloth in the hero's colour at the highest point of this life on the mountain.
// Called by: main.ts (createRecordFlag, update every frame with the sim's record and the hero's z).
// Keep: One mesh, one draw call, hidden until the hero is RECORD_RETURN below it (sim/world.ts); colours come in as arguments.

/**
 * Record flag (docs/01-gdd.md 17.7): where the hero was highest on this mountain in this life. It stands only when he is
 * below it — sent down by «Snowed in!» or the giant — so the way back up to it is a familiar run to a mark; passing it
 * says «New height!» (the sim). Pole and cloth merged into one geometry with vertex colours.
 */
import { BoxGeometry, BufferAttribute, Color, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RECORD_RETURN } from '../sim/world.ts';

const POLE_HEIGHT = 5;
const CLOTH: [number, number, number] = [2.4, 1.4, 0.12];

export interface RecordFlag {
  mesh: Mesh;
  update(record: { x: number; y: number; z: number } | null, heroZ: number): void;
  dispose(): void;
}

function painted(geo: BoxGeometry, color: Color): BoxGeometry {
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute('color', new BufferAttribute(c, 3));
  return geo;
}

export function createRecordFlag(clothColor: string, poleColor: string): RecordFlag {
  const pole = painted(new BoxGeometry(0.25, POLE_HEIGHT, 0.25).translate(0, POLE_HEIGHT / 2, 0), new Color(poleColor));
  const cloth = painted(new BoxGeometry(...CLOTH).translate(CLOTH[0] / 2, POLE_HEIGHT - CLOTH[1] / 2, 0), new Color(clothColor));
  const geo = mergeGeometries([pole, cloth])!;
  pole.dispose();
  cloth.dispose();
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const mesh = new Mesh(geo, mat);
  mesh.visible = false;
  return {
    mesh,
    update(record, heroZ) {
      mesh.visible = record !== null && record.z - heroZ > RECORD_RETURN;
      if (record && mesh.visible) mesh.position.set(record.x, record.y, record.z);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

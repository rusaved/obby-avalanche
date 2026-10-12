import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createRecordFlag } from '../../src/render/record-flag.ts';
import { guardRecordFlag } from '../../src/app/banner-signs.ts';

// SP-01 (docs/01-gdd.md 20.2): the record flag is not drawn on the line camera → hero nor nearer than
// hideDistance × camera.flagHide to the camera; it is back as soon as that ends.
describe('SP-01: the record flag out of the way of the camera', () => {
  const flag = createRecordFlag('#ff3399', '#6b4a2b');
  const camera = new PerspectiveCamera();
  const hero = new Vector3(0, 0, 100);
  const place = (cam: [number, number, number], record: [number, number, number], near: number): boolean => {
    camera.position.set(...cam);
    flag.update({ x: record[0], y: record[1], z: record[2] }, hero.z);
    guardRecordFlag(flag, camera, hero, near);
    return flag.mesh.visible;
  };

  it('on the line camera → hero: hidden; beside it: drawn', () => {
    expect(place([0, 3, 130], [0, 0, 125], 5)).toBe(false);
    expect(place([0, 3, 130], [12, 0, 125], 5)).toBe(true);
  });

  it('nearer than the distance to the camera: hidden even off the line; flagHide 0 — always drawn', () => {
    expect(place([6, 3, 128], [3, 0, 126], 5)).toBe(false);
    expect(place([0, 3, 130], [0, 0, 125], 0)).toBe(true);
  });

  it('below RECORD_RETURN under the flag it is not drawn at all (as before SP)', () => {
    expect(place([0, 3, 130], [12, 0, 110], 5)).toBe(false);
  });
});

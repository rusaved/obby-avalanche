/** Blob shadow under a character (docs/02-tech.md 7): always on, placed by a ray down against the Octree. */
import { CircleGeometry, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three';
import type { CollisionWorld } from '../sim/collision.ts';

export interface BlobShadow {
  mesh: Mesh;
  update(feet: Vector3, collision: CollisionWorld): void;
  dispose(): void;
}

const _ray = new Ray(new Vector3(), new Vector3(0, -1, 0));

export function createBlobShadow(): BlobShadow {
  const geo = new CircleGeometry(1, 20);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 1;
  return {
    mesh,
    update(feet, collision) {
      _ray.origin.set(feet.x, feet.y + 0.5, feet.z);
      const hit = collision.static.rayIntersect(_ray);
      if (hit && hit.distance < 40) {
        const height = Math.max(0, hit.distance - 0.5);
        mesh.visible = true;
        mesh.position.set(feet.x, hit.position.y + 0.03, feet.z);
        const s = Math.max(0.35, 1.1 - height * 0.06);
        mesh.scale.set(s, 1, s);
        (mesh.material as MeshBasicMaterial).opacity = Math.max(0.08, 0.28 - height * 0.015);
      } else {
        mesh.visible = false;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

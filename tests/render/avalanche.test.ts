import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3, type Material } from 'three';
import { buildLevel } from '../../src/level/builder.ts';
import { createAvalancheVisual } from '../../src/render/threat/avalanche.ts';
import { createCameraRig } from '../../src/render/camera.ts';
import { createControlFrame } from '../../src/input/control-frame.ts';
import { QUALITY_LEVELS, qualityParams } from '../../src/render/quality.ts';
import tuning from '../../content/avalanche/tuning.json' with { type: 'json' };
import theme from '../../content/avalanche/theme.json' with { type: 'json' };
import worldsJson from '../../content/avalanche/worlds.json' with { type: 'json' };
import type { ThemeJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

const tun = tuning as TuningJson;
const worlds = worldsJson as unknown as WorldsJson;

// M2-06, docs/02-tech.md 8.3: the spawn point of the avalanche is visible on every mountain and every quality level.
describe('avalanche visual (docs/02-tech.md 8.3)', () => {
  it('spawn point within camera.far, materials without fog, never culled — every mountain, every quality level', () => {
    const camera = new PerspectiveCamera();
    const rig = createCameraRig(camera, createControlFrame((tun.camera.pitchDeg * Math.PI) / 180, tun.camera.distance), tun, () => 0.5);
    for (const world of worlds.worlds) {
      const level = buildLevel(world);
      const visual = createAvalancheVisual(level, theme as unknown as ThemeJson, tun, () => 0.5);
      expect(visual.parts.length, 'at most 4 draw calls').toBeLessThanOrEqual(4);
      for (const mobile of [false, true]) {
        for (const q of QUALITY_LEVELS) {
          const params = qualityParams(q, mobile);
          visual.setParticles(params.particles);
          // Hero in the middle of the mountain: the wave starts spawnAhead above him (from: aboveHero).
          const heroZ = world.length / 2;
          const hero = new Vector3(0, level.floorYAt(heroZ), heroZ);
          rig.snapTo({ pos: hero, vel: new Vector3(), speed: 0, maxSpeed: 16 });
          const spawnZ = heroZ + world.threat.spawnAhead;
          visual.update({ phase: 'warn', spawnZ, frontZ: spawnZ, shelter: 0 }, 1, camera.position);
          const at = `${world.id} ${mobile ? 'mobile' : 'desktop'} ${q}`;
          const spawn = new Vector3(0, level.floorYAt(spawnZ), spawnZ);
          expect(spawn.distanceTo(camera.position), at).toBeLessThan(camera.far);
          // The fog would hide it on low (far 160) and on mountain 4: that is why its materials ignore fog.
          for (const p of visual.parts) {
            expect((p.material as Material & { fog?: boolean }).fog, `${at} ${p.name}`).toBe(false);
            expect(p.frustumCulled, `${at} ${p.name}`).toBe(false);
            expect(p.parent, `${at} ${p.name}`).toBe(visual.group);
          }
          const crack = visual.parts.find((p) => p.name === 'avalanche-crack')!;
          const dust = visual.parts.find((p) => p.name === 'avalanche-dust')!;
          expect(crack.visible && dust.visible, at).toBe(true);
          expect(crack.position.z, at).toBe(spawnZ);
          expect(dust.geometry.drawRange.count, at).toBeGreaterThan(0);
        }
      }
      visual.dispose();
    }
  });

  it('run: front and body follow frontZ; the camera inside the body hides it (veil instead)', () => {
    const level = buildLevel(worlds.worlds[0]!);
    const visual = createAvalancheVisual(level, theme as unknown as ThemeJson, tun, () => 0.5);
    const far = new Vector3(0, 10, 0);
    visual.update({ phase: 'run', spawnZ: 600, frontZ: 500, shelter: -1 }, 1, far);
    const front = visual.parts.find((p) => p.name === 'avalanche-front')!;
    const body = visual.parts.find((p) => p.name === 'avalanche-body')!;
    expect(front.visible && body.visible).toBe(true);
    expect(front.position.z).toBe(500);
    const inside = new Vector3(0, level.floorYAt(520) + 3, 520);
    expect(visual.insideBody(inside)).toBe(true);
    visual.update({ phase: 'run', spawnZ: 600, frontZ: 500, shelter: -1 }, 1, inside);
    expect(body.visible).toBe(false);
    // A cave at the track edge is never inside the body.
    const cave = level.niches.find((n) => Math.abs(n.z - 520) < 200)!;
    expect(visual.insideBody(new Vector3(cave.box.min[0], cave.y + 3, 520))).toBe(false);
  });
});

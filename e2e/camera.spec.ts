import { test, expect, testState, waitTicks } from './fixtures.ts';
import worldsJson from '../content/avalanche/worlds.json' with { type: 'json' };

// Camera (docs/02-tech.md, section 7): wall avoidance, auto-turn only on viewYaw, FOV from speed.
test.describe('camera', () => {
  test('at three points near walls the camera is never inside the geometry', async ({ page, openGame }) => {
    await openGame();
    // Mountain 1 (worlds.json): gate 1 at z = 130, cave 1 at z = 103 on the left (x from −21 to −14), track y = 6 there.
    const gateZ = 130;
    const caveZ = 103;
    const points: Array<[number, number, string]> = [
      [0, gateZ - 1.6, 'under gate 1'],
      [-13, caveZ, 'at the left border next to cave 1'],
      [-18, caveZ, 'inside cave 1'],
    ];
    for (const [x, z, label] of points) {
      await page.evaluate(({ x, z }) => window.__TEST__!.teleport(z, x), { x, z });
      // Turn the camera around to press it into walls from several sides.
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await page.evaluate((y) => window.__TEST__!.setCamera({ yaw: y, pitch: 0.2, dist: 14 }), yaw);
        await waitTicks(page, 15);
        expect(await page.evaluate(() => window.__TEST__!.cameraInsideGeometry()), `${label} yaw ${yaw}`).toBe(false);
      }
      await page.evaluate(() => window.__TEST__!.setCamera('auto'));
    }
    await page.evaluate(() => window.__TEST__!.teleport(103, -18));
    await waitTicks(page, 24);
    await page.screenshot({ path: 'docs/evidence/M1/camera_wall_960x540_ru.png' });
  });

  // Off since 05.10 (PR-06, docs/01-gdd.md 16.7): tuning camera.autoTurn = true brings back the M1–M3 behaviour.
  test('with camera.autoTurn = true the auto-turn pulls the view towards +Z and changes only viewYaw', async ({ page, openGame }) => {
    await openGame('debug=1');
    await page.evaluate(() => window.__DEBUG__!.set('camera.autoTurn', true));
    await page.mouse.move(480, 270);
    await page.mouse.down();
    await page.mouse.move(300, 270, { steps: 12 });
    await page.mouse.up();
    await waitTicks(page, 6);
    const s0 = await testState(page);
    expect(Math.abs(s0.viewYaw)).toBeGreaterThan(0.4);
    const controlYaw = s0.controlYaw;
    expect(controlYaw).toBeCloseTo(s0.viewYaw, 6);
    await page.keyboard.down('KeyW');
    await waitTicks(page, 160);
    await page.keyboard.up('KeyW');
    const s1 = await testState(page);
    expect(Math.abs(s1.viewYaw)).toBeLessThan(Math.abs(s0.viewYaw) * 0.5);
    expect(s1.controlYaw).toBeCloseTo(controlYaw, 6);
  });

  test('FOV at full speed exceeds the resting FOV by fovSpeedAdd from tuning.json', async ({ page, openGame }) => {
    await openGame();
    const fovRest = (await testState(page)).cameraFov;
    await page.keyboard.down('KeyW');
    await waitTicks(page, 150);
    const fovRun = (await testState(page)).cameraFov;
    await page.keyboard.up('KeyW');
    expect(fovRun - fovRest).toBeGreaterThan(12);
    expect(fovRun - fovRest).toBeLessThan(16);
    await waitTicks(page, 12);
    await page.screenshot({ path: 'docs/evidence/M1/camera_run_960x540_ru.png' });
  });
});

// Playtest M2, item 2: the camera went into walls and caves. The bot walks mountain 1 like a player: into every cave
// and onto its belt (W held, camera turned by the mouse), out to the closed wall and into it with the camera turned
// round, into the lit cave on every avalanche; in no rendered frame the camera is inside a collider or loses the hero.
type WSeg = { type: string; z: number; side?: string; requires?: number };
test('walk of mountain 1 by botPath: the camera is never inside a collider and never loses the hero', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  const worlds = worldsJson as unknown as { worlds: Array<{ segments: WSeg[] }> };
  const segs = worlds.worlds[0]!.segments;
  const gates = segs.filter((s) => s.type === 'gate').sort((a, b) => a.z - b.z);
  const caves = segs.filter((s) => s.type === 'niche').sort((a, b) => a.z - b.z).map((s) => ({ z: s.z, side: s.side === 'right' ? 1 : -1 }));
  await openGame('seed=3');
  await page.evaluate(() => window.__TEST__!.setTimeScale(6));
  await page.evaluate(() => window.__TEST__!.resetCameraStats());
  const into = (i: number): Array<[number, number]> => [
    [caves[i]!.side * 12, caves[i]!.z - 2],
    [caves[i]!.side * 19.5, caves[i]!.z],
  ];
  const drag = async (px: number): Promise<void> => {
    await page.mouse.move(480, 300);
    await page.mouse.down();
    await page.mouse.move(480 + px, 280, { steps: 8 });
    await page.mouse.up();
  };
  let waves = 0;
  let shotTaken = false;
  /** Walks the points; on an avalanche runs into the lit cave and waits it out, then walks the points again. */
  const walk = async (points: Array<[number, number]>, sec = 25): Promise<void> => {
    const end = (await testState(page)).timeSec + sec;
    let plan: Array<[number, number]> | null = null;
    for (;;) {
      const s = await testState(page);
      if (s.timeSec > end || !s.hero) break;
      const w = s.wave;
      if (s.caught) {
        plan = null;
        continue;
      }
      const h = s.hero;
      const out: Array<[number, number]> = Math.abs(h.x) > 12.5 ? [[Math.sign(h.x) * 11, h.z]] : [];
      if (!shotTaken && w?.phase === 'run' && s.waveHud.shot && s.inShelter && w.frontZ - h.z < 25) {
        await page.screenshot({ path: 'docs/evidence/M3/camera_cave_wave_960x540_ru.png' });
        shotTaken = true;
      }
      if (w && (w.phase === 'warn' || w.phase === 'run') && w.outcome === 'none' && w.shelter >= 0) {
        if (plan !== null || (await page.evaluate(() => window.__TEST__!.botLeft())) === 0) {
          if (s.shelter !== w.shelter) await page.evaluate((p) => window.__TEST__!.botPath(p), [...(s.shelter >= 0 ? out : []), ...into(w.shelter)]);
          if (plan !== null) waves++;
          plan = null;
        }
        continue;
      }
      if (plan === null) {
        plan = [...out, ...points];
        await page.evaluate((p) => window.__TEST__!.botPath(p), plan);
        continue;
      }
      if ((await page.evaluate(() => window.__TEST__!.botLeft())) === 0) break;
    }
  };
  for (let i = 0; i < gates.length; i++) {
    // Into the cave below wall i, onto the belt; W held and the camera turned both ways.
    await walk(into(i));
    await page.keyboard.down('KeyW');
    await drag(-260);
    await waitTicks(page, 90);
    await drag(520);
    await waitTicks(page, 90);
    if (i === 0) await page.screenshot({ path: 'docs/evidence/M3/camera_cave_belt_960x540_ru.png' });
    await page.keyboard.up('KeyW');
    // Out to the closed wall, pressed into it, the camera turned to look from the front.
    const s = await testState(page);
    await walk([[caves[i]!.side * 11, caves[i]!.z], [0, caves[i]!.z + 4], [0, gates[i]!.z - 2]]);
    await page.evaluate((z) => window.__TEST__!.botPath([[0, z]]), gates[i]!.z);
    await drag(720);
    await waitTicks(page, 60);
    await drag(-720);
    await page.evaluate((n) => window.__TEST__!.setStat(n), Math.max(s.stat, gates[i]!.requires ?? 0));
    await walk([[0, gates[i]!.z + 4]]);
  }
  const st = await page.evaluate(() => window.__TEST__!.cameraStats());
  const end = await testState(page);
  console.log(`camera walk: walls ${end.gatesPassed.filter(Boolean).length}, waves ${waves}, shot ${shotTaken}, ${JSON.stringify(st)}`);
  expect(end.gatesPassed.filter(Boolean).length).toBe(gates.length);
  expect(waves).toBeGreaterThanOrEqual(1);
  expect(shotTaken).toBe(true);
  expect(st.frames).toBeGreaterThan(500);
  expect(st.inside, st.bad.join('\n')).toBe(0);
  expect(st.heroHidden, st.bad.join('\n')).toBe(0);
  // A line camera → hero chest may graze a border edge for a frame while the camera catches up (hero out of a cave).
  expect(st.heroBlocked, st.bad.join('\n')).toBeLessThanOrEqual(Math.ceil(st.frames * 0.01));
});

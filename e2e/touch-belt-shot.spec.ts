import { test, expect } from './fixtures.ts';
import { PACES } from './pace-data.ts';
import { beltExit, exitCaves, touchMover, type ExitResult } from './belt-exit.ts';

// PR-13 on the phone (playtest of the prototype 2: the wide frame came on 3 belts of 6, the camera in the hero's head on
// the rest). The stick drives, a thumb looks round on the camera zone on the way and rests there until the belt, as the
// playtest's touches did: a resting finger is not a turn by hand, the frame comes on the belt as on PC, in 5 caves of 5;
// the exits by the stick bring the view back as on PC (e2e/belt-exit.ts).
for (const pace of PACES) {
  test(`touch belt frame (${pace}): with the stick and a resting thumb the wide frame comes on the belt in 5 caves of 5; exits by the stick as on PC`, async ({ page, openGame }) => {
    test.setTimeout(420_000);
    await openGame('pace=' + pace);
    expect((await page.evaluate(() => window.__TEST__!.state().autoRun))).toBe(false);
    const mover = await touchMover(page);
    const list = exitCaves(pace, 5);
    const results: ExitResult[] = [];
    for (let i = 0; i < list.length; i++) {
      const cave = list[i]!;
      results.push(await beltExit(page, mover, cave, `${pace} touch cave ${cave.index + 1}`, { wave: i === 3 }));
    }
    console.log(`touch belt exits (${pace}): ` + results.map((r, i) => `${list[i]!.index + 1}${r.wave ? '*' : ''}: wide ${r.wide}, yaw ${r.yawErrDeg.toFixed(1)}°, min ${r.minDist.toFixed(2)}`).join('; '));
    expect(results.filter((r) => r.wide).length, `${pace}: wide frame on the belt with the stick`).toBe(5);
  });
}

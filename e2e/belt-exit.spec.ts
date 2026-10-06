import { test, expect } from './fixtures.ts';
import { PACES, SHOT_PACE, type Pace } from './pace-data.ts';
import { beltExit, exitCaves, keyboardMover, type ExitResult } from './belt-exit.ts';

// PR-13 (playtest of the prototype 2, item 2 = 2; regression of PR-11): after the wide frame on the belt and on the
// avalanche the camera comes back behind the hero with the yaw from before the frame, never into him, and «forward»
// leads up the slope again (e2e/belt-exit.ts). The default pace — 10 exits by W in a row, the other — 3; the scripted
// avalanche and a forced one are among them.
const EXITS: Record<Pace, number> = { fast: 10, classic: 3 };

for (const pace of PACES) {
  test(`belt exit (${pace}): ${EXITS[pace]} exits in a row by W — the view back to the yaw before the frame, never at the hero, forward up the slope; also after an avalanche`, async ({ page, openGame }) => {
    test.setTimeout(480_000);
    await openGame('pace=' + pace);
    const mover = keyboardMover(page);
    const list = exitCaves(pace, EXITS[pace]);
    expect(list).toHaveLength(EXITS[pace]);
    const spots = [0, -2.5, 2.5];
    const results: ExitResult[] = [];
    for (let i = 0; i < list.length; i++) {
      const cave = list[i]!;
      // The frame right after the way back at 1920×1080, on the third exit (the scripted avalanche is over by then).
      const shot = i === 2 && pace === SHOT_PACE;
      if (shot) await page.setViewportSize({ width: 1920, height: 1080 });
      const wave = i === Math.min(4, list.length - 1);
      results.push(await beltExit(page, mover, cave, `${pace} cave ${cave.index + 1}`, { wave, spot: spots[i % spots.length], shot: shot ? 'docs/evidence/proto/belt_exit_1920x1080_ru.png' : undefined }));
      if (shot) await page.setViewportSize({ width: 960, height: 540 });
    }
    console.log(
      `belt exits (${pace}): ` +
        results.map((r, i) => `${list[i]!.index + 1}${r.wave ? '*' : ''}: yaw ${r.yawErrDeg.toFixed(1)}°, min ${r.minDist.toFixed(2)}, dz ${r.dz.toFixed(1)}, frames ${r.frames}`).join('; '),
    );
    expect(results.filter((r) => r.wide).length, `${pace}: wide frame on the belt`).toBe(list.length);
    expect(results.filter((r) => r.wave).length, `${pace}: exits after an avalanche`).toBeGreaterThanOrEqual(2);
  });
}

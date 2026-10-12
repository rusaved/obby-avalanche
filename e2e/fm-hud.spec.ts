import { test, expect, testState, waitTicks } from './fixtures.ts';
import { nextSummit, toFirstBase } from './base-route.ts';

// FM-08 (docs/01-gdd.md 19.5; docs/01a-content.md 18.4): with the base no more than three new things at a time — the
// trophy plaque after summit 1, «Wardrobe» and «Quests» after summit 2, «Rebirth» after summit 3; a new button shines once.
const SUMMIT_IDS = ['wardrobe', 'quests', 'rebirth'];

test('open: the summit group by summits — trophies after 1, wardrobe and quests after 2, rebirth after 3; each new button shines', async ({ page, openGame }) => {
  test.setTimeout(300_000);
  await toFirstBase(page, openGame);
  // Past the window of the summit: every button of it has come (3 × menuStepSec), before the 180 s group.
  await waitTicks(page, 8 * 60);
  let s = await testState(page);
  expect(s.playSec).toBeLessThan(180);
  expect(s.trophyPlaque.shown).toBe(true);
  expect(s.menu.filter((id) => SUMMIT_IDS.includes(id))).toEqual([]);

  /** The buttons that came into the column from the summit of `world` (its window open) over `ticks` of play on the base
   * after it, and whether each shone as it came. */
  const watchNew = async (world: number, ticks: number): Promise<Record<string, boolean>> => {
    let before = new Set<string>();
    const menu = (): Promise<Array<[string, boolean]>> =>
      page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-role="menu"] [data-hud]')].map((e) => [(e.dataset['hud'] ?? '').replace(/^menu-/, ''), e.classList.contains('glow')] as [string, boolean]));
    await nextSummit(page, world, async () => {
      before = new Set((await menu()).map(([id]) => id));
    });
    const came: Record<string, boolean> = {};
    for (let k = 0; k < ticks / 15; k++) {
      for (const [id, glow] of await menu()) if (!before.has(id) && !(id in came)) came[id] = glow;
      await waitTicks(page, 15);
    }
    return came;
  };
  let came = await watchNew(2, 8 * 60);
  s = await testState(page);
  expect(s.menu.filter((id) => SUMMIT_IDS.includes(id)).sort()).toEqual(['quests', 'wardrobe']);
  expect(came, 'the new ones, each shining').toEqual({ wardrobe: true, quests: true });

  came = await watchNew(3, 8 * 60);
  s = await testState(page);
  expect(s.menu.filter((id) => SUMMIT_IDS.includes(id)).sort()).toEqual(['quests', 'rebirth', 'wardrobe']);
  expect(came, 'only the new one, shining').toEqual({ rebirth: true });
});

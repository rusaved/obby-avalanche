import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../src/analytics/catalog.ts';
import { track } from '../../src/analytics/index.ts';

// M4-09 (docs/06-analytics.md): the names track() takes are a catalog — an unknown one fails typecheck; an error inside
// ym never breaks the game; the funnel names of docs/06 section 2 are all in it.
describe('analytics catalog (M4-09)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('an unknown name does not pass typecheck; the numbered steps do', () => {
    // @ts-expect-error — not in the catalog
    const bad = (): void => track('no_such_event');
    void bad;
    const good = (): void => {
      track('gate_4');
      track('session_180s');
      track('ridge_2');
    };
    void good;
    for (const n of ['first_input', 'startup_ad_start', 'startup_ad_end', 'rewarded_shown', 'wave_real_1', 'shoes_1', 'sdk_init_slow', 'game_ready', 'rebirth_1']) expect(EVENTS as readonly string[]).toContain(n);
  });

  it('ym throwing inside does not break track', async () => {
    vi.stubGlobal('window', {
      ym: () => {
        throw new Error('ym down');
      },
    });
    const a = await import('../../src/analytics/index.ts');
    a.configureAnalytics({ counterId: 7, echoToConsole: false });
    expect(() => a.track('first_input')).not.toThrow();
    expect(a.analyticsEvents().map((e) => e.name)).toContain('first_input');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

// M2-12, docs/06-analytics.md: gold_take / gold_saved / gold_lost reach Metrika as params({ goldGift }), never as goals.
describe('golden gift analytics (M2-12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('gold_* → ym(id, "params", { goldGift }); other events stay reachGoal', async () => {
    const ym = vi.fn();
    vi.stubGlobal('window', { ym });
    const a = await import('../../src/analytics/index.ts');
    a.configureAnalytics({ counterId: 42, echoToConsole: false });
    a.track('gold_take');
    a.track('gold_saved');
    a.track('gold_lost');
    a.track('wave_real_1', { caught: false });
    expect(ym.mock.calls.slice(0, 3)).toEqual([
      [42, 'params', { goldGift: 'take' }],
      [42, 'params', { goldGift: 'saved' }],
      [42, 'params', { goldGift: 'lost' }],
    ]);
    expect(ym.mock.calls.filter((c) => c[1] === 'reachGoal' && String(c[2]).startsWith('gold_'))).toEqual([]);
    expect(ym.mock.calls[3]![1]).toBe('reachGoal');
    expect(a.analyticsEvents().map((e) => e.name)).toEqual(['gold_take', 'gold_saved', 'gold_lost', 'wave_real_1']);
  });
});

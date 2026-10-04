import { describe, expect, it } from 'vitest';
import { PauseManager } from '../../src/core/pause.ts';

describe('PauseManager (docs/02-tech.md 4.3)', () => {
  it('resumes only after every reason is removed: ad + hidden', () => {
    const pm = new PauseManager();
    const log: boolean[] = [];
    pm.onChange((paused) => log.push(paused));
    pm.add('ad');
    pm.add('hidden');
    expect(pm.paused).toBe(true);
    pm.remove('ad');
    expect(pm.paused).toBe(true);
    expect(pm.reasons).toEqual(['hidden']);
    pm.remove('hidden');
    expect(pm.paused).toBe(false);
    expect(log).toEqual([true, false]);
  });

  it('is idempotent and order-independent for overlapping reasons', () => {
    const pm = new PauseManager();
    let changes = 0;
    pm.onChange(() => changes++);
    pm.add('sdk');
    pm.add('sdk');
    pm.add('blur');
    pm.remove('blur');
    pm.remove('blur');
    expect(pm.paused).toBe(true);
    pm.remove('sdk');
    expect(pm.paused).toBe(false);
    expect(changes).toBe(2);
    pm.remove('menu');
    expect(changes).toBe(2);
  });

  it('set_ toggles a reason', () => {
    const pm = new PauseManager();
    pm.set_('hidden', true);
    expect(pm.has('hidden')).toBe(true);
    pm.set_('hidden', false);
    expect(pm.paused).toBe(false);
  });
});

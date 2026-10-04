import { describe, expect, it } from 'vitest';
import { createEmitter } from '../../src/core/events.ts';

type E = { step: number; gateOpened: { wall: number } };

describe('typed event bus (docs/02-tech.md 4.6)', () => {
  it('on / emit / off / once', () => {
    const bus = createEmitter<E>();
    const got: number[] = [];
    const off = bus.on('step', (n) => got.push(n));
    bus.emit('step', 1);
    bus.emit('step', 2);
    off();
    bus.emit('step', 3);
    expect(got).toEqual([1, 2]);
    let once = 0;
    bus.once('gateOpened', () => once++);
    bus.emit('gateOpened', { wall: 1 });
    bus.emit('gateOpened', { wall: 2 });
    expect(once).toBe(1);
  });

  it('a listener removed during emit does not break the others', () => {
    const bus = createEmitter<E>();
    const seen: string[] = [];
    const offA = bus.on('step', () => {
      seen.push('a');
      offA();
    });
    bus.on('step', () => seen.push('b'));
    bus.emit('step', 1);
    bus.emit('step', 2);
    expect(seen).toEqual(['a', 'b', 'b']);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSim } from '../../src/sim/world.ts';
import { buildLevel, BORDER_HEIGHT, BORDER_WIDTH } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import type { BalanceJson, TuningJson, WorldsJson } from '../../src/content/types.ts';

// Producer's playtest PS: a closed wall or ridge was passed by jumping onto the side border and running along it.
// A closed gate blocks the borders too, and a jump from a border top never clears it — in every pace.
const root = resolve(__dirname, '../..');
const read = (f: string): unknown => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8'));
const shared = read('balance.json') as BalanceJson;
const tuning = read('tuning.json') as TuningJson;
const PACES: Array<[string, BalanceJson, WorldsJson]> = [
  ['classic', shared, read('worlds.json') as WorldsJson],
  ['fast', mergePatch(shared, read('pace/fast/balance.json')), read('pace/fast/worlds.json') as WorldsJson],
  ['open', mergePatch(shared, read('pace/open/balance.json')), read('pace/open/worlds.json') as WorldsJson],
];

describe('a closed gate blocks the side borders (playtest PS)', () => {
  for (const [pace, balance, worlds] of PACES) {
    it(`${pace}: on a border top, running and jumping at the first gate of mountain 1 — never past it`, () => {
      const level = buildLevel(worlds.worlds[0]!);
      const gate = level.gates[0]!;
      const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
      for (const side of [-1, 1]) {
        for (const outward of [0, 0.4]) {
          const s = createSim(level, tuning, { balance, speedCurve: curve, stat: 0 });
          const z0 = gate.z - 12;
          s.teleport(side * (level.width / 2 + BORDER_WIDTH / 2), level.floorYAt(z0) + BORDER_HEIGHT + 0.1, z0);
          let maxZ = -Infinity;
          for (let i = 0; i < 6 * 60; i++) {
            const jump = i % 12 === 0;
            // Straight along the border, or veering out over the void to go round the end of the gate.
            const x = s.hero.pos.z < gate.z - 2 ? side * outward : -side * outward;
            s.step({ moveX: x, moveZ: 1, jump, jumpHeld: jump }, 1 / 60);
            if (s.hero.pos.y > level.floorYAt(gate.z) - 5) maxZ = Math.max(maxZ, s.hero.pos.z);
          }
          expect(maxZ, `side ${side}, outward ${outward}`).toBeLessThan(gate.z);
        }
      }
    });
  }
});

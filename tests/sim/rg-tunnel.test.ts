import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLevel } from '../../src/level/builder.ts';
import { mergePatch } from '../../src/content/pace.ts';
import { validateOpenShapes } from '../../src/level/validate-open.ts';
import { createSim, type Sim } from '../../src/sim/world.ts';
import type { BalanceJson, BotsJson, OpenSpecJson, TuningJson, WorldsJson } from '../../src/content/types.ts';
import type { HeroInput } from '../../src/sim/controller.ts';

// RG-06: the tunnel — the calm lane of a fork of mountain 6 (docs/01-gdd.md 18.3; docs/01a-content.md 17.2).
const root = resolve(__dirname, '../..');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'content/avalanche', f), 'utf8')) as T;
const balance = mergePatch(read<BalanceJson>('balance.json'), read('pace/open/balance.json'));
const tuning = mergePatch(read<TuningJson>('tuning.json'), read('pace/open/tuning.json'));
const spec = read<OpenSpecJson>('pace/open/worlds-spec.json');
const worlds = read<WorldsJson>('pace/open/worlds.json');
const bots = read<BotsJson>('bots.json');
const curve = { ...balance.speedCurve, base: tuning.controller.baseSpeed, max: tuning.controller.maxSpeed };
const DT = 1 / 60;
const STAND: HeroInput = { moveX: 0, moveZ: 0, jump: false, jumpHeld: false };
const RUN: HeroInput = { moveX: 0, moveZ: 1, jump: false, jumpHeld: false };
const w6 = worlds.worlds[5]!;
const level = buildLevel(w6);
const tunnelAt = level.niches.findIndex((n) => n.kind === 'tunnel' && n.stretch === 2);
const tunnel = level.niches[tunnelAt]!;
const shape = level.shapes!.find((s) => s.kind === 'tunnel' && s.section === 2)!;
const stat = spec.mountains[5]!.ridges[0]!.requires;
const hallX = (tunnel.box.min[0] + tunnel.box.max[0]) / 2;

function waveSim(): Sim {
  return createSim(level, tuning, {
    balance,
    speedCurve: curve,
    stat,
    threat: { threat: { ...w6.threat }, balance, avalanche: tuning.avalanche, scriptedPending: false, normalWavesDone: 10 },
  });
}

describe('tunnel (RG-06)', () => {
  it('mountain 6: an ice hall 16 wide, 12 high, 80 long on the calm lane of the fork of section 2', () => {
    expect(tunnel.box.max[0] - tunnel.box.min[0]).toBe(16);
    expect(tunnel.box.max[1] - tunnel.box.min[1]).toBe(12);
    expect(tunnel.box.max[2] - tunnel.box.min[2]).toBe(80);
    expect(tunnel.lane).toBe('calm');
    const fork = w6.segments.find((s) => s.type === 'fork' && s['section'] === 2)!;
    expect(fork['bold']).not.toBe(tunnel.side);
  });

  it('at every point of the tunnel the hero is in shelter; on a wave «Phew, made it!» once', () => {
    for (let z = tunnel.box.min[2] + 0.5; z < tunnel.box.max[2]; z += 10) {
      const s = waveSim();
      s.teleport(hallX, tunnel.y, z);
      s.step(STAND, DT);
      expect(s.inShelter(), `z=${z}`).toBe(true);
    }
    const s = waveSim();
    let survived = 0;
    let caught = 0;
    s.events.on('waveSurvived', () => survived++);
    s.events.on('waveCaught', () => caught++);
    s.teleport(hallX, tunnel.y, (tunnel.box.min[2] + tunnel.box.max[2]) / 2);
    s.threat!.trigger();
    for (let i = 0; i < 60 * 30 && s.threat!.state.phase !== 'gone'; i++) s.step(STAND, DT);
    expect(survived).toBe(1);
    expect(caught).toBe(0);
    // A sim a point: ~1.5 s each to build its octree (13 s alone, over 20 s beside the rest of the suite).
  }, 60_000);

  it('steps inside count with the multiplier of the section; a tunnel event as he walks in', () => {
    const s = createSim(level, tuning, { balance, speedCurve: curve, stat });
    const enters: number[] = [];
    s.events.on('tunnelEnter', ({ section }) => enters.push(section));
    s.teleport(hallX, tunnel.y, tunnel.box.min[2] - 6);
    const zone = w6.zones.find((z) => z.k === 2)!;
    let steps = 0;
    s.events.on('gain', ({ steps: n }) => (steps = n));
    for (let i = 0; i < 60; i++) {
      s.step(RUN, DT);
      if (s.inShelter()) expect(s.sectionMult()).toBe(zone.stepMult);
    }
    expect(enters).toEqual([2]);
    expect(steps).toBeGreaterThan(0);
  });

  it('no gifts inside it; its open lane ×2', () => {
    const inside = level.points.filter((p) => p.type === 'gift' && p.x >= tunnel.box.min[0] && p.x <= tunnel.box.max[0] && p.z >= tunnel.box.min[2] && p.z <= tunnel.box.max[2]);
    expect(inside).toEqual([]);
    const zone = w6.zones.find((z) => z.k === 2)!;
    const open = w6.segments.filter((s) => s.type === 'gift' && s['lane'] === 'bold' && s.z >= shape.z0 && s.z <= shape.z1);
    expect(open.length).toBeGreaterThan(0);
    for (const g of open) expect(g['coins']).toBe(2 * zone.gift);
  });

  it('validator: a tunnel with its entry closed is an error', () => {
    expect(validateOpenShapes(worlds, spec)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(worlds)) as WorldsJson;
    bad.worlds[5]!.segments.push({ type: 'fork', z: shape.z0 - 4, length: 3, x: hallX, y: shape.y, width: 16, height: 10, bold: 'left', section: 99 });
    expect(validateOpenShapes(bad, spec).some((e) => e.includes('(crystal): section 2') && e.includes('no open entry'))).toBe(true);
  });

  it('bots: about bots.tunnelShare of them take the tunnel, the rest the open lane', () => {
    let through = 0;
    let total = 0;
    for (const seed of [1, 2]) {
      const s = createSim(level, tuning, { balance, speedCurve: curve, stat, bots: { cfg: bots, count: 12, seed } });
      const list = s.bots!.list;
      list.forEach((b, i) => {
        b.mode = 'up';
        b.z = shape.z0 - 60 - i * 3;
        b.x = b.lane;
        b.path = [[b.lane, shape.z1 + 40]];
      });
      const inHall = list.map(() => false);
      for (let i = 0; i < 60 * 12; i++) {
        s.step(STAND, DT);
        list.forEach((b, k) => {
          if (b.x >= tunnel.box.min[0] && b.x <= tunnel.box.max[0] && b.z > tunnel.box.min[2] + 5 && b.z < tunnel.box.max[2] - 5) inHall[k] = true;
        });
        if (list.every((b) => b.z > shape.z1 + 10)) break;
      }
      for (const b of list) expect(b.z, `seed ${seed} bot ${b.index}`).toBeGreaterThan(shape.z1);
      total += list.length;
      through += inHall.filter(Boolean).length;
    }
    expect(through / total).toBeGreaterThan(bots.tunnelShare! - 0.25);
    expect(through / total).toBeLessThan(bots.tunnelShare! + 0.25);
  });
});

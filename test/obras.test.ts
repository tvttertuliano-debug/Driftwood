import { describe, expect, it } from 'vitest';
import { genesis } from '../src/sim/genesis.ts';
import { createSimulation, stepSimulation, type Simulation } from '../src/simulation.ts';
import { SIM } from '../src/core/config.ts';
import { findProp } from '../src/sim/queries.ts';
import { flag } from '../src/sim/worldState.ts';

/**
 * O desgaste destrói as obras. Elas precisam poder ser refeitas: antes cada
 * obra só podia existir uma vez na vida do mundo, e a ilha esvaziava — sem
 * fogueira, nada de fogo, cozinha ou brasas, para sempre.
 */

const STEPS_PER_DAY = 86400 / (SIM.step * SIM.minutesPerSecond * 60);

function runUntil(sim: Simulation, maxDays: number, done: () => boolean): boolean {
  for (let i = 0; i < maxDays * STEPS_PER_DAY; i++) {
    stepSimulation(sim);
    if (i % 200 === 0 && done()) return true;
  }
  return done();
}

describe('obras', () => {
  it('uma fogueira destruída volta a ser construída', () => {
    const sim = createSimulation(771203);
    genesis(sim.world, sim.ws);

    const built = runUntil(sim, 40, () => findProp(sim.world, 'fogueira') !== null);
    expect(built).toBe(true);
    expect(flag(sim.ws, 'já-construiu:fogueira')).toBe(1);

    // O tempo leva a fogueira (aqui, de uma vez).
    sim.world.destroy(findProp(sim.world, 'fogueira')!);
    sim.world.flush();
    expect(findProp(sim.world, 'fogueira', false)).toBeNull();

    const restarted = runUntil(sim, 20, () => findProp(sim.world, 'fogueira', false) !== null);
    expect(restarted).toBe(true);
    expect(sim.ws.chronicle.some((l) => l.text.startsWith('Do que havia antes não sobrou nada.'))).toBe(true);
  }, 120_000);
});

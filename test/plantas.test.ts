import { describe, expect, it } from 'vitest';
import { genesis } from '../src/sim/genesis.ts';
import { createSimulation, stepSimulation } from '../src/simulation.ts';
import { CPlant } from '../src/sim/components.ts';

/** O README promete que palmeiras morrem em tempestade; antes a saúde caía a zero e nada acontecia. */
describe('plantas', () => {
  it('uma planta já fraca morre numa tempestade, e a crônica conta', () => {
    const sim = createSimulation(771203);
    genesis(sim.world, sim.ws);
    const weak = sim.world.first(CPlant)!;
    sim.world.need(weak, CPlant).health = 0.0005;
    Object.assign(sim.ws.weather, { kind: 'tempestade', remaining: 1e6, rain: 1, wind: 1, targetRain: 1, targetWind: 1 });

    const healthy = [...sim.world.query(CPlant)].filter((e) => e !== weak);
    for (let i = 0; i < 40; i++) stepSimulation(sim);

    expect(sim.world.isAlive(weak)).toBe(false);
    expect(healthy.every((e) => sim.world.isAlive(e))).toBe(true);
    expect(sim.ws.chronicle.some((l) => l.text.startsWith('A tempestade derrubou uma palmeira.'))).toBe(true);
  });
});

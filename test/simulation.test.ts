import { describe, expect, it } from 'vitest';
import { genesis } from '../src/sim/genesis.ts';
import { createSimulation, stepSimulation, type Simulation } from '../src/simulation.ts';
import { applySave, buildSave } from '../src/persist/save.ts';

/**
 * A simulação não conhece pixels, então dá para rodar dias de mundo sem
 * navegador. Estes testes guardam as duas promessas centrais do projeto:
 * a mesma semente dá o mesmo mundo, e recarregar não sorteia um mundo novo.
 */

/** ~7 dias de mundo a 2 min/s e 20 Hz: dá tempo de histórias e ecologia agirem. */
const STEPS = 100_000;

function newWorld(seed: number): Simulation {
  const sim = createSimulation(seed);
  genesis(sim.world, sim.ws);
  return sim;
}

function run(sim: Simulation, steps: number): Simulation {
  for (let i = 0; i < steps; i++) stepSimulation(sim);
  return sim;
}

/** O save inteiro, sem o carimbo de hora real, como texto comparável. */
function snapshot(sim: Simulation): string {
  return JSON.stringify(buildSave(sim.world, sim.ws, 0));
}

describe('determinismo', () => {
  it('a mesma semente produz exatamente o mesmo mundo', () => {
    const a = snapshot(run(newWorld(771203), STEPS));
    const b = snapshot(run(newWorld(771203), STEPS));
    expect(a).toBe(b);
  });

  it('sementes diferentes produzem mundos diferentes', () => {
    const a = snapshot(run(newWorld(771203), 2_000));
    const b = snapshot(run(newWorld(424242), 2_000));
    expect(a).not.toBe(b);
  });

  it('o tempo de mundo avança', () => {
    const sim = run(newWorld(90210), STEPS);
    expect(sim.ws.worldSeconds).toBeGreaterThan(0);
    expect(sim.ws.sky.day).toBeGreaterThanOrEqual(1);
  });
});

describe('persistência', () => {
  it('salvar e carregar devolve o mesmo mundo', () => {
    const original = run(newWorld(771203), STEPS);
    const blob = JSON.parse(snapshot(original));

    const restored = createSimulation(blob.seed);
    applySave(blob, restored.world, restored.ws);

    expect(snapshot(restored)).toBe(snapshot(original));
  });

  it('um mundo recarregado continua igual ao que nunca parou', () => {
    const original = run(newWorld(771203), STEPS);
    const blob = JSON.parse(snapshot(original));

    const restored = createSimulation(blob.seed);
    applySave(blob, restored.world, restored.ws);

    run(original, STEPS);
    run(restored, STEPS);
    expect(snapshot(restored)).toBe(snapshot(original));
  });
});

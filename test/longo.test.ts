import { describe, expect, it } from 'vitest';
import { genesis } from '../src/sim/genesis.ts';
import { createSimulation, stepSimulation } from '../src/simulation.ts';
import { SIM } from '../src/core/config.ts';
import { CBody, CPlant, CProp, CTransform } from '../src/sim/components.ts';
import { findProps } from '../src/sim/queries.ts';

/**
 * Meses de mundo de uma vez. O programa é feito para ficar aberto por semanas,
 * e os defeitos que este teste guarda só aparecem depois de muito tempo: a ilha
 * entulhada de esculturas e mudas, e a jangada afundada indo embora com o vento
 * para mais de mil unidades da ilha.
 */

const STEPS_PER_DAY = 86400 / (SIM.step * SIM.minutesPerSecond * 60);
const DAYS = 120;

describe('vida longa', () => {
  it(`depois de ${DAYS} dias a ilha não está entulhada e nada foi embora boiando`, () => {
    const sim = createSimulation(771203);
    genesis(sim.world, sim.ws);
    const half = sim.ws.island.half;

    let farthest = 0;
    for (let i = 0; i < DAYS * STEPS_PER_DAY; i++) {
      stepSimulation(sim);
      if (i % 1000 === 0) {
        for (const e of sim.world.query(CProp, CTransform)) {
          // A jangada em viagem boia de propósito por algumas horas; o defeito
          // era continuar boiando depois do desfecho.
          if (sim.world.has(e, CBody)) continue;
          farthest = Math.max(farthest, Math.abs(sim.world.need(e, CTransform).x));
        }
      }
    }

    let plants = 0;
    for (const _ of sim.world.query(CPlant)) plants++;

    expect(findProps(sim.world, 'escultura').length).toBeLessThanOrEqual(24);
    expect(plants).toBeLessThanOrEqual(40);
    expect(farthest).toBeLessThanOrEqual(half);
    expect([...sim.world.query(CProp, CBody)].filter((e) => sim.world.need(e, CBody).buoyant)).toHaveLength(0);
    // O teste só prova algo se a jangada chegou a ir para a água.
    expect(sim.ws.stats['tentativas-de-fuga'] ?? 0).toBeGreaterThan(0);
  }, 180_000);
});

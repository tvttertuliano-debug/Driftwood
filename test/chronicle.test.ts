import { describe, expect, it } from 'vitest';
import { genesis } from '../src/sim/genesis.ts';
import { createSimulation, stepSimulation } from '../src/simulation.ts';
import { SIM } from '../src/core/config.ts';

/**
 * A crônica é a única voz do programa, e a tela só mostra o que passa pelo
 * evento `crônica`. Antes, estações, fenômenos, ruínas e todos os eventos raros
 * iam para `ws.chronicle` sem nunca aparecer; e cada fenômeno era anunciado
 * duas vezes.
 */

const STEPS_PER_DAY = 86400 / (SIM.step * SIM.minutesPerSecond * 60);

describe('crônica', () => {
  it('toda linha escrita durante a simulação chega à tela, e cada fenômeno sai uma vez', () => {
    const sim = createSimulation(90210);
    genesis(sim.world, sim.ws);

    let written = 0;
    let shown = 0;
    let phenomenaStarted = 0;
    let phenomenaAnnounced = 0;
    let previous = sim.ws.weather.phenomenon;
    sim.bus.on('crônica', () => shown++);
    sim.bus.on('fenômeno', () => phenomenaAnnounced++);

    const seasons = new Set<string>();
    for (let i = 0; i < 30 * STEPS_PER_DAY; i++) {
      const before = sim.ws.chronicle.length;
      stepSimulation(sim);
      // A crônica é podada em 400 linhas; contar pelo crescimento basta enquanto não chega lá.
      written += sim.ws.chronicle.length - before;
      seasons.add(sim.ws.sky.season);
      if (sim.ws.weather.phenomenon !== previous) {
        if (sim.ws.weather.phenomenon !== 'nenhum') phenomenaStarted++;
        previous = sim.ws.weather.phenomenon;
      }
    }

    expect(sim.ws.chronicle.length).toBeLessThan(400);
    // O teste só vale se a corrida cobriu o que antes ficava de fora.
    expect(seasons.size).toBeGreaterThan(1);
    expect(phenomenaStarted).toBeGreaterThan(0);
    expect(written).toBeGreaterThan(0);

    expect(shown).toBe(written);
    expect(phenomenaAnnounced).toBe(phenomenaStarted);
  }, 60_000);
});

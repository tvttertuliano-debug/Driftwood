import { describe, expect, it } from 'vitest';
import { Particles, type ParticleWorld } from '../src/render/particles.ts';
import { newWeather } from '../src/sim/weather.ts';

/**
 * Regressão do defeito D1 da auditoria: com `floor(taxa × dt)`, a 60 fps o
 * produto ficava sempre abaixo de 1 e nenhuma partícula nascia.
 */

function scene(rain: number, wind: number): ParticleWorld {
  const weather = newWeather();
  weather.rain = rain;
  weather.wind = wind;
  weather.windDir = 1;
  return {
    weather,
    left: -120, right: 120, top: 60, bottom: -10, seaLevel: 0,
    fires: [], night: 0, calm: 0,
  };
}

function aliveAfter(frames: number, dt: number, world: ParticleWorld): number {
  const p = new Particles(1400);
  for (let i = 0; i < frames; i++) p.update(dt, world, 1);
  return p.alive;
}

describe('partículas', () => {
  it('emitem continuamente a 60 fps numa tempestade', () => {
    const p = new Particles(1400);
    const world = scene(1, 1);
    const counts: number[] = [];
    for (let i = 0; i < 10; i++) {
      p.update(1 / 60, world, 1);
      counts.push(p.alive);
    }
    expect(counts[0]).toBeGreaterThan(0);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it('taxas fracionárias acumulam até sair (chuva fraca a 144 fps)', () => {
    expect(aliveAfter(144, 1 / 144, scene(0.02, 0))).toBeGreaterThan(0);
  });

  it('chuva aumenta a emissão', () => {
    expect(aliveAfter(60, 1 / 60, scene(1, 0.3))).toBeGreaterThan(aliveAfter(60, 1 / 60, scene(0, 0.3)));
  });

  it('um engasgo longo não despeja o pool inteiro de uma vez', () => {
    expect(aliveAfter(1, 5, scene(1, 1))).toBeLessThan(200);
  });
});

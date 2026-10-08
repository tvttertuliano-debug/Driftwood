import { describe, expect, it, vi } from 'vitest';
import { ASSET_IDS, isAssetId } from '../src/art/assets/ids.ts';
import { ASSETS, getAsset, resolveAsset } from '../src/art/assets/registry.ts';
import type { BrushCtx } from '../src/render/brushes.ts';
import type { Painter } from '../src/render/painter.ts';
import { computeLighting } from '../src/render/palette.ts';
import { createWorldState } from '../src/sim/worldState.ts';
import { CVisual } from '../src/sim/components.ts';
import { genesis } from '../src/sim/genesis.ts';
import { createSimulation, stepSimulation } from '../src/simulation.ts';

/**
 * O compilador já garante que catálogo e vocabulário batem. Aqui fica o que
 * ele não vê: que cada pincel desenha de fato, e que o mundo simulado só pede
 * nomes que existem.
 */

/** Pintor falso: aceita qualquer chamada e só conta. Dispensa WebGL. */
function countingPainter(): { painter: Painter; calls: () => number } {
  let n = 0;
  const painter = new Proxy({}, { get: () => () => { n++; } }) as unknown as Painter;
  return { painter, calls: () => n };
}

function ctxFor(painter: Painter): BrushCtx {
  const ws = createWorldState(771203);
  return {
    p: painter,
    l: computeLighting(ws.sky, ws.weather),
    x: 0, y: 0, seed: 12345, scale: 1, facing: 1, opacity: 1, depth: 0, shadow: 1,
    time: 3.2, season: ws.sky.season, wind: 0.5,
    // Objeto pronto, planta adulta: o caso em que todo pincel tem o que desenhar.
    extra: { progress: 1, condition: 1, growth: 1, health: 1, maxHeight: 22, fruit: 1, species: 0 },
  };
}

describe('catálogo visual', () => {
  it('cada nome do vocabulário tem uma entrada com o mesmo id', () => {
    for (const id of ASSET_IDS) expect(ASSETS[id].id).toBe(id);
    expect(Object.keys(ASSETS).sort()).toEqual([...ASSET_IDS].sort());
  });

  it.each(ASSET_IDS)('"%s" desenha sem erro', (id) => {
    const { painter, calls } = countingPainter();
    ASSETS[id].draw(ctxFor(painter));
    expect(calls()).toBeGreaterThan(0);
  });

  it('um nome desconhecido vira destroço, com um único aviso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getAsset('pincel-de-outra-versão')).toBeUndefined();
    expect(resolveAsset('pincel-de-outra-versão')).toBe(ASSETS.destroço);
    expect(resolveAsset('pincel-de-outra-versão')).toBe(ASSETS.destroço);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('o mundo simulado só pede desenhos que existem', () => {
    for (const seed of [771203, 424242, 90210]) {
      const sim = createSimulation(seed);
      genesis(sim.world, sim.ws);
      for (let i = 0; i < 100_000; i++) stepSimulation(sim);
      // Passa pelo JSON como um save faria: é assim que um nome velho entraria.
      const saved = JSON.parse(JSON.stringify(sim.world.serialize()));
      const brushes: string[] = saved.components[CVisual.name]?.d.map((v: { brush: string }) => v.brush) ?? [];
      expect(brushes.length).toBeGreaterThan(0);
      expect(brushes.filter((b) => !isAssetId(b))).toEqual([]);
    }
  });
});

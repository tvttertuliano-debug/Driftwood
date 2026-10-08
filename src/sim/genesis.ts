import type { World } from '../core/ecs.ts';
import {
  CBody, CBrain, CCastaway, CCritter, CNeeds, CPlant, CProp, CSkills, CTransform, CVisual,
} from './components.ts';
import { spawnProp } from './queries.ts';
import { chronicle, type WorldState } from './worldState.ts';

/**
 * O primeiro dia. Nada aqui é roteiro — só o estado inicial de um lugar que já
 * existia antes de ele chegar, mais os destroços que o trouxeram.
 */
export function genesis(world: World, ws: WorldState): void {
  const island = ws.island;
  const rng = ws.rngAmbient;

  // Vegetação nativa: palmeiras adultas espalhadas pela parte plana.
  const palms = 7 + rng.int(0, 6);
  for (let i = 0; i < palms; i++) {
    const x = island.clampToLand(rng.range(island.shoreLeft + 8, island.shoreRight - 8));
    if (island.groundAt(x) < 1.2) continue;
    const e = world.create();
    world.add(e, CTransform, {
      x, y: island.surfaceAt(x), depth: rng.range(-0.45, 0.45),
      facing: rng.chance(0.5) ? 1 : -1, scale: 1, rot: 0,
    });
    world.add(e, CPlant, {
      species: 'palmeira',
      growth: rng.range(0.55, 1),
      maxHeight: rng.range(17, 32),
      seed: rng.int(1, 1e6),
      fruit: rng.int(0, 3),
      plantedOnDay: 0,
    });
    world.add(e, CVisual, { brush: 'planta', seed: rng.int(1, 1e6), opacity: 1, shadow: 0.75 });
  }

  const bushes = 5 + rng.int(0, 7);
  for (let i = 0; i < bushes; i++) {
    const x = island.clampToLand(rng.range(island.shoreLeft + 4, island.shoreRight - 4));
    const e = world.create();
    world.add(e, CTransform, { x, y: island.surfaceAt(x), depth: rng.range(-0.5, 0.5), facing: 1, scale: 1, rot: 0 });
    world.add(e, CPlant, { species: 'arbusto', growth: rng.range(0.6, 1), maxHeight: rng.range(6, 11), seed: rng.int(1, 1e6), plantedOnDay: 0 });
    world.add(e, CVisual, { brush: 'planta', seed: rng.int(1, 1e6), opacity: 1, shadow: 0.6 });
  }

  // Rochedos do cenário.
  for (const f of island.features) {
    if (f.kind !== 'rochedo') continue;
    const e = spawnProp(world, ws, 'rocha', f.x, { seed: f.seed });
    world.add(e, CVisual, { brush: 'rocha', seed: f.seed, opacity: 1, shadow: 0.8 });
  }

  // Caranguejos e gaivotas: a ilha não estava vazia.
  for (let i = 0; i < 4; i++) {
    const x = rng.chance(0.5) ? island.shoreRight - rng.range(2, 16) : island.shoreLeft + rng.range(2, 16);
    const e = world.create();
    world.add(e, CTransform, { x, y: island.surfaceAt(x), depth: rng.range(0.2, 0.6), facing: 1, scale: 1, rot: 0 });
    world.add(e, CCritter, { species: 'caranguejo', state: 'vagando', timer: rng.range(0, 4), bond: 0, homeX: x, seed: rng.int(1, 1e6) });
    world.add(e, CVisual, { brush: 'caranguejo', seed: rng.int(1, 1e6), opacity: 1, shadow: 0.5 });
  }
  for (let i = 0; i < 3; i++) {
    const x = rng.range(island.shoreLeft, island.shoreRight);
    const e = world.create();
    world.add(e, CTransform, { x, y: 16, depth: rng.range(-0.7, -0.2), facing: 1, scale: 1, rot: 0 });
    world.add(e, CCritter, { species: 'gaivota', state: 'voando', timer: 0, bond: 0, homeX: x, seed: rng.int(1, 1e6) });
    world.add(e, CVisual, { brush: 'gaivota', seed: rng.int(1, 1e6), opacity: 1, shadow: 0 });
  }

  // Os destroços que o trouxeram até aqui. Ficam na praia até o sal e as
  // tempestades os desfazerem — ele não os conserta: não são obra dele.
  const wreckX = island.shoreRight - 10;
  for (let i = 0; i < 3; i++) {
    const x = wreckX + rng.range(-9, 9);
    const e = spawnProp(world, ws, 'destroço', x, { condition: rng.range(0.3, 0.7) });
    world.add(e, CVisual, { brush: 'destroço', seed: rng.int(1, 1e6), opacity: 1, shadow: 0.6 });
    const body = world.add(e, CBody, { buoyant: false, asleep: true });
    body.asleep = true;
  }

  // Ele.
  const self = world.create();
  const startX = island.clampToLand(wreckX - 6);
  world.add(self, CTransform, { x: startX, y: island.surfaceAt(startX), depth: 0, facing: -1, scale: 1, rot: 0 });
  world.add(self, CCastaway, { name: 'o náufrago' });
  world.add(self, CNeeds, { thirst: 0.45, hunger: 0.35, rest: 0.55, curiosity: 0.7, hope: 0.5 });
  world.add(self, CBrain, {});
  world.add(self, CSkills, {});

  chronicle(ws, 'Ele acordou na praia. O mar já tinha ido embora sem ele.', 'maravilha');
}

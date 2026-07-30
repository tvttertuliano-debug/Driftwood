import type { Entity, World } from '../core/ecs.ts';
import { CProp, CPlant, CCritter, CTransform, type Prop } from './components.ts';
import type { WorldState } from './worldState.ts';

/** Consultas reutilizáveis sobre o mundo. Sistemas não devem varrer stores na mão. */

export function findProp(world: World, kind: string, builtOnly = true): Entity | null {
  for (const e of world.query(CProp)) {
    const p = world.need(e, CProp);
    if (p.kind !== kind) continue;
    if (builtOnly && p.progress < 1) continue;
    return e;
  }
  return null;
}

export function findProps(world: World, kind: string): Entity[] {
  const out: Entity[] = [];
  for (const e of world.query(CProp)) {
    if (world.need(e, CProp).kind === kind) out.push(e);
  }
  return out;
}

export function hasProp(world: World, kind: string): boolean {
  return findProp(world, kind) !== null;
}

/** Obra em andamento (progress < 1). É o que a ação "construir" empurra. */
export function currentProject(world: World): Entity | null {
  let best: Entity | null = null;
  let bestProgress = -1;
  for (const e of world.query(CProp)) {
    const p = world.need(e, CProp);
    if (p.progress >= 1) continue;
    if (p.progress > bestProgress) {
      bestProgress = p.progress;
      best = e;
    }
  }
  return best;
}

/** Construção pronta mais danificada, se valer a pena consertar. */
export function mostDamagedProp(world: World, threshold = 0.62): Entity | null {
  let best: Entity | null = null;
  let worst = threshold;
  for (const e of world.query(CProp)) {
    const p = world.need(e, CProp);
    if (p.progress < 1) continue;
    if (p.condition < worst) {
      worst = p.condition;
      best = e;
    }
  }
  return best;
}

export function propX(world: World, e: Entity | null): number | null {
  if (e === null) return null;
  return world.get(e, CTransform)?.x ?? null;
}

export function findCritter(world: World, species: string): Entity | null {
  for (const e of world.query(CCritter)) {
    if (world.need(e, CCritter).species === species) return e;
  }
  return null;
}

export function countPlants(world: World, species?: string): number {
  let n = 0;
  for (const e of world.query(CPlant)) {
    if (!species || world.need(e, CPlant).species === species) n++;
  }
  return n;
}

/** Palmeira adulta com coco disponível, mais próxima de x. */
export function nearestFruitingPalm(world: World, x: number): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of world.query(CPlant, CTransform)) {
    const p = world.need(e, CPlant);
    if (p.species !== 'palmeira' || p.growth < 0.7 || p.fruit < 1) continue;
    const d = Math.abs(world.need(e, CTransform).x - x);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function spawnProp(
  world: World,
  ws: WorldState,
  kind: string,
  x: number,
  init: Partial<Prop> = {},
  brush = kind,
): Entity {
  const e = world.create();
  const y = ws.island.surfaceAt(x);
  world.add(e, CTransform, { x, y, depth: 0, facing: ws.rngAmbient.chance(0.5) ? 1 : -1, scale: 1, rot: 0 });
  world.add(e, CProp, {
    kind,
    progress: init.progress ?? 1,
    condition: init.condition ?? 1,
    builtOnDay: ws.sky.day,
    seed: init.seed ?? ws.rngAmbient.int(1, 1e6),
    flags: init.flags ?? {},
  });
  // Visual é adicionado pelo chamador quando quer um pincel diferente do nome.
  return e;
}

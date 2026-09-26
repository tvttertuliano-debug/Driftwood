import { Scheduler, World } from './core/ecs.ts';
import { EventBus } from './core/events.ts';
import { SIM } from './core/config.ts';
import { createWorldState, type WorldState } from './sim/worldState.ts';
import {
  agingSystem, appearSystem, critterSystem, ecologySystem, ephemeralSystem,
  fireSystem, physicsSystem, timeSystem,
} from './sim/systems.ts';
import { actSystem, mindSystem } from './ai/brain.ts';
import { directorSystem } from './story/director.ts';
import type { DriftContext } from './sim/context.ts';

/**
 * Montagem da simulação, sem nada de navegador: o mesmo código roda na página,
 * no Electron e nos testes. Quem desenha, toca som ou salva fica de fora.
 */

export interface Simulation {
  world: World;
  ws: WorldState;
  bus: EventBus;
  scheduler: Scheduler<DriftContext>;
  ctx: DriftContext;
}

export function createScheduler(): Scheduler<DriftContext> {
  return new Scheduler<DriftContext>().add(
    timeSystem,
    mindSystem,
    agingSystem,
    actSystem,
    critterSystem,
    physicsSystem,
    ephemeralSystem,
    appearSystem,
    ecologySystem,
    fireSystem,
    directorSystem,
  );
}

/** Mundo vazio com a ilha da semente. Quem chama decide entre `genesis` e `applySave`. */
export function createSimulation(seed: number): Simulation {
  const world = new World(4096);
  const ws = createWorldState(seed);
  const bus = new EventBus();
  const scheduler = createScheduler();
  const ctx: DriftContext = { world, ws, bus, dt: SIM.step, elapsed: 0 };
  return { world, ws, bus, scheduler, ctx };
}

/** Um passo fixo de simulação, com a entrega dos eventos que ele gerou. */
export function stepSimulation(sim: Simulation, profile = false): void {
  sim.bus.setClock(sim.ws.worldSeconds);
  sim.ctx.dt = SIM.step;
  sim.ctx.elapsed += SIM.step;
  sim.scheduler.run(sim.ctx, profile);
  sim.bus.dispatch();
}

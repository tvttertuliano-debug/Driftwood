import type { SimContext, World } from '../core/ecs.ts';
import type { EventBus } from '../core/events.ts';
import type { WorldState } from './worldState.ts';

/** Contexto único passado a todos os sistemas. Só leitura de estrutura, escrita de dados. */
export interface DriftContext extends SimContext {
  world: World;
  ws: WorldState;
  bus: EventBus;
}

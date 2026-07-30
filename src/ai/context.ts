import type { Entity, World } from '../core/ecs.ts';
import type { EventBus } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import type { WorldState } from '../sim/worldState.ts';
import type { Brain, Castaway, Needs, Skills, Transform } from '../sim/components.ts';

/** Tudo que uma ação precisa para pontuar e para agir. Nada além disso. */
export interface AIContext {
  world: World;
  ws: WorldState;
  self: Entity;
  tr: Transform;
  needs: Needs;
  brain: Brain;
  skills: Skills;
  who: Castaway;
  bus: EventBus;
  rng: Rng;
  /** Passo de simulação em segundos de mundo. */
  dt: number;
}

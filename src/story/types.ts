import type { Entity, World } from '../core/ecs.ts';
import type { EventBus } from '../core/events.ts';
import type { Rng } from '../core/rng.ts';
import type { WorldState, ChronicleEntry } from '../sim/worldState.ts';

export interface StoryCtx {
  world: World;
  ws: WorldState;
  bus: EventBus;
  rng: Rng;
  /** O náufrago. Sempre existe. */
  self: Entity;
  /** Atalho para as habilidades dele — histórias consultam sem tocar em componentes. */
  skills(): Record<string, number>;
}

export interface StoryStep {
  /** Linha da crônica ao entrar no passo. */
  text?: string | ((c: StoryCtx) => string);
  tone?: ChronicleEntry['tone'];
  /** Efeito imediato ao entrar no passo. */
  run?: (c: StoryCtx) => void;
  /** Segundos de mundo a esperar antes de avançar. */
  wait?: number;
  /** Condição de avanço. Enquanto false, o passo continua (respeitando `timeout`). */
  until?: (c: StoryCtx) => boolean;
  /** Segundos de mundo até desistir do `until` e avançar assim mesmo. */
  timeout?: number;
  /** Se retorna true, a história aborta silenciosamente aqui. */
  abortIf?: (c: StoryCtx) => boolean;
}

/**
 * Vaga que a história ocupa no diretor.
 *
 * `obra` são construções: ficam paradas por dias esperando o náufrago terminar.
 * `acontecimento` é todo o resto. São duas vagas independentes justamente porque
 * uma obra longa não pode impedir que a maré traga destroços, que chegue um
 * papagaio ou que a praia alague — era isso que fazia a maioria das histórias
 * nunca aparecer.
 */
export type StorySlot = 'obra' | 'acontecimento';

export interface Story {
  id: string;
  /** Vaga do diretor. Ausente = `acontecimento`. */
  slot?: StorySlot;
  /** Peso base na roleta do diretor. */
  weight: number;
  /** Só pode acontecer uma vez na vida do mundo. */
  once?: boolean;
  /** Recarga em segundos de mundo. */
  cooldown?: number;
  /** Pré-condições. Sem isso, nem entra no sorteio. */
  requires?: (c: StoryCtx) => boolean;
  /** Peso dinâmico multiplicado ao base (humor, estação, habilidade). */
  bias?: (c: StoryCtx) => number;
  steps: StoryStep[];
}

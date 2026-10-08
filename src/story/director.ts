import { Stage, type System } from '../core/ecs.ts';
import { SIM } from '../core/config.ts';
import { CCastaway, CSkills } from '../sim/components.ts';
import { flag, narrate, setFlag, type WorldState } from '../sim/worldState.ts';
import type { DriftContext } from '../sim/context.ts';
import { STORIES, STORY_BY_ID } from './stories.ts';
import { rollRareEvents } from './rareEvents.ts';
import type { Story, StoryCtx, StorySlot, StoryStep } from './types.ts';

/**
 * O diretor não escreve a história — ele decide qual *possibilidade* ganha vez.
 *
 * Há duas vagas, não uma. Com vaga única, uma obra que leva quatro dias travava
 * o mundo inteiro: em 35 dias de simulação só 12 das 29 histórias chegavam a
 * acontecer. Agora a construção ocupa a vaga "obra" e o mundo continua
 * acontecendo na vaga "acontecimento".
 */

const HOUR = 3600;
const DONE = (id: string) => `história-feita:${id}`;

/** Intervalo médio entre histórias novas, por vaga, em segundos de mundo. */
const RITMO: Record<StorySlot, number> = {
  obra: 3.5 * HOUR,
  acontecimento: 2.5 * HOUR,
};

function makeCtx(ctx: DriftContext, self: number): StoryCtx {
  return {
    world: ctx.world,
    ws: ctx.ws,
    bus: ctx.bus,
    rng: ctx.ws.rngStory,
    self,
    skills: () => ctx.world.get(self, CSkills) ?? {},
  };
}

const slotOf = (s: Story): StorySlot => s.slot ?? 'acontecimento';

// ── acesso às duas vagas sem duplicar código ──

function slotId(ws: WorldState, slot: StorySlot): string | null {
  return slot === 'obra' ? ws.activeStory : ws.sideStory;
}

function readSlot(ws: WorldState, slot: StorySlot): { id: string | null; step: number; time: number } {
  return slot === 'obra'
    ? { id: ws.activeStory, step: ws.activeStoryStep, time: ws.activeStoryTime }
    : { id: ws.sideStory, step: ws.sideStoryStep, time: ws.sideStoryTime };
}

function writeSlot(ws: WorldState, slot: StorySlot, id: string | null, step: number, time: number): void {
  if (slot === 'obra') {
    ws.activeStory = id;
    ws.activeStoryStep = step;
    ws.activeStoryTime = time;
  } else {
    ws.sideStory = id;
    ws.sideStoryStep = step;
    ws.sideStoryTime = time;
  }
}

function eligible(c: StoryCtx, s: Story): boolean {
  // Não pode estar rodando agora — em nenhuma das duas vagas.
  if (c.ws.activeStory === s.id || c.ws.sideStory === s.id) return false;
  if (s.once && flag(c.ws, DONE(s.id)) > 0) return false;
  const last = c.ws.storyCooldowns[s.id];
  if (last !== undefined && s.cooldown && c.ws.worldSeconds - last < s.cooldown) return false;
  if (s.requires && !s.requires(c)) return false;
  return true;
}

function enterStep(c: StoryCtx, step: StoryStep): void {
  if (step.run) step.run(c);
  if (step.text) {
    const text = typeof step.text === 'function' ? step.text(c) : step.text;
    narrate(c.ws, c.bus, text, step.tone ?? 'rotina');
  }
}

function beginStory(c: StoryCtx, s: Story): void {
  const slot = slotOf(s);
  writeSlot(c.ws, slot, s.id, 0, 0);
  c.ws.storyCooldowns[s.id] = c.ws.worldSeconds;
  if (s.once) setFlag(c.ws, DONE(s.id));
  c.bus.emit('história-começou', { id: s.id, slot });
  enterStep(c, s.steps[0]);
}

function endStory(c: StoryCtx, slot: StorySlot, id: string): void {
  writeSlot(c.ws, slot, null, 0, 0);
  c.bus.emit('história-terminou', { id, slot });
}

function advance(c: StoryCtx, slot: StorySlot, worldDt: number): void {
  const current = slotId(c.ws, slot);
  if (!current) return;
  const story = STORY_BY_ID.get(current);
  if (!story) {
    endStory(c, slot, current);
    return;
  }

  let guard = 0;
  while (guard++ < 8) {
    const { step: stepIndex, time } = readSlot(c.ws, slot);
    const step = story.steps[stepIndex];
    if (!step) {
      endStory(c, slot, story.id);
      return;
    }

    writeSlot(c.ws, slot, story.id, stepIndex, time + worldDt);
    const elapsed = readSlot(c.ws, slot).time;

    if (step.abortIf?.(c)) {
      endStory(c, slot, story.id);
      return;
    }

    let done = false;
    if (step.until) {
      done = step.until(c) || (step.timeout !== undefined && elapsed >= step.timeout);
    } else if (step.wait !== undefined) {
      done = elapsed >= step.wait;
    } else {
      done = true; // Passo instantâneo: efeito já rodou ao entrar.
    }

    if (!done) return;

    const nextIndex = stepIndex + 1;
    const next = story.steps[nextIndex];
    if (!next) {
      endStory(c, slot, story.id);
      return;
    }
    writeSlot(c.ws, slot, story.id, nextIndex, 0);
    enterStep(c, next);
    // Se o próximo passo espera algo, sai do laço; se for instantâneo, continua.
    if (next.wait !== undefined || next.until) return;
  }
}

function tryStart(c: StoryCtx, slot: StorySlot, worldDt: number): void {
  if (slotId(c.ws, slot) !== null) return;
  if (!c.ws.rngStory.chance(worldDt / RITMO[slot])) return;

  const pick = c.ws.rngStory.weighted(
    STORIES.filter((s) => slotOf(s) === slot && eligible(c, s)),
    (s) => s.weight * (s.bias?.(c) ?? 1),
  );
  if (pick) beginStory(c, pick);
}

export const directorSystem: System<DriftContext> = {
  name: 'diretor',
  stage: Stage.Director,
  every: 20,
  update(ctx) {
    const self = ctx.world.first(CCastaway);
    if (self === null) return;
    const worldDt = ctx.dt * 20 * SIM.minutesPerSecond * 60;
    const c = makeCtx(ctx, self);

    rollRareEvents(c, worldDt);

    advance(c, 'obra', worldDt);
    advance(c, 'acontecimento', worldDt);
    tryStart(c, 'obra', worldDt);
    tryStart(c, 'acontecimento', worldDt);
  },
};

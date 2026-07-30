import { Stage, type System } from '../core/ecs.ts';
import { SIM } from '../core/config.ts';
import { clamp, clamp01, lerp } from '../core/math.ts';
import { CBrain, CCastaway, CNeeds, CSkills, CTransform } from '../sim/components.ts';
import { ACTION_BY_ID, ACTIONS, type Action } from './actions.ts';
import { driftNeeds, overallMood } from './needs.ts';
import type { AIContext } from './context.ts';
import type { DriftContext } from '../sim/context.ts';

/**
 * IA de utilidade. Todo passo:
 *   1. necessidades derivam;
 *   2. cada ação se autoavalia;
 *   3. ruído + inércia + recarga decidem;
 *   4. o corpo executa (andar até o lugar, depois agir).
 *
 * Nenhuma sequência é roteirizada. O que parece intenção é só pressão interna
 * encontrando a ação mais barata para aliviá-la.
 */

const ARRIVE_EPS = 1.4;

/**
 * Conversão essencial: durações de ação, recargas e taxas de necessidade estão
 * todas em SEGUNDOS DE MUNDO. O passo da simulação vem em segundos reais.
 * Misturar os dois faz o náufrago levar horas reais para tomar um gole d'água.
 */
const worldDt = (realDt: number): number => realDt * SIM.minutesPerSecond * 60;

function buildContext(ctx: DriftContext, self: number): AIContext | null {
  const { world, ws } = ctx;
  const tr = world.get(self, CTransform);
  const needs = world.get(self, CNeeds);
  const brain = world.get(self, CBrain);
  const skills = world.get(self, CSkills);
  const who = world.get(self, CCastaway);
  if (!tr || !needs || !brain || !skills || !who) return null;
  return {
    world, ws, self, tr, needs, brain, skills, who,
    bus: ctx.bus, rng: ws.rngMind,
    dt: worldDt(ctx.dt),
  };
}

function cooldownOk(c: AIContext, a: Action): boolean {
  if (!a.cooldown) return true;
  const last = c.brain.lastRun[a.id];
  if (last === undefined) return true;
  return c.ws.worldSeconds - last >= a.cooldown;
}

/** Penaliza o que ele acabou de fazer — evita loops sem precisar de máquina de estado. */
function repetitionPenalty(c: AIContext, a: Action): number {
  const last = c.brain.lastRun[a.id];
  // Novidade: o que ele nunca fez ganha um empurrão. Sem isto, uma ação de
  // pontuação mediana (escrever no diário, olhar pela luneta) pode perder todas
  // as disputas por meses e o espectador nunca vê aquele pedaço da vida dele.
  if (last === undefined) return 1.45;
  const since = c.ws.worldSeconds - last;
  return clamp01(since / (3 * 3600)) * 0.75 + 0.25;
}

function evaluate(c: AIContext): { action: Action; score: number } {
  let best = ACTION_BY_ID.get('ocioso')!;
  let bestScore = -Infinity;
  for (const a of ACTIONS) {
    if (!cooldownOk(c, a)) continue;
    let s = a.score(c);
    if (s <= 0) continue;
    s *= repetitionPenalty(c, a);
    // Ruído multiplicativo: dois dias idênticos produzem tardes diferentes.
    s *= 0.78 + c.rng.next() * 0.44;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return { action: best, score: bestScore };
}

function beginAction(c: AIContext, a: Action): void {
  const b = c.brain;
  b.action = a.id;
  b.elapsed = 0;
  b.phase = 0;
  b.duration = c.rng.range(a.duration[0], a.duration[1]);
  const place = a.place?.(c);
  b.targetX = place === null || place === undefined ? c.tr.x : c.ws.island.clampToLand(place);
  b.lastRun[a.id] = c.ws.worldSeconds;
  a.onStart?.(c);
  c.bus.emit('ação', { id: a.id, x: b.targetX });
}

/** Estágio Mind: só decide. Nunca move, nunca altera o mundo. */
export const mindSystem: System<DriftContext> = {
  name: 'mente',
  stage: Stage.Mind,
  update(ctx) {
    for (const e of ctx.world.query(CBrain, CNeeds, CTransform, CCastaway)) {
      const c = buildContext(ctx, e);
      if (!c) continue;

      const current = ACTION_BY_ID.get(c.brain.action);
      const working = current ? ['construir', 'consertar', 'coletar-lenha', 'pescar', 'esculpir'].includes(current.id) : false;
      driftNeeds(c.needs, c.ws, c.dt, working);
      c.who.mood = overallMood(c.needs);

      const finished = !current || c.brain.elapsed >= c.brain.duration;
      if (finished) {
        const { action } = evaluate(c);
        if (current && current.id !== action.id) c.brain.intent = action.id;
        beginAction(c, action);
        continue;
      }

      // Interrupção: só o urgente arranca alguém do que está fazendo.
      if (!current.urgent) {
        const currentScore = Math.max(0.001, current.score(c));
        for (const a of ACTIONS) {
          if (!a.urgent || a === current || !cooldownOk(c, a)) continue;
          const s = a.score(c);
          if (s > currentScore * 1.6) {
            c.bus.emit('interrompido', { from: current.id, to: a.id });
            beginAction(c, a);
            break;
          }
        }
      }
    }
  },
};

/** Velocidade de caminhada: idade, humor, ladeira e urgência entram na conta. */
function walkSpeed(c: AIContext, slope: number): number {
  const base = 6.4;
  const age = 1 - clamp01(c.who.weathering) * 0.22;
  const mood = lerp(0.82, 1.12, c.who.mood);
  const hill = 1 - clamp(Math.abs(slope), 0, 1.2) * 0.42;
  const rush = c.needs.fear > 0.5 ? 1.75 : 1;
  return base * age * mood * hill * rush;
}

/** Estágio Act: caminhar e executar. Todo efeito colateral no mundo nasce aqui. */
export const actSystem: System<DriftContext> = {
  name: 'ação',
  stage: Stage.Act,
  update(ctx) {
    for (const e of ctx.world.query(CBrain, CTransform, CCastaway)) {
      const c = buildContext(ctx, e);
      if (!c) continue;
      const a = ACTION_BY_ID.get(c.brain.action);
      if (!a) continue;

      const dx = c.brain.targetX - c.tr.x;
      const walking = Math.abs(dx) > ARRIVE_EPS;

      if (walking) {
        // Andar é movimento visível: acontece em tempo real, não de mundo.
        const slope = c.ws.island.slopeAt(c.tr.x);
        const step = walkSpeed(c, slope) * ctx.dt * Math.sign(dx);
        const nextX = c.ws.island.clampToLand(c.tr.x + step);
        c.tr.x = nextX;
        c.tr.facing = step >= 0 ? 1 : -1;
        c.tr.y = c.ws.island.surfaceAt(nextX);
        // Ciclo de passada: fase avança com a distância, não com o tempo.
        c.brain.phase = (c.brain.phase + Math.abs(step) * 0.22) % 1;
        // Caminhar consome parte do tempo da ação — trajetos importam.
        c.brain.elapsed += c.dt * 0.35;
        continue;
      }

      c.tr.y = c.ws.island.surfaceAt(c.tr.x);
      c.brain.elapsed += c.dt;
      const k = clamp01(c.brain.elapsed / c.brain.duration);
      a.tick?.(c, k);

      if (c.brain.elapsed >= c.brain.duration) {
        a.onFinish?.(c);
        c.bus.emit('ação-fim', { id: a.id });
      }
    }
  },
};

/** Pose atual, para o animador. Andar tem prioridade sobre a pose da ação. */
export function currentPose(brain: { action: string; targetX: number }, x: number): string {
  if (Math.abs(brain.targetX - x) > ARRIVE_EPS) return 'andando';
  return ACTION_BY_ID.get(brain.action)?.pose ?? 'parado';
}

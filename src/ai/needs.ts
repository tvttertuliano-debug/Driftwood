import { clamp01, lerp, smoothstep } from '../core/math.ts';
import type { Needs } from '../sim/components.ts';
import type { WorldState } from '../sim/worldState.ts';
import { temperature } from '../sim/calendar.ts';
import { isDangerous, severity } from '../sim/weather.ts';

/**
 * Necessidades sobem sozinhas e descem quando atendidas. Nada aqui decide nada:
 * este módulo só descreve a pressão interna. A decisão é do brain.
 */

const HOUR = 3600; // segundos de mundo

/** Taxa por segundo de mundo para encher a necessidade do zero. */
const RISE = {
  hunger: 1 / (11 * HOUR),
  thirst: 1 / (6.5 * HOUR),
  rest: 1 / (15 * HOUR),
  curiosity: 1 / (9 * HOUR),
  creativity: 1 / (20 * HOUR),
  laziness: 1 / (26 * HOUR),
  loneliness: 1 / (40 * HOUR),
};

export function driftNeeds(n: Needs, ws: WorldState, dt: number, working: boolean): void {
  const temp = temperature(ws.sky);
  const night = 1 - ws.sky.daylight;

  n.hunger = clamp01(n.hunger + RISE.hunger * dt);
  // Calor dá sede; chuva na cara também lembra que existe água.
  n.thirst = clamp01(n.thirst + RISE.thirst * dt * lerp(0.75, 1.5, temp));
  n.rest = clamp01(n.rest + RISE.rest * dt * (working ? 1.55 : 0.8) * lerp(0.85, 1.35, night));
  n.curiosity = clamp01(n.curiosity + RISE.curiosity * dt);
  n.creativity = clamp01(n.creativity + RISE.creativity * dt);
  n.laziness = clamp01(n.laziness + RISE.laziness * dt * (working ? 1.8 : 0.4));
  n.loneliness = clamp01(n.loneliness + RISE.loneliness * dt);

  // Medo é reativo: sobe com o clima, cai sozinho quando o mundo se acalma.
  const threat = isDangerous(ws.weather) ? severity(ws.weather) : 0;
  const fearTarget = clamp01(threat * 0.9 + (ws.weather.lightning > 0.5 ? 0.25 : 0));
  n.fear += (fearTarget - n.fear) * clamp01(dt * (fearTarget > n.fear ? 0.004 : 0.0012));

  // Felicidade tende ao humor de base, puxada por fome, medo e solidão.
  const baseline = clamp01(
    0.62 - n.hunger * 0.28 - n.thirst * 0.3 - n.fear * 0.4 - n.loneliness * 0.18 + n.hope * 0.2,
  );
  n.happiness += (baseline - n.happiness) * clamp01(dt * 0.0006);

  // Esperança decai devagar e é reacendida por eventos (navio, invenção, chuva boa).
  n.hope = clamp01(n.hope - dt * (1 / (60 * HOUR)));
}

export function satisfy(n: Needs, key: keyof Needs, amount: number): void {
  n[key] = clamp01(n[key] - amount);
}

export function raise(n: Needs, key: keyof Needs, amount: number): void {
  n[key] = clamp01(n[key] + amount);
}

/** Curva de urgência: necessidade baixa quase não pesa; acima de 0.6 domina tudo. */
export function urgency(v: number): number {
  return Math.pow(smoothstep(0.15, 1, v), 2.1) * 4;
}

/** Curva suave para desejos (curiosidade, criatividade): nunca vira obsessão. */
export function desire(v: number): number {
  return smoothstep(0.2, 0.95, v) * 1.35;
}

export function overallMood(n: Needs): number {
  return clamp01(n.happiness * 0.55 + n.hope * 0.25 + (1 - n.fear) * 0.2);
}

/** Frase curta para depuração e para o HUD discreto. */
export function dominantNeed(n: Needs): string {
  const pairs: [string, number][] = [
    ['sede', urgency(n.thirst)],
    ['fome', urgency(n.hunger)],
    ['cansaço', urgency(n.rest)],
    ['medo', urgency(n.fear) * 1.4],
    ['curiosidade', desire(n.curiosity)],
    ['criatividade', desire(n.creativity)],
    ['preguiça', desire(n.laziness)],
    ['solidão', desire(n.loneliness)],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0][1] > 0.05 ? pairs[0][0] : 'sossego';
}

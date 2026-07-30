import { clamp01 } from '../core/math.ts';
import type { Skills } from '../sim/components.ts';

/**
 * Habilidades crescem com uso e com retorno decrescente. Ninguém vira mestre
 * pescador em uma tarde — mas em três estações a diferença aparece na animação,
 * na velocidade e nas histórias que ficam disponíveis.
 */

export const SKILL_NAMES = [
  'pesca', 'carpintaria', 'fogo', 'agricultura', 'arte', 'navegação',
  'astronomia', 'cozinha', 'engenhoca', 'natação',
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export function level(s: Skills, name: string): number {
  return clamp01(s[name] ?? 0);
}

/** Ganho com retorno decrescente: quanto mais sabe, menos aprende por repetição. */
export function practice(s: Skills, name: string, amount: number): number {
  const cur = level(s, name);
  const gain = amount * (1 - cur) * (1 - cur);
  s[name] = clamp01(cur + gain);
  return s[name];
}

/** Marcos que valem uma linha na crônica. */
export function crossedMilestone(before: number, after: number): number | null {
  for (const m of [0.25, 0.5, 0.75, 0.95]) {
    if (before < m && after >= m) return m;
  }
  return null;
}

export function skillTitle(name: string, value: number): string {
  const tiers = ['desastrado', 'aprendiz', 'jeitoso', 'bom', 'mestre'];
  const i = Math.min(tiers.length - 1, Math.floor(value * tiers.length));
  return `${tiers[i]} em ${name}`;
}

export function bestSkill(s: Skills): { name: string; value: number } {
  let best = { name: 'nada ainda', value: 0 };
  for (const [k, v] of Object.entries(s)) {
    if (v > best.value) best = { name: k, value: v };
  }
  return best;
}

import { TAU } from '../core/math.ts';
import type { SkyTime } from './calendar.ts';

/**
 * Maré semidiurna com modulação lunar: marés de sizígia na lua cheia e nova,
 * marés mortas nos quartos. O náufrago aprende a contar com isso.
 */
export function tideAt(sky: SkyTime): number {
  const semidiurnal = Math.sin((sky.t * 2 + sky.day * 0.13) * TAU);
  // Amplitude máxima quando sol e lua se alinham (fase 0 ou 1) ou se opõem (0.5).
  const spring = 0.55 + 0.45 * Math.abs(Math.cos(sky.moonPhase * TAU));
  return semidiurnal * spring * 1.65;
}

/** Altura de onda base — cresce com o vento e alimenta o shader do oceano. */
export function swell(wind: number, tide: number): number {
  return 0.35 + wind * 1.35 + Math.abs(tide) * 0.12;
}

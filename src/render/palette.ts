import { clamp01, desaturate, lerp, mixColor, mulColor, scaleColor, smoothstep, type RGB } from '../core/math.ts';
import type { SkyTime } from '../sim/calendar.ts';
import type { Weather } from '../sim/weather.ts';
import { phenomenonIntensity } from '../sim/weather.ts';

/**
 * Modelo de luz da ilha. É pintura, não física: as cores são escolhidas para
 * lembrar animação tradicional — céus chapados, sombras coloridas, nada de cinza.
 */

const NIGHT_ZENITH: RGB = [0.03, 0.05, 0.14];
const NIGHT_HORIZON: RGB = [0.08, 0.11, 0.24];
const DAWN_ZENITH: RGB = [0.25, 0.34, 0.62];
const DAWN_HORIZON: RGB = [0.98, 0.62, 0.42];
const DAY_ZENITH: RGB = [0.24, 0.49, 0.82];
const DAY_HORIZON: RGB = [0.72, 0.86, 0.95];

const SUN_DAY: RGB = [1.0, 0.97, 0.88];
const SUN_GOLD: RGB = [1.0, 0.68, 0.38];
const MOONLIGHT: RGB = [0.55, 0.68, 1.0];

export interface Lighting {
  /** 0 = noite fechada, 1 = meio-dia. */
  day: number;
  night: number;
  zenith: RGB;
  horizon: RGB;
  /** Cor e direção da luz principal (sol de dia, lua de noite). */
  key: RGB;
  keyX: number;
  keyY: number;
  /** Luz de preenchimento vinda do céu inteiro. */
  ambient: RGB;
  /** Rebote quente/frio vindo do chão e da água. */
  bounce: RGB;
  fog: RGB;
  fogK: number;
  /** Multiplicador global — HDR simplificado antes do tonemap. */
  exposure: number;
  /** 0..1, quanto o mundo está molhado (aumenta reflexo e satura cores). */
  wet: number;
  /** Clarão instantâneo do raio. */
  flash: number;
  sunUp: number;
  moonUp: number;
  /**
   * Croma global (1 = cheio, <1 = dessaturado). Tempo fechado e noite puxam as
   * cores para o cinza — é isso que impede a ilha de brilhar amarelo-neon numa
   * tempestade e dá o ar de pintura em vez de demonstração.
   */
  chroma: number;
}

export function computeLighting(sky: SkyTime, w: Weather): Lighting {
  const day = clamp01(sky.daylight);
  const dusk = sky.goldenHour;

  let zenith = mixColor(NIGHT_ZENITH, DAY_ZENITH, smoothstep(0.0, 0.75, day));
  let horizon = mixColor(NIGHT_HORIZON, DAY_HORIZON, smoothstep(0.0, 0.7, day));
  zenith = mixColor(zenith, DAWN_ZENITH, dusk * 0.75);
  horizon = mixColor(horizon, DAWN_HORIZON, dusk * 0.9);

  // Nuvem e chuva puxam tudo para o cinza-azulado e derrubam o contraste.
  const gloom = clamp01(w.cloud * 0.75 + w.rain * 0.4);
  zenith = desaturate(mixColor(zenith, [0.42, 0.46, 0.52], gloom * 0.55), gloom * 0.35);
  horizon = desaturate(mixColor(horizon, [0.62, 0.65, 0.7], gloom * 0.5), gloom * 0.3);

  const sunUp = clamp01(sky.sunAltitude * 3);
  const moonUp = clamp01(sky.moonAltitude * 3) * (0.35 + Math.abs(Math.cos(sky.moonPhase * Math.PI)) * 0.65);

  const sunColor = mixColor(SUN_DAY, SUN_GOLD, dusk);
  const keyStrength = sunUp * (1 - gloom * 0.7);
  const moonStrength = moonUp * (1 - day) * (1 - gloom * 0.6);

  const key = keyStrength > moonStrength
    ? scaleColor(sunColor, 0.85 + keyStrength * 0.6)
    : scaleColor(MOONLIGHT, 0.18 + moonStrength * 0.32);

  const keyX = keyStrength > moonStrength ? sky.sunAzimuth : sky.moonAzimuth;
  const keyY = Math.max(0.12, keyStrength > moonStrength ? sky.sunAltitude : sky.moonAltitude);

  const ambient = mixColor(scaleColor(horizon, 0.5), scaleColor(zenith, 0.6), 0.5);
  const bounce = mixColor([0.35, 0.42, 0.5], [0.85, 0.72, 0.5], day * 0.7);

  const fog = mixColor(horizon, [0.75, 0.8, 0.85], w.fog * 0.5);
  const fogK = clamp01(0.06 + w.fog * 0.85 + w.rain * 0.18);

  const eclipse = w.phenomenon === 'eclipse' ? phenomenonIntensity(w) : 0;
  const exposure = lerp(1.0, 0.22, eclipse) * lerp(1.0, 0.68, gloom * 0.6);

  return {
    day, night: 1 - day,
    zenith, horizon,
    key, keyX, keyY,
    ambient: scaleColor(ambient, exposure),
    bounce,
    fog, fogK,
    exposure,
    wet: clamp01(w.rain * 1.6),
    flash: w.lightning,
    sunUp, moonUp,
    chroma: clamp01(1 - gloom * 0.5 - (1 - day) * 0.22),
  };
}

/**
 * Ilumina uma cor base.
 * `up`  = quanto a superfície aponta para cima (0..1) — pega mais céu.
 * `side`= -1..1, quanto aponta para a direção da luz principal.
 * `depth` = profundidade no diorama, para perspectiva aérea.
 */
export function lit(base: RGB, l: Lighting, up = 0.6, side = 0, depth = 0): RGB {
  const facing = clamp01(0.55 + side * l.keyX * 0.45 + up * l.keyY * 0.5);
  let c = mulColor(base, [
    l.ambient[0] + l.key[0] * facing,
    l.ambient[1] + l.key[1] * facing,
    l.ambient[2] + l.key[2] * facing,
  ]);
  // Rebote do chão nas partes de baixo.
  c = mixColor(c, mulColor(base, l.bounce), (1 - up) * 0.22);
  // Croma: puxa para o cinza em tempo fechado e à noite. É o que impede a areia
  // e a folhagem de gritarem cores saturadas quando a luz não pede.
  if (l.chroma < 0.999) c = desaturate(c, 1 - l.chroma);
  if (l.flash > 0.01) c = mixColor(c, [1, 1, 0.96], l.flash * 0.55);
  // Perspectiva aérea: o que está longe some no ar.
  const aerial = clamp01((-depth) * 0.8) * (0.25 + l.fogK * 0.75);
  if (aerial > 0.001) c = mixColor(c, l.fog, aerial);
  return c;
}

/** Cor de sombra: nunca preta. Recebe a cor do céu — é isso que a faz parecer pintura. */
export function shadowColor(l: Lighting): RGB {
  return mixColor([0.08, 0.1, 0.18], l.zenith, 0.45);
}

export function waterColor(l: Lighting, deep = true): RGB {
  const shallow: RGB = [0.24, 0.62, 0.66];
  const abyss: RGB = [0.04, 0.16, 0.3];
  const base = deep ? abyss : shallow;
  return mulColor(base, [
    l.ambient[0] * 1.6 + l.key[0] * 0.35,
    l.ambient[1] * 1.6 + l.key[1] * 0.35,
    l.ambient[2] * 1.6 + l.key[2] * 0.4,
  ]);
}

export function foamColor(l: Lighting): RGB {
  return mixColor([0.92, 0.96, 0.98], l.horizon, 0.35);
}

/** Paletas de vegetação por estação: a ilha muda de roupa quatro vezes por ano. */
export function foliageColor(season: string, variation: number): RGB {
  const palettes: Record<string, [RGB, RGB]> = {
    primavera: [[0.29, 0.55, 0.24], [0.48, 0.7, 0.3]],
    verão: [[0.18, 0.45, 0.22], [0.36, 0.62, 0.26]],
    outono: [[0.52, 0.42, 0.16], [0.72, 0.5, 0.18]],
    inverno: [[0.24, 0.38, 0.3], [0.36, 0.47, 0.36]],
  };
  const [a, b] = palettes[season] ?? palettes.verão;
  return mixColor(a, b, variation);
}

export const SAND: RGB = [0.82, 0.75, 0.63];
export const SAND_WET: RGB = [0.6, 0.55, 0.47];
export const ROCK: RGB = [0.42, 0.4, 0.4];
export const ROCK_DARK: RGB = [0.3, 0.29, 0.31];
export const WOOD: RGB = [0.45, 0.31, 0.19];
export const WOOD_LIGHT: RGB = [0.62, 0.45, 0.28];
export const SKIN: RGB = [0.79, 0.58, 0.42];
export const CLOTH: RGB = [0.78, 0.74, 0.66];

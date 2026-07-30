import { SIM } from '../core/config.ts';
import { clamp01, lerp, TAU } from '../core/math.ts';

/** Um dia de mundo tem 1440 minutos, como o nosso. Só passa mais rápido. */
export const MINUTES_PER_DAY = 1440;

export type Season = 'primavera' | 'verão' | 'outono' | 'inverno';
export const SEASONS: readonly Season[] = ['primavera', 'verão', 'outono', 'inverno'];

export interface Calendar {
  /** Minutos de mundo acumulados desde o naufrágio. Nunca reinicia. */
  minutes: number;
}

export function newCalendar(startHour = 6.4): Calendar {
  return { minutes: startHour * 60 };
}

export function advance(cal: Calendar, dtSeconds: number): void {
  cal.minutes += dtSeconds * SIM.minutesPerSecond;
}

export interface SkyTime {
  /** Dia inteiro desde o naufrágio (0-based). */
  day: number;
  /** 0..1 dentro do dia. 0 = meia-noite. */
  t: number;
  hour: number;
  season: Season;
  seasonIndex: number;
  /** 0..1 dentro da estação. */
  seasonT: number;
  /** -1 (nadir) .. 1 (zênite). */
  sunAltitude: number;
  /** -1 (leste) .. 1 (oeste), para posicionar o disco e a sombra. */
  sunAzimuth: number;
  moonAltitude: number;
  moonAzimuth: number;
  /** 0 = lua nova, 0.5 = cheia. */
  moonPhase: number;
  /** 0 = noite fechada, 1 = pleno dia. */
  daylight: number;
  /** Picos em 1 no nascer e no pôr do sol. */
  goldenHour: number;
  /** Ano de mundo (4 estações). */
  year: number;
}

export function readSky(cal: Calendar): SkyTime {
  const day = Math.floor(cal.minutes / MINUTES_PER_DAY);
  const t = (cal.minutes % MINUTES_PER_DAY) / MINUTES_PER_DAY;
  const seasonPos = day / SIM.daysPerSeason;
  const seasonIndex = Math.floor(seasonPos) % 4;
  const season = SEASONS[seasonIndex];
  const seasonT = seasonPos - Math.floor(seasonPos);
  const year = Math.floor(day / (SIM.daysPerSeason * 4));

  // Inclinação sazonal: verões com dias longos, invernos com sol baixo.
  const yearPhase = (day / (SIM.daysPerSeason * 4)) * TAU;
  const tilt = Math.sin(yearPhase - Math.PI / 2) * 0.28;

  const sunAngle = (t - 0.25) * TAU;
  const sunAltitude = Math.sin(sunAngle) * (0.86 + tilt * 0.5) + tilt * 0.34;
  const sunAzimuth = -Math.cos(sunAngle);

  const moonPhase = ((day + t) % SIM.lunarCycle) / SIM.lunarCycle;
  const moonAngle = sunAngle + moonPhase * TAU + Math.PI;
  const moonAltitude = Math.sin(moonAngle) * 0.9;
  const moonAzimuth = -Math.cos(moonAngle);

  const daylight = clamp01((sunAltitude + 0.16) / 0.42);
  const goldenHour = clamp01(1 - Math.abs(sunAltitude) / 0.18) * clamp01(daylight * 4);

  return {
    day, t, hour: t * 24, season, seasonIndex, seasonT, year,
    sunAltitude, sunAzimuth, moonAltitude, moonAzimuth, moonPhase,
    daylight, goldenHour,
  };
}

/** Temperatura relativa 0..1 — alimenta comportamento (sede, sesta) e cor da vegetação. */
export function temperature(sky: SkyTime): number {
  const bySeason: Record<Season, number> = { primavera: 0.55, verão: 0.85, outono: 0.5, inverno: 0.28 };
  const base = bySeason[sky.season];
  const daily = lerp(-0.18, 0.16, clamp01(sky.daylight));
  return clamp01(base + daily);
}

export function formatClock(sky: SkyTime): string {
  const h = Math.floor(sky.hour);
  const m = Math.floor((sky.hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function moonName(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return 'lua nova';
  if (phase < 0.22) return 'crescente';
  if (phase < 0.28) return 'quarto crescente';
  if (phase < 0.47) return 'gibosa crescente';
  if (phase < 0.53) return 'lua cheia';
  if (phase < 0.72) return 'gibosa minguante';
  if (phase < 0.78) return 'quarto minguante';
  return 'minguante';
}

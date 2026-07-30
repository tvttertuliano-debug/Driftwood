import { Rng } from '../core/rng.ts';
import { approach, clamp01, lerp } from '../core/math.ts';
import type { SkyTime, Season } from './calendar.ts';

export type WeatherKind =
  | 'limpo'
  | 'nuvens'
  | 'encoberto'
  | 'garoa'
  | 'chuva'
  | 'tempestade'
  | 'neblina'
  | 'furacão';

/** Fenômenos que se sobrepõem ao clima base e duram pouco. São o "brilho" do céu. */
export type SkyPhenomenon = 'arco-íris' | 'aurora' | 'eclipse' | 'meteoros' | 'nenhum';

export interface Weather {
  kind: WeatherKind;
  /** Segundos de mundo restantes no estado atual. */
  remaining: number;
  /** Valores suavizados que o render consome — nunca saltam. */
  cloud: number;
  rain: number;
  wind: number;
  fog: number;
  lightning: number;
  /** Alvos do estado atual. */
  targetCloud: number;
  targetRain: number;
  targetWind: number;
  targetFog: number;
  phenomenon: SkyPhenomenon;
  phenomenonTime: number;
  phenomenonDuration: number;
  /** Contador para o raio seguinte na tempestade. */
  nextBolt: number;
  /** Direção dominante do vento: -1 oeste, 1 leste. */
  windDir: number;
}

export function newWeather(): Weather {
  return {
    kind: 'limpo', remaining: 600,
    cloud: 0.15, rain: 0, wind: 0.25, fog: 0.05, lightning: 0,
    targetCloud: 0.15, targetRain: 0, targetWind: 0.25, targetFog: 0.05,
    phenomenon: 'nenhum', phenomenonTime: 0, phenomenonDuration: 0,
    nextBolt: 8, windDir: 1,
  };
}

interface Profile {
  cloud: [number, number];
  rain: [number, number];
  wind: [number, number];
  fog: [number, number];
  /** Duração em minutos de mundo. */
  minutes: [number, number];
}

const PROFILES: Record<WeatherKind, Profile> = {
  limpo:      { cloud: [0.02, 0.2], rain: [0, 0],       wind: [0.1, 0.4],  fog: [0, 0.08],   minutes: [180, 900] },
  nuvens:     { cloud: [0.3, 0.6],  rain: [0, 0],       wind: [0.2, 0.5],  fog: [0, 0.12],   minutes: [120, 500] },
  encoberto:  { cloud: [0.7, 0.95], rain: [0, 0.05],    wind: [0.25, 0.6], fog: [0.05, 0.2], minutes: [120, 420] },
  garoa:      { cloud: [0.6, 0.85], rain: [0.15, 0.35], wind: [0.2, 0.5],  fog: [0.1, 0.3],  minutes: [40, 180] },
  chuva:      { cloud: [0.8, 1],    rain: [0.45, 0.8],  wind: [0.35, 0.7], fog: [0.1, 0.25], minutes: [50, 220] },
  tempestade: { cloud: [0.95, 1],   rain: [0.8, 1],     wind: [0.7, 1],    fog: [0.05, 0.2], minutes: [30, 110] },
  neblina:    { cloud: [0.4, 0.7],  rain: [0, 0.05],    wind: [0, 0.2],    fog: [0.55, 0.9], minutes: [60, 200] },
  furacão:    { cloud: [1, 1],      rain: [0.9, 1],     wind: [1, 1.35],   fog: [0, 0.15],   minutes: [25, 70] },
};

/** Matriz de transição por estação: a ilha tem climas com personalidade anual. */
const TRANSITIONS: Record<Season, Partial<Record<WeatherKind, number>>> = {
  primavera: { limpo: 26, nuvens: 24, encoberto: 12, garoa: 16, chuva: 12, tempestade: 5, neblina: 5, furacão: 0.2 },
  verão:     { limpo: 40, nuvens: 20, encoberto: 8,  garoa: 6,  chuva: 9,  tempestade: 12, neblina: 2, furacão: 1.2 },
  outono:    { limpo: 18, nuvens: 24, encoberto: 16, garoa: 14, chuva: 14, tempestade: 7, neblina: 9, furacão: 0.8 },
  inverno:   { limpo: 14, nuvens: 22, encoberto: 22, garoa: 12, chuva: 16, tempestade: 8, neblina: 12, furacão: 0.4 },
};

export function stepWeather(w: Weather, sky: SkyTime, dt: number, rng: Rng): WeatherKind | null {
  w.remaining -= dt;
  let changed: WeatherKind | null = null;

  if (w.remaining <= 0) {
    const table = TRANSITIONS[sky.season];
    const kinds = Object.keys(table) as WeatherKind[];
    // Nunca repete o mesmo estado em seguida: o céu precisa contar uma história.
    const next = rng.weighted(kinds, (k) => (k === w.kind ? 0 : (table[k] ?? 0))) ?? 'nuvens';
    w.kind = next;
    changed = next;
    const p = PROFILES[next];
    w.remaining = rng.range(p.minutes[0], p.minutes[1]) * 60;
    w.targetCloud = rng.range(p.cloud[0], p.cloud[1]);
    w.targetRain = rng.range(p.rain[0], p.rain[1]);
    w.targetWind = rng.range(p.wind[0], p.wind[1]);
    w.targetFog = rng.range(p.fog[0], p.fog[1]);
    if (rng.chance(0.25)) w.windDir = -w.windDir;
  }

  // Transições lentas: o clima nunca "pisca".
  const rate = w.kind === 'furacão' ? 0.35 : 0.12;
  w.cloud = approach(w.cloud, w.targetCloud, rate, dt);
  w.rain = approach(w.rain, w.targetRain, rate, dt);
  w.wind = approach(w.wind, w.targetWind + Math.sin(sky.t * 12) * 0.04, rate * 1.4, dt);
  w.fog = approach(w.fog, w.targetFog * (1 - sky.daylight * 0.55), rate * 0.8, dt);

  // Raios.
  w.lightning = Math.max(0, w.lightning - dt * 3.2);
  if (w.kind === 'tempestade' || w.kind === 'furacão') {
    w.nextBolt -= dt;
    if (w.nextBolt <= 0) {
      w.lightning = 1;
      w.nextBolt = rng.range(4, 26) / (w.kind === 'furacão' ? 2 : 1);
    }
  }

  stepPhenomenon(w, sky, dt, rng);
  return changed;
}

function stepPhenomenon(w: Weather, sky: SkyTime, dt: number, rng: Rng): void {
  if (w.phenomenon !== 'nenhum') {
    w.phenomenonTime += dt;
    if (w.phenomenonTime >= w.phenomenonDuration) {
      w.phenomenon = 'nenhum';
      w.phenomenonTime = 0;
    }
    return;
  }

  // As probabilidades abaixo são POR SEGUNDO DE MUNDO. Um dia tem 86 400 deles —
  // é fácil errar a ordem de grandeza aqui e transformar um prodígio em rotina.
  const perDay = (times: number) => (times / 86400) * dt;

  // Arco-íris: chuva acabando + sol no céu. Condição física, não sorteio puro.
  if (w.rain > 0.05 && w.targetRain < 0.05 && sky.daylight > 0.35 && rng.chance(perDay(24))) {
    begin(w, 'arco-íris', rng.range(90, 260));
    return;
  }
  // Aurora: noite fria e limpa. Uma vez a cada poucas semanas de inverno.
  if (sky.daylight < 0.08 && w.cloud < 0.3 && (sky.season === 'inverno' || sky.season === 'outono') && rng.chance(perDay(0.35))) {
    begin(w, 'aurora', rng.range(400, 1200));
    return;
  }
  // Meteoros: madrugada limpa, umas poucas vezes por estação.
  if (sky.daylight < 0.05 && w.cloud < 0.35 && rng.chance(perDay(0.5))) {
    begin(w, 'meteoros', rng.range(200, 700));
    return;
  }
  // Eclipse: uma vez a cada muitos meses de mundo, e só na lua nova.
  if (sky.daylight > 0.6 && (sky.moonPhase < 0.02 || sky.moonPhase > 0.98) && rng.chance(perDay(1 / 90))) {
    begin(w, 'eclipse', rng.range(150, 260));
  }
}

function begin(w: Weather, p: SkyPhenomenon, duration: number): void {
  w.phenomenon = p;
  w.phenomenonTime = 0;
  w.phenomenonDuration = duration;
}

/** 0..1 — quanto o fenômeno está "aberto" (entra e sai suavemente). */
export function phenomenonIntensity(w: Weather): number {
  if (w.phenomenon === 'nenhum') return 0;
  const t = clamp01(w.phenomenonTime / w.phenomenonDuration);
  return Math.sin(t * Math.PI);
}

/** Severidade agregada: usada por medo, dano em construções e erosão. */
export function severity(w: Weather): number {
  return clamp01(w.rain * 0.5 + w.wind * 0.6 + (w.kind === 'furacão' ? 0.5 : 0));
}

export function describe(w: Weather): string {
  const s: Record<WeatherKind, string> = {
    limpo: 'céu limpo',
    nuvens: 'nuvens passeando',
    encoberto: 'céu fechado',
    garoa: 'garoa fina',
    chuva: 'chuva',
    tempestade: 'tempestade',
    neblina: 'neblina',
    furacão: 'furacão',
  };
  return s[w.kind];
}

export function isWet(w: Weather): boolean {
  return w.rain > 0.12;
}

export function isDangerous(w: Weather): boolean {
  return w.kind === 'tempestade' || w.kind === 'furacão';
}

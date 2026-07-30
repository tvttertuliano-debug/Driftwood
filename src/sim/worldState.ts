import { Rng } from '../core/rng.ts';
import { Island } from './island.ts';
import { newCalendar, readSky, type Calendar, type SkyTime } from './calendar.ts';
import { newWeather, type Weather } from './weather.ts';
import { tideAt } from './tides.ts';

/**
 * Recurso global do mundo: tudo que não pertence a uma entidade específica.
 * Em ECS isso é um "resource" — dado compartilhado, jamais lógica.
 */

export interface ChronicleEntry {
  /** Dia de mundo. */
  day: number;
  hour: number;
  text: string;
  /** Categoria, para o renderizador escolher o tom. */
  tone: 'rotina' | 'conquista' | 'perda' | 'maravilha' | 'raro';
}

export interface WorldState {
  seed: number;
  cal: Calendar;
  weather: Weather;
  island: Island;
  /** Derivados recalculados a cada passo. */
  sky: SkyTime;
  tide: number;
  /** Segundos de mundo desde o naufrágio. */
  worldSeconds: number;

  /** Memória de longo prazo: o que já aconteceu, o que existe, o que ele sabe. */
  flags: Record<string, number>;
  /** Contadores: peixes pescados, tempestades sobrevividas, conchas... */
  stats: Record<string, number>;
  /** Última vez (em segundos de mundo) que cada história rodou. */
  storyCooldowns: Record<string, number>;
  /** Vaga "obra": a construção em andamento, que pode levar dias. */
  activeStory: string | null;
  activeStoryStep: number;
  activeStoryTime: number;
  /** Vaga "acontecimento": o que acontece com o mundo enquanto ele constrói. */
  sideStory: string | null;
  sideStoryStep: number;
  sideStoryTime: number;

  chronicle: ChronicleEntry[];

  /** Fluxos de aleatoriedade separados: clima nunca "rouba" números da narrativa. */
  rngWeather: Rng;
  rngStory: Rng;
  rngRare: Rng;
  rngAmbient: Rng;
  /** Fluxo das decisões do náufrago — é o que faz duas manhãs iguais divergirem. */
  rngMind: Rng;
}

export function createWorldState(seed: number): WorldState {
  const cal = newCalendar(6.2);
  const island = new Island(seed);
  const state: WorldState = {
    seed,
    cal,
    weather: newWeather(),
    island,
    sky: readSky(cal),
    tide: 0,
    worldSeconds: cal.minutes * 60,
    flags: {},
    stats: {},
    storyCooldowns: {},
    activeStory: null,
    activeStoryStep: 0,
    activeStoryTime: 0,
    sideStory: null,
    sideStoryStep: 0,
    sideStoryTime: 0,
    chronicle: [],
    rngWeather: new Rng(seed ^ 0xa11ce),
    rngStory: new Rng(seed ^ 0x570b1e),
    rngRare: new Rng(seed ^ 0xdeadbe),
    rngAmbient: new Rng(seed ^ 0x0cea11),
    rngMind: new Rng(seed ^ 0x3d1f2a),
  };
  state.tide = tideAt(state.sky);
  return state;
}

export function flag(w: WorldState, name: string): number {
  return w.flags[name] ?? 0;
}

export function setFlag(w: WorldState, name: string, value = 1): void {
  w.flags[name] = value;
}

export function bump(w: WorldState, stat: string, by = 1): number {
  w.stats[stat] = (w.stats[stat] ?? 0) + by;
  return w.stats[stat];
}

export function stat(w: WorldState, name: string): number {
  return w.stats[name] ?? 0;
}

/** Registra na crônica. É a única "voz" do jogo — curta, seca, sem explicar a piada. */
export function chronicle(w: WorldState, text: string, tone: ChronicleEntry['tone'] = 'rotina'): void {
  w.chronicle.push({ day: w.sky.day, hour: w.sky.hour, text, tone });
  if (w.chronicle.length > 400) w.chronicle.splice(0, w.chronicle.length - 400);
}

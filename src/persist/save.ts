import { PERSIST } from '../core/config.ts';
import { World, type SerializedWorld } from '../core/ecs.ts';
import { Island } from '../sim/island.ts';
import { readSky } from '../sim/calendar.ts';
import { tideAt } from '../sim/tides.ts';
import { parseSeed, Rng } from '../core/rng.ts';
import type { WorldState } from '../sim/worldState.ts';

/**
 * Persistência. O mundo continua exatamente de onde parou: a árvore que estava
 * crescendo continua crescendo; a cabana continua torta do mesmo jeito.
 */

export interface SaveBlob {
  version: number;
  savedAt: number;
  seed: number;
  minutes: number;
  worldSeconds: number;
  /** Ausente em saves antigos. */
  steps?: number;
  weather: unknown;
  flags: Record<string, number>;
  stats: Record<string, number>;
  storyCooldowns: Record<string, number>;
  activeStory: string | null;
  activeStoryStep: number;
  activeStoryTime: number;
  sideStory: string | null;
  sideStoryStep: number;
  sideStoryTime: number;
  chronicle: unknown[];
  erosion: number[];
  rng: { weather: number; story: number; rare: number; ambient: number; mind: number };
  ecs: SerializedWorld;
}

interface Backend {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
}

/** No desktop (Electron) o preload expõe `driftwood`; no navegador, localStorage. */
function backend(): Backend {
  const bridge = (window as any).driftwood;
  if (bridge?.load && bridge?.save) {
    return {
      read: (k) => bridge.load(k),
      write: (k, v) => bridge.save(k, v),
      clear: (k) => bridge.clear?.(k) ?? Promise.resolve(),
    };
  }
  return {
    async read(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    async write(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* cota cheia ou modo privado: seguimos sem salvar */
      }
    },
    async clear(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignora */
      }
    },
  };
}

/** Fotografia completa do mundo, pronta para virar JSON. Não toca em disco. */
export function buildSave(world: World, ws: WorldState, savedAt = Date.now()): SaveBlob {
  return {
    version: PERSIST.version,
    savedAt,
    seed: ws.seed,
    minutes: ws.cal.minutes,
    worldSeconds: ws.worldSeconds,
    steps: ws.steps,
    weather: { ...ws.weather },
    flags: ws.flags,
    stats: ws.stats,
    storyCooldowns: ws.storyCooldowns,
    activeStory: ws.activeStory,
    activeStoryStep: ws.activeStoryStep,
    activeStoryTime: ws.activeStoryTime,
    sideStory: ws.sideStory,
    sideStoryStep: ws.sideStoryStep,
    sideStoryTime: ws.sideStoryTime,
    chronicle: ws.chronicle.slice(-120),
    erosion: ws.island.serializeErosion(),
    rng: {
      weather: ws.rngWeather.state,
      story: ws.rngStory.state,
      rare: ws.rngRare.state,
      ambient: ws.rngAmbient.state,
      mind: ws.rngMind.state,
    },
    ecs: world.serialize(),
  };
}

export async function saveWorld(world: World, ws: WorldState): Promise<void> {
  await backend().write(PERSIST.key, JSON.stringify(buildSave(world, ws)));
}

export interface LoadedWorld {
  world: World;
  ws: WorldState;
}

/** Onde fica a cópia de um save que não pôde ser usado. Só a última é guardada. */
export const REJECTED_KEY = `${PERSIST.key}.rejeitado`;

/** Motivo pelo qual um save não pode ser aplicado, ou null se ele serve. */
export function saveProblem(blob: unknown): string | null {
  if (typeof blob !== 'object' || blob === null) return 'não é um objeto';
  const b = blob as Partial<SaveBlob>;
  if (b.version !== PERSIST.version) return `versão ${String(b.version)}, esperada ${PERSIST.version}`;
  if (parseSeed(b.seed) === null) return `semente inválida (${String(b.seed)})`;
  if (typeof b.minutes !== 'number' || !Number.isFinite(b.minutes)) return 'relógio ausente';
  if (typeof b.ecs !== 'object' || b.ecs === null || typeof b.ecs.components !== 'object') return 'mundo (ecs) ausente';
  return null;
}

/**
 * Guarda de lado um save que não vai ser usado. Sem isto, o primeiro autosave
 * do mundo novo (45 s depois) apagava o antigo para sempre — numa troca de
 * versão, ou por um arquivo corrompido, o usuário perdia meses de ilha calado.
 */
export async function setAsideSave(raw: string, reason: string): Promise<void> {
  console.warn(`[driftwood] save não usado (${reason}); cópia guardada em "${REJECTED_KEY}".`);
  await backend().write(REJECTED_KEY, raw);
}

/** Devolve null se não houver save válido — aí o mundo nasce novo. */
export async function loadWorld(): Promise<{ blob: SaveBlob; raw: string } | null> {
  const raw = await backend().read(PERSIST.key);
  if (!raw) return null;
  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    await setAsideSave(raw, 'JSON ilegível');
    return null;
  }
  const problem = saveProblem(blob);
  if (problem) {
    await setAsideSave(raw, problem);
    return null;
  }
  return { blob: blob as SaveBlob, raw };
}

/** Aplica um save sobre um mundo recém-criado com a mesma semente. */
export function applySave(blob: any, world: World, ws: WorldState): void {
  ws.cal.minutes = blob.minutes;
  ws.worldSeconds = blob.worldSeconds;
  ws.steps = typeof blob.steps === 'number' ? blob.steps : 0;
  Object.assign(ws.weather, blob.weather);
  ws.flags = blob.flags ?? {};
  ws.stats = blob.stats ?? {};
  ws.storyCooldowns = blob.storyCooldowns ?? {};
  ws.activeStory = blob.activeStory ?? null;
  ws.activeStoryStep = blob.activeStoryStep ?? 0;
  ws.activeStoryTime = blob.activeStoryTime ?? 0;
  // Saves feitos antes das duas vagas simplesmente chegam sem estes campos.
  ws.sideStory = blob.sideStory ?? null;
  ws.sideStoryStep = blob.sideStoryStep ?? 0;
  ws.sideStoryTime = blob.sideStoryTime ?? 0;
  ws.chronicle = blob.chronicle ?? [];
  ws.island.loadErosion(blob.erosion);
  if (blob.rng) {
    ws.rngWeather.state = blob.rng.weather;
    ws.rngStory.state = blob.rng.story;
    ws.rngRare.state = blob.rng.rare;
    ws.rngAmbient.state = blob.rng.ambient;
    ws.rngMind.state = blob.rng.mind;
  }
  world.deserialize(blob.ecs);
  ws.sky = readSky(ws.cal);
  ws.tide = tideAt(ws.sky);
}

export async function wipeSave(): Promise<void> {
  await backend().clear(PERSIST.key);
}

/** Semente do save. `loadWorld` só devolve saves com semente válida. */
export function savedSeed(blob: SaveBlob): number {
  return parseSeed(blob.seed)!;
}

import { PERSIST } from '../core/config.ts';
import { World, type SerializedWorld } from '../core/ecs.ts';
import { Island } from '../sim/island.ts';
import { readSky } from '../sim/calendar.ts';
import { tideAt } from '../sim/tides.ts';
import { Rng } from '../core/rng.ts';
import type { WorldState } from '../sim/worldState.ts';

/**
 * Persistência. O mundo continua exatamente de onde parou: a árvore que estava
 * crescendo continua crescendo; a cabana continua torta do mesmo jeito.
 */

interface SaveBlob {
  version: number;
  savedAt: number;
  seed: number;
  minutes: number;
  worldSeconds: number;
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

export async function saveWorld(world: World, ws: WorldState): Promise<void> {
  const blob: SaveBlob = {
    version: PERSIST.version,
    savedAt: Date.now(),
    seed: ws.seed,
    minutes: ws.cal.minutes,
    worldSeconds: ws.worldSeconds,
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
  await backend().write(PERSIST.key, JSON.stringify(blob));
}

export interface LoadedWorld {
  world: World;
  ws: WorldState;
}

/** Devolve null se não houver save válido — aí o mundo nasce novo. */
export async function loadWorld(): Promise<{ blob: SaveBlob } | null> {
  const raw = await backend().read(PERSIST.key);
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as SaveBlob;
    if (blob.version !== PERSIST.version) return null;
    return { blob };
  } catch {
    return null;
  }
}

/** Aplica um save sobre um mundo recém-criado com a mesma semente. */
export function applySave(blob: any, world: World, ws: WorldState): void {
  ws.cal.minutes = blob.minutes;
  ws.worldSeconds = blob.worldSeconds;
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

export function savedSeed(blob: any): number {
  return typeof blob?.seed === 'number' ? blob.seed : Math.floor(Math.random() * 2 ** 31);
}

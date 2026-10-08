import { CCritter, CNeeds, CRare, CTransform, CVisual } from '../sim/components.ts';
import { bump, flag, narrate, setFlag } from '../sim/worldState.ts';
import { raise, satisfy } from '../ai/needs.ts';
import { spawnProp } from '../sim/queries.ts';
import type { StoryCtx } from './types.ts';
import type { AssetId } from '../art/assets/ids.ts';

/**
 * Eventos raros. As probabilidades são deliberadamente cruéis.
 * `perDay` = chance esperada por dia de mundo (1 dia ≈ 12 minutos reais).
 * Algumas coisas aqui um espectador pode nunca ver. É esse o ponto.
 */

export interface RareEvent {
  id: string;
  perDay: number;
  /** Condição dura. Sem isso nem entra no sorteio. */
  requires?: (c: StoryCtx) => boolean;
  line: string;
  tone?: 'maravilha' | 'raro' | 'perda';
  spawn: (c: StoryCtx) => void;
}

function horizonEntity(c: StoryCtx, brush: AssetId, ttl: number, y = 1.2, scale = 1): void {
  const fromLeft = c.rng.chance(0.5);
  const x = fromLeft ? c.ws.island.shoreLeft - 90 : c.ws.island.shoreRight + 90;
  const e = c.world.create();
  c.world.add(e, CTransform, { x, y, depth: -0.85, facing: fromLeft ? 1 : -1, scale, rot: 0 });
  c.world.add(e, CVisual, { brush, seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0 });
  c.world.add(e, CRare, { event: brush, ttl, phase: 0 });
}

function nearEntity(c: StoryCtx, brush: AssetId, ttl: number, dy = 0, scale = 1): void {
  const x = c.ws.island.clampToLand((c.world.get(c.self, CTransform)?.x ?? 0) + c.rng.range(-30, 30));
  const e = c.world.create();
  c.world.add(e, CTransform, { x, y: c.ws.island.surfaceAt(x) + dy, depth: c.rng.range(-0.2, 0.2), facing: c.rng.chance(0.5) ? 1 : -1, scale, rot: 0 });
  c.world.add(e, CVisual, { brush, seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.6 });
  c.world.add(e, CRare, { event: brush, ttl, phase: 0 });
}

const hope = (c: StoryCtx, v: number) => {
  const n = c.world.get(c.self, CNeeds);
  if (n) raise(n, 'hope', v);
};
const scare = (c: StoryCtx, v: number) => {
  const n = c.world.get(c.self, CNeeds);
  if (n) raise(n, 'fear', v);
};
const delight = (c: StoryCtx, v: number) => {
  const n = c.world.get(c.self, CNeeds);
  if (n) {
    raise(n, 'happiness', v);
    satisfy(n, 'curiosity', v);
  }
};

export const RARE_EVENTS: RareEvent[] = [
  {
    id: 'navio',
    perDay: 1 / 22,
    requires: (c) => c.ws.sky.daylight > 0.3 && c.ws.weather.fog < 0.4,
    line: 'Um navio cruzou o horizonte. Longe. Muito longe.',
    tone: 'raro',
    spawn: (c) => {
      horizonEntity(c, 'navio', 260, 1.4, 1);
      setFlag(c.ws, 'algo-no-horizonte');
      hope(c, 0.5);
      bump(c.ws, 'navios-vistos');
    },
  },
  {
    id: 'navio-pirata',
    perDay: 1 / 90,
    requires: (c) => c.ws.sky.daylight < 0.35,
    line: 'Passou um navio de velas negras. Ninguém a bordo olhou para a ilha.',
    tone: 'raro',
    spawn: (c) => {
      horizonEntity(c, 'navio-pirata', 300, 1.4, 1.15);
      setFlag(c.ws, 'algo-no-horizonte');
      scare(c, 0.15);
    },
  },
  {
    id: 'submarino',
    perDay: 1 / 140,
    line: 'Um periscópio subiu, girou devagar e afundou de novo.',
    tone: 'raro',
    spawn: (c) => {
      horizonEntity(c, 'submarino', 150, 0.4, 0.8);
      hope(c, 0.3);
    },
  },
  {
    id: 'baleia',
    perDay: 1 / 55,
    line: 'Uma baleia soprou perto demais da arrebentação.',
    tone: 'maravilha',
    spawn: (c) => {
      horizonEntity(c, 'baleia', 200, 0.6, 1.2);
      delight(c, 0.35);
    },
  },
  {
    id: 'ovni',
    perDay: 1 / 260,
    requires: (c) => c.ws.sky.daylight < 0.08,
    line: 'Uma luz desceu do céu, parou, e subiu de novo em silêncio absoluto.',
    tone: 'raro',
    spawn: (c) => {
      nearEntity(c, 'ovni', 90, 42, 1);
      scare(c, 0.3);
      delight(c, 0.4);
      bump(c.ws, 'ovnis');
    },
  },
  {
    id: 'sereia',
    perDay: 1 / 320,
    requires: (c) => c.ws.sky.moonPhase > 0.45 && c.ws.sky.moonPhase < 0.55 && c.ws.sky.daylight < 0.1,
    line: 'Havia alguém sentado na pedra, cantando. Quando ele olhou de novo, não havia.',
    tone: 'raro',
    spawn: (c) => {
      const x = c.ws.island.shoreRight + 12;
      const e = c.world.create();
      c.world.add(e, CTransform, { x, y: 2.5, depth: -0.3, facing: -1, scale: 1, rot: 0 });
      c.world.add(e, CVisual, { brush: 'sereia', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0 });
      c.world.add(e, CRare, { event: 'sereia', ttl: 110, phase: 0 });
      delight(c, 0.5);
    },
  },
  {
    id: 'kraken',
    perDay: 1 / 700,
    requires: (c) => c.ws.weather.kind === 'tempestade' || c.ws.weather.kind === 'furacão',
    line: 'Alguma coisa muito grande se moveu sob a água durante a tempestade.',
    tone: 'raro',
    spawn: (c) => {
      horizonEntity(c, 'kraken', 130, 0.8, 1.6);
      scare(c, 0.8);
      bump(c.ws, 'krakens');
    },
  },
  {
    id: 'vulcão',
    perDay: 1 / 1100,
    line: 'No horizonte, uma ilha nova começou a sair da água, fumegando.',
    tone: 'raro',
    spawn: (c) => {
      horizonEntity(c, 'vulcão', 900, 2.5, 1.4);
      delight(c, 0.6);
      setFlag(c.ws, 'vulcão-visto');
    },
  },
  {
    id: 'ilha-flutuante',
    perDay: 1 / 800,
    requires: (c) => c.ws.weather.cloud > 0.5,
    line: 'Entre as nuvens passou um pedaço de terra com árvores penduradas.',
    tone: 'raro',
    spawn: (c) => {
      const e = c.world.create();
      c.world.add(e, CTransform, { x: c.ws.island.shoreLeft - 60, y: 68, depth: -0.9, facing: 1, scale: 1.2, rot: 0 });
      c.world.add(e, CVisual, { brush: 'ilha-flutuante', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0 });
      c.world.add(e, CRare, { event: 'ilha-flutuante', ttl: 420, phase: 0 });
      delight(c, 0.6);
    },
  },
  {
    id: 'baú-do-tesouro',
    perDay: 1 / 120,
    requires: (c) => Math.abs(c.ws.tide) > 1.2,
    line: 'A maré deixou um baú fechado na areia.',
    tone: 'raro',
    spawn: (c) => {
      const x = c.ws.island.shoreRight - c.rng.range(3, 12);
      const e = spawnProp(c.world, c.ws, 'baú', x, {});
      c.world.add(e, CVisual, { brush: 'baú', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.7 });
      hope(c, 0.4);
      setFlag(c.ws, 'baú-na-praia');
    },
  },
  {
    id: 'exploradores',
    perDay: 1 / 400,
    requires: (c) => c.ws.sky.daylight > 0.5,
    line: 'Um bote encostou. Três pessoas desceram, olharam em volta, tiraram medidas e foram embora.',
    tone: 'raro',
    spawn: (c) => {
      nearEntity(c, 'explorador', 240, 0, 1);
      hope(c, 0.7);
      const n = c.world.get(c.self, CNeeds);
      if (n) satisfy(n, 'loneliness', 0.5);
      bump(c.ws, 'visitas');
    },
  },
  {
    id: 'astronauta',
    perDay: 1 / 1400,
    line: 'Caiu uma cápsula na praia. Saiu de dentro alguém de traje branco, muito confuso.',
    tone: 'raro',
    spawn: (c) => {
      nearEntity(c, 'astronauta', 380, 0, 1);
      delight(c, 0.8);
      const n = c.world.get(c.self, CNeeds);
      if (n) satisfy(n, 'loneliness', 0.9);
      bump(c.ws, 'astronautas');
    },
  },
  {
    id: 'portal',
    perDay: 1 / 2000,
    requires: (c) => c.ws.weather.phenomenon === 'aurora',
    line: 'Abriu-se uma fresta de luz no ar. Fechou antes que ele chegasse perto.',
    tone: 'raro',
    spawn: (c) => {
      nearEntity(c, 'portal', 70, 6, 1);
      delight(c, 0.9);
      bump(c.ws, 'portais');
    },
  },
  {
    id: 'robô',
    perDay: 1 / 900,
    line: 'Desenterrou um robô enferrujado. Passou a tarde tentando fazê-lo funcionar.',
    tone: 'raro',
    spawn: (c) => {
      nearEntity(c, 'robô', 600, 0, 1);
      delight(c, 0.5);
      setFlag(c.ws, 'robô-achado');
    },
  },
  {
    id: 'dragão',
    perDay: 1 / 2600,
    requires: (c) => flag(c.ws, 'caverna-descoberta') > 0 && c.ws.sky.daylight < 0.2,
    line: 'No fundo da caverna havia algo enorme, dormindo. Ele saiu na ponta dos pés.',
    tone: 'raro',
    spawn: (c) => {
      const cave = c.ws.island.feature('caverna');
      const x = cave?.x ?? 0;
      const e = c.world.create();
      c.world.add(e, CTransform, { x, y: c.ws.island.surfaceAt(x), depth: 0.05, facing: 1, scale: 1, rot: 0 });
      c.world.add(e, CVisual, { brush: 'dragão', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.5 });
      c.world.add(e, CRare, { event: 'dragão', ttl: 300, phase: 0 });
      scare(c, 0.6);
      delight(c, 1);
      bump(c.ws, 'dragões');
    },
  },
  {
    id: 'castelo-vivo',
    perDay: 1 / 1800,
    requires: (c) => c.ws.sky.daylight < 0.12,
    line: 'O castelo de areia tinha janelas acesas. De manhã era só areia de novo.',
    tone: 'raro',
    spawn: (c) => {
      nearEntity(c, 'castelo-vivo', 160, 0, 1);
      delight(c, 0.7);
    },
  },
  {
    id: 'chuva-de-peixes',
    perDay: 1 / 1000,
    requires: (c) => c.ws.weather.wind > 0.8,
    line: 'Choveu peixe. Só isso. Choveu peixe.',
    tone: 'raro',
    spawn: (c) => {
      setFlag(c.ws, 'chuva-de-peixes', 1);
      const n = c.world.get(c.self, CNeeds);
      if (n) {
        satisfy(n, 'hunger', 0.9);
        raise(n, 'happiness', 0.4);
      }
      bump(c.ws, 'chuvas-de-peixe');
      for (let i = 0; i < 6; i++) {
        const x = c.ws.island.clampToLand(c.rng.range(c.ws.island.shoreLeft, c.ws.island.shoreRight));
        const e = c.world.create();
        c.world.add(e, CTransform, { x, y: 40 + c.rng.range(0, 20), depth: c.rng.range(-0.3, 0.3), facing: 1, scale: 1, rot: 0 });
        c.world.add(e, CCritter, { species: 'peixe-caindo', state: 'caindo', timer: 0, bond: 0, homeX: x, seed: c.rng.int(1, 1e6) });
        c.world.add(e, CVisual, { brush: 'peixe', seed: c.rng.int(1, 1e6), opacity: 1, shadow: 0.2 });
        c.world.add(e, CRare, { event: 'peixe', ttl: 40, phase: 0 });
      }
    },
  },
];

export function rollRareEvents(c: StoryCtx, worldDtSeconds: number): void {
  const days = worldDtSeconds / 86400;
  for (const ev of RARE_EVENTS) {
    if (ev.requires && !ev.requires(c)) continue;
    if (!c.ws.rngRare.chance(ev.perDay * days)) continue;
    ev.spawn(c);
    narrate(c.ws, c.bus, ev.line, ev.tone ?? 'raro');
    c.bus.emit('evento-raro', { id: ev.id, line: ev.line });
    bump(c.ws, 'eventos-raros');
    return; // No máximo um prodígio por vez. Milagre em série vira rotina.
  }
}

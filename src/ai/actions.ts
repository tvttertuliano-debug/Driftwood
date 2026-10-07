import { clamp01, lerp } from '../core/math.ts';
import { CPlant, CProp, CTransform, CVisual, CCritter } from '../sim/components.ts';
import {
  currentProject, findProp, mostDamagedProp, nearestFruitingPalm, propX, spawnProp, findCritter,
} from '../sim/queries.ts';
import { bump, flag, narrate, setFlag, stat } from '../sim/worldState.ts';
import { isDangerous, isWet } from '../sim/weather.ts';
import { desire, raise, satisfy, urgency } from './needs.ts';
import { crossedMilestone, level, practice } from './skills.ts';
import type { AIContext } from './context.ts';

/**
 * Catálogo de ações. Nada aqui é roteiro: cada ação apenas diz "quanto eu valho
 * agora" e o cérebro escolhe. Duas execuções do mesmo dia raramente coincidem.
 *
 * Durações estão em SEGUNDOS DE MUNDO (1 hora de mundo = 3600).
 */

export interface Action {
  id: string;
  /** Pose usada pelo animador procedural. */
  pose: string;
  duration: [number, number];
  /** Recarga mínima em segundos de mundo. */
  cooldown?: number;
  /** Interrompe qualquer coisa em andamento. */
  urgent?: boolean;
  /** Onde precisa acontecer. null = aqui mesmo. */
  place?: (c: AIContext) => number | null;
  score: (c: AIContext) => number;
  onStart?: (c: AIContext) => void;
  /** k vai de 0 a 1 ao longo da ação. */
  tick?: (c: AIContext, k: number) => void;
  onFinish?: (c: AIContext) => void;
}

const HOUR = 3600;

function say(c: AIContext, text: string, tone: Parameters<typeof narrate>[3] = 'rotina'): void {
  narrate(c.ws, c.bus, text, tone);
}

/** Pequeno desastre cômico. O humor vem da física, não da piada escrita. */
function mishap(c: AIContext, chance: number, text: string): boolean {
  if (!c.rng.chance(chance)) return false;
  c.brain.frustration = Math.min(3, c.brain.frustration + 1);
  raise(c.needs, 'laziness', 0.06);
  satisfy(c.needs, 'happiness', 0.04);
  say(c, text, 'perda');
  c.bus.emit('tropeço', { text });
  return true;
}

function reward(c: AIContext, skill: string, amount: number): void {
  const before = level(c.skills, skill);
  const after = practice(c.skills, skill, amount);
  const m = crossedMilestone(before, after);
  if (m !== null) {
    say(c, `Ele percebeu que ficou bom em ${skill}.`, 'conquista');
    raise(c.needs, 'hope', 0.12);
    c.bus.emit('marco', { skill, level: after });
  }
}

const spring = (c: AIContext) => c.ws.island.feature('nascente')?.x ?? 0;
const cove = (c: AIContext) => c.ws.island.feature('enseada')?.x ?? -20;
const peak = (c: AIContext) => c.ws.island.peakX;
const beachSpot = (c: AIContext, side = 1) => {
  const i = c.ws.island;
  return side > 0 ? i.shoreRight - 6 : i.shoreLeft + 6;
};

/** Local abrigado: caverna descoberta > cabana > lado protegido do vento. */
function shelterX(c: AIContext): number {
  const hut = propX(c.world, findProp(c.world, 'cabana'));
  if (hut !== null) return hut;
  if (flag(c.ws, 'caverna-descoberta')) return c.ws.island.feature('caverna')?.x ?? 0;
  return c.ws.island.peakX * -0.4;
}

export const ACTIONS: Action[] = [
  // ─────────────────────────────── sobrevivência ───────────────────────────────
  {
    id: 'beber',
    pose: 'agachado',
    duration: [220, 420],
    place: spring,
    score: (c) => urgency(c.needs.thirst) * 1.25,
    onFinish: (c) => {
      satisfy(c.needs, 'thirst', 0.92);
      raise(c.needs, 'happiness', 0.02);
      if (stat(c.ws, 'goles') === 0) say(c, 'A nascente ainda corre. Isso resolve o assunto mais urgente.', 'conquista');
      bump(c.ws, 'goles');
    },
  },
  {
    id: 'beber-da-chuva',
    pose: 'olhando-cima',
    duration: [120, 240],
    cooldown: 6 * HOUR,
    score: (c) => (isWet(c.ws.weather) ? urgency(c.needs.thirst) * 0.7 : 0),
    onFinish: (c) => {
      satisfy(c.needs, 'thirst', 0.55);
      raise(c.needs, 'happiness', 0.05);
    },
  },
  {
    id: 'comer-coco',
    pose: 'comendo',
    duration: [300, 620],
    place: (c) => {
      const palm = nearestFruitingPalm(c.world, c.tr.x);
      return palm ? propX(c.world, palm) : null;
    },
    score: (c) => (nearestFruitingPalm(c.world, c.tr.x) ? urgency(c.needs.hunger) * 1.05 : 0),
    onFinish: (c) => {
      const palm = nearestFruitingPalm(c.world, c.tr.x);
      if (!palm) return;
      const p = c.world.need(palm, CPlant);
      p.fruit = Math.max(0, p.fruit - 1);
      if (mishap(c, 0.16, 'Um coco caiu antes da hora. Na cabeça dele.')) {
        satisfy(c.needs, 'hunger', 0.25);
        return;
      }
      satisfy(c.needs, 'hunger', 0.6);
      bump(c.ws, 'cocos');
    },
  },
  {
    id: 'pescar',
    pose: 'pescando',
    duration: [1600, 4200],
    place: (c) => beachSpot(c, c.rng.chance(0.5) ? 1 : -1),
    score: (c) => {
      if (isDangerous(c.ws.weather)) return 0;
      const gear = findProp(c.world, 'vara-de-pesca') ? 1.25 : 0.75;
      return urgency(c.needs.hunger) * gear + level(c.skills, 'pesca') * 0.25;
    },
    tick: (c, k) => {
      // Puxadas ocasionais na linha — o render lê isso pela fase.
      c.brain.phase = k;
    },
    onFinish: (c) => {
      const sk = level(c.skills, 'pesca');
      const gear = findProp(c.world, 'vara-de-pesca') ? 0.22 : 0;
      if (c.rng.chance(0.45 + sk * 0.4 + gear)) {
        satisfy(c.needs, 'hunger', 0.7);
        raise(c.needs, 'happiness', 0.1);
        const n = bump(c.ws, 'peixes');
        setFlag(c.ws, 'peixe-cru', 1);
        if (n === 1) say(c, 'Primeiro peixe. Ele olhou para os lados como se alguém devesse ter visto.', 'conquista');
        reward(c, 'pesca', 0.06);
      } else {
        mishap(c, 0.5, 'A linha voltou vazia. De novo.');
        reward(c, 'pesca', 0.02);
      }
    },
  },
  {
    id: 'cozinhar',
    pose: 'agachado',
    duration: [900, 1800],
    place: (c) => propX(c.world, findProp(c.world, 'fogueira')),
    score: (c) => {
      if (!flag(c.ws, 'peixe-cru')) return 0;
      if (!findProp(c.world, 'fogueira')) return 0;
      return urgency(c.needs.hunger) * 0.9 + 0.2;
    },
    onFinish: (c) => {
      setFlag(c.ws, 'peixe-cru', 0);
      if (mishap(c, 0.12, 'Queimou. Comeu assim mesmo.')) {
        satisfy(c.needs, 'hunger', 0.4);
        return;
      }
      satisfy(c.needs, 'hunger', 0.95);
      raise(c.needs, 'happiness', 0.14);
      reward(c, 'cozinha', 0.05);
      bump(c.ws, 'refeições');
    },
  },
  {
    id: 'dormir',
    pose: 'deitado',
    duration: [4 * HOUR, 7 * HOUR],
    place: (c) => {
      const bed = findProp(c.world, 'rede') ?? findProp(c.world, 'cabana');
      return bed ? propX(c.world, bed) : shelterX(c);
    },
    score: (c) => {
      const night = 1 - c.ws.sky.daylight;
      return urgency(c.needs.rest) * (0.7 + night * 1.1) - c.needs.fear * 1.2;
    },
    onStart: (c) => c.bus.emit('dormiu'),
    onFinish: (c) => {
      satisfy(c.needs, 'rest', 0.95);
      satisfy(c.needs, 'laziness', 0.5);
      raise(c.needs, 'happiness', 0.08);
      raise(c.needs, 'hope', 0.05);
      bump(c.ws, 'noites');
    },
  },
  {
    id: 'abrigar-se',
    pose: 'encolhido',
    duration: [1800, 5400],
    urgent: true,
    place: shelterX,
    score: (c) => c.needs.fear * 5.5,
    onStart: (c) => {
      if (c.ws.weather.kind === 'furacão' && c.rng.chance(0.6)) {
        say(c, 'Ele decidiu que hoje não é dia de heroísmo.', 'rotina');
      }
    },
    onFinish: (c) => {
      satisfy(c.needs, 'fear', 0.5);
      if (!isDangerous(c.ws.weather)) {
        bump(c.ws, 'tempestades-sobrevividas');
        raise(c.needs, 'hope', 0.1);
      }
    },
  },
  {
    id: 'acender-fogueira',
    pose: 'agachado',
    duration: [600, 1400],
    cooldown: 4 * HOUR,
    place: (c) => propX(c.world, findProp(c.world, 'fogueira')),
    score: (c) => {
      const fire = findProp(c.world, 'fogueira');
      if (!fire) return 0;
      if (c.world.need(fire, CProp).flags.acesa) return 0;
      // Sem lenha não há fogo. É o que fecha o ciclo com `coletar-lenha`.
      if (stat(c.ws, 'lenha') < 1) return 0;
      if (isWet(c.ws.weather)) return 0.1;
      const night = 1 - c.ws.sky.daylight;
      return 0.35 + night * 1.3 + c.needs.loneliness * 0.5;
    },
    onFinish: (c) => {
      const fire = findProp(c.world, 'fogueira');
      if (!fire) return;
      const sk = level(c.skills, 'fogo');
      // Queimou lenha, deu certo ou não.
      bump(c.ws, 'lenha', -1);
      if (c.rng.chance(0.35 + sk * 0.6)) {
        c.world.need(fire, CProp).flags.acesa = 1;
        raise(c.needs, 'happiness', 0.12);
        satisfy(c.needs, 'loneliness', 0.15);
        reward(c, 'fogo', 0.09);
        c.bus.emit('fogo-aceso');
        if (bump(c.ws, 'fogueiras') === 1) say(c, 'O fogo pegou. A ilha ficou menor e mais quente.', 'conquista');
      } else {
        mishap(c, 0.8, 'A fumaça saiu, o fogo não.');
        reward(c, 'fogo', 0.04);
      }
    },
  },

  // ─────────────────────────────── trabalho ───────────────────────────────
  {
    id: 'construir',
    pose: 'martelando',
    duration: [2200, 5200],
    place: (c) => propX(c.world, currentProject(c.world)),
    score: (c) => {
      const proj = currentProject(c.world);
      if (!proj) return 0;
      const p = c.world.need(proj, CProp);
      const drive = 0.55 + c.needs.hope * 0.7 + desire(c.needs.creativity) * 0.5;
      // Quanto mais perto do fim, mais difícil largar. Teimosia é personalidade.
      return (drive + p.progress * 0.9) * (1 - c.needs.laziness * 0.5) * (1 - c.needs.fear);
    },
    tick: (c, k) => {
      const proj = currentProject(c.world);
      if (!proj) return;
      const p = c.world.need(proj, CProp);
      const skill = 0.55 + level(c.skills, 'carpintaria') * 0.9;
      p.progress = clamp01(p.progress + (c.dt / (9 * HOUR)) * skill);
      c.brain.phase = k;
    },
    onFinish: (c) => {
      const proj = currentProject(c.world);
      reward(c, 'carpintaria', 0.05);
      raise(c.needs, 'rest', 0.06);
      if (proj && c.world.need(proj, CProp).progress >= 1) {
        const p = c.world.need(proj, CProp);
        p.builtOnDay = c.ws.sky.day;
        raise(c.needs, 'hope', 0.3);
        raise(c.needs, 'happiness', 0.25);
        satisfy(c.needs, 'creativity', 0.5);
        bump(c.ws, 'construções');
        c.bus.emit('obra-pronta', { kind: p.kind, entity: proj });
        say(c, `Terminou: ${p.kind}. Ele deu dois passos para trás para olhar.`, 'conquista');
      }
    },
  },
  {
    id: 'consertar',
    pose: 'martelando',
    duration: [1400, 3000],
    place: (c) => propX(c.world, mostDamagedProp(c.world)),
    score: (c) => {
      const dmg = mostDamagedProp(c.world);
      if (!dmg) return 0;
      const p = c.world.need(dmg, CProp);
      return (1 - p.condition) * 2.2 * (1 - c.needs.laziness * 0.6);
    },
    onFinish: (c) => {
      const dmg = mostDamagedProp(c.world);
      if (!dmg) return;
      const p = c.world.need(dmg, CProp);
      p.condition = clamp01(p.condition + c.rng.range(0.25, 0.5) * (0.6 + level(c.skills, 'carpintaria')));
      reward(c, 'carpintaria', 0.04);
      bump(c.ws, 'consertos');
    },
  },
  {
    id: 'coletar-lenha',
    pose: 'carregando',
    duration: [1200, 2600],
    cooldown: 5 * HOUR,
    place: (c) => c.ws.island.clampToLand(peak(c) + c.rng.range(-30, 30)),
    score: (c) => (stat(c.ws, 'lenha') < 4 ? 0.55 + c.ws.sky.daylight * 0.3 : 0.05),
    onFinish: (c) => {
      bump(c.ws, 'lenha', c.rng.int(1, 3));
      raise(c.needs, 'rest', 0.05);
    },
  },
  {
    id: 'plantar',
    pose: 'agachado',
    duration: [900, 2000],
    cooldown: 20 * HOUR,
    place: (c) => c.ws.island.clampToLand(c.tr.x + c.rng.range(-40, 40)),
    score: (c) => {
      const seasonBonus = c.ws.sky.season === 'primavera' ? 0.7 : c.ws.sky.season === 'verão' ? 0.35 : 0.1;
      return seasonBonus + desire(c.needs.creativity) * 0.4 + c.needs.hope * 0.4;
    },
    onFinish: (c) => {
      const x = c.ws.island.clampToLand(c.tr.x + c.rng.range(-3, 3));
      const e = c.world.create();
      c.world.add(e, CTransform, { x, y: c.ws.island.surfaceAt(x), depth: c.rng.range(-0.3, 0.3), facing: 1, scale: 1, rot: 0 });
      c.world.add(e, CPlant, {
        species: c.rng.chance(0.7) ? 'palmeira' : 'arbusto',
        growth: 0.02,
        maxHeight: c.rng.range(16, 30),
        seed: c.rng.int(1, 1e6),
        plantedOnDay: c.ws.sky.day,
      });
      c.world.add(e, CVisual, { brush: 'planta', seed: c.rng.int(1, 1e6), opacity: 1, shadow: 0.7 });
      reward(c, 'agricultura', 0.06);
      raise(c.needs, 'hope', 0.15);
      if (bump(c.ws, 'plantios') === 1) {
        say(c, 'Plantou uma muda. Vai levar estações para virar sombra — ele sabe.', 'conquista');
      }
    },
  },

  // ─────────────────────────── curiosidade e criação ───────────────────────────
  {
    id: 'explorar',
    pose: 'andando',
    duration: [1800, 4200],
    place: (c) => c.ws.island.clampToLand(c.rng.range(c.ws.island.shoreLeft, c.ws.island.shoreRight)),
    score: (c) => desire(c.needs.curiosity) * 1.2 * (1 - c.needs.fear) * c.ws.sky.daylight,
    onFinish: (c) => {
      satisfy(c.needs, 'curiosity', 0.55);
      const cave = c.ws.island.feature('caverna');
      if (cave && !flag(c.ws, 'caverna-descoberta') && Math.abs(c.tr.x - cave.x) < 14 && c.rng.chance(0.5)) {
        setFlag(c.ws, 'caverna-descoberta');
        cave.hidden = false;
        raise(c.needs, 'hope', 0.35);
        raise(c.needs, 'happiness', 0.3);
        say(c, 'Achou uma caverna atrás das pedras. Entrou. Demorou para sair.', 'maravilha');
        c.bus.emit('descoberta', { what: 'caverna' });
      }
      if (c.rng.chance(0.12)) {
        say(c, c.rng.pick([
          'Voltou com uma pedra de formato improvável.',
          'Encontrou uma pegada. Era dele mesmo, de ontem.',
          'Ficou olhando um besouro por tempo demais.',
        ]));
      }
    },
  },
  {
    id: 'olhar-horizonte',
    pose: 'olhando',
    duration: [900, 2400],
    place: (c) => (c.rng.chance(0.4) ? peak(c) : beachSpot(c, c.rng.chance(0.5) ? 1 : -1)),
    score: (c) => desire(c.needs.loneliness) * 0.9 + (1 - c.needs.hope) * 0.5 + c.ws.sky.goldenHour * 0.8,
    onFinish: (c) => {
      satisfy(c.needs, 'loneliness', 0.25);
      if (c.ws.sky.goldenHour > 0.4) {
        raise(c.needs, 'happiness', 0.12);
        if (c.rng.chance(0.08)) say(c, 'Ficou parado até o sol sumir inteiro.', 'maravilha');
      }
    },
  },
  {
    id: 'colecionar-conchas',
    pose: 'agachado',
    duration: [1200, 2800],
    cooldown: 8 * HOUR,
    place: (c) => beachSpot(c, c.rng.chance(0.5) ? 1 : -1),
    score: (c) => desire(c.needs.curiosity) * 0.5 + desire(c.needs.laziness) * 0.4 + 0.15,
    onFinish: (c) => {
      const n = bump(c.ws, 'conchas', c.rng.int(1, 4));
      satisfy(c.needs, 'curiosity', 0.2);
      raise(c.needs, 'happiness', 0.06);
      if (n > 24 && !flag(c.ws, 'coleção-conchas')) {
        setFlag(c.ws, 'coleção-conchas');
        say(c, 'Organizou as conchas por tamanho. Depois por cor. Depois por preferência.', 'conquista');
      }
    },
  },
  {
    id: 'esculpir',
    pose: 'esculpindo',
    duration: [2400, 5400],
    cooldown: 26 * HOUR,
    place: (c) => c.ws.island.clampToLand(c.tr.x + c.rng.range(-12, 12)),
    score: (c) => desire(c.needs.creativity) * 1.3 * (1 - c.needs.fear) - c.needs.hunger * 0.5,
    onFinish: (c) => {
      satisfy(c.needs, 'creativity', 0.75);
      if (mishap(c, 0.22, 'A escultura rachou ao meio. Ele encarou os pedaços por um tempo.')) return;
      const x = c.ws.island.clampToLand(c.tr.x);
      const e = spawnProp(c.world, c.ws, 'escultura', x, { seed: c.rng.int(1, 1e6) });
      c.world.add(e, CVisual, { brush: 'escultura', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.8 });
      reward(c, 'arte', 0.08);
      raise(c.needs, 'happiness', 0.2);
      bump(c.ws, 'esculturas');
      say(c, 'Fez uma escultura. Não se sabe do quê. Ele sabe.', 'conquista');
    },
  },
  {
    id: 'observar-estrelas',
    pose: 'deitado-olhando',
    duration: [2400, 6000],
    place: peak,
    score: (c) => {
      if (c.ws.sky.daylight > 0.08 || c.ws.weather.cloud > 0.55) return 0;
      const scope = findProp(c.world, 'telescópio') ? 1.1 : 0;
      return 0.5 + desire(c.needs.curiosity) * 0.8 + scope + (c.ws.weather.phenomenon === 'meteoros' ? 2.2 : 0);
    },
    onFinish: (c) => {
      satisfy(c.needs, 'curiosity', 0.45);
      raise(c.needs, 'happiness', 0.18);
      raise(c.needs, 'hope', 0.1);
      reward(c, 'astronomia', 0.07);
      const n = bump(c.ws, 'noites-estreladas');
      if (n === 3 && !flag(c.ws, 'nomeou-constelação')) {
        setFlag(c.ws, 'nomeou-constelação');
        say(c, 'Deu nome a uma constelação. Guardou o nome para si.', 'maravilha');
      }
    },
  },
  {
    id: 'nadar',
    pose: 'nadando',
    duration: [1400, 3200],
    cooldown: 10 * HOUR,
    place: (c) => beachSpot(c, c.rng.chance(0.5) ? 1 : -1),
    score: (c) => {
      if (c.ws.weather.wind > 0.6 || isDangerous(c.ws.weather)) return 0;
      const heat = c.ws.sky.season === 'verão' ? 0.8 : 0.25;
      return heat * c.ws.sky.daylight + desire(c.needs.laziness) * 0.4;
    },
    onFinish: (c) => {
      satisfy(c.needs, 'laziness', 0.4);
      raise(c.needs, 'happiness', 0.14);
      reward(c, 'natação', 0.05);
      bump(c.ws, 'banhos');
    },
  },
  {
    id: 'castelo-de-areia',
    pose: 'agachado',
    duration: [1800, 3600],
    cooldown: 30 * HOUR,
    place: (c) => beachSpot(c, c.rng.chance(0.5) ? 1 : -1),
    score: (c) => desire(c.needs.creativity) * 0.55 + desire(c.needs.laziness) * 0.5,
    onFinish: (c) => {
      satisfy(c.needs, 'creativity', 0.3);
      raise(c.needs, 'happiness', 0.12);
      const x = c.tr.x;
      const e = spawnProp(c.world, c.ws, 'castelo-de-areia', x, { condition: 0.9 });
      c.world.add(e, CVisual, { brush: 'castelo', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.5 });
      bump(c.ws, 'castelos');
    },
  },
  {
    id: 'jogar-pedra',
    pose: 'jogando',
    duration: [500, 1200],
    place: (c) => beachSpot(c, c.rng.chance(0.5) ? 1 : -1),
    score: (c) => desire(c.needs.laziness) * 0.55 + 0.12,
    onFinish: (c) => {
      satisfy(c.needs, 'laziness', 0.2);
      if (c.rng.chance(0.1)) say(c, 'Sete quiques. Ninguém viu.');
    },
  },
  {
    id: 'dançar-na-chuva',
    pose: 'dançando',
    duration: [900, 2000],
    cooldown: 40 * HOUR,
    score: (c) => (isWet(c.ws.weather) && !isDangerous(c.ws.weather) ? c.needs.happiness * 1.6 : 0),
    onFinish: (c) => {
      raise(c.needs, 'happiness', 0.3);
      satisfy(c.needs, 'loneliness', 0.2);
      say(c, 'Dançou na chuva. Sem plateia, sem vergonha.', 'maravilha');
    },
  },
  {
    id: 'escrever-diário',
    pose: 'sentado',
    duration: [1400, 3000],
    cooldown: 20 * HOUR,
    place: (c) => propX(c.world, findProp(c.world, 'cabana')) ?? c.tr.x,
    score: (c) => (flag(c.ws, 'tem-diário') ? desire(c.needs.loneliness) * 0.9 + 0.2 : 0),
    onFinish: (c) => {
      satisfy(c.needs, 'loneliness', 0.35);
      raise(c.needs, 'hope', 0.08);
      bump(c.ws, 'páginas');
    },
  },
  {
    id: 'usar-telescópio',
    pose: 'telescópio',
    duration: [1600, 3600],
    place: (c) => propX(c.world, findProp(c.world, 'telescópio')),
    score: (c) => {
      if (!findProp(c.world, 'telescópio')) return 0;
      if (c.ws.weather.cloud > 0.6) return 0;
      return 0.6 + desire(c.needs.curiosity) * 0.9 + (c.ws.sky.daylight < 0.1 ? 0.8 : 0);
    },
    onFinish: (c) => {
      satisfy(c.needs, 'curiosity', 0.5);
      reward(c, 'astronomia', 0.09);
      raise(c.needs, 'hope', 0.1);
    },
  },
  {
    id: 'conversar-com-papagaio',
    pose: 'sentado',
    duration: [1200, 2800],
    place: (c) => {
      const p = findCritter(c.world, 'papagaio');
      return p ? (c.world.get(p, CTransform)?.x ?? null) : null;
    },
    score: (c) => {
      const p = findCritter(c.world, 'papagaio');
      if (!p) return 0;
      return desire(c.needs.loneliness) * 1.4 + 0.2;
    },
    onFinish: (c) => {
      satisfy(c.needs, 'loneliness', 0.6);
      raise(c.needs, 'happiness', 0.15);
      const p = findCritter(c.world, 'papagaio');
      if (p) {
        const cr = c.world.need(p, CCritter);
        cr.bond = clamp01(cr.bond + 0.05);
        if (cr.bond > 0.8 && !flag(c.ws, 'papagaio-fala')) {
          setFlag(c.ws, 'papagaio-fala');
          say(c, 'O papagaio repetiu alguma coisa. Ele fingiu que entendeu.', 'maravilha');
        }
      }
    },
  },
  {
    id: 'acenar-para-o-mar',
    pose: 'acenando',
    duration: [600, 1400],
    urgent: true,
    place: (c) => beachSpot(c, c.tr.x > 0 ? 1 : -1),
    score: (c) => (flag(c.ws, 'algo-no-horizonte') ? 6 : 0),
    onFinish: (c) => {
      setFlag(c.ws, 'algo-no-horizonte', 0);
      raise(c.needs, 'hope', 0.25);
      if (c.rng.chance(0.85)) {
        satisfy(c.needs, 'hope', 0.35);
        satisfy(c.needs, 'happiness', 0.15);
        say(c, 'Acenou até o braço cansar. O horizonte continuou horizonte.', 'perda');
      }
    },
  },
  {
    id: 'cochilar',
    pose: 'deitado',
    duration: [1800, 4000],
    place: (c) => propX(c.world, findProp(c.world, 'rede')) ?? c.tr.x,
    score: (c) => desire(c.needs.laziness) * 1.1 + c.needs.rest * 0.6 + (c.ws.sky.hour > 12 && c.ws.sky.hour < 15 ? 0.5 : 0),
    onFinish: (c) => {
      satisfy(c.needs, 'laziness', 0.7);
      satisfy(c.needs, 'rest', 0.3);
    },
  },
  {
    id: 'ocioso',
    pose: 'parado',
    duration: [400, 1400],
    score: () => 0.08,
    onFinish: (c) => {
      if (c.rng.chance(0.06)) {
        say(c, c.rng.pick([
          'Coçou a cabeça sem motivo aparente.',
          'Espreguiçou-se e decidiu que ainda não.',
          'Contou as próprias pegadas.',
          'Ajeitou uma pedra que estava torta.',
        ]));
      }
    },
  },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

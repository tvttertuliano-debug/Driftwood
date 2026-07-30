import { CBody, CCritter, CNeeds, CPlant, CProp, CTransform, CVisual } from '../sim/components.ts';
import { findProp, hasProp, propX, spawnProp, findCritter, countPlants } from '../sim/queries.ts';
import { bump, flag, setFlag, stat } from '../sim/worldState.ts';
import { level } from '../ai/skills.ts';
import { raise, satisfy } from '../ai/needs.ts';
import { clamp01 } from '../core/math.ts';
import type { Story, StoryCtx, StoryStep } from './types.ts';

/**
 * Histórias emergentes. Não são um roteiro: são *possibilidades* com condições.
 * O diretor sorteia entre as que fazem sentido agora. A mesma história, em
 * semanas diferentes, cai num clima diferente, com habilidades diferentes,
 * e termina diferente.
 */

const HOUR = 3600;
const DAY = 24 * HOUR;

function needsOf(c: StoryCtx) {
  return c.world.get(c.self, CNeeds);
}

function spot(c: StoryCtx, hint: 'praia' | 'cume' | 'meio' | 'enseada' = 'meio'): number {
  const i = c.ws.island;
  switch (hint) {
    case 'praia': return c.rng.chance(0.5) ? i.shoreRight - 8 : i.shoreLeft + 8;
    case 'cume': return i.peakX + c.rng.range(-6, 6);
    case 'enseada': return i.feature('enseada')?.x ?? 0;
    default: return i.clampToLand(c.rng.range(i.shoreLeft + 14, i.shoreRight - 14));
  }
}

/** Cria uma obra inacabada. A ação "construir" cuida do resto, no ritmo dele. */
function startProject(c: StoryCtx, kind: string, brush: string, hint: Parameters<typeof spot>[1] = 'meio'): void {
  const x = spot(c, hint);
  const e = spawnProp(c.world, c.ws, kind, x, { progress: 0.01, condition: 1 });
  c.world.add(e, CVisual, { brush, seed: c.rng.int(1, 1e6), opacity: 1, shadow: 0.85 });
  const n = needsOf(c);
  if (n) raise(n, 'hope', 0.2);
  c.bus.emit('projeto-iniciado', { kind });
}

const projectDone = (kind: string) => (c: StoryCtx) => {
  const e = findProp(c.world, kind, false);
  return !e || c.world.need(e, CProp).progress >= 1;
};

interface ProjectOpts {
  id: string;
  kind: string;
  brush?: string;
  weight: number;
  where?: Parameters<typeof spot>[1];
  intro: string;
  outro: string;
  requires?: (c: StoryCtx) => boolean;
  bias?: (c: StoryCtx) => number;
  after?: (c: StoryCtx) => void;
}

/** Molde de história "ele decidiu construir X". Muitas obras, pouca repetição de código. */
function projectStory(o: ProjectOpts): Story {
  return {
    id: o.id,
    slot: 'obra',
    weight: o.weight,
    once: true,
    cooldown: 2 * DAY,
    requires: (c) => !hasProp(c.world, o.kind) && (o.requires?.(c) ?? true),
    bias: o.bias,
    steps: [
      { text: o.intro, tone: 'rotina', run: (c) => startProject(c, o.kind, o.brush ?? o.kind, o.where) },
      { until: projectDone(o.kind), timeout: 6 * DAY },
      {
        text: o.outro,
        tone: 'conquista',
        run: (c) => {
          o.after?.(c);
          const n = needsOf(c);
          if (n) {
            raise(n, 'hope', 0.25);
            raise(n, 'happiness', 0.2);
          }
        },
      },
    ],
  };
}

// ─────────────────────────── obras ───────────────────────────

const OBRAS: Story[] = [
  projectStory({
    id: 'obra-fogueira', kind: 'fogueira', brush: 'fogueira', weight: 20, where: 'praia',
    intro: 'Empilhou pedras num círculo. A intenção era óbvia.',
    outro: 'A fogueira está pronta. Falta só convencer a madeira.',
    // Pressão que só cresce. A fogueira é a base de cozinhar, do forno e das
    // brasas: deixá-la no sorteio puro fazia com que, em cerca de um terço das
    // vidas, o náufrago passasse meses sem nunca acender fogo.
    bias: (c) => 4 + c.ws.sky.day * 1.5,
  }),
  projectStory({
    id: 'obra-abrigo', kind: 'cabana', brush: 'cabana', weight: 18,
    intro: 'Começou a fincar galhos no chão, um ao lado do outro.',
    outro: 'A cabana ficou torta e é dele. Dorme melhor desde então.',
    requires: (c) => stat(c.ws, 'lenha') >= 1 || c.ws.sky.day >= 2,
    bias: (c) => (c.ws.sky.season === 'inverno' ? 2.5 : 1.2),
  }),
  projectStory({
    id: 'obra-vara', kind: 'vara-de-pesca', brush: 'ferramenta', weight: 14, where: 'praia',
    intro: 'Encontrou um galho fino e passou a tarde amarrando fibra nele.',
    outro: 'Agora tem uma vara de pesca. O mar que se cuide.',
  }),
  projectStory({
    id: 'obra-rede', kind: 'rede', brush: 'rede', weight: 12,
    intro: 'Trançou fibra de coqueiro entre duas palmeiras.',
    outro: 'A rede aguentou o peso dele na terceira tentativa.',
    requires: (c) => countPlants(c.world, 'palmeira') >= 2,
  }),
  projectStory({
    id: 'obra-jangada', kind: 'jangada', brush: 'jangada', weight: 16, where: 'praia',
    intro: 'Alinhou troncos na areia e mediu com os braços abertos.',
    outro: 'A jangada está pronta. Ele olhou para o horizonte por um tempo longo.',
    requires: (c) => c.ws.sky.day >= 4,
    bias: (c) => 1 + (needsOf(c)?.hope ?? 0.5) * 2,
    after: (c) => setFlag(c.ws, 'jangada-pronta'),
  }),
  projectStory({
    id: 'obra-moinho', kind: 'moinho', brush: 'moinho', weight: 8, where: 'cume',
    intro: 'Desenhou pás na areia. Apagou. Desenhou de novo, maiores.',
    outro: 'O moinho girou. Não move nada, mas gira.',
    requires: (c) => level(c.skills(), 'carpintaria') > 0.35,
  }),
  projectStory({
    id: 'obra-farol', kind: 'farol', brush: 'farol', weight: 7, where: 'cume',
    intro: 'Empilhou pedra sobre pedra no ponto mais alto.',
    outro: 'O farol acendeu. Se alguém passar de noite, vai ver.',
    requires: (c) => level(c.skills(), 'carpintaria') > 0.5 && stat(c.ws, 'construções') >= 3,
    after: (c) => {
      const e = findProp(c.world, 'farol');
      if (e) c.world.need(e, CProp).flags.aceso = 1;
      setFlag(c.ws, 'farol-aceso');
    },
  }),
  projectStory({
    id: 'obra-telescópio', kind: 'telescópio', brush: 'telescópio', weight: 7, where: 'cume',
    intro: 'Passou dias polindo um fundo de garrafa contra a pedra.',
    outro: 'O telescópio é ruim. As estrelas não parecem se importar.',
    requires: (c) => flag(c.ws, 'garrafa-achada') > 0 && level(c.skills(), 'engenhoca') >= 0,
  }),
  projectStory({
    id: 'obra-observatório', kind: 'observatório', brush: 'observatório', weight: 5, where: 'cume',
    intro: 'Marcou pedras no chão apontando para onde certas estrelas nascem.',
    outro: 'Tem um observatório de pedras. Funciona duas vezes por ano.',
    requires: (c) => level(c.skills(), 'astronomia') > 0.4 && hasProp(c.world, 'telescópio'),
  }),
  projectStory({
    id: 'obra-ponte', kind: 'ponte', brush: 'ponte', weight: 6, where: 'praia',
    intro: 'Decidiu que aquela pedra no raso merecia ser alcançada a pé enxuto.',
    outro: 'A ponte leva a uma pedra. É uma ponte.',
    requires: (c) => level(c.skills(), 'carpintaria') > 0.3,
  }),
  projectStory({
    id: 'obra-forno', kind: 'forno', brush: 'forno', weight: 8,
    intro: 'Amassou barro da beira da nascente a tarde inteira.',
    outro: 'O forno de barro assa. Assa mal, mas assa.',
    requires: (c) => hasProp(c.world, 'fogueira'),
  }),
  projectStory({
    id: 'obra-móveis', kind: 'cadeira', brush: 'cadeira', weight: 9, where: 'praia',
    intro: 'Serrou um tronco em pedaços do tamanho de sentar.',
    outro: 'Fez uma cadeira. Sentou. Ficou satisfeito.',
    requires: (c) => hasProp(c.world, 'cabana'),
  }),
  projectStory({
    id: 'obra-horta', kind: 'horta', brush: 'horta', weight: 9,
    intro: 'Cercou um pedaço de terra com gravetos.',
    outro: 'A horta está de pé. Agora é esperar — o que ele tem de sobra.',
    requires: (c) => level(c.skills(), 'agricultura') > 0.2,
  }),
  projectStory({
    id: 'obra-tambor', kind: 'tambor', brush: 'tambor', weight: 6,
    intro: 'Esticou couro de nada em cima de um tronco oco.',
    outro: 'O tambor soa. As gaivotas discordam.',
    requires: (c) => level(c.skills(), 'arte') > 0.25,
  }),
  projectStory({
    id: 'obra-sino', kind: 'sino-de-conchas', brush: 'sino', weight: 7,
    intro: 'Furou conchas com um espinho, uma por uma.',
    outro: 'Pendurou o sino de conchas. Agora o vento faz música.',
    requires: (c) => stat(c.ws, 'conchas') >= 12,
  }),
  projectStory({
    id: 'obra-escada', kind: 'escada', brush: 'escada', weight: 5, where: 'cume',
    intro: 'Cansou de subir o barranco de quatro.',
    outro: 'Tem uma escada no morro agora. Pequena vitória diária.',
    requires: (c) => level(c.skills(), 'carpintaria') > 0.4,
  }),
  projectStory({
    id: 'obra-cavalete', kind: 'cavalete', brush: 'cavalete', weight: 6,
    intro: 'Montou três varas em tripé e fixou uma tábua lisa.',
    outro: 'Tem onde pintar. Falta o que pintar com — mas isso ele resolve.',
    requires: (c) => level(c.skills(), 'arte') > 0.35,
  }),
];

// ─────────────────────────── histórias com arco ───────────────────────────

const ARCOS: Story[] = [
  {
    id: 'a-jangada-que-afundou',
    weight: 22,
    cooldown: 6 * DAY,
    requires: (c) => flag(c.ws, 'jangada-pronta') > 0,
    bias: (c) => 1 + (needsOf(c)?.hope ?? 0) * 1.5,
    steps: [
      { text: 'Empurrou a jangada para a água. Subiu nela com cuidado exagerado.', tone: 'maravilha' },
      { wait: 2 * HOUR },
      {
        run: (c) => {
          const e = findProp(c.world, 'jangada');
          if (e) {
            const tr = c.world.get(e, CTransform);
            if (tr) tr.x += c.rng.range(-30, 30);
            c.world.add(e, CBody, { buoyant: true, drag: 0.9, mass: 3 });
          }
        },
        wait: 3 * HOUR,
      },
      {
        text: (c) =>
          c.rng.chance(0.6)
            ? 'A jangada afundou a cinquenta metros da praia. Ele voltou nadando, sem pressa.'
            : 'A corrente virou e devolveu a jangada à mesma praia. Ele riu. Acho que riu.',
        tone: 'perda',
        run: (c) => {
          const n = needsOf(c);
          if (n) {
            satisfy(n, 'hope', 0.3);
            raise(n, 'happiness', 0.05);
          }
          setFlag(c.ws, 'jangada-pronta', 0);
          bump(c.ws, 'tentativas-de-fuga');
          const e = findProp(c.world, 'jangada');
          if (e) {
            const p = c.world.need(e, CProp);
            p.condition = 0.25;
            p.kind = 'destroço-jangada';
          }
        },
      },
    ],
  },
  {
    id: 'o-papagaio',
    weight: 14,
    once: true,
    requires: (c) => c.ws.sky.day >= 5 && !findCritter(c.world, 'papagaio'),
    bias: (c) => 1 + (needsOf(c)?.loneliness ?? 0) * 3,
    steps: [
      {
        text: 'Um papagaio pousou na palmeira e ficou olhando. Não foi embora.',
        tone: 'maravilha',
        run: (c) => {
          const x = c.ws.island.clampToLand(c.world.get(c.self, CTransform)!.x + c.rng.range(-14, 14));
          const e = c.world.create();
          c.world.add(e, CTransform, { x, y: c.ws.island.surfaceAt(x) + 8, depth: 0.1, facing: 1, scale: 1, rot: 0 });
          c.world.add(e, CCritter, { species: 'papagaio', state: 'observando', timer: 0, bond: 0.1, homeX: x, seed: c.rng.int(1, 1e6) });
          c.world.add(e, CVisual, { brush: 'papagaio', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.3 });
          setFlag(c.ws, 'tem-papagaio');
        },
      },
      {
        until: (c) => {
          const p = findCritter(c.world, 'papagaio');
          return !!p && c.world.need(p, CCritter).bond > 0.6;
        },
        timeout: 8 * DAY,
      },
      {
        text: 'O papagaio agora dorme perto. Ele fala com o bicho. O bicho responde do jeito dele.',
        tone: 'conquista',
        run: (c) => {
          const n = needsOf(c);
          if (n) satisfy(n, 'loneliness', 0.6);
          setFlag(c.ws, 'papagaio-amigo');
        },
      },
    ],
  },
  {
    id: 'o-papagaio-sumiu',
    weight: 6,
    cooldown: 10 * DAY,
    requires: (c) => flag(c.ws, 'papagaio-amigo') > 0,
    steps: [
      {
        text: 'O papagaio não apareceu hoje.',
        tone: 'perda',
        run: (c) => {
          const p = findCritter(c.world, 'papagaio');
          if (p) c.world.destroy(p);
          const n = needsOf(c);
          if (n) raise(n, 'loneliness', 0.5);
          setFlag(c.ws, 'papagaio-amigo', 0);
          setFlag(c.ws, 'tem-papagaio', 0);
        },
      },
      { wait: 2 * DAY },
      {
        text: (c) => (c.rng.chance(0.55) ? 'O papagaio voltou. Trouxe outro papagaio.' : 'O papagaio não voltou.'),
        tone: 'maravilha',
        run: (c) => {
          if (!c.rng.chance(0.55)) return;
          for (let i = 0; i < 2; i++) {
            const x = c.ws.island.clampToLand(c.world.get(c.self, CTransform)!.x + c.rng.range(-18, 18));
            const e = c.world.create();
            c.world.add(e, CTransform, { x, y: c.ws.island.surfaceAt(x) + 8, depth: 0.1, facing: 1, scale: 1, rot: 0 });
            c.world.add(e, CCritter, { species: 'papagaio', state: 'observando', timer: 0, bond: 0.7, homeX: x, seed: c.rng.int(1, 1e6) });
            c.world.add(e, CVisual, { brush: 'papagaio', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.3 });
          }
          setFlag(c.ws, 'papagaio-amigo');
          const n = needsOf(c);
          if (n) satisfy(n, 'loneliness', 0.8);
        },
      },
    ],
  },
  {
    id: 'a-garrafa',
    weight: 12,
    once: true,
    requires: (c) => c.ws.sky.day >= 3,
    // A garrafa é o vidro do telescópio: sem ela, `usar-telescópio` e o
    // observatório ficam inalcançáveis para sempre. Cresce até acontecer.
    bias: (c) => 1 + c.ws.sky.day * 0.25,
    steps: [
      {
        text: 'A maré trouxe uma garrafa. Vazia. Ele guardou mesmo assim.',
        tone: 'maravilha',
        run: (c) => {
          setFlag(c.ws, 'garrafa-achada');
          const x = c.ws.island.shoreRight - 6;
          const e = spawnProp(c.world, c.ws, 'garrafa', x, {});
          c.world.add(e, CVisual, { brush: 'garrafa', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.4 });
        },
      },
      { wait: 1.5 * DAY },
      {
        text: 'Escreveu alguma coisa, enrolou o papel e jogou a garrafa no mar.',
        tone: 'maravilha',
        run: (c) => {
          const e = findProp(c.world, 'garrafa');
          if (e) c.world.destroy(e);
          setFlag(c.ws, 'garrafa-lançada');
          const n = needsOf(c);
          if (n) raise(n, 'hope', 0.35);
        },
      },
      { wait: 6 * DAY },
      {
        text: (c) =>
          c.rng.chance(0.35)
            ? 'A mesma garrafa voltou. Com a mesma mensagem. Ele leu de novo assim mesmo.'
            : 'A garrafa nunca mais apareceu. Isso, por algum motivo, o deixou tranquilo.',
        tone: 'perda',
        run: (c) => {
          const n = needsOf(c);
          if (n) raise(n, 'hope', 0.1);
        },
      },
    ],
  },
  {
    id: 'o-mapa',
    weight: 10,
    once: true,
    requires: (c) => flag(c.ws, 'caverna-descoberta') > 0,
    steps: [
      {
        text: 'Dentro da caverna, riscado na pedra, havia um desenho. Podia ser um mapa.',
        tone: 'maravilha',
        run: (c) => {
          setFlag(c.ws, 'mapa-achado');
          const n = needsOf(c);
          if (n) raise(n, 'hope', 0.4);
        },
      },
      { wait: 1 * DAY },
      {
        text: 'Passou o dia cavando onde o mapa parecia indicar.',
        tone: 'rotina',
        run: (c) => bump(c.ws, 'buracos', 3),
      },
      { wait: 8 * HOUR },
      {
        text: (c) => c.rng.pick([
          'Achou um baú. Dentro: um sapato. Um só.',
          'Achou uma caixa de madeira. Dentro, ferramentas enferrujadas — mas ferramentas.',
          'Cavou até o pôr do sol e achou mais areia.',
        ]),
        tone: 'raro',
        run: (c) => {
          if (c.rng.chance(0.5)) {
            setFlag(c.ws, 'tem-ferramentas');
            const x = c.ws.island.clampToLand(c.world.get(c.self, CTransform)!.x);
            const e = spawnProp(c.world, c.ws, 'baú', x, {});
            c.world.add(e, CVisual, { brush: 'baú', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.7 });
          }
          const n = needsOf(c);
          if (n) satisfy(n, 'curiosity', 0.7);
        },
      },
    ],
  },
  {
    id: 'o-diário',
    weight: 8,
    once: true,
    requires: (c) => c.ws.sky.day >= 6,
    steps: [
      {
        text: 'A maré trouxe um caderno encharcado. Ele secou página por página ao sol.',
        tone: 'maravilha',
        run: (c) => setFlag(c.ws, 'tem-diário'),
      },
    ],
  },
  {
    id: 'o-incêndio',
    weight: 5,
    cooldown: 20 * DAY,
    requires: (c) => c.ws.weather.lightning > 0.3 && countPlants(c.world) > 2,
    steps: [
      {
        text: 'Um raio acertou uma árvore. O fogo pegou rápido.',
        tone: 'perda',
        run: (c) => {
          setFlag(c.ws, 'incêndio', 1);
          const n = needsOf(c);
          if (n) raise(n, 'fear', 0.7);
          for (const e of c.world.query(CPlant)) {
            if (c.rng.chance(0.3)) c.world.need(e, CPlant).health = 0.1;
          }
        },
      },
      { until: (c) => c.ws.weather.rain > 0.35, timeout: 6 * HOUR },
      {
        text: (c) => (c.ws.weather.rain > 0.35 ? 'A chuva apagou o fogo antes de virar problema.' : 'O fogo se apagou sozinho, faltando o que queimar.'),
        tone: 'rotina',
        run: (c) => {
          setFlag(c.ws, 'incêndio', 0);
          const n = needsOf(c);
          if (n) satisfy(n, 'fear', 0.6);
          bump(c.ws, 'incêndios');
        },
      },
      { wait: 2 * DAY },
      {
        text: 'Onde queimou, brotou capim novo. Mais verde do que antes.',
        tone: 'maravilha',
        run: (c) => {
          for (const e of c.world.query(CPlant)) {
            const p = c.world.need(e, CPlant);
            if (p.health < 0.3) p.health = clamp01(p.health + 0.6);
          }
        },
      },
    ],
  },
  {
    id: 'a-tartaruga',
    weight: 9,
    cooldown: 25 * DAY,
    requires: (c) => c.ws.sky.season === 'verão' && c.ws.sky.daylight < 0.15,
    steps: [
      {
        text: 'Uma tartaruga subiu a praia no escuro e cavou por horas.',
        tone: 'maravilha',
        run: (c) => {
          const x = c.ws.island.shoreRight - c.rng.range(4, 14);
          const e = c.world.create();
          c.world.add(e, CTransform, { x, y: c.ws.island.surfaceAt(x), depth: 0.2, facing: -1, scale: 1, rot: 0 });
          c.world.add(e, CCritter, { species: 'tartaruga', state: 'cavando', timer: 60, bond: 0, homeX: x, seed: c.rng.int(1, 1e6) });
          c.world.add(e, CVisual, { brush: 'tartaruga', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.7 });
        },
      },
      { wait: 6 * HOUR },
      {
        text: 'Ele ficou de longe, quieto, para não atrapalhar.',
        run: (c) => {
          const n = needsOf(c);
          if (n) {
            raise(n, 'happiness', 0.2);
            satisfy(n, 'loneliness', 0.2);
          }
        },
      },
      { wait: 6 * DAY },
      {
        text: 'Semanas depois, a areia se mexeu sozinha. Filhotes correram para a água.',
        tone: 'maravilha',
        run: (c) => {
          for (const e of c.world.query(CCritter)) {
            if (c.world.need(e, CCritter).species === 'tartaruga') c.world.destroy(e);
          }
          const n = needsOf(c);
          if (n) raise(n, 'hope', 0.3);
        },
      },
    ],
  },
  {
    id: 'a-arvore-caida',
    weight: 7,
    cooldown: 12 * DAY,
    requires: (c) => c.ws.weather.wind > 0.75 && countPlants(c.world, 'palmeira') >= 2,
    steps: [
      {
        text: 'O vento derrubou uma palmeira durante a noite.',
        tone: 'perda',
        run: (c) => {
          for (const e of c.world.query(CPlant)) {
            const p = c.world.need(e, CPlant);
            if (p.growth > 0.8 && c.rng.chance(0.5)) {
              c.world.destroy(e);
              bump(c.ws, 'lenha', 4);
              break;
            }
          }
        },
      },
      { wait: 8 * HOUR },
      {
        text: 'Ele passou o dia cortando o tronco em pedaços úteis. Nada se perde.',
        tone: 'conquista',
      },
    ],
  },
  {
    id: 'a-mare-trouxe',
    weight: 26,
    cooldown: 1.5 * DAY,
    steps: [
      {
        text: (c) => c.rng.pick([
          'A maré trouxe tábuas. Ele agradeceu a ninguém em particular.',
          'A maré deixou uma boia furada na praia.',
          'Apareceu um remo quebrado na areia.',
          'A maré trouxe uma rede rasgada e muita coisa que não serve.',
        ]),
        tone: 'rotina',
        run: (c) => {
          const x = c.rng.chance(0.5) ? c.ws.island.shoreRight - c.rng.range(2, 10) : c.ws.island.shoreLeft + c.rng.range(2, 10);
          const e = spawnProp(c.world, c.ws, 'destroço', x, { condition: c.rng.range(0.4, 0.9) });
          c.world.add(e, CVisual, { brush: 'destroço', seed: c.rng.int(1, 1e6), opacity: 0, shadow: 0.6 });
          bump(c.ws, 'lenha', c.rng.int(1, 3));
          const n = needsOf(c);
          if (n) raise(n, 'curiosity', 0.25);
        },
      },
    ],
  },
  {
    id: 'a-pintura',
    weight: 8,
    cooldown: 8 * DAY,
    requires: (c) => hasProp(c.world, 'cavalete'),
    steps: [
      { text: 'Passou a manhã moendo pedra colorida com água.', tone: 'rotina' },
      { wait: 6 * HOUR },
      {
        text: (c) => c.rng.pick([
          'Pintou o mar. Ficou parecido com o mar.',
          'Pintou uma pessoa. Depois cobriu com azul.',
          'Pintou a própria ilha vista de cima, do jeito que imagina que seja.',
        ]),
        tone: 'conquista',
        run: (c) => {
          bump(c.ws, 'quadros');
          const n = needsOf(c);
          if (n) {
            satisfy(n, 'creativity', 0.8);
            raise(n, 'happiness', 0.2);
          }
        },
      },
    ],
  },
  {
    id: 'a-cheia',
    weight: 6,
    cooldown: 14 * DAY,
    requires: (c) => Math.abs(c.ws.tide) > 1.4 && c.ws.weather.wind > 0.6,
    steps: [
      {
        text: 'A maré subiu mais do que devia e invadiu a praia.',
        tone: 'perda',
        run: (c) => {
          for (const e of c.world.query(CProp, CTransform)) {
            const tr = c.world.need(e, CTransform);
            const p = c.world.need(e, CProp);
            if (tr.y < 1.6) p.condition = clamp01(p.condition - 0.35);
          }
          const n = needsOf(c);
          if (n) raise(n, 'fear', 0.3);
        },
      },
      { wait: 10 * HOUR },
      { text: 'Passou o dia seguinte arrastando coisas para mais longe da água.', tone: 'rotina' },
    ],
  },
];

export const STORIES: Story[] = [...OBRAS, ...ARCOS];
export const STORY_BY_ID = new Map(STORIES.map((s) => [s.id, s]));

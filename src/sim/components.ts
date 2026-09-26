import { defineComponent } from '../core/ecs.ts';
import type { AssetId } from '../art/assets/ids.ts';

/** Posição no diorama. x: leste-oeste, y: altura (0 = nível do mar), depth: paralaxe. */
export interface Transform {
  x: number;
  y: number;
  /** -1 (fundo) .. 1 (frente). Afeta escala, névoa e ordem de desenho. */
  depth: number;
  facing: 1 | -1;
  scale: number;
  rot: number;
}
export const CTransform = defineComponent<Transform>('Transform', () => ({
  x: 0, y: 0, depth: 0, facing: 1, scale: 1, rot: 0,
}));

/** Física leve. Nada de motor rígido: só o suficiente para coisas caírem e boiarem. */
export interface Body {
  vx: number;
  vy: number;
  mass: number;
  drag: number;
  bounce: number;
  /** Se true, flutua na linha d'água e balança com a onda. */
  buoyant: boolean;
  grounded: boolean;
  /** Repouso: para de integrar quando parado, economizando CPU por semanas a fio. */
  asleep: boolean;
}
export const CBody = defineComponent<Body>('Body', () => ({
  vx: 0, vy: 0, mass: 1, drag: 0.6, bounce: 0.15, buoyant: false, grounded: false, asleep: false,
}));

/** O náufrago. Existe exatamente um. */
export interface Castaway {
  name: string;
  /** Dias vividos na ilha. */
  ageDays: number;
  /** 0 = recém-chegado, 1 = velho do mar. Muda barba, roupa, postura. */
  weathering: number;
  beard: number;
  /** Índice da roupa atual (procedural, feita do que ele achou). */
  outfit: number;
  mood: number;
}
export const CCastaway = defineComponent<Castaway>('Castaway', () => ({
  name: 'o náufrago', ageDays: 0, weathering: 0, beard: 0.05, outfit: 0, mood: 0.5,
}));

/** Impulsos internos. 0 = saciado, 1 = urgente. Exceto felicidade/esperança (0 ruim, 1 bom). */
export interface Needs {
  hunger: number;
  thirst: number;
  rest: number;
  curiosity: number;
  fear: number;
  creativity: number;
  laziness: number;
  happiness: number;
  loneliness: number;
  hope: number;
}
export const CNeeds = defineComponent<Needs>('Needs', () => ({
  hunger: 0.2, thirst: 0.2, rest: 0.1, curiosity: 0.4, fear: 0.05,
  creativity: 0.3, laziness: 0.2, happiness: 0.55, loneliness: 0.3, hope: 0.6,
}));

/** Estado de decisão. O cérebro escolhe; o corpo executa. */
export interface Brain {
  action: string;
  /** Segundos de mundo já gastos na ação atual. */
  elapsed: number;
  duration: number;
  /** Fase interna da ação (cada ação interpreta como quiser). */
  phase: number;
  targetX: number;
  targetEntity: number;
  /** Ação -> instante da última execução, para evitar repetição. */
  lastRun: Record<string, number>;
  /** Trilha de intenção: o que ele planeja fazer em seguida, se nada mudar. */
  intent: string;
  /** Contador de tentativas frustradas — alimenta humor e histórias. */
  frustration: number;
}
export const CBrain = defineComponent<Brain>('Brain', () => ({
  action: 'ocioso', elapsed: 0, duration: 3, phase: 0, targetX: 0, targetEntity: 0,
  lastRun: {}, intent: '', frustration: 0,
}));

/** Habilidades aprendidas com a prática. Melhoram resultados e abrem histórias novas. */
export interface Skills {
  [name: string]: number;
}
export const CSkills = defineComponent<Skills>('Skills', () => ({}));

/** Estrutura construída ou objeto do cenário. Persiste para sempre. */
export interface Prop {
  kind: string;
  /** 0..1 durante a construção; 1 = pronto. */
  progress: number;
  /** 1 = novo, 0 = ruína. Cai com tempestade, sal e tempo. */
  condition: number;
  /** Dia de mundo em que foi concluído. */
  builtOnDay: number;
  /** Semente própria: dá formato único a cada objeto. */
  seed: number;
  /** Estado livre por tipo (ex.: farol aceso, moinho girando). */
  flags: Record<string, number>;
}
export const CProp = defineComponent<Prop>('Prop', () => ({
  kind: 'destroço', progress: 1, condition: 1, builtOnDay: 0, seed: 1, flags: {},
}));

/** Vegetação com crescimento real e memória de cada galho. */
export interface Plant {
  species: string;
  /** 0 = muda, 1 = adulta. Cresce por dias, não por segundos. */
  growth: number;
  health: number;
  /** Altura alvo em unidades de mundo. */
  maxHeight: number;
  seed: number;
  fruit: number;
  plantedOnDay: number;
}
export const CPlant = defineComponent<Plant>('Plant', () => ({
  species: 'palmeira', growth: 1, health: 1, maxHeight: 22, seed: 1, fruit: 0, plantedOnDay: 0,
}));

/** Bichos: caranguejos, gaivotas, peixes, o papagaio. */
export interface Critter {
  species: string;
  state: string;
  timer: number;
  /** Vínculo com o náufrago: 0 arisco, 1 companheiro. */
  bond: number;
  homeX: number;
  seed: number;
}
export const CCritter = defineComponent<Critter>('Critter', () => ({
  species: 'caranguejo', state: 'vagando', timer: 0, bond: 0, homeX: 0, seed: 1,
}));

/** Marca uma entidade como visível e diz por qual pincel procedural desenhá-la. */
export interface Visual {
  /** Nome do desenho no catálogo visual (`art/assets`). */
  brush: AssetId;
  /** Variação estável de cor/forma. */
  seed: number;
  /** 0..1, para nascer/desaparecer suavemente. */
  opacity: number;
  /** Sombra projetada no chão. */
  shadow: number;
}
export const CVisual = defineComponent<Visual>('Visual', () => ({
  brush: 'destroço', seed: 1, opacity: 1, shadow: 0.8,
}));

/** Marca uma entidade como parte de um evento raro ativo. */
export interface RareMark {
  event: string;
  /** Segundos de mundo restantes antes de sumir para sempre. */
  ttl: number;
  phase: number;
}
export const CRare = defineComponent<RareMark>('RareMark', () => ({ event: '', ttl: 60, phase: 0 }));

/** Vida útil simples: some quando zera. Usado por efeitos e coisas efêmeras. */
export interface Ephemeral {
  ttl: number;
  fade: number;
}
export const CEphemeral = defineComponent<Ephemeral>('Ephemeral', () => ({ ttl: 5, fade: 1 }), false);

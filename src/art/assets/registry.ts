/**
 * Asset Registry
 *
 * Catálogo central dos elementos visuais do Driftwood.
 *
 * O renderer não deve conhecer objetos específicos.
 * Ele recebe uma referência de asset e resolve através deste catálogo.
 *
 * Cada entrada liga um nome de `ids.ts` ao pincel que o desenha e aos
 * metadados que o descrevem. O náufrago fica de fora: ele não é um pincel,
 * é um boneco articulado com pose e envelhecimento (`render/character.ts`).
 */

import type { Brush } from '../../render/brushes.ts';
import {
  bottle, bridge, bush, campfire, chair, chest, drum, easel, flotsam, garden, hammock, hut,
  lighthouse, observatory, oven, palm, plant, raft, rock, sandcastle, sculpture, shellChime,
  stairs, telescope, tool, windmill,
} from '../../render/brushes.ts';
import {
  astronaut, crab, dragon, explorer, fish, floatingIsland, kraken, livingCastle, mermaid,
  parrot, pirateShip, portal, robot, seagull, ship, submarine, turtle, ufo, volcano, whale,
} from '../../render/creatures.ts';
import { isAssetId, type AssetId } from './ids.ts';

export type { AssetId } from './ids.ts';

export type AssetLayer =
  | "silhouette"
  | "volume"
  | "detail"
  | "shadow"
  | "highlight"
  | "particle"
  | "light";


export interface VisualAsset<Id extends AssetId = AssetId> {
  id: Id;

  category:
    | "creature"
    | "vegetation"
    | "prop"
    | "environment"
    /** Prodígio: aparece raramente, por pouco tempo, às vezes nunca. */
    | "wonder";

  /** O desenho. Função pura: mesma semente, mesmo resultado, para sempre. */
  draw: Brush;

  /**
   * Camadas que o pincel desenha em separado. Nenhum pincel atual separa
   * camadas — cada um desenha tudo de uma vez — então fica vazio até a nova
   * pipeline visual dividi-los.
   */
  layers?: AssetLayer[];

  /** O que faz o desenho mudar sozinho. Reflete o que o pincel realmente lê. */
  animation?: {
    /** Balança com `wind`. */
    wind?: boolean;
    /** Se mexe com o relógio de render (chama, asas, luz piscando). */
    idle?: boolean;
    /** Muda de cor ou forma com a estação. */
    seasonal?: boolean;
  };

  description: string;
}


/**
 * Catálogo visual principal.
 *
 * Novos elementos entram aqui (e o nome em `ids.ts`),
 * não diretamente no renderer.
 */
export const ASSETS: { readonly [Id in AssetId]: VisualAsset<Id> } = {

  // ── vegetação ──

  planta: {
    id: "planta",
    category: "vegetation",
    draw: plant,
    animation: { wind: true, seasonal: true },
    description: "Planta viva do ecossistema; vira palmeira ou arbusto conforme a espécie.",
  },

  palmeira: {
    id: "palmeira",
    category: "vegetation",
    draw: palm,
    animation: { wind: true, seasonal: true },
    description: "Coqueiro com frondes em pena, cresce ao longo de semanas e dá frutos.",
  },

  arbusto: {
    id: "arbusto",
    category: "vegetation",
    draw: bush,
    animation: { wind: true, seasonal: true },
    description: "Moita baixa de folhagem em tufos.",
  },

  // ── construções e objetos ──

  cabana: {
    id: "cabana",
    category: "prop",
    draw: hut,
    animation: { seasonal: true },
    description: "Abrigo de galhos fincados no chão, erguido aos poucos.",
  },

  fogueira: {
    id: "fogueira",
    category: "prop",
    draw: campfire,
    animation: { idle: true },
    description: "Círculo de pedras; com chama quando acesa.",
  },

  jangada: {
    id: "jangada",
    category: "prop",
    draw: raft,
    description: "Jangada de troncos alinhados na areia.",
  },

  destroço: {
    id: "destroço",
    category: "prop",
    draw: flotsam,
    description: "Tábuas e restos que a maré traz.",
  },

  escultura: {
    id: "escultura",
    category: "prop",
    draw: sculpture,
    description: "Escultura que ele fez. Não se sabe do quê.",
  },

  castelo: {
    id: "castelo",
    category: "prop",
    draw: sandcastle,
    description: "Castelo de areia.",
  },

  rede: {
    id: "rede",
    category: "prop",
    draw: hammock,
    animation: { idle: true },
    description: "Rede de fibra de coqueiro entre duas palmeiras.",
  },

  moinho: {
    id: "moinho",
    category: "prop",
    draw: windmill,
    animation: { wind: true, idle: true },
    description: "Moinho de vento no cume, com pás que giram.",
  },

  farol: {
    id: "farol",
    category: "prop",
    draw: lighthouse,
    animation: { idle: true },
    description: "Farol de pedra empilhada no ponto mais alto, com luz.",
  },

  telescópio: {
    id: "telescópio",
    category: "prop",
    draw: telescope,
    animation: { idle: true },
    description: "Telescópio com lente de fundo de garrafa polido.",
  },

  observatório: {
    id: "observatório",
    category: "prop",
    draw: observatory,
    description: "Pedras marcadas apontando para onde certas estrelas nascem.",
  },

  ponte: {
    id: "ponte",
    category: "prop",
    draw: bridge,
    description: "Ponte até a pedra no raso.",
  },

  forno: {
    id: "forno",
    category: "prop",
    draw: oven,
    description: "Forno de barro da beira da nascente.",
  },

  cadeira: {
    id: "cadeira",
    category: "prop",
    draw: chair,
    description: "Assento serrado de um tronco.",
  },

  horta: {
    id: "horta",
    category: "prop",
    draw: garden,
    animation: { seasonal: true },
    description: "Pedaço de terra cercado com gravetos.",
  },

  tambor: {
    id: "tambor",
    category: "prop",
    draw: drum,
    description: "Tambor de tronco oco.",
  },

  sino: {
    id: "sino",
    category: "prop",
    draw: shellChime,
    animation: { wind: true, idle: true },
    description: "Sino de conchas furadas que balança com o vento.",
  },

  escada: {
    id: "escada",
    category: "prop",
    draw: stairs,
    description: "Escada para subir o barranco.",
  },

  cavalete: {
    id: "cavalete",
    category: "prop",
    draw: easel,
    description: "Tripé de varas com uma tábua lisa.",
  },

  garrafa: {
    id: "garrafa",
    category: "prop",
    draw: bottle,
    description: "Garrafa trazida pelo mar.",
  },

  baú: {
    id: "baú",
    category: "prop",
    draw: chest,
    description: "Baú encontrado ou desenterrado.",
  },

  ferramenta: {
    id: "ferramenta",
    category: "prop",
    draw: tool,
    description: "Vara de pesca: galho fino amarrado com fibra.",
  },

  rocha: {
    id: "rocha",
    category: "environment",
    draw: rock,
    animation: { seasonal: true },
    description: "Rocha da ilha, com musgo.",
  },

  // ── bichos da ilha ──

  caranguejo: {
    id: "caranguejo",
    category: "creature",
    draw: crab,
    animation: { idle: true },
    description: "Caranguejo que vaga pela praia.",
  },

  gaivota: {
    id: "gaivota",
    category: "creature",
    draw: seagull,
    animation: { idle: true },
    description: "Gaivota em voo.",
  },

  papagaio: {
    id: "papagaio",
    category: "creature",
    draw: parrot,
    animation: { idle: true },
    description: "Papagaio que pode ser domesticado.",
  },

  tartaruga: {
    id: "tartaruga",
    category: "creature",
    draw: turtle,
    animation: { idle: true },
    description: "Tartaruga marinha.",
  },

  peixe: {
    id: "peixe",
    category: "creature",
    draw: fish,
    animation: { idle: true },
    description: "Peixe — inclusive o que cai do céu.",
  },

  // ── prodígios ──

  navio: {
    id: "navio",
    category: "wonder",
    draw: ship,
    description: "Navio no horizonte.",
  },

  "navio-pirata": {
    id: "navio-pirata",
    category: "wonder",
    draw: pirateShip,
    description: "Navio de velas negras no horizonte.",
  },

  submarino: {
    id: "submarino",
    category: "wonder",
    draw: submarine,
    description: "Periscópio que sobe, gira devagar e afunda.",
  },

  baleia: {
    id: "baleia",
    category: "wonder",
    draw: whale,
    animation: { idle: true },
    description: "Baleia soprando perto da arrebentação.",
  },

  ovni: {
    id: "ovni",
    category: "wonder",
    draw: ufo,
    animation: { idle: true },
    description: "Luz que desce do céu e sobe de novo em silêncio.",
  },

  sereia: {
    id: "sereia",
    category: "wonder",
    draw: mermaid,
    description: "Alguém cantando na pedra, só na lua cheia.",
  },

  kraken: {
    id: "kraken",
    category: "wonder",
    draw: kraken,
    animation: { idle: true },
    description: "Algo muito grande sob a água, só em tempestade.",
  },

  vulcão: {
    id: "vulcão",
    category: "wonder",
    draw: volcano,
    animation: { idle: true },
    description: "Ilha nova saindo da água no horizonte, fumegando.",
  },

  "ilha-flutuante": {
    id: "ilha-flutuante",
    category: "wonder",
    draw: floatingIsland,
    animation: { idle: true },
    description: "Pedaço de terra com árvores penduradas entre as nuvens.",
  },

  explorador: {
    id: "explorador",
    category: "wonder",
    draw: explorer,
    description: "Visitantes de bote que tiram medidas e vão embora.",
  },

  astronauta: {
    id: "astronauta",
    category: "wonder",
    draw: astronaut,
    description: "Alguém de traje branco saído de uma cápsula.",
  },

  portal: {
    id: "portal",
    category: "wonder",
    draw: portal,
    animation: { idle: true },
    description: "Fresta de luz no ar, só durante uma aurora.",
  },

  robô: {
    id: "robô",
    category: "wonder",
    draw: robot,
    animation: { idle: true },
    description: "Robô enferrujado, desenterrado.",
  },

  dragão: {
    id: "dragão",
    category: "wonder",
    draw: dragon,
    animation: { idle: true },
    description: "Algo enorme dormindo no fundo da caverna.",
  },

  "castelo-vivo": {
    id: "castelo-vivo",
    category: "wonder",
    draw: livingCastle,
    animation: { idle: true },
    description: "Castelo de areia com janelas acesas; de manhã é só areia.",
  },

};


export function getAsset(id: string): VisualAsset | undefined {
  return isAssetId(id) ? ASSETS[id] : undefined;
}

const warned = new Set<string>();

/**
 * Como `getAsset`, mas nunca falha: um nome desconhecido (um save de outra
 * versão, por exemplo) vira destroço, com um único aviso no console.
 */
export function resolveAsset(id: string): VisualAsset {
  const asset = getAsset(id);
  if (asset) return asset;
  if (!warned.has(id)) {
    warned.add(id);
    console.warn(`[driftwood] asset desconhecido "${id}"; desenhando como destroço.`);
  }
  return ASSETS.destroço;
}

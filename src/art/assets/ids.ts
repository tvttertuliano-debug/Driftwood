/**
 * Vocabulário visual do Driftwood: o nome de tudo que pode ser desenhado.
 *
 * Fica separado do catálogo (`registry.ts`) de propósito. A simulação precisa
 * dizer *o que* uma entidade é, mas não pode saber *como* ela é desenhada —
 * então importa só estes nomes, nunca os pincéis.
 *
 * O catálogo é tipado contra esta lista: um nome aqui sem desenho lá, ou um
 * desenho lá sem nome aqui, é erro de compilação.
 */
export const ASSET_IDS = [
  // vegetação
  'planta',
  'palmeira',
  'arbusto',
  // construções e objetos
  'cabana',
  'fogueira',
  'jangada',
  'destroço',
  'escultura',
  'castelo',
  'rede',
  'moinho',
  'farol',
  'telescópio',
  'observatório',
  'ponte',
  'forno',
  'cadeira',
  'horta',
  'tambor',
  'sino',
  'escada',
  'cavalete',
  'garrafa',
  'baú',
  'ferramenta',
  'rocha',
  // bichos da ilha
  'caranguejo',
  'gaivota',
  'papagaio',
  'tartaruga',
  'peixe',
  // prodígios
  'navio',
  'navio-pirata',
  'submarino',
  'baleia',
  'ovni',
  'sereia',
  'kraken',
  'vulcão',
  'ilha-flutuante',
  'explorador',
  'astronauta',
  'portal',
  'robô',
  'dragão',
  'castelo-vivo',
] as const;

export type AssetId = (typeof ASSET_IDS)[number];

const KNOWN: ReadonlySet<string> = new Set(ASSET_IDS);

/** Para dados que chegam de fora do compilador — um save antigo, por exemplo. */
export function isAssetId(id: string): id is AssetId {
  return KNOWN.has(id);
}

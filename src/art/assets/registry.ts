/**
 * Asset Registry
 *
 * Catálogo central dos elementos visuais do Driftwood.
 *
 * O renderer não deve conhecer objetos específicos.
 * Ele recebe uma referência de asset e resolve através deste catálogo.
 */

export type AssetLayer =
  | "silhouette"
  | "volume"
  | "detail"
  | "shadow"
  | "highlight"
  | "particle"
  | "light";


export interface VisualAsset {
  id: string;

  category:
    | "character"
    | "creature"
    | "vegetation"
    | "prop"
    | "environment";

  layers: AssetLayer[];

  animation?: {
    wind?: boolean;
    idle?: boolean;
    seasonal?: boolean;
  };

  description: string;
}


/**
 * Catálogo visual principal.
 *
 * Novos elementos entram aqui,
 * não diretamente no renderer.
 */
export const ASSETS: Record<string, VisualAsset> = {

  castaway: {
    id: "castaway",
    category: "character",

    layers: [
      "silhouette",
      "volume",
      "detail",
      "shadow",
      "highlight",
    ],

    animation: {
      idle: true,
      seasonal: true,
    },

    description:
      "Náufrago principal com evolução de aparência ao longo do tempo.",
  },


  palm_tree: {
    id: "palm_tree",
    category: "vegetation",

    layers: [
      "silhouette",
      "volume",
      "shadow",
      "highlight",
    ],

    animation: {
      wind: true,
    },

    description:
      "Palmeira tropical afetada pelo vento.",
  },


  camp_fire: {
    id: "camp_fire",
    category: "prop",

    layers: [
      "silhouette",
      "volume",
      "particle",
      "light",
    ],

    animation: {
      idle: true,
    },

    description:
      "Fogueira com chama e partículas.",
  },

};


export function getAsset(id: string): VisualAsset | undefined {
  return ASSETS[id];
}
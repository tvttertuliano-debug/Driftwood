/** Constantes de sintonia. Tudo que é "gosto" mora aqui, não espalhado no código. */

export const SIM = {
  /** Passo fixo da simulação, em segundos. 20 Hz é suficiente e barato. */
  step: 1 / 20,
  /** Máximo de passos recuperados por frame — evita espiral da morte. */
  maxCatchUp: 4,
  /**
   * Minutos de mundo por segundo real. 2 => um dia inteiro em 12 minutos reais.
   * O ritmo é lento de propósito: quem observa deve ter tempo de reparar nas coisas.
   */
  minutesPerSecond: 2,
  /** Dias de mundo por estação. */
  daysPerSeason: 12,
  /** Ciclo lunar, em dias. */
  lunarCycle: 29.5,
} as const;

export const WORLD = {
  /** Meia-largura da ilha em unidades de mundo. */
  halfWidth: 120,
  /** Nível do mar em y. */
  seaLevel: 0,
  gravity: -46,
} as const;

export const RENDER = {
  /** Resolução interna máxima (a janela pode ser 4K; a simulação visual não precisa). */
  maxPixels: 3840 * 2160,
  /** Segundos entre trocas automáticas de enquadramento. */
  cameraDwell: [38, 95] as [number, number],
} as const;

export const PERSIST = {
  key: 'driftwood.world.v1',
  /** Intervalo de autosave em segundos reais. */
  autosaveSeconds: 45,
  version: 1,
} as const;

/** Perfis de qualidade. O runtime rebaixa sozinho se o frame estourar o orçamento. */
export type QualityTier = 'alta' | 'media' | 'baixa';

export const QUALITY: Record<QualityTier, {
  particles: number;
  oceanOctaves: number;
  vegetationDetail: number;
}> = {
  alta: { particles: 1400, oceanOctaves: 5, vegetationDetail: 1 },
  media: { particles: 700, oceanOctaves: 4, vegetationDetail: 0.7 },
  baixa: { particles: 260, oceanOctaves: 3, vegetationDetail: 0.45 },
};

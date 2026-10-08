/**
 * Geradores determinísticos. Todo o mundo de Driftwood nasce de uma semente:
 * mesma semente => mesma ilha, mesmas constelações, mesmo formato de rocha.
 * Só o tempo (e o acaso das decisões do náufrago) diverge.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** mulberry32 — pequeno, rápido, bom o bastante para simulação ambiental. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }

  /** true com probabilidade p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Escolha ponderada. Pesos <= 0 são ignorados. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | null {
    let total = 0;
    for (const it of items) {
      const w = weight(it);
      if (w > 0) total += w;
    }
    if (total <= 0) return null;
    let roll = this.next() * total;
    for (const it of items) {
      const w = weight(it);
      if (w <= 0) continue;
      roll -= w;
      if (roll <= 0) return it;
    }
    return null;
  }

  /** Ruído gaussiano (Box-Muller), útil para variação orgânica. */
  gauss(mean = 0, sd = 1): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0);
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }
}

/** Hash estável 2D -> [0,1). Usado por terreno e vegetação. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Ruído de valor 1D suavizado — perfeito para ondulação de terreno e vento. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  return a + (b - a) * u;
}

/** Ruído fractal 1D. */
export function fbm1(x: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise1(x * freq, seed + o * 97) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Semente vinda de fora (URL, save). Só aceita inteiros de 0 a 2^32 − 1: um
 * `?semente=abc` virava NaN, que o JSON grava como null, e no carregamento
 * seguinte a ilha era sorteada de novo debaixo das entidades salvas.
 */
export function parseSeed(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff ? n : null;
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

import { fbm1, Rng } from '../core/rng.ts';
import { clamp, clamp01, lerp, smoothstep } from '../core/math.ts';
import { WORLD } from '../core/config.ts';

/**
 * A ilha é gerada uma vez a partir da semente do mundo e nunca é serializada:
 * a mesma semente reconstrói exatamente o mesmo recorte de areia e pedra.
 * Erosão é aplicada por cima, como um delta pequeno e persistente.
 */

const SAMPLES = 1024;

export interface IslandFeature {
  kind: 'caverna' | 'nascente' | 'rochedo' | 'cume' | 'enseada' | 'coqueiral';
  x: number;
  y: number;
  seed: number;
  /** Descobertas ficam visíveis; o resto espera o náufrago tropeçar nelas. */
  hidden: boolean;
}

export class Island {
  readonly seed: number;
  readonly half = WORLD.halfWidth;
  private height = new Float32Array(SAMPLES);
  /** Delta de erosão acumulado, em unidades de mundo (negativo = desgaste). */
  private erosion = new Float32Array(SAMPLES);
  readonly features: IslandFeature[] = [];
  /** x onde o terreno cruza o nível do mar. */
  shoreLeft = -80;
  shoreRight = 80;
  peakX = 0;
  peakY = 30;

  constructor(seed: number) {
    this.seed = seed;
    this.build();
  }

  private raw(x: number): number {
    const t = clamp(x / this.half, -1, 1);
    // Massa central suave: nada de ilha retangular.
    const core = Math.pow(Math.cos((t * Math.PI) / 2), 1.5);
    const bumps = fbm1(x * 0.021 + 13.7, 4, this.seed) - 0.5;
    const dunes = fbm1(x * 0.13 + 41.2, 3, this.seed ^ 0x51) - 0.5;
    const shape = core * (0.78 + 0.44 * bumps) + 0.06 * dunes * core;
    return shape;
  }

  private build(): void {
    const rng = new Rng(this.seed ^ 0x1a2b3c);
    const peak = 26 + rng.range(0, 16);
    const waterCut = 0.2 + rng.range(0, 0.06);

    for (let i = 0; i < SAMPLES; i++) {
      const x = this.sampleX(i);
      const r = this.raw(x);
      const norm = (r - waterCut) / (1 - waterCut);
      // Expoente > 1 achata o terreno perto da linha d'água: é isso que cria
      // praias caminháveis em vez de um paredão saindo direto do mar.
      this.height[i] = peak * Math.sign(norm) * Math.pow(Math.abs(norm), 1.7);
    }

    // Um segundo relevo assimétrico: dá à ilha um lado alto e um lado manso.
    const hillSide = rng.chance(0.5) ? 1 : -1;
    const hillCenter = hillSide * this.half * rng.range(0.24, 0.42);
    const hillWidth = this.half * rng.range(0.16, 0.26);
    const hillHeight = peak * rng.range(0.32, 0.6);
    for (let i = 0; i < SAMPLES; i++) {
      const x = this.sampleX(i);
      const d = (x - hillCenter) / hillWidth;
      const bump = Math.exp(-d * d * 1.4) * hillHeight;
      this.height[i] += bump;
    }

    this.recomputeBounds();

    // Feições notáveis, derivadas do terreno — nada arbitrário.
    this.peakX = hillCenter;
    this.peakY = this.groundAt(hillCenter);

    const caveX = hillCenter + hillSide * hillWidth * rng.range(0.5, 0.85);
    this.features.push({ kind: 'caverna', x: caveX, y: this.groundAt(caveX) + 1.5, seed: rng.int(1, 1e6), hidden: true });

    const springX = hillCenter - hillSide * hillWidth * rng.range(0.6, 1.3);
    this.features.push({ kind: 'nascente', x: springX, y: this.groundAt(springX), seed: rng.int(1, 1e6), hidden: false });

    this.features.push({ kind: 'cume', x: hillCenter, y: this.peakY, seed: rng.int(1, 1e6), hidden: false });

    const rocks = rng.int(2, 4);
    for (let i = 0; i < rocks; i++) {
      const x = rng.range(this.shoreLeft - 26, this.shoreRight + 26);
      this.features.push({ kind: 'rochedo', x, y: this.groundAt(x), seed: rng.int(1, 1e6), hidden: false });
    }

    const coveX = -hillSide * this.half * rng.range(0.3, 0.55);
    this.features.push({ kind: 'enseada', x: coveX, y: this.groundAt(coveX), seed: rng.int(1, 1e6), hidden: false });

    const groveX = -hillSide * this.half * rng.range(0.1, 0.35);
    this.features.push({ kind: 'coqueiral', x: groveX, y: this.groundAt(groveX), seed: rng.int(1, 1e6), hidden: false });
  }

  private recomputeBounds(): void {
    this.shoreLeft = -this.half;
    this.shoreRight = this.half;
    for (let i = 1; i < SAMPLES; i++) {
      if (this.height[i - 1] <= 0 && this.height[i] > 0) {
        this.shoreLeft = this.sampleX(i);
        break;
      }
    }
    for (let i = SAMPLES - 2; i >= 0; i--) {
      if (this.height[i + 1] <= 0 && this.height[i] > 0) {
        this.shoreRight = this.sampleX(i);
        break;
      }
    }
  }

  private sampleX(i: number): number {
    return -this.half + (i / (SAMPLES - 1)) * this.half * 2;
  }

  private index(x: number): number {
    return clamp(((x + this.half) / (this.half * 2)) * (SAMPLES - 1), 0, SAMPLES - 1);
  }

  /** Altura do terreno em x (interpolada). Abaixo de 0 significa fundo submerso. */
  groundAt(x: number): number {
    const f = this.index(x);
    const i = Math.floor(f);
    const j = Math.min(SAMPLES - 1, i + 1);
    const t = f - i;
    return lerp(this.height[i] + this.erosion[i], this.height[j] + this.erosion[j], t);
  }

  /** Inclinação local — usada para caminhar mais devagar na subida e posicionar coisas. */
  slopeAt(x: number): number {
    const d = 1.5;
    return (this.groundAt(x + d) - this.groundAt(x - d)) / (2 * d);
  }

  /** y de superfície onde algo apoiado deve ficar (chão acima do mar, senão a linha d'água). */
  surfaceAt(x: number): number {
    return Math.max(WORLD.seaLevel, this.groundAt(x));
  }

  isLand(x: number): boolean {
    return this.groundAt(x) > 0.15;
  }

  /** Faixa caminhável, com uma margem para ele não andar até cair no mar. */
  get walkable(): [number, number] {
    return [this.shoreLeft + 2.5, this.shoreRight - 2.5];
  }

  clampToLand(x: number): number {
    const [a, b] = this.walkable;
    return clamp(x, a, b);
  }

  /** Praia = terreno baixo e quase plano perto da água. */
  isBeach(x: number): boolean {
    const h = this.groundAt(x);
    return h > 0 && h < 3.2 && Math.abs(this.slopeAt(x)) < 0.35;
  }

  /** Aplica desgaste. Tempestades comem a praia; o mundo lembra disso. */
  erode(x: number, radius: number, amount: number): void {
    const i0 = Math.floor(this.index(x - radius));
    const i1 = Math.ceil(this.index(x + radius));
    for (let i = i0; i <= i1; i++) {
      if (i < 0 || i >= SAMPLES) continue;
      const d = Math.abs(this.sampleX(i) - x) / radius;
      const w = smoothstep(1, 0, clamp01(d));
      this.erosion[i] -= amount * w;
    }
    this.recomputeBounds();
  }

  /** Areia se acumula de volta com o tempo: a ilha respira. */
  settle(rate: number): void {
    let changed = false;
    for (let i = 0; i < SAMPLES; i++) {
      if (this.erosion[i] === 0) continue;
      this.erosion[i] *= 1 - rate;
      if (Math.abs(this.erosion[i]) < 1e-4) this.erosion[i] = 0;
      changed = true;
    }
    if (changed) this.recomputeBounds();
  }

  feature(kind: IslandFeature['kind']): IslandFeature | undefined {
    return this.features.find((f) => f.kind === kind);
  }

  serializeErosion(): number[] {
    return Array.from(this.erosion);
  }

  loadErosion(data: number[] | undefined): void {
    if (!data || data.length !== SAMPLES) return;
    this.erosion.set(data);
    this.recomputeBounds();
  }

  /** Polilinha do contorno para o renderizador, no nível de detalhe pedido. */
  outline(step = 2): Float32Array {
    const pts: number[] = [];
    for (let x = -this.half; x <= this.half; x += step) {
      pts.push(x, this.groundAt(x));
    }
    return new Float32Array(pts);
  }
}

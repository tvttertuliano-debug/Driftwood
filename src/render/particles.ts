import { Painter } from './painter.ts';
import { Rng } from '../core/rng.ts';
import { clamp01, lerp, type RGB } from '../core/math.ts';
import { lit, type Lighting } from './palette.ts';
import type { Weather } from '../sim/weather.ts';

/**
 * Partículas em arrays planos, sem alocação por quadro. O pool é fixo: o
 * programa pode ficar semanas aberto sem o coletor de lixo dar as caras.
 */

const enum Kind {
  Livre = 0,
  Chuva = 1,
  Respingo = 2,
  Brasa = 3,
  VagaLume = 4,
  Folha = 5,
  Poeira = 6,
}

export interface ParticleWorld {
  weather: Weather;
  /** Limites visíveis, em unidades de mundo. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  seaLevel: number;
  /** Focos de brasa (fogueiras acesas). */
  fires: { x: number; y: number }[];
  night: number;
  calm: number;
}

export class Particles {
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private kind: Uint8Array;
  private seedArr: Float32Array;
  private cursor = 0;
  private rng = new Rng(0x9137);
  /**
   * Resto fracionário de emissão por tipo.
   *
   * Sem isto, uma taxa de 54 partículas por segundo vira `floor(54 * 1/60)` =
   * `floor(0.9)` = 0 em *todo* quadro, e o sistema inteiro nunca emite nada.
   * Guardando a sobra entre quadros, qualquer taxa acaba saindo.
   */
  private resto = new Float32Array(8);
  readonly capacity: number;
  /** Quantidade viva, exposta para o HUD de desempenho. */
  alive = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.seedArr = new Float32Array(capacity);
  }

  private spawn(k: Kind, x: number, y: number, vx: number, vy: number, life: number): void {
    // Buffer circular: partícula nova sobrescreve a mais antiga. Sem realocação.
    for (let tries = 0; tries < 4; tries++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      if (this.kind[i] !== Kind.Livre && this.life[i] > 0.35 * this.maxLife[i] && tries < 3) continue;
      this.kind[i] = k;
      this.x[i] = x; this.y[i] = y;
      this.vx[i] = vx; this.vy[i] = vy;
      this.life[i] = life; this.maxLife[i] = life;
      this.seedArr[i] = this.rng.next();
      return;
    }
  }

  /**
   * Converte uma taxa por segundo num número inteiro de partículas neste quadro,
   * guardando a fração que sobrou para o quadro seguinte.
   */
  private aEmitir(k: Kind, porSegundo: number, dt: number, teto = 200): number {
    if (porSegundo <= 0) return 0;
    const acumulado = this.resto[k] + porSegundo * dt;
    const n = Math.min(teto, Math.floor(acumulado));
    this.resto[k] = acumulado - n;
    return n;
  }

  update(dt: number, w: ParticleWorld, budget: number): void {
    const width = w.right - w.left;
    const wind = w.weather.wind * w.weather.windDir;
    // Um engasgo longo não deve despejar milhares de partículas de uma vez.
    const edt = Math.min(dt, 0.05);

    // ── emissão (taxas em partículas por segundo, a orçamento cheio) ──
    const chuva = this.aEmitir(Kind.Chuva, w.weather.rain * 420 * budget, edt, 120);
    for (let i = 0; i < chuva; i++) {
      const px = w.left + this.rng.next() * width * 1.25 - width * 0.12;
      this.spawn(Kind.Chuva, px, w.top + this.rng.range(0, 12), wind * 26 + this.rng.range(-2, 2), -52 - this.rng.range(0, 26), 4);
    }

    // Arrebentação: respingo constante na linha d'água.
    const respingos = this.aEmitir(Kind.Respingo, (0.5 + w.weather.wind * 1.6) * 22 * budget, edt, 60);
    for (let i = 0; i < respingos; i++) {
      const px = this.rng.chance(0.5) ? w.left + this.rng.range(0, width * 0.2) : w.right - this.rng.range(0, width * 0.2);
      this.spawn(Kind.Respingo, px, w.seaLevel, this.rng.range(-4, 4), this.rng.range(4, 13), this.rng.range(0.7, 1.5));
    }

    if (w.fires.length > 0) {
      const brasas = this.aEmitir(Kind.Brasa, 14 * w.fires.length * budget, edt, 40);
      for (let i = 0; i < brasas; i++) {
        const fire = w.fires[Math.floor(this.rng.next() * w.fires.length)];
        this.spawn(Kind.Brasa, fire.x + this.rng.range(-1, 1), fire.y + this.rng.range(0, 2), this.rng.range(-1.2, 1.2) + wind * 3, this.rng.range(5, 13), this.rng.range(1.2, 2.6));
      }
    }

    if (w.night > 0.6 && w.calm > 0.5) {
      const vagalumes = this.aEmitir(Kind.VagaLume, 3.5 * budget, edt, 12);
      for (let i = 0; i < vagalumes; i++) {
        const px = w.left + this.rng.next() * width;
        this.spawn(Kind.VagaLume, px, this.rng.range(1, 14), this.rng.range(-1, 1), this.rng.range(-0.5, 0.8), this.rng.range(4, 10));
      }
    }

    if (w.weather.wind > 0.45) {
      const folhas = this.aEmitir(Kind.Folha, w.weather.wind * 7 * budget, edt, 20);
      for (let i = 0; i < folhas; i++) {
        const px = wind > 0 ? w.left - 4 : w.right + 4;
        this.spawn(Kind.Folha, px, this.rng.range(2, 22), wind * this.rng.range(10, 22), this.rng.range(-1, 3), this.rng.range(2.5, 6));
      }
    }

    // ── integração ──
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.kind[i] === Kind.Livre) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kind[i] = Kind.Livre;
        continue;
      }
      alive++;
      const k = this.kind[i];
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;

      switch (k) {
        case Kind.Chuva:
          if (this.y[i] < w.seaLevel) {
            // Ao bater na água ou no chão, vira respingo curto.
            this.spawn(Kind.Respingo, this.x[i], w.seaLevel, this.rng.range(-3, 3), this.rng.range(3, 8), 0.4);
            this.kind[i] = Kind.Livre;
          }
          break;
        case Kind.Respingo:
          this.vy[i] -= 34 * dt;
          break;
        case Kind.Brasa:
          this.vy[i] += 3 * dt;
          this.vx[i] += Math.sin(this.y[i] * 0.6 + this.seedArr[i] * 9) * 5 * dt;
          break;
        case Kind.VagaLume:
          this.vx[i] += Math.sin(this.life[i] * 1.7 + this.seedArr[i] * 12) * 3 * dt;
          this.vy[i] += Math.cos(this.life[i] * 1.3 + this.seedArr[i] * 7) * 2 * dt;
          break;
        case Kind.Folha:
          this.vy[i] += Math.sin(this.life[i] * 4 + this.seedArr[i] * 6) * 9 * dt;
          this.vx[i] *= 1 - dt * 0.15;
          break;
        default:
          break;
      }

      if (this.x[i] < w.left - width * 0.3 || this.x[i] > w.right + width * 0.3 || this.y[i] < -6) {
        this.kind[i] = Kind.Livre;
      }
    }
    this.alive = alive;
  }

  /**
   * @param mundoPorPixel quantas unidades de mundo cabem num pixel. Gotas e
   * respingos são finos: sem um piso em pixels eles somem quando a câmera se
   * afasta, e a chuva vira um punhado de pontos invisíveis.
   */
  draw(p: Painter, l: Lighting, mundoPorPixel = 0.05): void {
    const rain: RGB = lit([0.72, 0.8, 0.9], l, 0.9, 0);
    const foam: RGB = [0.93, 0.96, 0.98];
    const leafCol: RGB = lit([0.5, 0.42, 0.2], l, 0.7, 0.3);
    const fioMin = Math.max(0.09, mundoPorPixel * 1.7);
    const pontoMin = Math.max(0.05, mundoPorPixel * 1.2);

    for (let i = 0; i < this.capacity; i++) {
      const k = this.kind[i];
      if (k === Kind.Livre) continue;
      const t = clamp01(this.life[i] / this.maxLife[i]);
      const x = this.x[i];
      const y = this.y[i];

      switch (k) {
        case Kind.Chuva:
          p.line(x, y, x - this.vx[i] * 0.022, y - this.vy[i] * 0.022, fioMin, rain, 0.5);
          break;
        case Kind.Respingo:
          p.circle(x, y, Math.max(0.16 * t + 0.05, pontoMin), foam, 0.55 * t, 5);
          break;
        case Kind.Brasa: {
          const heat: RGB = [1, lerp(0.35, 0.8, t), lerp(0.1, 0.35, t)];
          p.circle(x, y, 0.13 * t + 0.04, heat, 0.85 * t, 5);
          break;
        }
        case Kind.VagaLume: {
          const glow = 0.5 + 0.5 * Math.sin(this.life[i] * 4.2 + this.seedArr[i] * 30);
          p.circle(x, y, 0.24, [0.85, 1, 0.55], 0.5 * t * glow, 6);
          p.circle(x, y, 0.09, [1, 1, 0.85], 0.9 * t * glow, 5);
          break;
        }
        case Kind.Folha:
          p.ellipse(x, y, 0.28, 0.13, this.life[i] * 3 + this.seedArr[i] * 6, leafCol, 0.75 * clamp01(t * 2), 6);
          break;
        default:
          break;
      }
    }
  }

  clear(): void {
    this.kind.fill(Kind.Livre);
    this.resto.fill(0);
    this.alive = 0;
  }
}

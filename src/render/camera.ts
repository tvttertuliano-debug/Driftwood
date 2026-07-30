import { approach, clamp, lerp } from '../core/math.ts';
import { RENDER } from '../core/config.ts';
import { Rng } from '../core/rng.ts';

/**
 * Câmera contemplativa. Ela não segue o personagem como um jogo: ela repara
 * nas coisas. De vez em quando escolhe outro enquadramento e vai devagar até lá.
 */

export interface Shot {
  x: number;
  /** Meia-altura visível, em unidades de mundo. Menor = mais perto. */
  view: number;
  /** Deslocamento vertical do centro. */
  y: number;
  label: string;
}

export class Camera {
  x = 0;
  y = 18;
  view = 62;
  private targetX = 0;
  private targetY = 18;
  private targetView = 62;
  private dwell = 12;
  private rng: Rng;
  /** Respiração lenta: a câmera nunca fica perfeitamente parada. */
  private breath = 0;
  currentLabel = 'ilha';

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0xca11a);
  }

  /** Enquadra imediatamente (usado ao carregar um mundo salvo). */
  snap(shot: Shot): void {
    this.x = this.targetX = shot.x;
    this.y = this.targetY = shot.y;
    this.view = this.targetView = shot.view;
    this.currentLabel = shot.label;
  }

  cut(shot: Shot, dwellSeconds?: number): void {
    this.targetX = shot.x;
    this.targetY = shot.y;
    this.targetView = clamp(shot.view, 16, 200);
    this.currentLabel = shot.label;
    this.dwell = dwellSeconds ?? this.rng.range(RENDER.cameraDwell[0], RENDER.cameraDwell[1]);
  }

  /** @param pick fornece o próximo enquadramento quando o tempo de permanência acaba. */
  update(dt: number, pick: () => Shot): void {
    this.dwell -= dt;
    if (this.dwell <= 0) this.cut(pick());

    // Aproximação exponencial: nunca há corte seco, só deriva.
    this.x = approach(this.x, this.targetX, 0.55, dt);
    this.y = approach(this.y, this.targetY, 0.5, dt);
    this.view = approach(this.view, this.targetView, 0.42, dt);

    this.breath += dt;
  }

  get renderX(): number {
    return this.x + Math.sin(this.breath * 0.11) * this.view * 0.006;
  }

  get renderY(): number {
    return this.y + Math.sin(this.breath * 0.079 + 1.3) * this.view * 0.005;
  }

  /** Escala NDC. `aspect` = largura/altura. */
  scale(aspect: number): [number, number] {
    return [1 / (this.view * aspect), 1 / this.view];
  }

  /** Converte y de mundo para NDC — o backdrop precisa disso para o horizonte. */
  worldToNdcY(y: number): number {
    return (y - this.renderY) / this.view;
  }

  worldToNdcX(x: number, aspect: number): number {
    return (x - this.renderX) / (this.view * aspect);
  }
}

import { createProgram, type Program } from './gl.ts';
import { TAU, type RGB } from '../core/math.ts';

/**
 * Pincel 2D em lote. Tudo — ilha, árvores, náufrago, sereia — é triângulo com
 * cor por vértice. Nenhuma textura, nenhum asset: a arte é código.
 */

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
uniform vec2 uCenter;
uniform vec2 uScale;
out vec4 vColor;
void main() {
  vColor = aColor;
  vec2 ndc = (aPos - uCenter) * uScale;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() {
  // Pré-multiplicação manual: mistura limpa em cima do oceano.
  outColor = vec4(vColor.rgb * vColor.a, vColor.a);
}`;

const FLOATS_PER_VERT = 6;

export class Painter {
  private gl: WebGL2RenderingContext;
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data: Float32Array;
  private count = 0;
  private capacity: number;
  /** Estatística de frame, útil para o orçamento de performance. */
  triangles = 0;

  constructor(gl: WebGL2RenderingContext, capacityVerts = 120000) {
    this.gl = gl;
    this.capacity = capacityVerts;
    this.data = new Float32Array(capacityVerts * FLOATS_PER_VERT);
    this.prog = createProgram(gl, VERT, FRAG, 'pincel');
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 8);
    gl.bindVertexArray(null);
  }

  begin(centerX: number, centerY: number, scaleX: number, scaleY: number): void {
    const gl = this.gl;
    gl.useProgram(this.prog.handle);
    gl.uniform2f(this.prog.uniforms.uCenter!, centerX, centerY);
    gl.uniform2f(this.prog.uniforms.uScale!, scaleX, scaleY);
    this.count = 0;
    this.triangles = 0;
  }

  private vertex(x: number, y: number, c: RGB, a: number): void {
    if (this.count + 1 >= this.capacity) this.flush();
    const i = this.count * FLOATS_PER_VERT;
    const d = this.data;
    d[i] = x; d[i + 1] = y;
    d[i + 2] = c[0]; d[i + 3] = c[1]; d[i + 4] = c[2]; d[i + 5] = a;
    this.count++;
  }

  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: RGB, a = 1): void {
    if (a <= 0.002) return;
    this.vertex(x1, y1, c, a);
    this.vertex(x2, y2, c, a);
    this.vertex(x3, y3, c, a);
    this.triangles++;
  }

  /** Triângulo com cor por vértice — usado por gradientes de luz. */
  triShaded(
    x1: number, y1: number, c1: RGB, a1: number,
    x2: number, y2: number, c2: RGB, a2: number,
    x3: number, y3: number, c3: RGB, a3: number,
  ): void {
    this.vertex(x1, y1, c1, a1);
    this.vertex(x2, y2, c2, a2);
    this.vertex(x3, y3, c3, a3);
    this.triangles++;
  }

  quad(
    x0: number, y0: number, x1: number, y1: number,
    x2: number, y2: number, x3: number, y3: number,
    c: RGB, a = 1,
  ): void {
    this.tri(x0, y0, x1, y1, x2, y2, c, a);
    this.tri(x0, y0, x2, y2, x3, y3, c, a);
  }

  /** Polígono convexo (leque). Para côncavos, use `strip`. */
  poly(pts: ArrayLike<number>, c: RGB, a = 1): void {
    const n = pts.length / 2;
    if (n < 3) return;
    for (let i = 1; i < n - 1; i++) {
      this.tri(pts[0], pts[1], pts[i * 2], pts[i * 2 + 1], pts[(i + 1) * 2], pts[(i + 1) * 2 + 1], c, a);
    }
  }

  /** Faixa entre uma polilinha (topo) e uma linha de base — o perfil da ilha. */
  strip(pts: ArrayLike<number>, baseY: number, c: RGB, a = 1): void {
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[i * 2];
      const y0 = pts[i * 2 + 1];
      const x1 = pts[(i + 1) * 2];
      const y1 = pts[(i + 1) * 2 + 1];
      this.quad(x0, baseY, x0, y0, x1, y1, x1, baseY, c, a);
    }
  }

  /** Faixa com gradiente vertical: topo iluminado, base na sombra. */
  stripShaded(pts: ArrayLike<number>, baseY: number, top: RGB, bottom: RGB, a = 1): void {
    const n = pts.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[i * 2];
      const y0 = pts[i * 2 + 1];
      const x1 = pts[(i + 1) * 2];
      const y1 = pts[(i + 1) * 2 + 1];
      this.triShaded(x0, baseY, bottom, a, x0, y0, top, a, x1, y1, top, a);
      this.triShaded(x0, baseY, bottom, a, x1, y1, top, a, x1, baseY, bottom, a);
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB, a = 1, segments = 0): void {
    const seg = segments || Math.max(8, Math.min(48, Math.ceil(r * 2)));
    let px = cx + r;
    let py = cy;
    for (let i = 1; i <= seg; i++) {
      const t = (i / seg) * TAU;
      const nx = cx + Math.cos(t) * r;
      const ny = cy + Math.sin(t) * r;
      this.tri(cx, cy, px, py, nx, ny, c, a);
      px = nx;
      py = ny;
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, c: RGB, a = 1, segments = 20): void {
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    let px = 0;
    let py = 0;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * TAU;
      const ex = Math.cos(t) * rx;
      const ey = Math.sin(t) * ry;
      const nx = cx + ex * cr - ey * sr;
      const ny = cy + ex * sr + ey * cr;
      if (i > 0) this.tri(cx, cy, px, py, nx, ny, c, a);
      px = nx;
      py = ny;
    }
  }

  /** Linha grossa com pontas retas. */
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1e-5;
    const nx = (-dy / len) * w * 0.5;
    const ny = (dx / len) * w * 0.5;
    this.quad(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, c, a);
  }

  /** Traço afilado: grossura varia do começo ao fim (galhos, membros, fumaça). */
  taper(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: RGB, a = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1e-5;
    const ux = -dy / len;
    const uy = dx / len;
    this.quad(
      x0 + ux * w0 * 0.5, y0 + uy * w0 * 0.5,
      x1 + ux * w1 * 0.5, y1 + uy * w1 * 0.5,
      x1 - ux * w1 * 0.5, y1 - uy * w1 * 0.5,
      x0 - ux * w0 * 0.5, y0 - uy * w0 * 0.5,
      c, a,
    );
  }

  /** Cápsula: linha com pontas arredondadas — braços, pernas, troncos. */
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB, a = 1): void {
    this.line(x0, y0, x1, y1, r * 2, c, a);
    this.circle(x0, y0, r, c, a, 12);
    this.circle(x1, y1, r, c, a, 12);
  }

  /** Curva quadrática amostrada, com espessura variável. */
  curve(
    x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
    w0: number, w1: number, c: RGB, a = 1, steps = 10,
  ): void {
    let px = x0;
    let py = y0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const it = 1 - t;
      const nx = it * it * x0 + 2 * it * t * cx + t * t * x1;
      const ny = it * it * y0 + 2 * it * t * cy + t * t * y1;
      const wa = w0 + (w1 - w0) * ((i - 1) / steps);
      const wb = w0 + (w1 - w0) * t;
      this.taper(px, py, nx, ny, wa, wb, c, a);
      px = nx;
      py = ny;
    }
  }

  /** Sombra macia no chão: elipses concêntricas simulam penumbra sem blur. */
  softShadow(cx: number, cy: number, rx: number, ry: number, strength: number, steps: number, c: RGB): void {
    if (strength <= 0.01) return;
    for (let i = 0; i < steps; i++) {
      const k = 1 + i * 0.55;
      this.ellipse(cx, cy, rx * k, ry * k, 0, c, (strength / steps) * (1 - i * 0.18), 16);
    }
  }

  flush(): void {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS_PER_VERT);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.bindVertexArray(null);
    this.count = 0;
  }

  get pendingVerts(): number {
    return this.count;
  }
}

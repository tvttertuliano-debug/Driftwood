import {
  createFramebuffer, createProgram, createFullscreenQuad, resizeFramebuffer,
  FULLSCREEN_VERT, type Framebuffer, type Program,
} from './gl.ts';

/**
 * Pós-processamento cinematográfico.
 *
 * A cena inteira (céu, oceano, ilha, personagem, partículas) é pintada num
 * framebuffer fora da tela; este módulo a relê como textura e a transforma no
 * quadro final: bloom suave, tonemap filmic, color grading com temperatura
 * dinâmica, profundidade atmosférica, vinheta orgânica, grão de filme e — só em
 * tempestade — aberração cromática. É a camada que separa "pintura" de "WebGL".
 *
 * Nada aqui toca a simulação. Recebe apenas números de humor por quadro.
 */

export interface Grade {
  /** Exposição antes do tonemap. */
  exposure: number;
  /** Força do bloom (brilho que sangra). */
  bloom: number;
  /** Saturação final. <1 = mais pictórico, menos "neon de demo". */
  saturation: number;
  /** Temperatura: >0 dourado (tarde), <0 azul (noite). */
  temperature: number;
  /** Cor do color-grade (tingimento sutil de sombras/luzes). */
  tint: [number, number, number];
  /** Peso do tingimento. */
  tintK: number;
  /** Vinheta (escurecimento orgânico das bordas). */
  vignette: number;
  /** Grão de filme. */
  grain: number;
  /** Aberração cromática — só sobe em tempestade. */
  aberration: number;
  /** Relógio, para animar grão e ruído da vinheta. */
  time: number;
}

const BRIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 frag;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, uThreshold + 0.25, l);
  frag = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;      // deslocamento por texel na direção do borrão
out vec4 frag;
void main() {
  // Gaussiana de 9 taps, separável (H depois V).
  vec3 sum = texture(uTex, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += texture(uTex, vUv + o1).rgb * 0.3162162162;
  sum += texture(uTex, vUv - o1).rgb * 0.3162162162;
  sum += texture(uTex, vUv + o2).rgb * 0.0702702703;
  sum += texture(uTex, vUv - o2).rgb * 0.0702702703;
  frag = vec4(sum, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomK;
uniform float uSaturation;
uniform float uTemperature;
uniform vec3 uTint;
uniform float uTintK;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uTime;
out vec4 frag;

// Tonemap filmic (aproximação ACES de Narkowicz). Dá o rolloff de cinema:
// realces que dobram com graça em vez de estourar em branco chapado.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec2 toCenter = uv - 0.5;
  float r2 = dot(toCenter, toCenter);

  // Aberração cromática: os canais se separam radialmente. Quase zero no tempo
  // bom; só a tempestade a acorda, como uma lente estressada.
  vec3 scene;
  if (uAberration > 0.001) {
    vec2 off = toCenter * uAberration * (0.6 + r2);
    scene.r = texture(uScene, uv + off).r;
    scene.g = texture(uScene, uv).g;
    scene.b = texture(uScene, uv - off).b;
  } else {
    scene = texture(uScene, uv).rgb;
  }

  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 col = scene + bloom * uBloomK;

  col *= uExposure;

  // Temperatura de cor: dourado na tarde, azul na noite. Multiplicativo e sutil.
  vec3 warm = vec3(1.06, 1.0, 0.92);
  vec3 cool = vec3(0.92, 0.98, 1.10);
  col *= mix(vec3(1.0), uTemperature > 0.0 ? warm : cool, abs(uTemperature));

  col = aces(col);

  // Color grade: puxa a imagem inteira para uma cor de dominante (crepúsculo
  // âmbar, noite índigo), com mais peso nas sombras — truque de pintura digital.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, uTint, uTintK * (1.0 - luma) * 0.5);

  // Saturação.
  col = mix(vec3(luma), col, uSaturation);

  // Vinheta orgânica: raio levemente irregular, nunca um círculo perfeito.
  float ang = atan(toCenter.y, toCenter.x);
  float wobble = 0.03 * sin(ang * 3.0 + 1.7) + 0.02 * sin(ang * 5.0);
  float vig = smoothstep(0.9 + wobble, 0.35, r2 * 2.3);
  col *= mix(1.0, vig, uVignette);

  // Grão de filme: ruído animado, pesado nas sombras (como filme real).
  float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0) - 0.5;
  col += g * uGrain * (0.4 + (1.0 - luma) * 0.6);

  frag = vec4(col, 1.0);
}`;

export class Post {
  private gl: WebGL2RenderingContext;
  private quad: WebGLVertexArrayObject;
  private scene: Framebuffer;
  private bloomA: Framebuffer;
  private bloomB: Framebuffer;
  private bright: Program;
  private blur: Program;
  private composite: Program;
  private w = 2;
  private h = 2;
  /** Divisor de resolução do bloom — metade basta e é barato. */
  private readonly bloomScale = 2;
  enabled = true;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.quad = createFullscreenQuad(gl);
    this.scene = createFramebuffer(gl, 2, 2);
    this.bloomA = createFramebuffer(gl, 2, 2);
    this.bloomB = createFramebuffer(gl, 2, 2);
    this.bright = createProgram(gl, FULLSCREEN_VERT, BRIGHT_FRAG, 'bright');
    this.blur = createProgram(gl, FULLSCREEN_VERT, BLUR_FRAG, 'blur');
    this.composite = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG, 'composite');
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    resizeFramebuffer(this.gl, this.scene, w, h);
    const bw = Math.max(1, Math.floor(w / this.bloomScale));
    const bh = Math.max(1, Math.floor(h / this.bloomScale));
    resizeFramebuffer(this.gl, this.bloomA, bw, bh);
    resizeFramebuffer(this.gl, this.bloomB, bw, bh);
  }

  /** Redireciona o desenho da cena para o framebuffer fora da tela. */
  beginScene(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.BLEND);
  }

  private drawQuad(): void {
    this.gl.bindVertexArray(this.quad);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  /** Roda bloom + composição e entrega o quadro final à tela. */
  resolve(grade: Grade): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);

    const bw = this.bloomA.width;
    const bh = this.bloomA.height;

    if (this.enabled && grade.bloom > 0.001) {
      // 1. Bright-pass da cena para o alvo de bloom (meia resolução).
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.viewport(0, 0, bw, bh);
      gl.useProgram(this.bright.handle);
      gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
      gl.uniform1i(this.bright.uniforms.uScene, 0);
      gl.uniform1f(this.bright.uniforms.uThreshold, 0.7);
      this.drawQuad();

      // 2. Borrão separável: horizontal (A->B) e vertical (B->A).
      gl.useProgram(this.blur.handle);
      gl.uniform1i(this.blur.uniforms.uTex, 0);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
        gl.uniform2f(this.blur.uniforms.uDir, 1 / bw, 0);
        this.drawQuad();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
        gl.uniform2f(this.blur.uniforms.uDir, 0, 1 / bh);
        this.drawQuad();
      }
    } else {
      // Sem bloom: zera o alvo para o composite somar nada.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.viewport(0, 0, bw, bh);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // 3. Composição final na tela.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    const c = this.composite;
    gl.useProgram(c.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.uniform1i(c.uniforms.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    gl.uniform1i(c.uniforms.uBloom, 1);
    gl.uniform1f(c.uniforms.uExposure, grade.exposure);
    gl.uniform1f(c.uniforms.uBloomK, this.enabled ? grade.bloom : 0);
    gl.uniform1f(c.uniforms.uSaturation, grade.saturation);
    gl.uniform1f(c.uniforms.uTemperature, grade.temperature);
    gl.uniform3f(c.uniforms.uTint, grade.tint[0], grade.tint[1], grade.tint[2]);
    gl.uniform1f(c.uniforms.uTintK, grade.tintK);
    gl.uniform1f(c.uniforms.uVignette, grade.vignette);
    gl.uniform1f(c.uniforms.uGrain, grade.grain);
    gl.uniform1f(c.uniforms.uAberration, grade.aberration);
    gl.uniform1f(c.uniforms.uTime, grade.time);
    this.drawQuad();

    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}

/** Utilitários mínimos de WebGL2. Sem framework, sem alocação por frame. */

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
    desynchronized: true,
  });
  if (!gl) throw new Error('WebGL2 não disponível nesta máquina.');
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`falha ao compilar ${label}:\n${log}`);
  }
  return sh;
}

export interface Program {
  handle: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  attribs: Record<string, number>;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
  label = 'programa',
): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${label}.frag`);
  const handle = gl.createProgram()!;
  gl.attachShader(handle, vs);
  gl.attachShader(handle, fs);
  gl.linkProgram(handle);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle);
    gl.deleteProgram(handle);
    throw new Error(`falha ao linkar ${label}:\n${log}`);
  }

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const nU = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < nU; i++) {
    const info = gl.getActiveUniform(handle, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(handle, name);
  }

  const attribs: Record<string, number> = {};
  const nA = gl.getProgramParameter(handle, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < nA; i++) {
    const info = gl.getActiveAttrib(handle, i);
    if (!info) continue;
    attribs[info.name] = gl.getAttribLocation(handle, info.name);
  }

  return { handle, uniforms, attribs };
}

export interface Framebuffer {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Alvo de render fora da tela. É o que torna o pós-processamento possível: a
 * cena inteira é pintada aqui e depois relida como textura pelo passe final.
 * RGBA8 basta — o motor não produz cores acima de 1, então não há HDR real a
 * preservar, e RGBA8 roda em qualquer GPU sem extensão.
 */
export function createFramebuffer(gl: WebGL2RenderingContext, w: number, h: number): Framebuffer {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, width: w, height: h };
}

export function resizeFramebuffer(gl: WebGL2RenderingContext, fb: Framebuffer, w: number, h: number): void {
  if (fb.width === w && fb.height === h) return;
  gl.bindTexture(gl.TEXTURE_2D, fb.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  fb.width = w;
  fb.height = h;
}

/** Quad de tela cheia reaproveitado por todos os passes de fundo e pós. */
export function createFullscreenQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export const FULLSCREEN_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

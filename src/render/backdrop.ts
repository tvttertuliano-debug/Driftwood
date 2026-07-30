import { createProgram, createFullscreenQuad, FULLSCREEN_VERT, type Program } from './gl.ts';
import type { Lighting } from './palette.ts';
import type { SkyTime } from '../sim/calendar.ts';
import type { Weather } from '../sim/weather.ts';
import { phenomenonIntensity } from '../sim/weather.ts';

/**
 * Céu e oceano em um único passe de tela cheia.
 *
 * O oceano é falso-3D: cada pixel abaixo do horizonte vira uma distância, e as
 * ondas são somas de senos com deriva. Barato o suficiente para rodar semanas,
 * bonito o suficiente para prender o olho.
 */

const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2  uRes;
uniform float uAspect;
uniform float uTime;
uniform float uHorizon;      // y do nível do mar em NDC
uniform vec3  uZenith;
uniform vec3  uHorizonCol;
uniform vec2  uSunPos;
uniform vec3  uSunCol;
uniform float uSunUp;
uniform vec2  uMoonPos;
uniform float uMoonUp;
uniform float uMoonPhase;
uniform float uCloud;
uniform float uRain;
uniform float uFog;
uniform float uWind;
uniform float uFlash;
uniform float uExposure;
uniform float uSeed;
uniform float uWaveAmp;
uniform int   uOctaves;
uniform int   uPhenom;       // 0 nenhum, 1 arco-iris, 2 aurora, 3 eclipse, 4 meteoros
uniform float uPhenomK;
uniform float uZoom;         // unidades de mundo por meia-altura de tela

// ─────────────────── ruído ───────────────────
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed * 0.017);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, int oct) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += vnoise(p) * a;
    n += a;
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s / max(n, 0.0001);
}

// ─────────────────── céu ───────────────────
vec3 skyGradient(vec2 p) {
  float t = clamp((p.y - uHorizon) / (1.85 - uHorizon * 0.5), 0.0, 1.0);
  vec3 col = mix(uHorizonCol, uZenith, pow(t, 0.72));
  // Brilho difuso ao redor do sol, espalhado pela atmosfera.
  float dSun = distance(p, uSunPos);
  col += uSunCol * uSunUp * 0.42 * exp(-dSun * 1.9);
  return col;
}

vec3 stars(vec2 p, float night) {
  if (night < 0.02) return vec3(0.0);
  vec2 g = p * 90.0;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id);
  float bright = step(0.972, h);
  float size = 0.055 + h * 0.055;
  float d = length(f + vec2(hash21(id + 3.1) - 0.5, hash21(id + 7.7) - 0.5) * 0.7);
  float star = bright * smoothstep(size, 0.0, d);
  // Cintilação lenta e dessincronizada.
  star *= 0.55 + 0.45 * sin(uTime * (0.7 + h * 2.4) + h * 40.0);
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash21(id + 11.0));
  // Faixa mais densa: a "via láctea" da ilha.
  float band = exp(-pow((p.y - uHorizon - 0.85 + p.x * 0.25) * 1.5, 2.0)) * 0.5;
  return tint * star * night * (1.0 + band * 2.0);
}

vec3 meteors(vec2 p, float night) {
  if (uPhenom != 4 || night < 0.05) return vec3(0.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float seed = floor(uTime * 0.22 + fi * 13.0);
    float life = fract(uTime * 0.22 + fi * 13.0);
    vec2 start = vec2(hash21(vec2(seed, fi)) * 2.4 - 1.2, uHorizon + 0.55 + hash21(vec2(seed + 5.0, fi)) * 0.9);
    vec2 dir = normalize(vec2(-0.75, -0.55));
    vec2 pos = start + dir * life * 1.5;
    vec2 rel = p - pos;
    float along = dot(rel, dir);
    float across = length(rel - dir * along);
    float streak = smoothstep(0.02, 0.0, across) * smoothstep(0.0, -0.28, along);
    acc += vec3(1.0, 0.95, 0.85) * streak * sin(life * 3.1415) * uPhenomK;
  }
  return acc;
}

vec3 aurora(vec2 p, float night) {
  if (uPhenom != 2) return vec3(0.0);
  float h = p.y - uHorizon;
  if (h < 0.05) return vec3(0.0);
  float band = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float wave = fbm(vec2(p.x * 1.6 + uTime * 0.05 + fi * 4.0, uTime * 0.03 + fi), 3);
    float center = 0.55 + fi * 0.22 + wave * 0.35;
    band += exp(-pow((h - center) * 4.5, 2.0)) * (0.6 - fi * 0.15);
  }
  vec3 col = mix(vec3(0.2, 1.0, 0.6), vec3(0.35, 0.55, 1.0), fbm(p * 1.2 + uTime * 0.02, 2));
  float curtain = 0.6 + 0.4 * sin(p.x * 9.0 + uTime * 0.35);
  return col * band * curtain * night * uPhenomK * 0.9;
}

vec3 rainbow(vec2 p) {
  if (uPhenom != 1) return vec3(0.0);
  vec2 anti = vec2(-uSunPos.x, uHorizon - (uSunPos.y - uHorizon));
  float r = distance(p, anti);
  float arc = smoothstep(0.015, 0.0, abs(r - 0.78)) + smoothstep(0.02, 0.0, abs(r - 0.9)) * 0.35;
  float hue = clamp((r - 0.74) / 0.09, 0.0, 1.0);
  vec3 col = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
  float above = smoothstep(0.0, 0.06, p.y - uHorizon);
  return col * arc * above * uPhenomK * 0.55;
}

vec3 clouds(vec2 p, out float cover) {
  cover = 0.0;
  float h = p.y - uHorizon;
  if (h < -0.02) return vec3(0.0);

  // Plano de nuvens em perspectiva, mas com a distorção limitada: sem o teto
  // abaixo, tudo perto do horizonte vira listra esfumaçada em vez de nuvem.
  float persp = min(1.0 / max(h + 0.22, 0.08), 2.6);
  vec2 q = vec2(p.x * (0.55 + persp * 0.35) + uTime * (0.008 + uWind * 0.03), persp * 0.75);

  float base = fbm(q * 1.35 + vec2(uSeed * 0.01, 0.0), 4);
  float detail = fbm(q * 4.2 + vec2(3.1, uTime * 0.01), 3);
  float n = base * 0.78 + detail * 0.22;

  // Bordas fofas: transição larga, sem recorte duro.
  float lo = 0.66 - uCloud * 0.42;
  float dens = smoothstep(lo, lo + 0.26, n);
  dens *= smoothstep(-0.02, 0.16, h);
  cover = dens * (0.55 + uCloud * 0.45);

  // Volume: o lado voltado para o sol recebe luz, a base recebe o céu.
  float lift = fbm(q * 1.35 + vec2(0.0, -0.12), 3) - base;
  float toSun = clamp(0.62 + lift * 5.0 + (uSunPos.x - p.x) * 0.22, 0.0, 1.0);
  vec3 lightSide = mix(vec3(1.0), uSunCol, 0.45) * (0.95 + uSunUp * 0.5);
  // A base da nuvem recebe o céu, não escuridão: nuvem cinza-chumbo só aparece
  // quando está de fato chovendo.
  vec3 darkSide = mix(uHorizonCol * 1.02, vec3(0.38, 0.4, 0.46), uRain * 0.85);
  vec3 col = mix(darkSide, lightSide, toSun);
  return col * dens;
}

vec3 sunDisc(vec2 p) {
  float d = distance(p, uSunPos);
  float disc = smoothstep(0.045, 0.032, d);
  if (uPhenom == 3) {
    // Eclipse: a lua morde o disco e sobra a coroa.
    float m = distance(p, uSunPos + vec2(0.004, 0.0) * (1.0 - uPhenomK));
    disc *= 1.0 - smoothstep(0.036, 0.03, m) * uPhenomK;
    disc += smoothstep(0.058, 0.04, d) * uPhenomK * 0.25;
  }
  return uSunCol * disc * (0.6 + uSunUp) * 2.0;
}

vec3 moonDisc(vec2 p) {
  float d = distance(p, uMoonPos);
  float disc = smoothstep(0.03, 0.021, d);
  // Fase: subtrai um disco deslocado.
  float off = (uMoonPhase - 0.5) * 0.075;
  float shade = smoothstep(0.028, 0.02, distance(p, uMoonPos + vec2(off, 0.0)));
  float lit = clamp(disc - shade * step(0.001, abs(off)) * 1.15, 0.0, 1.0);
  vec3 col = vec3(0.95, 0.95, 0.88) * (lit + disc * 0.08);
  col += vec3(0.6, 0.7, 1.0) * smoothstep(0.12, 0.0, d) * 0.12;
  return col * uMoonUp;
}

// ─────────────────── oceano ───────────────────
float waveHeight(vec2 w, float amp) {
  float h = 0.0;
  float f = 1.0;
  float a = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uOctaves) break;
    float fi = float(i);
    h += sin(w.x * f * 1.7 + w.y * f * 0.6 + uTime * (0.55 + fi * 0.31) + fi * 2.1) * a;
    h += sin(w.x * f * 0.9 - w.y * f * 1.3 + uTime * (0.42 + fi * 0.19)) * a * 0.6;
    norm += a * 1.6;
    a *= 0.55;
    f *= 1.9;
  }
  return (h / max(norm, 0.001)) * amp;
}

vec3 ocean(vec2 p, vec3 skyCol) {
  float d = uHorizon - p.y;                 // distância vertical abaixo do horizonte
  float persp = 1.0 / max(d, 0.0016);       // perto = grande
  vec2 w = vec2(p.x * persp * 0.5, persp * 0.9);

  float amp = clamp(0.35 + uWaveAmp * 0.9, 0.2, 2.2);
  float h = waveHeight(w, amp);
  // Derivada aproximada para inclinação da onda.
  float h2 = waveHeight(w + vec2(0.06, 0.0), amp);
  float slope = (h2 - h) * 6.0;

  float far = smoothstep(0.0, 0.35, d);     // 0 no horizonte, 1 perto
  vec3 deep = vec3(0.035, 0.12, 0.24);
  vec3 shallow = vec3(0.09, 0.32, 0.42);
  vec3 base = mix(deep, shallow, far * 0.75 + 0.1);
  // A água apaga junto com o dia — mas seguindo a luz do CÉU, não só a altura do
  // sol. Amarrar só à altura do sol deixava o mar quase preto na hora dourada, com um
  // céu em brasa em cima: o oposto do que se vê num pôr do sol de verdade.
  float skyLum = dot(uHorizonCol, vec3(0.299, 0.587, 0.114));
  base *= (0.126 + uSunUp * 0.358 + skyLum * 0.614 + uMoonUp * 0.22) * uExposure;

  // Reflexo do céu: mais forte quando a onda está deitada (rasante) e mais forte
  // ainda com o sol baixo — é o que faz a água tomar a cor do poente.
  float fresnel = pow(1.0 - clamp(far, 0.0, 1.0), 2.0);
  // "Sol baixo mas ainda claro": skyLum serve de indicador de dia sem precisar de
  // um uniforme novo (à noite ele cai para ~0.12 e isto zera).
  float grazing = (1.0 - uSunUp) * smoothstep(0.15, 0.5, skyLum);
  // O peso do reflexo é contido de propósito: exagerar aqui iguala o valor do mar
  // ao do céu e apaga a linha do horizonte, que é a espinha da composição.
  vec3 col = mix(base, skyCol * 0.85, clamp(fresnel * 0.85 + 0.12 + grazing * 0.16, 0.0, 0.9));

  // Caminho de luz do sol/lua sobre a água.
  float glitterX = exp(-pow((p.x - uSunPos.x) * (1.2 + far * 2.2), 2.0));
  float sparkle = pow(clamp(slope * 0.5 + 0.5, 0.0, 1.0), 7.0);
  col += uSunCol * glitterX * sparkle * uSunUp * (0.55 + far * 0.9);

  float moonX = exp(-pow((p.x - uMoonPos.x) * (1.4 + far * 2.4), 2.0));
  col += vec3(0.7, 0.8, 1.0) * moonX * sparkle * uMoonUp * 0.5;

  // Cristas espumantes com vento forte.
  float crest = smoothstep(0.55, 0.95, h / max(amp, 0.001)) * smoothstep(0.02, 0.25, d);
  col = mix(col, vec3(0.9, 0.95, 0.97), crest * clamp(uWind - 0.35, 0.0, 1.0) * 0.85);

  // Névoa marinha no encontro com o horizonte.
  col = mix(uHorizonCol * 0.95, col, smoothstep(0.0, 0.09 + uFog * 0.2, d));
  return col;
}

// ─────────────────── composição ───────────────────
void main() {
  vec2 p = vec2((vUv.x * 2.0 - 1.0) * uAspect, vUv.y * 2.0 - 1.0);
  float night = clamp(1.0 - (uSunUp * 3.0), 0.0, 1.0);

  vec3 sky = skyGradient(p);
  sky += stars(p, night * (1.0 - uCloud * 0.85));
  sky += sunDisc(p);
  sky += moonDisc(p);
  sky += aurora(p, night);
  sky += meteors(p, night);
  sky += rainbow(p);

  float cover;
  vec3 cloudCol = clouds(p, cover);
  vec3 skyFinal = mix(sky, cloudCol, clamp(cover, 0.0, 1.0));

  vec3 col;
  if (p.y > uHorizon) {
    col = skyFinal;
  } else {
    // O oceano reflete o céu na altura espelhada.
    vec2 mirrored = vec2(p.x, uHorizon + (uHorizon - p.y) * 0.55);
    vec3 reflSky = skyGradient(mirrored);
    float rc;
    reflSky = mix(reflSky, clouds(mirrored, rc), clamp(rc * 0.7, 0.0, 1.0));
    col = ocean(p, reflSky);
  }

  // Chuva escurece e dessatura tudo.
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uRain * 0.22);
  col *= (1.0 - uRain * 0.16);

  // Clarão do raio.
  col += vec3(0.85, 0.9, 1.0) * uFlash * 0.45;

  // Névoa geral.
  col = mix(col, uHorizonCol, uFog * 0.35 * smoothstep(0.9, -0.4, abs(p.y - uHorizon)));

  col *= uExposure;
  // As cores do céu já são cores de pintura, não radiância: comprimir tudo
  // deixaria a imagem cinzenta. Só o excedente acima do joelho é amaciado,
  // preservando o azul chapado e deixando sol e raio estourarem com graça.
  vec3 knee = vec3(0.88);
  vec3 over = max(col - knee, vec3(0.0));
  col = min(col, knee) + over / (1.0 + over * 1.6);
  col = clamp(col, 0.0, 1.0);

  outColor = vec4(col, 1.0);
}`;

export interface BackdropParams {
  aspect: number;
  time: number;
  horizonNdc: number;
  sunPos: [number, number];
  moonPos: [number, number];
  waveAmp: number;
  octaves: number;
  zoom: number;
}

export class Backdrop {
  private gl: WebGL2RenderingContext;
  private prog: Program;
  private vao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = createProgram(gl, FULLSCREEN_VERT, FRAG, 'céu-e-mar');
    this.vao = createFullscreenQuad(gl);
  }

  draw(l: Lighting, sky: SkyTime, w: Weather, p: BackdropParams, seed: number): void {
    const gl = this.gl;
    const u = this.prog.uniforms;
    gl.useProgram(this.prog.handle);
    gl.uniform2f(u.uRes!, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(u.uAspect!, p.aspect);
    gl.uniform1f(u.uTime!, p.time);
    gl.uniform1f(u.uHorizon!, p.horizonNdc);
    gl.uniform3fv(u.uZenith!, l.zenith);
    gl.uniform3fv(u.uHorizonCol!, l.horizon);
    gl.uniform2f(u.uSunPos!, p.sunPos[0], p.sunPos[1]);
    gl.uniform3fv(u.uSunCol!, l.key);
    gl.uniform1f(u.uSunUp!, l.sunUp);
    gl.uniform2f(u.uMoonPos!, p.moonPos[0], p.moonPos[1]);
    gl.uniform1f(u.uMoonUp!, l.moonUp);
    gl.uniform1f(u.uMoonPhase!, sky.moonPhase);
    gl.uniform1f(u.uCloud!, w.cloud);
    gl.uniform1f(u.uRain!, w.rain);
    gl.uniform1f(u.uFog!, w.fog);
    gl.uniform1f(u.uWind!, w.wind);
    gl.uniform1f(u.uFlash!, w.lightning);
    gl.uniform1f(u.uExposure!, l.exposure);
    gl.uniform1f(u.uSeed!, seed % 1000);
    gl.uniform1f(u.uWaveAmp!, p.waveAmp);
    gl.uniform1i(u.uOctaves!, p.octaves);
    gl.uniform1f(u.uZoom!, p.zoom);

    const phen = { nenhum: 0, 'arco-íris': 1, aurora: 2, eclipse: 3, meteoros: 4 } as const;
    gl.uniform1i(u.uPhenom!, phen[w.phenomenon] ?? 0);
    gl.uniform1f(u.uPhenomK!, phenomenonIntensity(w));

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mix = lerp;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};
export const invLerp = (a: number, b: number, v: number): number => clamp01((v - a) / (b - a || 1e-9));

/** Aproximação exponencial independente de framerate. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function wrap(v: number, size: number): number {
  return ((v % size) + size) % size;
}

export interface Vec2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export type RGB = [number, number, number];

export function rgb(r: number, g: number, b: number): RGB {
  return [r, g, b];
}

/** Interpola cores em espaço linear aproximado (gamma 2) para não "lavar" o meio. */
export function mixColor(a: RGB, b: RGB, t: number): RGB {
  const tt = clamp01(t);
  return [
    Math.sqrt(lerp(a[0] * a[0], b[0] * b[0], tt)),
    Math.sqrt(lerp(a[1] * a[1], b[1] * b[1], tt)),
    Math.sqrt(lerp(a[2] * a[2], b[2] * b[2], tt)),
  ];
}

export function scaleColor(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function addColor(a: RGB, b: RGB): RGB {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function mulColor(a: RGB, b: RGB): RGB {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

/** Dessatura em direção à luminância — usado por névoa, chuva e distância. */
export function desaturate(c: RGB, amount: number): RGB {
  const l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  return mixColor(c, [l, l, l], amount);
}

export function hsl(h: number, s: number, l: number): RGB {
  const hh = wrap(h, 1) * 6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Curva de ease usada em animações de personagem. */
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeIn = (t: number): number => t * t;

/** Oscilador com fase estável — animação de folhas, respiração, ondas. */
export function osc(time: number, period: number, phase = 0): number {
  return Math.sin((time / period + phase) * TAU);
}

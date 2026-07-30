import { clamp01, lerp, mixColor, scaleColor, TAU, type RGB } from '../core/math.ts';
import { hash2 } from '../core/rng.ts';
import { lit, shadowColor, ROCK, ROCK_DARK, WOOD, type Lighting } from './palette.ts';
import type { Brush, BrushCtx } from './brushes.ts';

/** Bichos e prodígios. Silhuetas simples com um detalhe que dá vida. */

const r = (seed: number, i: number): number => hash2(seed, i * 613, 0xb1c0);
const rr = (seed: number, i: number, a: number, b: number): number => a + r(seed, i) * (b - a);

function shade(c: BrushCtx, base: RGB, up = 0.7, side = 0.3): RGB {
  return lit(base, c.l, up, side, c.depth);
}

function grounded(c: BrushCtx, rx: number, ry: number, strength = 0.6): void {
  c.p.softShadow(c.x - c.l.keyX * rx * 0.5, c.y, rx, ry, 0.28 * strength * c.opacity, 2, shadowColor(c.l));
}

// ────────────────────────────── bichos da ilha ──────────────────────────────

const crab: Brush = (c) => {
  const s = 1.1 * c.scale;
  grounded(c, s * 1.2, s * 0.3);
  // Tom de caranguejo de praia: tijolo acinzentado, não vermelho de desenho. E a
  // carapaça recebe luz por cima — dois olhos grandes e simétricos num corpo
  // chapado leem como um rostinho, o que estraga o tom da cena.
  // Escuro e dessaturado. Tom claro num corpo arredondado lê como pele, e com
  // dois pontos escuros vira uma carinha — o oposto do que a cena pede.
  const shell: RGB = [0.34, 0.22, 0.2];
  const body = shade(c, shell, 0.55, 0.35);
  const bodyLow = shade(c, scaleColor(shell, 0.6), 0.15, -0.5);
  const rim = shade(c, mixColor(shell, [0.72, 0.5, 0.4], 0.55), 1, 0.9);

  // Pernas primeiro, bem abertas: é a silhueta esparramada que diz "caranguejo".
  for (let i = -1; i <= 1; i += 2) {
    for (let k = 0; k < 3; k++) {
      const wobble = Math.sin(c.time * 6 + k + (i > 0 ? 0 : 1.5)) * 0.2;
      const kx = c.x + i * s * (0.95 + k * 0.42);
      const ky = c.y + s * (0.1 + wobble * 0.25);
      // Joelho para cima, pé no chão — perna quebrada, não um traço reto.
      c.p.curve(c.x + i * s * 0.5, c.y + s * 0.42,
        c.x + i * s * (0.8 + k * 0.3), c.y + s * 0.55,
        kx, ky, s * 0.1, s * 0.05, bodyLow, c.opacity, 3);
    }
    const claw = i > 0 ? 1.0 : 0.7;
    c.p.ellipse(c.x + i * s * 1.25, c.y + s * 0.5, s * 0.28 * claw, s * 0.17 * claw, i * 0.3, body, c.opacity, 9);
  }

  // Carapaça: larga e achatada, com um fio de luz na borda de cima.
  c.p.ellipse(c.x, c.y + s * 0.44, s * 1.02, s * 0.42, 0, bodyLow, c.opacity, 14);
  c.p.ellipse(c.x, c.y + s * 0.5, s * 0.88, s * 0.3, 0, body, c.opacity, 14);
  c.p.ellipse(c.x, c.y + s * 0.58, s * 0.6, s * 0.1, 0, rim, c.opacity * 0.55, 10);

  // Olhos: minúsculos e escuros, quase na borda do casco.
  for (let i = -1; i <= 1; i += 2) {
    c.p.circle(c.x + i * s * 0.3, c.y + s * 0.62, s * 0.035, [0.08, 0.07, 0.09], c.opacity * 0.9, 5);
  }
};

const seagull: Brush = (c) => {
  const s = 1.6 * c.scale;
  const flap = Math.sin(c.time * 3.4 + c.seed) * 0.6;
  const body = shade(c, [0.95, 0.95, 0.93], 0.9, 0.4);
  c.p.ellipse(c.x, c.y, s * 0.7, s * 0.3, 0, body, c.opacity, 10);
  for (let i = -1; i <= 1; i += 2) {
    c.p.curve(c.x, c.y, c.x + i * s * 1.1, c.y + flap * s * 0.9, c.x + i * s * 2.1, c.y + flap * s * 0.4, s * 0.28, s * 0.05, body, c.opacity, 6);
  }
  c.p.tri(c.x + c.facing * s * 0.6, c.y + s * 0.08, c.x + c.facing * s * 1.0, c.y, c.x + c.facing * s * 0.6, c.y - s * 0.08, shade(c, [0.95, 0.7, 0.2], 0.9, 0.5), c.opacity);
};

const parrot: Brush = (c) => {
  const s = 1.9 * c.scale;
  const bob = Math.sin(c.time * 2.1 + c.seed) * s * 0.08;
  const body = shade(c, [0.15, 0.62, 0.28], 0.85, 0.4);
  const wing = shade(c, [0.1, 0.45, 0.24], 0.5, -0.2);
  const red = shade(c, [0.85, 0.24, 0.2], 0.8, 0.4);
  c.p.ellipse(c.x, c.y + bob, s * 0.55, s * 0.75, 0.1 * c.facing, body, c.opacity, 14);
  c.p.ellipse(c.x - c.facing * s * 0.15, c.y + bob, s * 0.35, s * 0.55, 0.3 * c.facing, wing, c.opacity, 12);
  c.p.circle(c.x + c.facing * s * 0.3, c.y + bob + s * 0.75, s * 0.36, red, c.opacity, 12);
  c.p.tri(
    c.x + c.facing * s * 0.6, c.y + bob + s * 0.82,
    c.x + c.facing * s * 0.95, c.y + bob + s * 0.7,
    c.x + c.facing * s * 0.6, c.y + bob + s * 0.6,
    shade(c, [0.95, 0.85, 0.3], 0.9, 0.5), c.opacity,
  );
  c.p.circle(c.x + c.facing * s * 0.42, c.y + bob + s * 0.85, s * 0.08, [0.05, 0.04, 0.04], c.opacity, 6);
  // Cauda longa que balança contra o vento.
  const tailA = 0.4 + Math.sin(c.time * 1.3) * 0.1;
  c.p.taper(c.x, c.y + bob - s * 0.4, c.x - c.facing * s * 1.3, c.y + bob - s * 0.4 - tailA * s, s * 0.3, s * 0.08, body, c.opacity);
};

const turtle: Brush = (c) => {
  const s = 2.6 * c.scale;
  grounded(c, s * 1.3, s * 0.3);
  const shell = shade(c, [0.35, 0.42, 0.28], 0.85, 0.4);
  const skin = shade(c, [0.5, 0.52, 0.4], 0.6, 0.2);
  c.p.ellipse(c.x, c.y + s * 0.4, s * 1.1, s * 0.6, 0, shell, c.opacity, 18);
  for (let i = 0; i < 5; i++) {
    const px = c.x + lerp(-0.7, 0.7, i / 4) * s;
    c.p.ellipse(px, c.y + s * 0.55, s * 0.16, s * 0.14, 0, scaleColor(shell, 0.85), c.opacity, 8);
  }
  c.p.ellipse(c.x + c.facing * s * 1.15, c.y + s * 0.35, s * 0.3, s * 0.22, 0, skin, c.opacity, 10);
  for (let i = -1; i <= 1; i += 2) {
    const paddle = Math.sin(c.time * 1.5 + (i > 0 ? 0 : 1.6)) * 0.25;
    c.p.ellipse(c.x + i * s * 0.7, c.y + s * 0.12 + paddle * s * 0.1, s * 0.4, s * 0.16, i * 0.4, skin, c.opacity, 8);
  }
};

const fish: Brush = (c) => {
  const s = 1.2 * c.scale;
  const body = shade(c, [0.6, 0.72, 0.8], 0.9, 0.4);
  const spin = c.time * 4 + c.seed;
  c.p.ellipse(c.x, c.y, s, s * 0.42, spin * 0.4, body, c.opacity, 10);
  c.p.tri(c.x - Math.cos(spin * 0.4) * s, c.y - Math.sin(spin * 0.4) * s, c.x - s * 1.5, c.y + s * 0.4, c.x - s * 1.4, c.y - s * 0.4, body, c.opacity);
};

// ────────────────────────────── prodígios ──────────────────────────────

function hull(c: BrushCtx, w: number, h: number, col: RGB): void {
  c.p.quad(c.x - w, c.y + h * 0.5, c.x - w * 0.8, c.y + h * 1.4, c.x + w * 0.8, c.y + h * 1.4, c.x + w, c.y + h * 0.5, col, c.opacity);
  c.p.tri(c.x - w, c.y + h * 0.5, c.x + w, c.y + h * 0.5, c.x, c.y, col, c.opacity);
}

const ship: Brush = (c) => {
  const s = 7 * c.scale;
  const dark = shade(c, [0.22, 0.2, 0.24], 0.4, 0.2);
  const sail = shade(c, [0.92, 0.9, 0.85], 0.9, 0.5);
  hull(c, s, s * 0.5, dark);
  c.p.line(c.x, c.y + s * 0.7, c.x, c.y + s * 3.2, s * 0.12, dark, c.opacity);
  c.p.tri(c.x, c.y + s * 3.0, c.x, c.y + s * 1.0, c.x + c.facing * s * 1.5, c.y + s * 1.5, sail, c.opacity);
  c.p.tri(c.x, c.y + s * 2.2, c.x, c.y + s * 0.9, c.x - c.facing * s * 1.1, c.y + s * 1.3, scaleColor(sail, 0.9), c.opacity);
};

const pirateShip: Brush = (c) => {
  const s = 8 * c.scale;
  const dark = shade(c, [0.1, 0.09, 0.12], 0.3, 0.1);
  const sail = shade(c, [0.16, 0.14, 0.18], 0.5, 0.2);
  hull(c, s, s * 0.55, dark);
  c.p.line(c.x, c.y + s * 0.7, c.x, c.y + s * 3.6, s * 0.13, dark, c.opacity);
  c.p.tri(c.x, c.y + s * 3.4, c.x, c.y + s * 1.0, c.x + c.facing * s * 1.7, c.y + s * 1.6, sail, c.opacity);
  // Caveira insinuada: dois pontos claros. O resto é imaginação de quem olha.
  c.p.circle(c.x + c.facing * s * 0.7, c.y + s * 2.4, s * 0.09, [0.85, 0.85, 0.8], c.opacity, 6);
  c.p.circle(c.x + c.facing * s * 0.95, c.y + s * 2.4, s * 0.09, [0.85, 0.85, 0.8], c.opacity, 6);
};

const submarine: Brush = (c) => {
  const s = 4 * c.scale;
  const metal = shade(c, [0.2, 0.24, 0.26], 0.5, 0.3);
  c.p.ellipse(c.x, c.y, s * 1.6, s * 0.35, 0, metal, c.opacity, 14);
  c.p.line(c.x, c.y + s * 0.2, c.x, c.y + s * 1.3, s * 0.22, metal, c.opacity);
  c.p.line(c.x, c.y + s * 1.2, c.x + c.facing * s * 0.5, c.y + s * 1.2, s * 0.14, metal, c.opacity);
};

const whale: Brush = (c) => {
  const s = 9 * c.scale;
  const body = shade(c, [0.18, 0.25, 0.34], 0.6, 0.3);
  c.p.ellipse(c.x, c.y, s * 1.6, s * 0.42, -0.06 * c.facing, body, c.opacity, 18);
  c.p.tri(c.x - c.facing * s * 1.5, c.y, c.x - c.facing * s * 2.3, c.y + s * 0.7, c.x - c.facing * s * 2.1, c.y - s * 0.2, body, c.opacity);
  // Esguicho, quando ela resolve.
  const blow = (Math.sin(c.time * 0.6 + c.seed) + 1) * 0.5;
  if (blow > 0.7) {
    const k = (blow - 0.7) / 0.3;
    c.p.taper(c.x + c.facing * s * 0.6, c.y + s * 0.3, c.x + c.facing * s * 0.6, c.y + s * (0.4 + k * 2.2), s * 0.18, s * 0.5, [0.9, 0.95, 1], c.opacity * (1 - k) * 0.75);
  }
};

const ufo: Brush = (c) => {
  const s = 4 * c.scale;
  const hover = Math.sin(c.time * 0.9 + c.seed) * s * 0.25;
  const metal = shade(c, [0.6, 0.63, 0.68], 0.9, 0.4);
  const glass = shade(c, [0.5, 0.85, 0.75], 1, 0.6);
  c.p.ellipse(c.x, c.y + hover, s * 1.7, s * 0.4, 0, metal, c.opacity, 20);
  c.p.ellipse(c.x, c.y + hover + s * 0.3, s * 0.75, s * 0.5, 0, glass, c.opacity * 0.9, 14);
  // Luzes girando embaixo.
  for (let i = 0; i < 5; i++) {
    const a = c.time * 1.4 + (i / 5) * TAU;
    c.p.circle(c.x + Math.cos(a) * s * 1.3, c.y + hover - s * 0.12, s * 0.11, [1, 0.85, 0.4], c.opacity * (0.5 + 0.5 * Math.sin(a)), 6);
  }
  // Feixe.
  c.p.tri(c.x - s * 0.5, c.y + hover - s * 0.2, c.x + s * 0.5, c.y + hover - s * 0.2, c.x, c.y - s * 6, [0.7, 1, 0.85], c.opacity * 0.1);
};

const mermaid: Brush = (c) => {
  const s = 3 * c.scale;
  const skin = shade(c, [0.85, 0.72, 0.6], 0.8, 0.3);
  const tail = shade(c, [0.2, 0.55, 0.62], 0.7, 0.4);
  const hair = shade(c, [0.25, 0.18, 0.15], 0.6, 0.2);
  c.p.curve(c.x, c.y, c.x + c.facing * s * 0.8, c.y - s * 0.4, c.x + c.facing * s * 1.6, c.y + s * 0.3, s * 0.5, s * 0.15, tail, c.opacity, 8);
  c.p.tri(c.x + c.facing * s * 1.4, c.y + s * 0.3, c.x + c.facing * s * 2.2, c.y + s * 0.9, c.x + c.facing * s * 2.1, c.y - s * 0.3, tail, c.opacity);
  c.p.capsule(c.x, c.y, c.x - c.facing * s * 0.15, c.y + s * 1.1, s * 0.28, skin, c.opacity);
  c.p.circle(c.x - c.facing * s * 0.18, c.y + s * 1.35, s * 0.3, skin, c.opacity, 12);
  c.p.curve(c.x - c.facing * s * 0.3, c.y + s * 1.5, c.x - c.facing * s * 0.9, c.y + s * 1.0, c.x - c.facing * s * 0.7, c.y + s * 0.1, s * 0.35, s * 0.1, hair, c.opacity, 8);
};

const kraken: Brush = (c) => {
  const s = 7 * c.scale;
  const body = shade(c, [0.28, 0.14, 0.3], 0.5, 0.2);
  for (let i = 0; i < 5; i++) {
    const ph = c.time * 0.5 + i * 1.3;
    const bx = c.x + (i - 2) * s * 0.8;
    const hgt = s * (1.4 + Math.sin(ph) * 0.7 + i * 0.15);
    c.p.curve(bx, c.y, bx + Math.sin(ph) * s * 0.9, c.y + hgt * 0.7, bx + Math.sin(ph) * s * 1.6, c.y + hgt, s * 0.42, s * 0.06, body, c.opacity, 9);
  }
};

const volcano: Brush = (c) => {
  const s = 10 * c.scale;
  const rockCol = shade(c, ROCK_DARK, 0.5, 0.4);
  c.p.tri(c.x - s * 1.6, c.y, c.x, c.y + s * 1.4, c.x + s * 1.6, c.y, rockCol, c.opacity);
  const puff = (Math.sin(c.time * 0.25 + c.seed) + 1) * 0.5;
  for (let i = 0; i < 4; i++) {
    const t = (c.time * 0.12 + i * 0.25) % 1;
    c.p.circle(c.x + Math.sin(t * 4 + i) * s * 0.5, c.y + s * 1.4 + t * s * 2.6, s * (0.3 + t * 0.9), [0.55, 0.52, 0.5], c.opacity * (1 - t) * 0.5, 12);
  }
  c.p.circle(c.x, c.y + s * 1.4, s * 0.22, [1, 0.5, 0.15], c.opacity * (0.5 + puff * 0.5), 8);
};

const floatingIsland: Brush = (c) => {
  const s = 8 * c.scale;
  const drift = Math.sin(c.time * 0.12 + c.seed) * s * 0.15;
  const rockCol = shade(c, ROCK, 0.7, 0.4);
  const grass = shade(c, [0.3, 0.55, 0.28], 0.95, 0.4);
  c.p.tri(c.x - s, c.y + drift, c.x + s, c.y + drift, c.x + s * 0.1, c.y + drift - s * 1.6, rockCol, c.opacity);
  c.p.ellipse(c.x, c.y + drift, s, s * 0.3, 0, grass, c.opacity, 16);
  for (let i = -1; i <= 1; i++) {
    c.p.taper(c.x + i * s * 0.4, c.y + drift, c.x + i * s * 0.5, c.y + drift + s * 0.7, s * 0.09, s * 0.05, shade(c, WOOD, 0.5, 0.3), c.opacity);
    c.p.ellipse(c.x + i * s * 0.5, c.y + drift + s * 0.8, s * 0.32, s * 0.22, 0, grass, c.opacity, 10);
  }
};

const explorer: Brush = (c) => {
  const s = 3.4 * c.scale;
  grounded(c, s * 0.7, s * 0.2);
  const coat = shade(c, [0.85, 0.78, 0.55], 0.8, 0.4);
  const skin = shade(c, [0.8, 0.6, 0.45], 0.85, 0.4);
  c.p.capsule(c.x, c.y + s * 0.3, c.x, c.y + s * 1.5, s * 0.34, coat, c.opacity);
  c.p.circle(c.x, c.y + s * 1.8, s * 0.3, skin, c.opacity, 12);
  c.p.ellipse(c.x, c.y + s * 2.0, s * 0.6, s * 0.16, 0, shade(c, [0.6, 0.5, 0.32], 0.9, 0.3), c.opacity, 10);
};

const astronaut: Brush = (c) => {
  const s = 3.6 * c.scale;
  grounded(c, s * 0.8, s * 0.22);
  const suit = shade(c, [0.94, 0.94, 0.96], 0.9, 0.5);
  const visor = shade(c, [0.15, 0.28, 0.4], 0.9, 0.7);
  c.p.capsule(c.x, c.y + s * 0.35, c.x, c.y + s * 1.4, s * 0.42, suit, c.opacity);
  c.p.circle(c.x, c.y + s * 1.8, s * 0.42, suit, c.opacity, 14);
  c.p.ellipse(c.x + c.facing * s * 0.1, c.y + s * 1.82, s * 0.28, s * 0.24, 0, visor, c.opacity, 12);
  c.p.capsule(c.x - s * 0.4, c.y + s * 1.2, c.x - s * 0.7, c.y + s * 0.6, s * 0.14, suit, c.opacity);
  c.p.capsule(c.x + s * 0.4, c.y + s * 1.2, c.x + s * 0.7, c.y + s * 0.6, s * 0.14, suit, c.opacity);
};

const portal: Brush = (c) => {
  const s = 4 * c.scale;
  const pulse = 0.7 + Math.sin(c.time * 2.2) * 0.3;
  for (let i = 5; i >= 0; i--) {
    const k = i / 5;
    const col: RGB = mixColor([0.9, 0.95, 1], [0.4, 0.2, 0.9], k);
    c.p.ellipse(c.x, c.y, s * (0.2 + k * 0.9) * pulse, s * (0.6 + k * 1.8) * pulse, Math.sin(c.time * 0.5) * 0.2, col, c.opacity * (1 - k) * 0.55, 18);
  }
};

const robot: Brush = (c) => {
  const s = 3 * c.scale;
  grounded(c, s * 0.8, s * 0.2);
  const rust = shade(c, [0.5, 0.36, 0.24], 0.7, 0.4);
  const metal = shade(c, [0.45, 0.47, 0.5], 0.8, 0.5);
  c.p.quad(c.x - s * 0.45, c.y, c.x - s * 0.45, c.y + s * 1.1, c.x + s * 0.45, c.y + s * 1.1, c.x + s * 0.45, c.y, rust, c.opacity);
  c.p.quad(c.x - s * 0.32, c.y + s * 1.1, c.x - s * 0.3, c.y + s * 1.7, c.x + s * 0.3, c.y + s * 1.7, c.x + s * 0.32, c.y + s * 1.1, metal, c.opacity);
  const blink = Math.sin(c.time * 1.1) > 0.9 ? 1 : 0.25;
  c.p.circle(c.x, c.y + s * 1.45, s * 0.12, [1, 0.4, 0.2], c.opacity * blink, 8);
  c.p.line(c.x, c.y + s * 1.7, c.x, c.y + s * 2.0, s * 0.05, metal, c.opacity);
};

const dragon: Brush = (c) => {
  const s = 9 * c.scale;
  const breath = Math.sin(c.time * 0.35) * 0.5 + 0.5;
  const body = shade(c, [0.24, 0.32, 0.26], 0.5, 0.3);
  const belly = shade(c, [0.4, 0.42, 0.3], 0.8, 0.4);
  // Dorme enrolado: uma curva grande e três espinhos.
  c.p.ellipse(c.x, c.y + s * 0.45, s * 1.6, s * 0.55 * (1 + breath * 0.04), 0, body, c.opacity, 20);
  c.p.ellipse(c.x, c.y + s * 0.3, s * 1.2, s * 0.3, 0, belly, c.opacity * 0.7, 16);
  c.p.ellipse(c.x - c.facing * s * 1.5, c.y + s * 0.5, s * 0.5, s * 0.36, 0.2, body, c.opacity, 12);
  for (let i = 0; i < 4; i++) {
    const px = c.x + lerp(-1, 1, i / 3) * s;
    c.p.tri(px - s * 0.16, c.y + s * 0.9, px, c.y + s * (1.25 + i * 0.05), px + s * 0.16, c.y + s * 0.9, body, c.opacity);
  }
  // Uma narina soltando fumaça.
  c.p.circle(c.x - c.facing * s * 1.85, c.y + s * 0.62 + breath * s * 0.4, s * 0.13 * breath, [0.8, 0.8, 0.85], c.opacity * 0.3 * breath, 8);
};

const livingCastle: Brush = (c) => {
  const s = 4 * c.scale;
  const sandy = shade(c, [0.85, 0.76, 0.58], 0.85, 0.4);
  c.p.quad(c.x - s, c.y, c.x - s * 0.85, c.y + s * 1.1, c.x + s * 0.85, c.y + s * 1.1, c.x + s, c.y, sandy, c.opacity);
  for (let i = -1; i <= 1; i += 2) {
    c.p.quad(c.x + i * s * 0.8, c.y, c.x + i * s * 0.7, c.y + s * 1.9, c.x + i * s * 0.4, c.y + s * 1.9, c.x + i * s * 0.5, c.y, sandy, c.opacity);
  }
  // Janelas acesas — a piada inteira mora aqui.
  for (let i = 0; i < 5; i++) {
    const px = c.x + lerp(-0.75, 0.75, i / 4) * s;
    const on = Math.sin(c.time * 0.8 + i * 2.1) > -0.2 ? 1 : 0.2;
    c.p.quad(px - s * 0.08, c.y + s * 0.4, px - s * 0.08, c.y + s * 0.7, px + s * 0.08, c.y + s * 0.7, px + s * 0.08, c.y + s * 0.4, [1, 0.85, 0.45], c.opacity * on, );
  }
};

export const CREATURE_BRUSHES: Record<string, Brush> = {
  caranguejo: crab,
  gaivota: seagull,
  papagaio: parrot,
  tartaruga: turtle,
  peixe: fish,
  navio: ship,
  'navio-pirata': pirateShip,
  submarino: submarine,
  baleia: whale,
  ovni: ufo,
  sereia: mermaid,
  kraken,
  vulcão: volcano,
  'ilha-flutuante': floatingIsland,
  explorador: explorer,
  astronauta: astronaut,
  portal,
  robô: robot,
  dragão: dragon,
  'castelo-vivo': livingCastle,
};

import { Painter } from './painter.ts';
import { clamp01, lerp, mixColor, scaleColor, TAU, type RGB } from '../core/math.ts';
import { lit, shadowColor, CLOTH, SKIN, WOOD, type Lighting } from './palette.ts';

/**
 * O náufrago. Um boneco articulado desenhado do zero a cada quadro.
 * Não há sprite, não há timeline: a pose é função da ação, do tempo e da idade.
 * A silhueta muda quando ele envelhece — barba, postura, roupa remendada.
 */

export interface CharacterState {
  x: number;
  y: number;
  facing: 1 | -1;
  pose: string;
  /** 0..1, fase do ciclo (passada, martelada, respiração). */
  phase: number;
  /** Segundos de render, para movimentos que não dependem da simulação. */
  time: number;
  /** 0 = recém-chegado, 1 = velho do mar. */
  weathering: number;
  beard: number;
  outfit: number;
  mood: number;
  scale: number;
  opacity: number;
}

interface Rig {
  hipX: number; hipY: number;
  chestX: number; chestY: number;
  headX: number; headY: number;
  handLX: number; handLY: number;
  handRX: number; handRY: number;
  footLX: number; footLY: number;
  footRX: number; footRY: number;
  lean: number;
  headTilt: number;
  /** Item na mão direita, se a pose pedir. */
  prop: 'nenhum' | 'vara' | 'martelo' | 'pedra' | 'luneta' | 'tocha';
}

const H = 7; // altura de referência em unidades de mundo

function baseRig(s: CharacterState, u: number): Rig {
  const breathe = Math.sin(s.time * 1.3) * 0.035 * u;
  const stoop = s.weathering * 0.22 * u;
  const hipY = s.y + 2.7 * u;
  const chestY = hipY + 1.75 * u + breathe - stoop;
  return {
    hipX: s.x, hipY,
    chestX: s.x, chestY,
    headX: s.x + s.facing * 0.12 * u, headY: chestY + 1.05 * u,
    handLX: s.x - 0.65 * u, handLY: chestY - 0.4 * u,
    handRX: s.x + 0.65 * u, handRY: chestY - 0.4 * u,
    footLX: s.x - 0.35 * u, footLY: s.y,
    footRX: s.x + 0.35 * u, footRY: s.y,
    lean: 0,
    headTilt: 0,
    prop: 'nenhum',
  };
}

/** Cada pose deforma o esqueleto base. Nada é interpolado de um arquivo. */
function poseRig(s: CharacterState, u: number): Rig {
  const rig = baseRig(s, u);
  const f = s.facing;
  const t = s.time;

  switch (s.pose) {
    case 'andando': {
      const p = s.phase * TAU;
      const stride = 1.05 * u;
      rig.footLX = s.x + Math.sin(p) * stride;
      rig.footRX = s.x + Math.sin(p + Math.PI) * stride;
      rig.footLY = s.y + Math.max(0, Math.sin(p + Math.PI * 0.5)) * 0.5 * u;
      rig.footRY = s.y + Math.max(0, Math.sin(p + Math.PI * 1.5)) * 0.5 * u;
      const bob = Math.abs(Math.sin(p)) * 0.16 * u;
      rig.hipY += bob;
      rig.chestY += bob;
      rig.headY += bob;
      rig.handLX = s.x + Math.sin(p + Math.PI) * 0.75 * u;
      rig.handRX = s.x + Math.sin(p) * 0.75 * u;
      rig.lean = f * 0.06;
      break;
    }
    case 'agachado': {
      const drop = 1.5 * u;
      rig.hipY -= drop;
      rig.chestY -= drop * 0.95;
      rig.headY -= drop * 0.9;
      rig.handLX = s.x + f * 0.5 * u;
      rig.handRX = s.x + f * 0.85 * u;
      rig.handLY = rig.hipY - 0.6 * u + Math.sin(t * 2.4) * 0.08 * u;
      rig.handRY = rig.hipY - 0.7 * u + Math.sin(t * 2.4 + 1) * 0.08 * u;
      rig.footLX = s.x - 0.55 * u;
      rig.footRX = s.x + 0.55 * u;
      rig.lean = f * 0.22;
      rig.headTilt = f * 0.3;
      break;
    }
    case 'comendo': {
      const chew = Math.sin(t * 5.5) * 0.08 * u;
      rig.handRX = rig.headX + f * 0.35 * u;
      rig.handRY = rig.headY - 0.15 * u + chew;
      rig.headTilt = f * 0.12;
      break;
    }
    case 'pescando': {
      rig.prop = 'vara';
      rig.handRX = s.x + f * 0.85 * u;
      rig.handRY = rig.chestY + 0.15 * u;
      rig.handLX = s.x + f * 0.35 * u;
      rig.handLY = rig.chestY - 0.25 * u;
      rig.lean = f * 0.08;
      rig.headTilt = f * 0.1;
      break;
    }
    case 'martelando': {
      rig.prop = 'martelo';
      const swing = Math.pow(Math.abs(Math.sin(t * 2.6)), 0.6);
      rig.handRX = s.x + f * (0.5 + swing * 0.5) * u;
      rig.handRY = rig.chestY + (0.9 - swing * 1.6) * u;
      rig.handLX = s.x + f * 0.55 * u;
      rig.handLY = rig.chestY - 0.5 * u;
      rig.lean = f * 0.16;
      break;
    }
    case 'esculpindo': {
      rig.prop = 'pedra';
      const tap = Math.sin(t * 4.2) * 0.18 * u;
      rig.handRX = s.x + f * 0.8 * u;
      rig.handRY = rig.chestY - 0.1 * u + tap;
      rig.handLX = s.x + f * 0.5 * u;
      rig.handLY = rig.chestY - 0.45 * u;
      rig.lean = f * 0.2;
      rig.headTilt = f * 0.25;
      break;
    }
    case 'deitado':
    case 'deitado-olhando': {
      const lie = 2.4 * u;
      rig.hipY = s.y + 0.45 * u;
      rig.hipX = s.x - f * 0.4 * u;
      rig.chestY = s.y + 0.55 * u;
      rig.chestX = s.x + f * 0.9 * u;
      rig.headY = s.y + 0.75 * u;
      rig.headX = s.x + f * 1.85 * u;
      rig.footLX = s.x - f * 2.0 * u;
      rig.footRX = s.x - f * 2.1 * u;
      rig.footLY = s.y + 0.3 * u;
      rig.footRY = s.y + 0.45 * u;
      rig.handLX = s.x + f * 0.5 * u;
      rig.handLY = s.y + 0.25 * u;
      rig.handRX = s.x + f * 1.2 * u;
      rig.handRY = s.y + 0.9 * u + (s.pose === 'deitado-olhando' ? 0.4 * u : 0);
      rig.lean = f * 1.35;
      rig.headTilt = s.pose === 'deitado-olhando' ? -f * 0.5 : f * 0.1;
      break;
    }
    case 'encolhido': {
      const drop = 2.1 * u;
      rig.hipY -= drop;
      rig.chestY -= drop * 1.05;
      rig.headY -= drop * 1.15;
      rig.headX = s.x + f * 0.35 * u;
      rig.handLX = s.x + f * 0.3 * u;
      rig.handRX = s.x + f * 0.45 * u;
      rig.handLY = rig.chestY - 0.1 * u;
      rig.handRY = rig.chestY + 0.05 * u;
      rig.footLX = s.x - f * 0.2 * u;
      rig.footRX = s.x + f * 0.1 * u;
      rig.lean = f * 0.5;
      rig.headTilt = f * 0.55;
      break;
    }
    case 'nadando': {
      const stroke = t * 3.4;
      rig.hipY = s.y + 0.3 * u;
      rig.chestY = s.y + 0.55 * u;
      rig.chestX = s.x + f * 0.8 * u;
      rig.headX = s.x + f * 1.5 * u;
      rig.headY = s.y + 0.85 * u;
      rig.handRX = s.x + f * (1.6 + Math.sin(stroke) * 0.9) * u;
      rig.handRY = s.y + 0.7 * u + Math.max(0, Math.cos(stroke)) * 1.1 * u;
      rig.handLX = s.x + f * (1.2 + Math.sin(stroke + Math.PI) * 0.8) * u;
      rig.handLY = s.y + 0.5 * u;
      rig.footLX = s.x - f * (1.6 + Math.sin(stroke * 1.3) * 0.3) * u;
      rig.footRX = s.x - f * (1.7 + Math.sin(stroke * 1.3 + 1) * 0.3) * u;
      rig.footLY = s.y + 0.35 * u;
      rig.footRY = s.y + 0.2 * u;
      rig.lean = f * 1.45;
      break;
    }
    case 'olhando': {
      const shift = Math.sin(t * 0.4) * 0.1 * u;
      rig.handRX = rig.headX + f * 0.45 * u;
      rig.handRY = rig.headY + 0.15 * u; // mão pala na testa
      rig.headX += shift;
      rig.lean = f * 0.04;
      break;
    }
    case 'olhando-cima': {
      rig.headTilt = -f * 0.55;
      rig.headY += 0.12 * u;
      rig.handLY += 0.3 * u;
      rig.handRY += 0.3 * u;
      break;
    }
    case 'sentado': {
      const drop = 1.9 * u;
      rig.hipY -= drop;
      rig.chestY -= drop;
      rig.headY -= drop;
      rig.footLX = s.x + f * 1.5 * u;
      rig.footRX = s.x + f * 1.7 * u;
      rig.handLX = s.x + f * 0.6 * u;
      rig.handRX = s.x + f * 0.8 * u;
      rig.handLY = rig.hipY + 0.1 * u;
      rig.handRY = rig.hipY + 0.15 * u;
      rig.lean = f * 0.12;
      break;
    }
    case 'jogando': {
      const wind = Math.sin(t * 2.2);
      rig.prop = 'pedra';
      rig.handRX = s.x + f * (0.4 + wind * 1.1) * u;
      rig.handRY = rig.chestY + (0.2 + wind * 0.5) * u;
      rig.lean = f * (0.1 + wind * 0.12);
      break;
    }
    case 'dançando': {
      const p = t * 3.1;
      const hop = Math.abs(Math.sin(p)) * 0.5 * u;
      rig.hipY += hop; rig.chestY += hop; rig.headY += hop;
      rig.handLX = s.x - Math.cos(p) * 1.2 * u;
      rig.handLY = rig.chestY + Math.sin(p) * 0.9 * u;
      rig.handRX = s.x + Math.cos(p) * 1.2 * u;
      rig.handRY = rig.chestY + Math.sin(p + 1.5) * 0.9 * u;
      rig.footLX = s.x - 0.5 * u - Math.sin(p) * 0.3 * u;
      rig.footRX = s.x + 0.5 * u + Math.sin(p) * 0.3 * u;
      rig.lean = Math.sin(p * 0.5) * 0.18;
      rig.headTilt = Math.sin(p) * 0.2;
      break;
    }
    case 'acenando': {
      const wave = Math.sin(t * 6.5);
      rig.handRX = s.x + f * (0.8 + wave * 0.35) * u;
      rig.handRY = rig.headY + 0.75 * u;
      rig.handLX = s.x - f * 0.3 * u;
      rig.lean = f * 0.1;
      break;
    }
    case 'telescópio': {
      rig.prop = 'luneta';
      rig.handRX = rig.headX + f * 0.55 * u;
      rig.handRY = rig.headY + 0.35 * u;
      rig.handLX = rig.headX + f * 0.25 * u;
      rig.handLY = rig.headY + 0.15 * u;
      rig.headTilt = -f * 0.4;
      rig.lean = -f * 0.08;
      break;
    }
    case 'carregando': {
      const sway = Math.sin(t * 2) * 0.06 * u;
      rig.handLX = s.x - f * 0.2 * u;
      rig.handRX = s.x + f * 0.25 * u;
      rig.handLY = rig.chestY + 0.55 * u + sway;
      rig.handRY = rig.chestY + 0.5 * u + sway;
      rig.lean = -f * 0.14;
      break;
    }
    default: {
      // Parado: micro-movimento constante. Ninguém fica realmente imóvel.
      const idle = Math.sin(t * 0.9) * 0.05 * u;
      rig.handLY += idle;
      rig.handRY -= idle;
      rig.headTilt = Math.sin(t * 0.31) * 0.06;
      break;
    }
  }
  return rig;
}

const OUTFITS: RGB[] = [
  [0.82, 0.8, 0.74], // camisa que sobrou do naufrágio
  [0.72, 0.66, 0.5], // remendada
  [0.55, 0.5, 0.38], // feita de fibra
  [0.42, 0.44, 0.36], // o que quer que seja isso, é dele
];

export function drawCharacter(p: Painter, l: Lighting, s: CharacterState): void {
  const u = (H / 7) * s.scale;
  const rig = poseRig(s, u);
  const a = s.opacity;

  const skin = lit(SKIN, l, 0.8, s.facing * 0.5);
  const skinDark = lit(scaleColor(SKIN, 0.78), l, 0.3, -s.facing * 0.5);
  const cloth = lit(mixColor(OUTFITS[s.outfit % OUTFITS.length], CLOTH, 0.25), l, 0.75, s.facing * 0.4);
  const clothDark = lit(scaleColor(OUTFITS[s.outfit % OUTFITS.length], 0.7), l, 0.3, -s.facing * 0.4);
  const hair = lit([0.24, 0.17, 0.13], l, 0.7, s.facing * 0.3);

  // Sombra projetada — cola o personagem no chão.
  const shadowSpread = s.pose === 'deitado' || s.pose === 'nadando' ? 3.4 : 1.5;
  p.softShadow(
    s.x - l.keyX * u * 1.2, s.y,
    u * shadowSpread, u * 0.42,
    0.3 * a * (0.3 + l.sunUp * 0.9), 2, shadowColor(l),
  );

  // Pernas (atrás primeiro, para haver profundidade).
  const legR = u * 0.24;
  p.capsule(rig.hipX - u * 0.18, rig.hipY, rig.footLX, rig.footLY + legR, legR, clothDark, a);
  p.capsule(rig.hipX + u * 0.18, rig.hipY, rig.footRX, rig.footRY + legR, legR, cloth, a);
  // Pés descalços — ele perdeu os sapatos no primeiro dia.
  p.ellipse(rig.footLX + s.facing * u * 0.12, rig.footLY + legR * 0.6, u * 0.3, u * 0.16, 0, skinDark, a, 10);
  p.ellipse(rig.footRX + s.facing * u * 0.12, rig.footRY + legR * 0.6, u * 0.3, u * 0.16, 0, skin, a, 10);

  // Braço de trás.
  p.capsule(rig.chestX - s.facing * u * 0.1, rig.chestY + u * 0.25, rig.handLX, rig.handLY, u * 0.2, skinDark, a);

  // Torso: cápsula levemente inclinada, com a camisa marcando a cintura.
  const torsoDX = Math.sin(rig.lean) * u * 0.8;
  p.capsule(rig.hipX, rig.hipY, rig.chestX + torsoDX, rig.chestY, u * 0.42, cloth, a);
  p.ellipse(rig.hipX + torsoDX * 0.3, rig.hipY + u * 0.15, u * 0.44, u * 0.22, rig.lean, clothDark, a * 0.75, 12);

  // Cabeça.
  const hx = rig.headX + Math.sin(rig.lean) * u * 1.1;
  const hy = rig.headY;
  p.circle(hx, hy, u * 0.62, skin, a, 18);
  // Cabelo bagunçado: mais volume conforme o tempo passa.
  const hairVol = 0.62 + s.weathering * 0.22;
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI * (0.15 + (i / 5) * 0.7) + rig.headTilt;
    p.ellipse(
      hx + Math.cos(ang) * u * 0.42, hy + Math.sin(ang) * u * 0.42,
      u * 0.3 * hairVol, u * 0.22 * hairVol, ang, hair, a, 10,
    );
  }
  // Barba, que é o relógio do mundo.
  if (s.beard > 0.08) {
    const b = clamp01(s.beard);
    p.ellipse(
      hx + s.facing * u * 0.14, hy - u * (0.42 + b * 0.3),
      u * (0.34 + b * 0.16), u * (0.26 + b * 0.42), rig.headTilt * 0.5,
      lit(mixColor([0.3, 0.22, 0.16], [0.78, 0.76, 0.72], s.weathering * 0.8), l, 0.5, s.facing * 0.3), a, 12,
    );
  }
  // Olho: um ponto. Charme acima de anatomia.
  const blink = Math.sin(s.time * 0.7 + 2) > 0.985 ? 0.15 : 1;
  p.ellipse(hx + s.facing * u * 0.3, hy + u * 0.08 - rig.headTilt * u * 0.3, u * 0.075, u * 0.09 * blink, 0, [0.08, 0.07, 0.09], a, 8);
  // Sorriso discreto quando está bem.
  if (s.mood > 0.62) {
    p.curve(
      hx + s.facing * u * 0.12, hy - u * 0.18,
      hx + s.facing * u * 0.3, hy - u * 0.3,
      hx + s.facing * u * 0.45, hy - u * 0.16,
      u * 0.05, u * 0.05, skinDark, a * 0.8, 5,
    );
  }

  // Braço da frente + item.
  p.capsule(rig.chestX + s.facing * u * 0.12, rig.chestY + u * 0.25, rig.handRX, rig.handRY, u * 0.21, skin, a);
  drawProp(p, l, s, rig, u, a);
}

function drawProp(p: Painter, l: Lighting, s: CharacterState, rig: Rig, u: number, a: number): void {
  const wood = lit(WOOD, l, 0.6, s.facing * 0.4);
  switch (rig.prop) {
    case 'vara': {
      const tipX = rig.handRX + s.facing * u * 5.5;
      const tipY = rig.handRY + u * 3.2;
      p.taper(rig.handRX - s.facing * u * 0.6, rig.handRY - u * 0.35, tipX, tipY, u * 0.11, u * 0.04, wood, a);
      // Linha até a água, com uma leve barriga.
      const lineCol = lit([0.9, 0.9, 0.88], l, 0.9, 0);
      p.curve(tipX, tipY, tipX + s.facing * u * 1.2, tipY - u * 2.5, tipX + s.facing * u * 1.6, 0.2, u * 0.03, u * 0.03, lineCol, a * 0.7, 8);
      break;
    }
    case 'martelo': {
      p.taper(rig.handRX, rig.handRY, rig.handRX + s.facing * u * 0.9, rig.handRY + u * 0.5, u * 0.1, u * 0.09, wood, a);
      p.ellipse(rig.handRX + s.facing * u * 1.0, rig.handRY + u * 0.55, u * 0.24, u * 0.16, 0.4, lit([0.4, 0.4, 0.44], l, 0.8, 0.5), a, 8);
      break;
    }
    case 'pedra': {
      p.ellipse(rig.handRX + s.facing * u * 0.15, rig.handRY, u * 0.22, u * 0.18, 0.3, lit([0.45, 0.44, 0.42], l, 0.8, 0.4), a, 8);
      break;
    }
    case 'luneta': {
      p.taper(rig.handRX - s.facing * u * 0.3, rig.handRY, rig.handRX + s.facing * u * 1.3, rig.handRY + u * 0.75, u * 0.16, u * 0.22, lit([0.42, 0.44, 0.48], l, 0.85, 0.5), a);
      break;
    }
    case 'tocha': {
      p.taper(rig.handRX, rig.handRY, rig.handRX + s.facing * u * 0.3, rig.handRY + u * 1.1, u * 0.09, u * 0.07, wood, a);
      p.circle(rig.handRX + s.facing * u * 0.32, rig.handRY + u * 1.2, u * 0.22, [1, 0.7, 0.3], a * 0.9, 8);
      break;
    }
    default:
      break;
  }
}

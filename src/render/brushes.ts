import { Painter } from './painter.ts';
import { hash2 } from '../core/rng.ts';
import { clamp01, lerp, mixColor, scaleColor, TAU, type RGB } from '../core/math.ts';
import {
  foliageColor, lit, shadowColor, ROCK, ROCK_DARK, SAND, WOOD, WOOD_LIGHT, type Lighting,
} from './palette.ts';

/**
 * Pincéis procedurais. Cada objeto do mundo é desenhado por uma função pura:
 * mesma semente, mesmo desenho, para sempre — sem um único arquivo de imagem.
 */

export interface BrushCtx {
  p: Painter;
  l: Lighting;
  x: number;
  y: number;
  seed: number;
  scale: number;
  facing: 1 | -1;
  opacity: number;
  depth: number;
  /**
   * Força da sombra no chão, já normalizada: 1 é o típico, 0 é nenhuma (o que
   * voa). Vem de `CVisual.shadow`, que antes era preenchido e ignorado.
   */
  shadow: number;
  /** Segundos de render (contínuo, para balanço e chamas). */
  time: number;
  season: string;
  wind: number;
  /** Dados do componente: progress, condition, growth, flags... */
  extra: Record<string, number>;
}

export type Brush = (c: BrushCtx) => void;

/** Variação estável a partir da semente. */
const r = (seed: number, i: number): number => hash2(seed, i * 977, 0x5eed);
const rr = (seed: number, i: number, a: number, b: number): number => a + r(seed, i) * (b - a);

function sway(c: BrushCtx, stiffness: number, phase = 0): number {
  const gust = Math.sin(c.time * 0.7 + phase) * 0.4 + Math.sin(c.time * 1.9 + phase * 2.1) * 0.2;
  return gust * c.wind * stiffness;
}

function ground(c: BrushCtx, rx: number, ry: number, strength = 1): void {
  const sc = shadowColor(c.l);
  // A sombra se estica para o lado oposto à luz.
  const off = -c.l.keyX * rx * 0.55;
  c.p.softShadow(c.x + off, c.y - ry * 0.25, rx, ry, 0.32 * strength * c.shadow * c.opacity * (0.35 + c.l.sunUp), 2, sc);
}

// ────────────────────────────── vegetação ──────────────────────────────

/**
 * Uma fronde de coqueiro como uma PENA, não um espeto: uma nervura que arqueia e
 * derruba a ponta, com folíolos curvos alternados dos dois lados. Recebe uma
 * função de sombreamento pronta para não recalcular luz por folíolo.
 */
function palmFrond(
  c: BrushCtx, ox: number, oy: number, angle: number, len: number, droop: number,
  ribW: number, colMid: RGB, colTip: RGB, back: number, backCol: RGB, leaflets: number,
): void {
  // angle: 0 = reto para cima; positivo inclina para a direita.
  const dx = Math.sin(angle);
  const dy = Math.cos(angle);
  // Arco: sobe pela metade, depois a ponta tomba sob o próprio peso.
  const cx = ox + dx * len * 0.5;
  const cy = oy + len * 0.52;
  const tipX = ox + dx * len * 1.02;
  const tipY = oy + len * (0.2 - droop * 0.75) + dy * len * 0.1;

  const bez = (t: number): [number, number] => {
    const it = 1 - t;
    return [it * it * ox + 2 * it * t * cx + t * t * tipX, it * it * oy + 2 * it * t * cy + t * t * tipY];
  };

  // Passe de subsurface: uma cópia mais larga e quente por baixo, só quando o sol
  // está baixo. É a luz do fim de tarde atravessando a folha.
  if (back > 0.02) {
    c.p.curve(ox, oy, cx, cy, tipX, tipY, ribW * 2.1, ribW * 0.4, backCol, c.opacity * back * 0.6, 7);
  }

  // Lâmina: massa macia da folha, por trás dos folíolos, para não virar espinhos
  // soltos. Larga na base, afina para a ponta, translúcida.
  c.p.curve(ox, oy, cx, cy, tipX, tipY, ribW * 3.0, ribW * 0.3, scaleColor(colMid, 0.9), c.opacity * 0.7, 7);
  // Nervura.
  c.p.curve(ox, oy, cx, cy, tipX, tipY, ribW * 0.9, ribW * 0.12, scaleColor(colMid, 0.82), c.opacity, 7);

  // Folíolos: densos e VARRIDOS para a ponta (não perpendiculares), formando a
  // borda serrilhada de uma pena. Cada lado é a tangente girada ~45°.
  const rot = (vx: number, vy: number, ang: number): [number, number] =>
    [vx * Math.cos(ang) - vy * Math.sin(ang), vx * Math.sin(ang) + vy * Math.cos(ang)];
  const n = Math.max(5, leaflets * 2);
  for (let k = 1; k <= n; k++) {
    const t = k / (n + 1);
    const [px, py] = bez(t);
    const [nx, ny] = bez(Math.min(1, t + 0.05));
    let tanx = nx - px;
    let tany = ny - py;
    const tl = Math.hypot(tanx, tany) || 1e-5;
    tanx /= tl; tany /= tl;
    const spread = len * 0.24 * (1 - t * 0.45);
    const tipCol = mixColor(colMid, colTip, t * 0.8 + 0.1);
    const [ux, uy] = rot(tanx, tany, 0.8);   // folíolo de cima, varrido à frente
    const [lx, ly] = rot(tanx, tany, -0.8);  // folíolo de baixo
    c.p.taper(px, py, px + ux * spread, py + uy * spread, ribW * 0.55, 0.02, tipCol, c.opacity);
    c.p.taper(px, py, px + lx * spread * 0.92, py + ly * spread * 0.92, ribW * 0.5, 0.02, scaleColor(tipCol, 0.8), c.opacity);
  }
}

export const palm: Brush = (c) => {
  const growth = clamp01(c.extra.growth ?? 1);
  const health = clamp01(c.extra.health ?? 1);
  const h = (c.extra.maxHeight ?? 22) * lerp(0.12, 1, growth) * c.scale;
  const lean = rr(c.seed, 1, -0.28, 0.28);
  const bend = sway(c, 0.22, c.seed * 0.01);
  const tx = c.x + (lean + bend) * h * 0.55;
  const ty = c.y + h;

  ground(c, h * 0.34, h * 0.08, growth);

  // ── tronco: cilindro sombreado, curvo, com raiz alargada; sem faixas ──
  const woodBase = mixColor(WOOD, WOOD_LIGHT, r(c.seed, 2) * 0.5);
  const trunkMid = lit(woodBase, c.l, 0.35, 0.25, c.depth);
  const trunkLight = lit(scaleColor(woodBase, 1.22), c.l, 0.6, 0.9, c.depth);
  const trunkDark = lit(scaleColor(woodBase, 0.6), c.l, 0.15, -0.8, c.depth);
  const baseW = h * 0.09;
  const topW = h * 0.04;
  const side = c.l.keyX >= 0 ? 1 : -1;
  // Tronco em UMA curva contínua, não em segmentos empilhados: as emendas entre
  // segmentos deixavam faixas horizontais visíveis, o velho defeito de listras.
  const bow = Math.sin(1.0 + lean) * h * 0.05;
  const ctrlX = (c.x + tx) * 0.5 + bow;
  const ctrlY = (c.y + ty) * 0.5;
  c.p.curve(c.x, c.y, ctrlX, ctrlY, tx, ty, baseW, topW, trunkMid, c.opacity, 10);
  // Volume cilíndrico: sombra de um lado, realce do outro, ambos contínuos.
  c.p.curve(c.x - side * baseW * 0.3, c.y, ctrlX - side * baseW * 0.28, ctrlY, tx - side * topW * 0.3, ty,
    baseW * 0.4, topW * 0.4, trunkDark, c.opacity * 0.85, 10);
  c.p.curve(c.x + side * baseW * 0.34, c.y, ctrlX + side * baseW * 0.3, ctrlY, tx + side * topW * 0.32, ty,
    baseW * 0.24, topW * 0.24, trunkLight, c.opacity * 0.6, 10);
  // Raiz alargada: um cone curto na base, onde o tronco encontra a areia.
  c.p.taper(c.x, c.y, c.x + (ctrlX - c.x) * 0.16, c.y + h * 0.16, baseW * 1.85, baseW * 1.02, trunkMid, c.opacity);
  c.p.taper(c.x - side * baseW * 0.5, c.y, c.x - side * baseW * 0.4 + (ctrlX - c.x) * 0.14, c.y + h * 0.14,
    baseW * 0.7, baseW * 0.4, trunkDark, c.opacity * 0.7);

  if (growth < 0.18) {
    const leaf = lit(foliageColor(c.season, r(c.seed, 9)), c.l, 0.8, 0.3, c.depth);
    palmFrond(c, tx, ty, 0.9, h * 0.9, 0.3, h * 0.04, leaf, scaleColor(leaf, 1.15), 0, leaf, 3);
    palmFrond(c, tx, ty, -0.9, h * 0.9, 0.3, h * 0.04, leaf, scaleColor(leaf, 1.15), 0, leaf, 3);
    return;
  }

  // Detalhe por distância: coqueiro no fundo não precisa de folíolo a folíolo.
  const detail = clamp01(1 - Math.abs(c.depth) * 1.1) * clamp01(c.scale * 1.2);
  const leaflets = 4 + Math.round(detail * 5);
  const nFronds = 8 + Math.floor(r(c.seed, 3) * 5);
  // Luz atravessando a folha: só ao entardecer (dia com sol baixo), nunca à noite.
  const back = clamp01(c.l.day * (1 - c.l.sunUp) * 1.4);
  const backCol = mixColor([1.0, 0.82, 0.45], c.l.key, 0.4);

  // Ordena as frondes por profundidade aparente (as de trás primeiro), para a
  // copa ganhar volume em camadas em vez de um leque chapado.
  const order: number[] = [];
  for (let i = 0; i < nFronds; i++) order.push(i);
  order.sort((a, b) => Math.abs(a / (nFronds - 1) - 0.5) - Math.abs(b / (nFronds - 1) - 0.5));

  for (const i of order) {
    const f = i / (nFronds - 1);              // 0..1 pela copa
    const angle = lerp(-1.55, 1.55, f) + rr(c.seed, 10 + i, -0.12, 0.12);
    const behind = Math.abs(f - 0.5) < 0.18;  // as centrais tombam para trás/frente
    const droop = 0.5 + r(c.seed, 20 + i) * 0.4;
    const len = h * (0.5 + r(c.seed, 30 + i) * 0.32) * lerp(0.7, 1, health);
    const flutter = sway(c, 0.45, i * 1.7 + c.seed * 0.01);
    // Sombreamento: frondes viradas para a luz mais claras; as de trás, mais escuras.
    const toLight = Math.cos(angle) * c.l.keyX + 0.4;
    const base = foliageColor(c.season, r(c.seed, 40 + i));
    const shade = clamp01(0.55 + toLight * 0.4 - (behind ? 0.18 : 0));
    const colMid = lit(scaleColor(base, lerp(0.72, 1.0, shade)), c.l, shade, Math.cos(angle), c.depth);
    const colTip = lit(scaleColor(base, lerp(0.95, 1.25, shade)), c.l, shade + 0.15, Math.cos(angle), c.depth);
    palmFrond(c, tx + flutter * h * 0.02, ty, angle, len, droop, h * 0.045, colMid, colTip,
      behind ? 0 : back, backCol, leaflets);
  }

  // Coco em cacho, com um respingo de luz.
  const fruit = Math.floor(c.extra.fruit ?? 0);
  const cocoCol = lit([0.34, 0.25, 0.15], c.l, 0.6, 0.4, c.depth);
  const cocoLit = lit([0.5, 0.4, 0.26], c.l, 0.9, 0.9, c.depth);
  for (let i = 0; i < fruit; i++) {
    const cxx = tx + rr(c.seed, 60 + i, -0.5, 0.5) * h * 0.08;
    const cyy = ty - h * 0.02 + rr(c.seed, 70 + i, -0.4, 0.4) * h * 0.05;
    c.p.circle(cxx, cyy, h * 0.035, cocoCol, c.opacity, 10);
    c.p.circle(cxx - h * 0.012, cyy + h * 0.012, h * 0.014, cocoLit, c.opacity * 0.8, 8);
  }
};

/**
 * Um tufo de folhagem: massa arredondada com a borda superior quebrada por
 * folhas. É o recorte irregular que impede o arbusto de ler como um monte de
 * elipses — o olho reconhece "planta" pela silhueta, não pelo interior.
 */
function leafyClump(
  c: BrushCtx, cx: number, cy: number, rx: number, ry: number,
  col: RGB, rim: RGB, seedOff: number, fringe: number,
): void {
  c.p.ellipse(cx, cy, rx, ry, 0, col, c.opacity, 14);
  if (fringe < 0.2) return;
  // Folhas na metade de cima, apontando para fora.
  const n = Math.max(4, Math.round(fringe * 9));
  for (let i = 0; i < n; i++) {
    const a = lerp(-2.5, -0.65, i / (n - 1)) + rr(c.seed, seedOff + i, -0.22, 0.22);
    const px = cx + Math.cos(a) * rx * 0.86;
    const py = cy - Math.sin(a) * ry * 0.86;
    const len = ry * rr(c.seed, seedOff + 40 + i, 0.4, 0.95);
    // Folha levemente curvada, mais clara na ponta (pega mais céu).
    const tipx = px + Math.cos(a) * len * 0.7;
    const tipy = py - Math.sin(a) * len;
    c.p.curve(px, py, px + Math.cos(a) * len * 0.3, py - Math.sin(a) * len * 0.75,
      tipx, tipy, rx * 0.24, 0.02, rim, c.opacity, 3);
  }
}

export const bush: Brush = (c) => {
  const growth = clamp01(c.extra.growth ?? 1);
  const s = (c.extra.maxHeight ?? 8) * 0.4 * lerp(0.2, 1, growth) * c.scale;
  ground(c, s * 1.2, s * 0.24, growth);

  const detail = clamp01(1 - Math.abs(c.depth) * 1.1);
  const clumps = 4 + Math.floor(r(c.seed, 1) * 3);

  // Duas camadas: os tufos de trás primeiro e mais escuros, os da frente por
  // cima e mais claros. É o que dá profundidade a uma moita.
  type Clump = { x: number; y: number; rx: number; ry: number; back: boolean; i: number };
  const list: Clump[] = [];
  for (let i = 0; i < clumps; i++) {
    const back = i < Math.floor(clumps * 0.45);
    list.push({
      x: c.x + rr(c.seed, 10 + i, -1, 1) * s * (back ? 1.0 : 0.75),
      y: c.y + rr(c.seed, 20 + i, back ? 0.5 : 0.15, back ? 1.25 : 0.9) * s * 0.85,
      rx: s * rr(c.seed, 30 + i, 0.5, 0.9),
      ry: s * rr(c.seed, 35 + i, 0.42, 0.78),
      back, i,
    });
  }
  list.sort((a, b) => (a.back === b.back ? 0 : a.back ? -1 : 1));

  for (const cl of list) {
    const up = clamp01((cl.y - c.y) / (s * 1.2));
    const base = foliageColor(c.season, r(c.seed, 40 + cl.i));
    const shade = cl.back ? 0.62 : lerp(0.85, 1.14, up);
    const col = lit(scaleColor(base, shade), c.l, up, rr(c.seed, 50 + cl.i, -1, 1), c.depth);
    // Luz de borda: só um degrau acima da folha. Misturar muito com o céu
    // transformava a franja em espinhos esbranquiçados.
    const rim = lit(scaleColor(mixColor(base, c.l.zenith, 0.05), shade * 1.1), c.l, 1, 0.5, c.depth);
    const wob = sway(c, cl.back ? 0.08 : 0.16, cl.i);
    leafyClump(c, cl.x + wob * s * 0.3, cl.y, cl.rx, cl.ry, col, rim, 60 + cl.i * 9,
      cl.back ? detail * 0.5 : detail);
  }

  // Flores sazonais: só primavera e verão, e só em algumas moitas. Miúdas e em
  // cachos — dois pontos grandes e simétricos leem como olhos, o que é fatal
  // para o tom da cena.
  if ((c.season === 'primavera' || c.season === 'verão') && r(c.seed, 5) > 0.4 && growth > 0.5 && detail > 0.35) {
    const petal: RGB = r(c.seed, 6) > 0.5 ? [1.0, 0.94, 0.68] : [0.98, 0.8, 0.86];
    const flowerCol = lit(petal, c.l, 1, 0.5, c.depth);
    const clusters = 2 + Math.floor(r(c.seed, 7) * 2);
    for (let k = 0; k < clusters; k++) {
      const bx = c.x + rr(c.seed, 80 + k, -0.8, 0.8) * s;
      const by = c.y + rr(c.seed, 90 + k, 0.6, 1.2) * s * 0.85;
      for (let i = 0; i < 4; i++) {
        const fx = bx + rr(c.seed, 100 + k * 5 + i, -0.22, 0.22) * s;
        const fy = by + rr(c.seed, 130 + k * 5 + i, -0.18, 0.18) * s;
        c.p.circle(fx, fy, s * 0.032, flowerCol, c.opacity * 0.9, 6);
      }
    }
  }
};

// ────────────────────────────── construções ──────────────────────────────

/** Muitas obras compartilham a mesma ideia: tábuas ganhando forma aos poucos. */
function plankFrame(c: BrushCtx, w: number, h: number, planks: number, progress: number): void {
  const built = Math.max(1, Math.round(planks * progress));
  for (let i = 0; i < built; i++) {
    const t = i / planks;
    const y = c.y + h * t;
    const jitter = rr(c.seed, 60 + i, -0.06, 0.06) * w;
    const col = lit(mixColor(WOOD, WOOD_LIGHT, r(c.seed, 70 + i)), c.l, 0.5, rr(c.seed, 80 + i, -1, 1), c.depth);
    c.p.line(c.x - w * 0.5 + jitter, y, c.x + w * 0.5 + jitter, y + rr(c.seed, 90 + i, -0.04, 0.04) * h, h / planks * 0.75, col, c.opacity);
  }
}

export const hut: Brush = (c) => {
  const prog = clamp01(c.extra.progress ?? 1);
  const cond = clamp01(c.extra.condition ?? 1);
  const w = 13 * c.scale;
  const h = 9 * c.scale * lerp(0.35, 1, prog);
  ground(c, w * 0.6, w * 0.14);

  // Estacas.
  const post = lit(scaleColor(WOOD, 0.8), c.l, 0.3, -0.5, c.depth);
  c.p.taper(c.x - w * 0.45, c.y, c.x - w * 0.42, c.y + h, w * 0.06, w * 0.045, post, c.opacity);
  c.p.taper(c.x + w * 0.45, c.y, c.x + w * 0.42, c.y + h, w * 0.06, w * 0.045, post, c.opacity);

  if (prog > 0.35) {
    // Parede de tábuas.
    plankFrame({ ...c, y: c.y + h * 0.05 }, w * 0.86, h * 0.8, 6, clamp01((prog - 0.3) / 0.5));
  }
  if (prog > 0.7) {
    // Telhado de folhas.
    const leaf = lit(foliageColor(c.season === 'inverno' ? 'outono' : c.season, 0.6), c.l, 0.85, 0.4, c.depth);
    const peakY = c.y + h * lerp(1.0, 1.35, cond);
    c.p.tri(c.x - w * 0.62, c.y + h * 0.82, c.x, peakY, c.x + w * 0.62, c.y + h * 0.82, leaf, c.opacity);
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const lx = lerp(c.x - w * 0.6, c.x + w * 0.6, t);
      c.p.taper(lx, c.y + h * 0.8, lerp(c.x - w * 0.2, c.x + w * 0.2, t), peakY - h * 0.06, w * 0.04, w * 0.02, scaleColor(leaf, 0.85), c.opacity * 0.9);
    }
  }
  if (cond < 0.6) {
    // Tábua solta pendurada — o desgaste tem que ser visível.
    const loose = lit(scaleColor(WOOD, 0.6), c.l, 0.3, 0, c.depth);
    c.p.line(c.x + w * 0.3, c.y + h * 0.5, c.x + w * 0.52, c.y + h * 0.2, w * 0.05, loose, c.opacity);
  }
};

export const campfire: Brush = (c) => {
  const s = 3.2 * c.scale;
  const lightIt = (c.extra.acesa ?? 0) > 0.5;
  ground(c, s * 1.4, s * 0.4);
  const stone = lit(ROCK, c.l, 0.7, 0.2, c.depth);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    c.p.ellipse(c.x + Math.cos(a) * s, c.y + Math.sin(a) * s * 0.3, s * 0.35, s * 0.26, 0, i % 2 ? stone : lit(ROCK_DARK, c.l, 0.5, 0, c.depth), c.opacity, 10);
  }
  const wood = lit(scaleColor(WOOD, 0.75), c.l, 0.4, 0, c.depth);
  c.p.line(c.x - s * 0.6, c.y + s * 0.1, c.x + s * 0.5, c.y + s * 0.6, s * 0.18, wood, c.opacity);
  c.p.line(c.x + s * 0.6, c.y + s * 0.1, c.x - s * 0.5, c.y + s * 0.6, s * 0.18, wood, c.opacity);

  if (!lightIt) return;
  // Chama: três línguas em fases diferentes. Aditivo pela alta luminosidade.
  for (let i = 0; i < 3; i++) {
    const ph = c.time * (3.1 + i * 0.7) + i * 2.1;
    const flick = Math.sin(ph) * 0.3 + Math.sin(ph * 2.3) * 0.15;
    const hgt = s * (1.5 + i * 0.35) * (0.85 + flick * 0.3);
    const col: RGB = i === 0 ? [1, 0.55, 0.15] : i === 1 ? [1, 0.78, 0.3] : [1, 0.95, 0.7];
    const wob = flick * s * 0.35;
    c.p.tri(
      c.x - s * (0.45 - i * 0.1), c.y + s * 0.2,
      c.x + wob * 0.6, c.y + hgt,
      c.x + s * (0.45 - i * 0.1), c.y + s * 0.2,
      col, c.opacity * (0.85 - i * 0.12),
    );
  }
  // Brilho no chão.
  c.p.ellipse(c.x, c.y + s * 0.1, s * 3.4, s * 0.9, 0, [1, 0.6, 0.25], c.opacity * 0.14, 16);
};

export const raft: Brush = (c) => {
  const prog = clamp01(c.extra.progress ?? 1);
  const w = 11 * c.scale;
  const logs = 5;
  ground(c, w * 0.55, w * 0.1);
  const built = Math.max(1, Math.round(logs * prog));
  for (let i = 0; i < built; i++) {
    const t = i / (logs - 1);
    const y = c.y + t * w * 0.16;
    const col = lit(mixColor(WOOD, WOOD_LIGHT, r(c.seed, i)), c.l, 0.75, 0.3, c.depth);
    c.p.capsule(c.x - w * 0.5, y, c.x + w * 0.5, y + rr(c.seed, 10 + i, -0.03, 0.03) * w, w * 0.055, col, c.opacity);
  }
  if (prog > 0.8) {
    const rope = lit([0.72, 0.64, 0.44], c.l, 0.6, 0, c.depth);
    c.p.line(c.x - w * 0.28, c.y - w * 0.02, c.x - w * 0.28, c.y + w * 0.18, w * 0.03, rope, c.opacity);
    c.p.line(c.x + w * 0.28, c.y - w * 0.02, c.x + w * 0.28, c.y + w * 0.18, w * 0.03, rope, c.opacity);
  }
};

export const flotsam: Brush = (c) => {
  const s = 3 * c.scale * rr(c.seed, 0, 0.7, 1.4);
  ground(c, s, s * 0.25);
  const col = lit(scaleColor(WOOD, rr(c.seed, 1, 0.55, 0.9)), c.l, 0.6, 0.2, c.depth);
  const pieces = 2 + Math.floor(r(c.seed, 2) * 3);
  for (let i = 0; i < pieces; i++) {
    const a = rr(c.seed, 10 + i, -0.6, 0.6);
    const len = s * rr(c.seed, 20 + i, 0.8, 1.6);
    const px = c.x + rr(c.seed, 30 + i, -0.8, 0.8) * s;
    const py = c.y + rr(c.seed, 40 + i, 0, 0.35) * s;
    c.p.taper(px - Math.cos(a) * len * 0.5, py - Math.sin(a) * len * 0.5, px + Math.cos(a) * len * 0.5, py + Math.sin(a) * len * 0.5, s * 0.22, s * 0.16, col, c.opacity);
  }
};

export const sculpture: Brush = (c) => {
  const h = 6 * c.scale * rr(c.seed, 0, 0.8, 1.6);
  ground(c, h * 0.45, h * 0.14);
  const stone = lit(ROCK, c.l, 0.8, 0.5, c.depth);
  const dark = lit(ROCK_DARK, c.l, 0.3, -0.7, c.depth);
  const blocks = 3 + Math.floor(r(c.seed, 1) * 3);
  let y = c.y;
  for (let i = 0; i < blocks; i++) {
    const bw = h * rr(c.seed, 10 + i, 0.22, 0.42) * (1 - i * 0.12);
    const bh = h * rr(c.seed, 20 + i, 0.18, 0.34);
    const off = rr(c.seed, 30 + i, -0.12, 0.12) * h;
    c.p.quad(c.x - bw + off, y, c.x - bw * 0.8 + off, y + bh, c.x + bw * 0.8 + off, y + bh, c.x + bw + off, y, i % 2 ? stone : dark, c.opacity);
    y += bh;
  }
};

export const sandcastle: Brush = (c) => {
  const cond = clamp01(c.extra.condition ?? 1);
  const s = 3.4 * c.scale * cond;
  ground(c, s * 1.2, s * 0.3);
  const sand = lit(SAND, c.l, 0.85, 0.4, c.depth);
  const sandDark = lit(scaleColor(SAND, 0.75), c.l, 0.4, -0.5, c.depth);
  c.p.quad(c.x - s, c.y, c.x - s * 0.85, c.y + s * 0.9, c.x + s * 0.85, c.y + s * 0.9, c.x + s, c.y, sand, c.opacity);
  for (let i = -1; i <= 1; i += 2) {
    c.p.quad(c.x + i * s * 0.8, c.y, c.x + i * s * 0.72, c.y + s * 1.5, c.x + i * s * 0.42, c.y + s * 1.5, c.x + i * s * 0.5, c.y, i > 0 ? sand : sandDark, c.opacity);
    c.p.tri(c.x + i * s * 0.78, c.y + s * 1.5, c.x + i * s * 0.6, c.y + s * 1.9, c.x + i * s * 0.42, c.y + s * 1.5, sand, c.opacity);
  }
};

export const hammock: Brush = (c) => {
  const w = 12 * c.scale;
  const rope = lit([0.78, 0.7, 0.5], c.l, 0.7, 0.2, c.depth);
  const dip = w * 0.22 + Math.sin(c.time * 0.6) * w * 0.02;
  c.p.curve(c.x - w * 0.5, c.y + w * 0.5, c.x, c.y + w * 0.5 - dip, c.x + w * 0.5, c.y + w * 0.5, w * 0.05, w * 0.05, rope, c.opacity, 10);
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    const sagY = c.y + w * 0.5 - Math.sin(t * Math.PI) * dip;
    c.p.line(lerp(c.x - w * 0.5, c.x + w * 0.5, t), c.y + w * 0.5, lerp(c.x - w * 0.5, c.x + w * 0.5, t), sagY, w * 0.02, rope, c.opacity * 0.7);
  }
};

export const windmill: Brush = (c) => {
  const prog = clamp01(c.extra.progress ?? 1);
  const h = 16 * c.scale * lerp(0.3, 1, prog);
  ground(c, h * 0.3, h * 0.08);
  const wood = lit(WOOD, c.l, 0.5, 0.3, c.depth);
  c.p.taper(c.x, c.y, c.x, c.y + h, h * 0.16, h * 0.1, wood, c.opacity);
  if (prog < 0.75) return;
  const hubY = c.y + h;
  const spin = c.time * (0.4 + c.wind * 2.2);
  const bladeCol = lit(WOOD_LIGHT, c.l, 0.7, 0.4, c.depth);
  for (let i = 0; i < 4; i++) {
    const a = spin + (i / 4) * TAU;
    const len = h * 0.55;
    const ex = c.x + Math.cos(a) * len;
    const ey = hubY + Math.sin(a) * len;
    c.p.taper(c.x, hubY, ex, ey, h * 0.05, h * 0.02, bladeCol, c.opacity);
    c.p.taper(ex, ey, ex - Math.sin(a) * len * 0.22, ey + Math.cos(a) * len * 0.22, h * 0.03, h * 0.03, scaleColor(bladeCol, 0.9), c.opacity * 0.85);
  }
  c.p.circle(c.x, hubY, h * 0.05, lit(ROCK_DARK, c.l, 0.6, 0, c.depth), c.opacity, 10);
};

export const lighthouse: Brush = (c) => {
  const prog = clamp01(c.extra.progress ?? 1);
  const h = 26 * c.scale * lerp(0.25, 1, prog);
  const w = h * 0.2;
  ground(c, w * 1.4, w * 0.35);
  const stone = lit(ROCK, c.l, 0.7, 0.5, c.depth);
  const stripe = lit([0.8, 0.32, 0.28], c.l, 0.7, 0.5, c.depth);
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const w0 = lerp(w, w * 0.55, t0);
    const w1 = lerp(w, w * 0.55, t1);
    c.p.quad(c.x - w0, c.y + h * t0, c.x - w1, c.y + h * t1, c.x + w1, c.y + h * t1, c.x + w0, c.y + h * t0, i % 2 ? stone : stripe, c.opacity);
  }
  if (prog < 0.9) return;
  const topY = c.y + h;
  c.p.quad(c.x - w * 0.75, topY, c.x - w * 0.75, topY + w * 0.8, c.x + w * 0.75, topY + w * 0.8, c.x + w * 0.75, topY, lit(ROCK_DARK, c.l, 0.6, 0, c.depth), c.opacity);
  if ((c.extra.aceso ?? 0) > 0.5) {
    const beam = (Math.sin(c.time * 0.5) + 1) * 0.5;
    c.p.circle(c.x, topY + w * 0.4, w * 0.5, [1, 0.95, 0.7], c.opacity * (0.6 + beam * 0.4), 12);
    // Feixe girando: dois triângulos longos e translúcidos.
    const a = c.time * 0.5;
    const len = h * 3.2;
    for (let s = -1; s <= 1; s += 2) {
      const dir = a + (s > 0 ? 0 : Math.PI);
      const dx = Math.cos(dir) * len;
      const dy = Math.sin(dir) * len * 0.18;
      c.p.tri(c.x, topY + w * 0.4, c.x + dx, topY + w * 0.4 + dy + len * 0.05, c.x + dx, topY + w * 0.4 + dy - len * 0.05, [1, 0.93, 0.65], c.opacity * 0.12 * Math.abs(Math.cos(dir)));
    }
  }
};

export const telescope: Brush = (c) => {
  const s = 5 * c.scale * clamp01(c.extra.progress ?? 1);
  ground(c, s, s * 0.3);
  const metal = lit([0.45, 0.47, 0.52], c.l, 0.7, 0.5, c.depth);
  const wood = lit(WOOD, c.l, 0.4, 0.2, c.depth);
  c.p.taper(c.x, c.y, c.x, c.y + s * 0.9, s * 0.35, s * 0.15, wood, c.opacity);
  const a = -0.7 + Math.sin(c.time * 0.13) * 0.15;
  c.p.taper(c.x - Math.cos(a) * s * 0.5, c.y + s * 0.9 - Math.sin(a) * s * 0.5, c.x + Math.cos(a) * s * 1.1, c.y + s * 0.9 + Math.sin(a) * s * 1.1, s * 0.3, s * 0.42, metal, c.opacity);
};

export const observatory: Brush = (c) => {
  const s = 9 * c.scale;
  const stone = lit(ROCK, c.l, 0.75, 0.4, c.depth);
  const stones = 7;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * TAU;
    const px = c.x + Math.cos(a) * s;
    const py = c.y + Math.sin(a) * s * 0.28;
    const hgt = s * rr(c.seed, i, 0.25, 0.6);
    c.p.taper(px, py, px + rr(c.seed, 10 + i, -0.1, 0.1) * s, py + hgt, s * 0.16, s * 0.11, stone, c.opacity);
  }
};

export const bridge: Brush = (c) => {
  const w = 16 * c.scale;
  const wood = lit(WOOD, c.l, 0.7, 0.3, c.depth);
  const planks = 9;
  for (let i = 0; i < planks; i++) {
    const t = i / (planks - 1);
    const px = lerp(c.x - w * 0.5, c.x + w * 0.5, t);
    const py = c.y + Math.sin(t * Math.PI) * w * 0.08 + 0.4;
    c.p.line(px, py, px, py + w * 0.05, w * 0.07, wood, c.opacity);
  }
  c.p.curve(c.x - w * 0.5, c.y + 0.4, c.x, c.y + w * 0.12, c.x + w * 0.5, c.y + 0.4, w * 0.03, w * 0.03, scaleColor(wood, 0.8), c.opacity, 8);
};

export const oven: Brush = (c) => {
  const s = 5 * c.scale * clamp01(c.extra.progress ?? 1);
  ground(c, s * 1.2, s * 0.3);
  const clay = lit([0.55, 0.36, 0.26], c.l, 0.75, 0.4, c.depth);
  c.p.ellipse(c.x, c.y + s * 0.5, s, s * 0.8, 0, clay, c.opacity, 16);
  c.p.ellipse(c.x, c.y + s * 0.35, s * 0.35, s * 0.3, 0, [0.1, 0.06, 0.05], c.opacity, 10);
};

export const chair: Brush = (c) => {
  const s = 4 * c.scale;
  ground(c, s * 0.8, s * 0.2);
  const wood = lit(WOOD_LIGHT, c.l, 0.6, 0.3, c.depth);
  c.p.line(c.x - s * 0.5, c.y, c.x - s * 0.5, c.y + s * 0.5, s * 0.12, wood, c.opacity);
  c.p.line(c.x + s * 0.5, c.y, c.x + s * 0.5, c.y + s * 0.5, s * 0.12, wood, c.opacity);
  c.p.line(c.x - s * 0.6, c.y + s * 0.5, c.x + s * 0.6, c.y + s * 0.5, s * 0.14, wood, c.opacity);
  c.p.line(c.x - s * 0.55, c.y + s * 0.5, c.x - s * 0.65, c.y + s * 1.2, s * 0.12, wood, c.opacity);
};

export const garden: Brush = (c) => {
  const w = 10 * c.scale;
  const wood = lit(scaleColor(WOOD, 0.8), c.l, 0.5, 0.2, c.depth);
  for (let i = 0; i < 7; i++) {
    const px = lerp(c.x - w * 0.5, c.x + w * 0.5, i / 6);
    c.p.taper(px, c.y, px + rr(c.seed, i, -0.15, 0.15) * w * 0.1, c.y + w * 0.22, w * 0.025, w * 0.015, wood, c.opacity);
  }
  const leaf = lit(foliageColor(c.season, 0.7), c.l, 0.85, 0.3, c.depth);
  for (let i = 0; i < 5; i++) {
    const px = c.x + rr(c.seed, 20 + i, -0.4, 0.4) * w;
    c.p.ellipse(px, c.y + w * 0.09, w * 0.07, w * 0.05, 0, leaf, c.opacity, 8);
  }
};

export const drum: Brush = (c) => {
  const s = 3.2 * c.scale;
  ground(c, s, s * 0.25);
  const wood = lit(WOOD, c.l, 0.6, 0.3, c.depth);
  c.p.quad(c.x - s * 0.5, c.y, c.x - s * 0.45, c.y + s, c.x + s * 0.45, c.y + s, c.x + s * 0.5, c.y, wood, c.opacity);
  c.p.ellipse(c.x, c.y + s, s * 0.46, s * 0.16, 0, lit([0.8, 0.72, 0.6], c.l, 0.95, 0.2, c.depth), c.opacity, 12);
};

export const shellChime: Brush = (c) => {
  const s = 5 * c.scale;
  const rope = lit([0.75, 0.68, 0.5], c.l, 0.6, 0, c.depth);
  c.p.line(c.x - s * 0.6, c.y + s, c.x + s * 0.6, c.y + s, s * 0.04, rope, c.opacity);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const px = lerp(c.x - s * 0.5, c.x + s * 0.5, t);
    const hang = s * rr(c.seed, i, 0.3, 0.6);
    const swingA = Math.sin(c.time * 1.5 + i) * c.wind * 0.4;
    const ex = px + Math.sin(swingA) * hang;
    const ey = c.y + s - Math.cos(swingA) * hang;
    c.p.line(px, c.y + s, ex, ey, s * 0.02, rope, c.opacity * 0.8);
    c.p.ellipse(ex, ey, s * 0.1, s * 0.13, swingA, lit([0.93, 0.86, 0.78], c.l, 0.9, 0.3, c.depth), c.opacity, 10);
  }
};

export const stairs: Brush = (c) => {
  const s = 8 * c.scale;
  const wood = lit(WOOD, c.l, 0.6, 0.4, c.depth);
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    c.p.line(c.x - s * 0.3 + t * s * 0.6, c.y + t * s * 0.7, c.x + s * 0.1 + t * s * 0.6, c.y + t * s * 0.7, s * 0.1, wood, c.opacity);
  }
};

export const easel: Brush = (c) => {
  const s = 7 * c.scale;
  ground(c, s * 0.5, s * 0.14);
  const wood = lit(WOOD_LIGHT, c.l, 0.55, 0.3, c.depth);
  c.p.taper(c.x, c.y + s, c.x - s * 0.3, c.y, s * 0.06, s * 0.05, wood, c.opacity);
  c.p.taper(c.x, c.y + s, c.x + s * 0.3, c.y, s * 0.06, s * 0.05, wood, c.opacity);
  const canvas = lit([0.9, 0.88, 0.82], c.l, 0.9, 0.5, c.depth);
  c.p.quad(c.x - s * 0.3, c.y + s * 0.35, c.x - s * 0.3, c.y + s * 0.85, c.x + s * 0.3, c.y + s * 0.85, c.x + s * 0.3, c.y + s * 0.35, canvas, c.opacity);
  // Uma pincelada azul: sempre o mar.
  c.p.line(c.x - s * 0.24, c.y + s * 0.55, c.x + s * 0.24, c.y + s * 0.55, s * 0.08, lit([0.25, 0.5, 0.7], c.l, 0.8, 0, c.depth), c.opacity);
};

export const bottle: Brush = (c) => {
  const s = 1.8 * c.scale;
  ground(c, s * 0.8, s * 0.2);
  const glass = lit([0.4, 0.62, 0.45], c.l, 0.9, 0.6, c.depth);
  c.p.ellipse(c.x, c.y + s * 0.5, s * 0.35, s * 0.5, 0.3, glass, c.opacity * 0.85, 12);
  c.p.line(c.x + s * 0.2, c.y + s * 0.75, c.x + s * 0.55, c.y + s * 0.95, s * 0.18, glass, c.opacity * 0.85);
};

export const chest: Brush = (c) => {
  const s = 3.4 * c.scale;
  ground(c, s, s * 0.25);
  const wood = lit(scaleColor(WOOD, 0.85), c.l, 0.6, 0.4, c.depth);
  const metal = lit([0.55, 0.5, 0.3], c.l, 0.8, 0.6, c.depth);
  c.p.quad(c.x - s * 0.6, c.y, c.x - s * 0.6, c.y + s * 0.55, c.x + s * 0.6, c.y + s * 0.55, c.x + s * 0.6, c.y, wood, c.opacity);
  c.p.ellipse(c.x, c.y + s * 0.55, s * 0.6, s * 0.3, 0, wood, c.opacity, 14);
  c.p.line(c.x - s * 0.6, c.y + s * 0.5, c.x + s * 0.6, c.y + s * 0.5, s * 0.08, metal, c.opacity);
};

export const tool: Brush = (c) => {
  const s = 6 * c.scale * clamp01(c.extra.progress ?? 1);
  const wood = lit(WOOD_LIGHT, c.l, 0.6, 0.4, c.depth);
  c.p.taper(c.x, c.y, c.x + s * 0.35, c.y + s, s * 0.09, s * 0.04, wood, c.opacity);
  c.p.line(c.x + s * 0.3, c.y + s * 0.9, c.x + s * 0.55, c.y + s * 0.75, s * 0.03, lit([0.8, 0.78, 0.6], c.l, 0.9, 0.3, c.depth), c.opacity);
};

export const rock: Brush = (c) => {
  const s = 4 * c.scale * rr(c.seed, 0, 0.6, 2.2);
  ground(c, s * 1.15, s * 0.26);

  // Silhueta arredondada e assimétrica: uma cúpula amassada, não um semicírculo.
  // Vai da esquerda para a direita passando pelo topo, monótona em x — é o que
  // `stripShaded` precisa para gerar o gradiente sem triângulo degenerado.
  const n = 13;
  const squash = rr(c.seed, 1, 0.6, 0.92);
  const tiltX = rr(c.seed, 2, -0.25, 0.25);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = Math.PI * (1 - t);                       // π → 0 (esquerda → direita)
    // Ruído suave no raio, para a pedra ter caroços sem virar serra.
    const lumps = 1
      + Math.sin(t * 5.1 + r(c.seed, 3) * 6.3) * 0.07
      + Math.sin(t * 9.7 + r(c.seed, 4) * 6.3) * 0.035;
    const rad = s * lumps;
    pts.push(c.x + Math.cos(a) * rad + tiltX * s * Math.sin(a), c.y + Math.sin(a) * rad * squash);
  }

  // Gradiente vertical: recebe céu no topo, escurece na base (oclusão de contato).
  const topCol = lit(mixColor(ROCK, c.l.zenith, 0.14), c.l, 1, 0.55, c.depth);
  const botCol = lit(scaleColor(mixColor(ROCK, ROCK_DARK, 0.7), 0.78), c.l, 0.1, -0.5, c.depth);
  c.p.stripShaded(pts, c.y, topCol, botCol, c.opacity);

  // Aresta de luz no lado voltado para o sol — o que "arredonda" a pedra.
  const side = c.l.keyX >= 0 ? 1 : -1;
  const rimCol = lit(scaleColor(mixColor(ROCK, [1, 0.96, 0.88], 0.3), 1.16), c.l, 1, 1, c.depth);
  for (let i = 0; i < n - 1; i++) {
    const t = i / (n - 1);
    // Só o quadrante iluminado do topo.
    const w = clamp01(1 - Math.abs(t - (side > 0 ? 0.68 : 0.32)) * 3.4);
    if (w < 0.05) continue;
    c.p.taper(pts[i * 2], pts[i * 2 + 1], pts[(i + 1) * 2], pts[(i + 1) * 2 + 1],
      s * 0.11 * w, s * 0.11 * w, rimCol, c.opacity * 0.5 * w);
  }

  // Musgo: só na face de cima, e só em algumas pedras.
  if (r(c.seed, 5) > 0.45) {
    const moss = lit(scaleColor(foliageColor(c.season, r(c.seed, 6)), 0.95), c.l, 1, 0.3, c.depth);
    const patches = 2 + Math.floor(r(c.seed, 7) * 3);
    for (let i = 0; i < patches; i++) {
      const t = rr(c.seed, 20 + i, 0.2, 0.8);
      const idx = Math.min(n - 1, Math.floor(t * (n - 1)));
      const mx = pts[idx * 2];
      const my = pts[idx * 2 + 1];
      c.p.ellipse(mx, my - s * 0.05, s * rr(c.seed, 30 + i, 0.16, 0.3), s * 0.1, 0, moss, c.opacity * 0.85, 9);
    }
  }
};

/** Uma planta viva decide o próprio desenho pela espécie que o ecossistema sorteou. */
export const plant: Brush = (c) => ((c.extra.species ?? 0) > 0.5 ? bush(c) : palm(c));

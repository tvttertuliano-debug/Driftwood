import { Painter } from './painter.ts';
import { Backdrop } from './backdrop.ts';
import { Camera, type Shot } from './camera.ts';
import { Particles } from './particles.ts';
import { Post, type Grade } from './post.ts';
import type { BrushCtx } from './brushes.ts';
import { resolveAsset } from '../art/assets/registry.ts';
import { drawCharacter } from './character.ts';
import {
  computeLighting, foamColor, foliageColor, lit, shadowColor, waterColor,
  ROCK, ROCK_DARK, SAND, SAND_WET, type Lighting,
} from './palette.ts';
import { configureContext, createContext } from './gl.ts';
import { QUALITY, RENDER, WORLD, type QualityTier } from '../core/config.ts';
import { clamp, clamp01, lerp, mixColor, scaleColor, smoothstep, type RGB } from '../core/math.ts';
import { fbm1, Rng } from '../core/rng.ts';
import { swell } from '../sim/tides.ts';
import {
  CBrain, CCastaway, CCritter, CPlant, CProp, CRare, CTransform, CVisual,
} from '../sim/components.ts';
import { currentPose } from '../ai/brain.ts';
import type { World } from '../core/ecs.ts';
import type { WorldState } from '../sim/worldState.ts';

interface Drawable {
  depth: number;
  y: number;
  draw: () => void;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private painter: Painter;
  private backdrop: Backdrop;
  private particles: Particles;
  private post: Post;
  readonly camera: Camera;
  private canvas: HTMLCanvasElement;
  private drawables: Drawable[] = [];
  private renderClock = 0;
  quality: QualityTier = 'alta';
  /** Média móvel do intervalo entre quadros, em ms. Só serve para exibir os fps. */
  frameMs = 16;
  /** Média móvel do custo de CPU do próprio `render`, em ms. Decide a qualidade. */
  renderMs = 6;
  private ridgeSeed: number;
  /** Segundos desde a última troca de perfil, para não ficar oscilando. */
  private sinceTierChange = 0;
  /** Quadros consecutivos fora da faixa — evita reagir a um engasgo isolado. */
  private overBudget = 0;
  private underBudget = 0;
  /**
   * Estimativa do intervalo de atualização da tela, em ms: o menor intervalo
   * já visto. É a régua contra a qual se mede "estamos perdendo quadros?".
   */
  private refreshMs = 16.7;

  constructor(canvas: HTMLCanvasElement, seed: number) {
    this.canvas = canvas;
    this.gl = createContext(canvas);
    this.painter = new Painter(this.gl);
    this.backdrop = new Backdrop(this.gl);
    this.particles = new Particles(QUALITY.alta.particles);
    this.post = new Post(this.gl);
    this.camera = new Camera(seed);
    this.ridgeSeed = seed ^ 0x7ea1;
  }

  /**
   * Recria tudo que mora na GPU depois de uma perda de contexto. O objeto `gl`
   * continua o mesmo, mas programas, buffers, texturas e o estado global foram
   * descartados pelo driver (atualização de driver, suspensão, troca de GPU).
   * Sem isto, um protetor de tela aberto por semanas ficava preto para sempre.
   */
  restoreGpu(dpr: number): void {
    configureContext(this.gl);
    this.painter = new Painter(this.gl);
    this.backdrop = new Backdrop(this.gl);
    this.post = new Post(this.gl);
    this.resize(dpr);
  }

  resize(dpr: number): void {
    const rect = this.canvas.getBoundingClientRect();
    let w = Math.max(320, Math.round(rect.width * dpr));
    let h = Math.max(240, Math.round(rect.height * dpr));
    // Teto de pixels: em 4K/ultrawide, renderiza um pouco abaixo e deixa o
    // navegador escalar. Fica bonito e não frita a GPU por semanas seguidas.
    const px = w * h;
    if (px > RENDER.maxPixels) {
      const k = Math.sqrt(RENDER.maxPixels / px);
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.post.resize(w, h);
  }

  get aspect(): number {
    return this.canvas.width / Math.max(1, this.canvas.height);
  }

  /** Escolhe o próximo enquadramento. Prioriza o extraordinário, depois o vivo. */
  private pickShot(world: World, ws: WorldState): Shot {
    const rng = ws.rngAmbient;
    const rare = world.first(CRare, CTransform);
    if (rare !== null) {
      const tr = world.need(rare, CTransform);
      return { x: tr.x, y: Math.max(10, tr.y + 8), view: 52, label: 'algo aconteceu' };
    }

    const self = world.first(CCastaway, CTransform);
    const px = self !== null ? world.need(self, CTransform).x : 0;
    const py = self !== null ? world.need(self, CTransform).y : 6;

    const options: Shot[] = [
      { x: px, y: py + 6, view: 22, label: 'perto' },
      { x: px, y: py + 10, view: 38, label: 'ele' },
      { x: px * 0.5, y: 20, view: 74, label: 'a ilha' },
      { x: 0, y: 26, view: 110, label: 'tudo' },
    ];

    // Ao pôr do sol, olhe para o horizonte. Sempre.
    if (ws.sky.goldenHour > 0.45) {
      options.push({ x: ws.sky.sunAzimuth * 70, y: 16, view: 66, label: 'o sol indo embora' });
    }
    if (ws.weather.phenomenon !== 'nenhum') {
      options.push({ x: px * 0.3, y: 42, view: 96, label: String(ws.weather.phenomenon) });
    }
    // Uma obra recém-terminada merece um plano.
    for (const e of world.query(CProp, CTransform)) {
      const p = world.need(e, CProp);
      if (p.progress < 1 || ws.sky.day - p.builtOnDay > 1) continue;
      const tr = world.need(e, CTransform);
      options.push({ x: tr.x, y: tr.y + 8, view: 30, label: p.kind });
    }

    return options[Math.floor(rng.next() * options.length)];
  }

  /** Cordilheira distante: paralaxe barata que dá tamanho ao mundo. */
  /**
   * Banco de névoa baixo no horizonte. Antes havia aqui uma cordilheira
   * distante — foi removida de propósito: terra à vista estraga o assunto do
   * programa, que é estar sozinho. O que ficou é só ar espesso sobre a água.
   */
  private drawHaze(l: Lighting, left: number, right: number, waterY: number, fog: number): void {
    const p = this.painter;
    const step = (right - left) / 40;
    const col = mixColor(l.horizon, l.fog, 0.5);
    for (let x = left; x < right; x += step) {
      const h = 0.9 + fbm1(x * 0.01 + this.renderClock * 0.02, 2, this.ridgeSeed) * 3.2;
      const a = (0.04 + fog * 0.5) * (0.5 + fbm1(x * 0.02 + 8, 2, this.ridgeSeed) * 0.5);
      p.triShaded(
        x, waterY - 0.4, col, a,
        x + step, waterY - 0.4, col, a,
        x + step, waterY + h, col, 0,
      );
      p.triShaded(
        x, waterY - 0.4, col, a,
        x + step, waterY + h, col, 0,
        x, waterY + h, col, 0,
      );
    }
  }

  private drawIsland(ws: WorldState, l: Lighting, left: number, right: number): void {
    const p = this.painter;
    const island = ws.island;
    const waterY = WORLD.seaLevel + ws.tide;
    const x0 = Math.max(island.shoreLeft - 12, left - 10);
    const x1 = Math.min(island.shoreRight + 12, right + 10);
    if (x1 <= x0) return;

    // Passo adaptativo: perto exige detalhe, longe não.
    const step = clamp((x1 - x0) / 220, 0.35, 3);
    const grass = foliageColor(ws.sky.season, 0.45);

    for (let x = x0; x < x1; x += step) {
      const xa = x;
      const xb = Math.min(x + step, x1);
      const ha = island.groundAt(xa);
      const hb = island.groundAt(xb);
      if (ha < -16 && hb < -16) continue;
      const mid = (ha + hb) * 0.5;
      // Inclinação suavizada (não a derivada do segmento, que é ruidosa) — serve
      // tanto para a face iluminada quanto para escolher o material.
      const smoothSlope = island.slopeAt((xa + xb) * 0.5);
      const slope = Math.abs(smoothSlope);
      const facing = clamp(-smoothSlope * 0.8, -1, 1);

      if (mid < waterY) {
        // Submerso: só o raso imediato aparece, como um banco de areia visto
        // através da água. Ir mais fundo desenhava uma tira clara atravessando
        // o mar inteiro — o olho lia como um degrau, não como profundidade.
        const drop = waterY - mid;
        if (drop > 3) continue;
        const depth = clamp01(drop / 3);
        // Some também nas pontas do trecho desenhado: com a praia rasa, o banco
        // de areia chegava ao fim do intervalo e terminava numa aresta reta.
        const edge = Math.min(smoothstep(x0, x0 + 10, xa), smoothstep(x1, x1 - 10, xa));
        const sandUnder = mixColor(SAND_WET, waterColor(l, false), 0.4 + depth * 0.5);
        p.quad(xa, Math.min(ha, waterY), xa, waterY, xb, waterY, xb, Math.min(hb, waterY),
          sandUnder, (1 - depth) * 0.34 * edge);
        continue;
      }

      // Materiais MISTURADOS por altura e inclinação, nunca escolhidos por um
      // limiar. O `if/else` anterior trocava areia↔rocha de tira em tira na
      // encosta ruidosa e pintava listras verticais cinzas no morro.
      const wet = smoothstep(waterY + 3.2, waterY, mid);          // beira molhada
      const beach = smoothstep(waterY + 4.6, waterY + 1.4, mid);  // faixa de praia
      const rockK = smoothstep(0.72, 1.15, slope);                // encosta rochosa
      const alt = clamp01((mid - 4) / 30);                        // altitude

      const sandTop = mixColor(SAND, SAND_WET, wet * (0.55 + l.wet * 0.45));
      const grassTop = mixColor(grass, scaleColor(grass, 0.82), alt);
      let topBase = mixColor(grassTop, sandTop, beach);
      topBase = mixColor(topBase, ROCK, rockK);
      const top = lit(topBase, l, 1, facing * 0.7);

      const sandBody = mixColor(SAND, [0.45, 0.36, 0.28], 0.55);
      // O corpo da ilha é terra quente, não preto: mantém a leitura de pintura.
      const earthBody = mixColor([0.4, 0.31, 0.24], scaleColor(grass, 0.55), 0.45);
      let bodyBase = mixColor(earthBody, sandBody, beach);
      bodyBase = mixColor(bodyBase, mixColor(ROCK, ROCK_DARK, 0.65), rockK * 0.2);
      const body = lit(bodyBase, l, 0.4, facing * 0.15);

      // Corpo até a linha d'água, em dois trechos. Com um único gradiente do
      // topo até o mar, a cor da superfície só existia na crista e a encosta
      // inteira virava terra: a faixa de vegetação some da imagem.
      //
      // O terreno é pintado em colunas verticais, e a cor de cada coluna vem da
      // superfície no topo dela. Tudo que varia de coluna para coluna — rocha
      // na encosta íngreme, o lado da luz — vira uma barra vertical se descer
      // pela coluna inteira: eram as "barras pálidas" na encosta que a
      // auditoria de julho não explicou. Por isso o material e a luz direcional
      // ficam numa pele fina que acompanha a superfície (SKIN unidades), e o
      // interior usa a vegetação sem rocha e com pouca luz lateral, que muda
      // devagar de uma coluna para a outra.
      const SKIN = 2.2;
      const vegBase = mixColor(grassTop, sandTop, beach);
      const veg = lit(vegBase, l, 1, facing * 0.15);
      const mid1a = lerp(waterY, ha, 0.42);
      const mid1b = lerp(waterY, hb, 0.42);
      const skinA = Math.max(mid1a, ha - SKIN);
      const skinB = Math.max(mid1b, hb - SKIN);
      const midCol = mixColor(veg, body, 0.42);
      p.triShaded(xa, skinA, veg, 1, xa, ha, top, 1, xb, hb, top, 1);
      p.triShaded(xa, skinA, veg, 1, xb, hb, top, 1, xb, skinB, veg, 1);
      p.triShaded(xa, mid1a, midCol, 1, xa, skinA, veg, 1, xb, skinB, veg, 1);
      p.triShaded(xa, mid1a, midCol, 1, xb, skinB, veg, 1, xb, mid1b, midCol, 1);
      p.triShaded(xa, waterY, body, 1, xa, mid1a, midCol, 1, xb, mid1b, midCol, 1);
      p.triShaded(xa, waterY, body, 1, xb, mid1b, midCol, 1, xb, waterY, body, 1);
      const skirt = waterY - 2.2;
      p.triShaded(xa, skirt, body, 0, xa, waterY, body, 1, xb, waterY, body, 1);
      p.triShaded(xa, skirt, body, 0, xb, waterY, body, 1, xb, skirt, body, 0);
      // Fio de luz na crista, o truque clássico de recortar a silhueta.
      p.quad(xa, ha - 0.55, xa, ha, xb, hb, xb, hb - 0.55, scaleColor(top, 1.18), 0.55);
    }

    // Tufos de capim na borda: lâminas curvas, nunca retas, com alturas e tons
    // diferentes. É a franja que tira a aresta "de polígono" da crista.
    const vegDetail = QUALITY[this.quality].vegetationDetail;
    if (vegDetail > 0.4) {
      const spacing = lerp(5.5, 2.6, vegDetail);
      const tufts = Math.floor((x1 - x0) / spacing);
      const rng = new Rng(ws.seed ^ 0x77aa);
      for (let i = 0; i < tufts; i++) {
        const jitter = rng.next();
        const tx = x0 + ((i * spacing + jitter * spacing) % (x1 - x0));
        const h = island.groundAt(tx);
        if (h < waterY + 2.2 || Math.abs(island.slopeAt(tx)) > 1.15) continue;
        // Vento com rajada defasada por posição — o campo inteiro ondula.
        const gust = Math.sin(this.renderClock * 1.5 + tx * 0.22) * 0.6
          + Math.sin(this.renderClock * 3.1 + tx * 0.5) * 0.25;
        const bend = gust * ws.weather.wind;
        const tone = foliageColor(ws.sky.season, (i % 9) / 9);
        const blades = vegDetail > 0.8 ? 5 : 3;
        for (let k = 0; k < blades; k++) {
          const off = (k / (blades - 1) - 0.5) * 0.9;
          const tall = 1.0 + Math.abs(Math.cos(k * 2.1 + i)) * 1.1;
          // Mais claro na ponta: a folha fina deixa passar luz.
          const col = lit(scaleColor(tone, 1.02 + tall * 0.1), l, 1, 0.4);
          const topX = tx + off * 0.5 + bend * tall * 0.9;
          const topY = h + tall;
          p.curve(tx + off, h, tx + off + bend * tall * 0.3, h + tall * 0.6,
            topX, topY, 0.2, 0.01, col, 0.92, 3);
        }
      }
    }

    this.drawShoreline(ws, l, x0, x1, waterY);
  }

  /** Espuma e ressaca: a borda mais viva da imagem. */
  private drawShoreline(ws: WorldState, l: Lighting, x0: number, x1: number, waterY: number): void {
    const p = this.painter;
    const island = ws.island;
    const foam = foamColor(l);
    const amp = swell(ws.weather.wind, ws.tide);
    // Duas ondas defasadas dão a impressão de vaivém sem simular nada.
    for (let pass = 0; pass < 2; pass++) {
      const phase = this.renderClock * (0.55 + pass * 0.2) + pass * 2.1;
      const reach = (Math.sin(phase) * 0.5 + 0.5) * (1.4 + amp * 1.6) + 0.4;
      const step = 1.2;
      for (let x = x0; x < x1; x += step) {
        const h = island.groundAt(x);
        const d = h - waterY;
        if (d < -1.2 || d > reach) continue;
        const k = clamp01(1 - Math.abs(d) / Math.max(0.4, reach));
        const wobble = Math.sin(x * 0.35 + phase * 2.2) * 0.18;
        p.ellipse(x, waterY + d * 0.5 + wobble, step * 0.9, 0.28 * k + 0.06, 0, foam, 0.5 * k * (pass === 0 ? 1 : 0.6), 6);
      }
    }
    // Fio claro só onde há terra logo abaixo da água — atravessar o mar inteiro
    // com uma linha reta denunciava o truque na hora.
    const thin = mixColor(foam, l.horizon, 0.5);
    for (let x = x0; x < x1; x += 1.6) {
      const d = island.groundAt(x) - waterY;
      if (d < -2.5 || d > 1.2) continue;
      p.line(x, waterY, Math.min(x + 1.6, x1), waterY, 0.14, thin, 0.3);
    }
  }

  private brushCtxFor(
    world: World, ws: WorldState, l: Lighting, e: number, extra: Record<string, number>,
  ): BrushCtx {
    const tr = world.need(e, CTransform);
    const vis = world.need(e, CVisual);
    return {
      p: this.painter,
      l,
      x: tr.x,
      y: tr.y,
      seed: vis.seed,
      scale: tr.scale,
      facing: tr.facing,
      opacity: vis.opacity,
      depth: tr.depth,
      // Os valores de CVisual.shadow giram em torno de 0,7 (vegetação); 0,85 é
      // construção, 0 é o que voa. Normalizado para 0,7 = sombra de sempre.
      shadow: clamp(vis.shadow / 0.7, 0, 1.25),
      time: this.renderClock,
      season: ws.sky.season,
      wind: ws.weather.wind,
      extra,
    };
  }

  private collect(world: World, ws: WorldState, l: Lighting, left: number, right: number): void {
    const list = this.drawables;
    list.length = 0;
    const margin = (right - left) * 0.25;

    for (const e of world.query(CVisual, CTransform)) {
      const tr = world.need(e, CTransform);
      if (tr.x < left - margin || tr.x > right + margin) continue;
      const vis = world.need(e, CVisual);
      if (vis.opacity <= 0.01) continue;

      const plant = world.get(e, CPlant);
      const prop = world.get(e, CProp);
      const critter = world.get(e, CCritter);

      const extra: Record<string, number> = {};
      if (plant) {
        extra.growth = plant.growth;
        extra.health = plant.health;
        extra.maxHeight = plant.maxHeight;
        extra.fruit = plant.fruit;
        extra.species = plant.species === 'arbusto' ? 1 : 0;
      }
      if (prop) {
        extra.progress = prop.progress;
        extra.condition = prop.condition;
        for (const [k, v] of Object.entries(prop.flags)) extra[k] = v;
      }
      if (critter) extra.bond = critter.bond;

      const { draw } = resolveAsset(vis.brush);
      const ctx = this.brushCtxFor(world, ws, l, e, extra);
      list.push({ depth: tr.depth, y: tr.y, draw: () => draw(ctx) });
    }

    // O náufrago entra na mesma fila de profundidade que o resto do cenário.
    const self = world.first(CCastaway, CTransform);
    if (self !== null) {
      const tr = world.need(self, CTransform);
      const who = world.need(self, CCastaway);
      const brain = world.need(self, CBrain);
      const state = {
        x: tr.x, y: tr.y, facing: tr.facing,
        pose: currentPose(brain, tr.x),
        phase: brain.phase,
        time: this.renderClock,
        weathering: who.weathering,
        beard: who.beard,
        outfit: who.outfit,
        mood: who.mood,
        scale: 1,
        opacity: 1,
      };
      list.push({ depth: tr.depth + 0.02, y: tr.y, draw: () => drawCharacter(this.painter, l, state) });
    }

    // Fundo primeiro; empatando, o que está mais alto está mais longe.
    list.sort((a, b) => (a.depth - b.depth) || (b.y - a.y));
  }

  /**
   * Escolhe o perfil de qualidade pelo custo de CPU do desenho, não pelo
   * intervalo entre quadros.
   *
   * O intervalo entre quadros é imprestável para isso: com vsync a 60 Hz ele
   * fica preso em ~16,7 ms mesmo com a GPU ociosa, de modo que um limiar de
   * promoção abaixo disso nunca dispara e o perfil só sabe descer. Pior: como
   * o intervalo inclui simulação, coleta de lixo e qualquer travada do sistema,
   * um engasgo isolado rebaixava a qualidade para sempre.
   *
   * Agora o sinal é o tempo gasto dentro de `render`, com histerese (é preciso
   * insistir por vários quadros) e um intervalo mínimo entre trocas.
   */
  private adaptQuality(renderCostMs: number, dt: number): void {
    this.renderMs = this.renderMs * 0.9 + renderCostMs * 0.1;
    this.sinceTierChange += dt;

    // Régua: o menor intervalo já observado é, na prática, o vsync do monitor.
    // Sobe de leve com o tempo para se readaptar se a tela mudar (por exemplo,
    // ao arrastar a janela para um monitor de 144 Hz).
    const dtMs = dt * 1000;
    if (dtMs > 1 && dtMs < 40) this.refreshMs = Math.min(this.refreshMs * 1.0004, dtMs);

    // Dois sinais, porque as causas são duas.
    //  - custo de CPU do desenho: pega cena pesada demais para montar;
    //  - quadros perdidos em relação ao vsync: pega GPU saturada (o caso comum
    //    em 4K), que o relógio de CPU jamais veria.
    const cpuApertado = this.renderMs > 9;
    const perdendoQuadros = this.frameMs > this.refreshMs * 1.7;
    const cpuFolgada = this.renderMs < 4.5;
    const noRitmoDaTela = this.frameMs < this.refreshMs * 1.15;

    if (cpuApertado || perdendoQuadros) {
      this.overBudget++;
      this.underBudget = 0;
    } else if (cpuFolgada && noRitmoDaTela) {
      this.underBudget++;
      this.overBudget = 0;
    } else {
      this.overBudget = 0;
      this.underBudget = 0;
    }

    // Intervalo mínimo entre trocas: nada de piscar entre perfis.
    if (this.sinceTierChange < 2) return;

    // Descer é rápido (meio segundo de sofrimento basta); subir é lento e
    // exigente (uns três segundos de folga), para não entrar em ciclo.
    if (this.overBudget > 30 && this.quality !== 'baixa') {
      this.quality = this.quality === 'alta' ? 'media' : 'baixa';
      this.sinceTierChange = 0;
      this.overBudget = 0;
    } else if (this.underBudget > 180 && this.quality !== 'alta') {
      this.quality = this.quality === 'baixa' ? 'media' : 'alta';
      this.sinceTierChange = 0;
      this.underBudget = 0;
    }
  }

  render(world: World, ws: WorldState, dt: number): void {
    const t0 = performance.now();
    this.renderClock += dt;
    this.frameMs = this.frameMs * 0.92 + dt * 1000 * 0.08;

    const l = computeLighting(ws.sky, ws.weather);
    const cam = this.camera;
    cam.update(dt, () => this.pickShot(world, ws));

    const aspect = this.aspect;
    const halfW = cam.view * aspect;
    const left = cam.renderX - halfW;
    const right = cam.renderX + halfW;
    const top = cam.renderY + cam.view;
    const bottom = cam.renderY - cam.view;

    const waterY = WORLD.seaLevel + ws.tide;
    const q = QUALITY[this.quality];

    // 0. A cena inteira é pintada fora da tela, para o pós poder relê-la.
    this.post.enabled = this.quality !== 'baixa';
    this.post.beginScene();

    // 1. Céu e oceano (shader de tela cheia).
    this.backdrop.draw(l, ws.sky, ws.weather, {
      aspect,
      time: this.renderClock,
      horizonNdc: cam.worldToNdcY(waterY),
      sunPos: [cam.worldToNdcX(ws.sky.sunAzimuth * 260, aspect), cam.worldToNdcY(waterY) + ws.sky.sunAltitude * 1.25],
      moonPos: [cam.worldToNdcX(ws.sky.moonAzimuth * 260, aspect), cam.worldToNdcY(waterY) + ws.sky.moonAltitude * 1.25],
      waveAmp: swell(ws.weather.wind, ws.tide) * 0.5,
      octaves: q.oceanOctaves,
    }, ws.seed);

    // 2. Geometria do mundo.
    const [sx, sy] = cam.scale(aspect);
    this.painter.begin(cam.renderX, cam.renderY, sx, sy);

    this.drawHaze(l, left, right, waterY, ws.weather.fog);
    this.drawIsland(ws, l, left, right);

    this.collect(world, ws, l, left, right);
    for (const d of this.drawables) d.draw();

    // 3. Partículas.
    const fires: { x: number; y: number }[] = [];
    for (const e of world.query(CProp, CTransform)) {
      const p = world.need(e, CProp);
      if (p.kind === 'fogueira' && p.flags.acesa) {
        const tr = world.need(e, CTransform);
        fires.push({ x: tr.x, y: tr.y });
      }
    }
    this.particles.update(dt, {
      weather: ws.weather,
      left, right, top, bottom,
      seaLevel: waterY,
      fires,
      night: l.night,
      calm: 1 - ws.weather.wind,
    }, q.particles / QUALITY.alta.particles);
    // Unidades de mundo por pixel: dá às partículas um tamanho mínimo na tela.
    this.particles.draw(this.painter, l, (cam.view * 2) / Math.max(1, this.canvas.height));

    // 4. Clima em primeiro plano: véu de chuva e escurecimento de tempestade.
    if (ws.weather.rain > 0.25) {
      const veil = mixColor(l.horizon, [0.5, 0.55, 0.62], 0.5);
      this.painter.quad(left, bottom, left, top, right, top, right, bottom, veil, ws.weather.rain * 0.1);
    }
    if (l.flash > 0.01) {
      this.painter.quad(left, bottom, left, top, right, top, right, bottom, [1, 1, 0.97], l.flash * 0.32);
    }

    this.painter.flush();

    // 6. Pós-processamento: bloom, tonemap filmic, color grade, vinheta orgânica,
    //    grão e — só em tempestade — aberração. A vinheta antiga (desenhada no
    //    painter) saiu daqui: agora ela é orgânica, feita no shader do pós.
    this.post.resolve(this.buildGrade(l, ws));

    this.adaptQuality(performance.now() - t0, dt);
  }

  /** Traduz luz e clima nos números de humor que o pós-processamento usa. */
  private buildGrade(l: Lighting, ws: WorldState): Grade {
    const dusk = ws.sky.goldenHour;
    const night = l.night;
    const gloom = clamp01(ws.weather.cloud * 0.7 + ws.weather.rain * 0.5);

    // Cor dominante do grade: dia levemente frio, tarde âmbar, noite índigo.
    const amber: RGB = [1.0, 0.72, 0.45];
    const indigo: RGB = [0.26, 0.38, 0.7];
    const dayTint: RGB = [0.74, 0.82, 0.92];
    let tint = mixColor(dayTint, amber, dusk);
    tint = mixColor(tint, indigo, night * 0.85);

    const storm = clamp01((ws.weather.wind - 0.62) / 0.38);

    return {
      // ACES escurece um pouco os médios; a exposição um tico acima de 1 devolve.
      exposure: l.exposure * 1.22,
      bloom: clamp(0.1 + night * 0.16 + dusk * 0.06 + l.flash * 0.5, 0, 0.5),
      saturation: clamp(0.94 + dusk * 0.06 - gloom * 0.08, 0.8, 1.06),
      temperature: clamp(dusk * 0.5 - night * 0.32, -0.35, 0.5),
      tint: [tint[0], tint[1], tint[2]],
      tintK: 0.06 + dusk * 0.12 + night * 0.14,
      vignette: 0.34 + night * 0.14,
      grain: 0.018 + night * 0.03 + gloom * 0.015,
      aberration: storm * 0.0035 + l.flash * 0.004,
      time: this.renderClock,
    };
  }

  get particleCount(): number {
    return this.particles.alive;
  }
}

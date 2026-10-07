import { PERSIST, SIM } from './core/config.ts';
import { genesis } from './sim/genesis.ts';
import { createSimulation, stepSimulation } from './simulation.ts';
import { Renderer } from './render/renderer.ts';
import { Ambience } from './audio/ambience.ts';
import { applySave, loadWorld, savedSeed, saveWorld, setAsideSave, wipeSave } from './persist/save.ts';
import { parseSeed } from './core/rng.ts';
import { formatClock, moonName } from './sim/calendar.ts';
import { describe } from './sim/weather.ts';
import { CBrain, CCastaway, CNeeds, CProp, CTransform } from './sim/components.ts';
import { dominantNeed } from './ai/needs.ts';

/**
 * Ponto de entrada. Laço de passo fixo para a simulação, quadro livre para o
 * desenho. A janela pode ficar aberta por semanas: nada aqui aloca por quadro.
 */

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const chronicleEl = document.getElementById('chronicle') as HTMLDivElement;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const bootEl = document.getElementById('boot') as HTMLDivElement;

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // `?novo` recomeça o mundo do zero; `?semente=123` reproduz uma ilha exata.
  if (params.has('novo')) await wipeSave();
  const forcedSeed = parseSeed(params.get('semente'));
  if (params.has('semente') && forcedSeed === null) {
    console.warn(`[driftwood] ?semente=${params.get('semente')} não é um inteiro de 0 a 4294967295; ignorada.`);
  }

  const candidate = params.has('novo') ? null : await loadWorld();

  // A ilha é reconstruída a partir da semente; o save guarda só o que aconteceu
  // *nela*. Se a semente pedida na URL não for a do save, os dois descrevem
  // lugares diferentes: aplicar um sobre o outro deixa árvores no ar e cabanas
  // enterradas. Nesse caso a URL manda e o save é descartado.
  const savedIsForAnotherIsland =
    candidate !== null && forcedSeed !== null && savedSeed(candidate.blob) !== forcedSeed;
  if (savedIsForAnotherIsland) {
    console.warn(
      `[driftwood] o mundo salvo é da semente ${savedSeed(candidate!.blob)}, ` +
      `mas a URL pediu ${forcedSeed}. Começando uma ilha nova com a semente pedida.`,
    );
  }

  const saved = savedIsForAnotherIsland ? null : candidate;
  const seed = forcedSeed ?? (saved ? savedSeed(saved.blob) : Math.floor(Math.random() * 2 ** 31));

  let sim = createSimulation(seed);
  if (saved) {
    try {
      applySave(saved.blob, sim.world, sim.ws);
      // Mundo antigo, mas sem ninguém dentro: recomeça em vez de travar.
      if (sim.world.first(CCastaway) === null) genesis(sim.world, sim.ws);
    } catch (err) {
      // Um save que passa na validação e mesmo assim quebra ao aplicar travaria
      // o boot em toda abertura — e no protetor de tela não há como pedir `?novo`.
      await setAsideSave(saved.raw, `falhou ao aplicar: ${String((err as Error)?.message ?? err)}`);
      sim = createSimulation(seed);
      genesis(sim.world, sim.ws);
    }
  } else {
    genesis(sim.world, sim.ws);
  }
  const { world, ws, bus, scheduler } = sim;

  const renderer = new Renderer(canvas, seed);
  const ambience = new Ambience();
  ambience.bind(bus);

  // ── crônica na tela ──
  bus.on('crônica', (ev) => {
    const line = document.createElement('div');
    line.textContent = String(ev.text ?? '');
    chronicleEl.appendChild(line);
    while (chronicleEl.childElementCount > 4) chronicleEl.removeChild(chronicleEl.firstChild!);
    setTimeout(() => line.remove(), 26000);
  });

  // Últimas linhas do save reaparecem discretamente, para o mundo não parecer novo.
  for (const entry of ws.chronicle.slice(-2)) {
    const line = document.createElement('div');
    line.textContent = entry.text;
    line.style.opacity = '0.35';
    line.style.animation = 'none';
    chronicleEl.appendChild(line);
  }

  // ── laço ──
  let last = performance.now();
  let accumulator = 0;
  let sinceSave = 0;
  let hudOn = false;
  let paused = false;
  let profiling = false;

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(dpr());
  // ResizeObserver pega também os casos em que o elemento muda sem a janela
  // mudar (painel lateral, tela dividida, entrada em tela cheia).
  new ResizeObserver(() => renderer.resize(dpr())).observe(canvas);
  window.addEventListener('resize', () => renderer.resize(dpr()));

  // Perda de contexto WebGL: a simulação segue; o desenho pausa e, quando o
  // navegador devolve o contexto, tudo que mora na GPU é recriado.
  // `preventDefault` é o que pede ao navegador para devolvê-lo.
  let gpuLost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    gpuLost = true;
    console.warn('[driftwood] contexto WebGL perdido; aguardando restauração.');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      renderer.restoreGpu(dpr());
      gpuLost = false;
      console.warn('[driftwood] contexto WebGL restaurado.');
    } catch (err) {
      console.error('[driftwood] falha ao restaurar o contexto WebGL', err);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ambience.suspend();
    else {
      ambience.resume();
      last = performance.now(); // não acumula horas de mundo em segundo plano
    }
  });

  const startAudio = () => {
    void ambience.start();
    window.removeEventListener('pointerdown', startAudio);
    window.removeEventListener('keydown', startAudio);
  };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);

  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'i':
        hudOn = !hudOn;
        hudEl.classList.toggle('on', hudOn);
        break;
      case 'p':
        paused = !paused;
        break;
      case 'f':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void canvas.requestFullscreen().catch(() => undefined);
        break;
      case 'm':
        ambience.setVolume(ambience.volume > 0.05 ? 0 : 0.55);
        break;
      case 'd':
        profiling = !profiling;
        break;
      default:
        break;
    }
  });

  function frame(now: number): void {
    const rawDt = Math.min(0.25, (now - last) / 1000);
    last = now;

    if (!paused) {
      accumulator += rawDt;
      let steps = 0;
      while (accumulator >= SIM.step && steps < SIM.maxCatchUp) {
        stepSimulation(sim, profiling);
        accumulator -= SIM.step;
        steps++;
      }
      if (steps === SIM.maxCatchUp) accumulator = 0; // descarta atraso acumulado
    }

    // Bandeira consumida pelo áudio: existe fogo aceso agora?
    let lit = 0;
    for (const e of world.query(CProp)) {
      const p = world.need(e, CProp);
      if (p.kind === 'fogueira' && p.flags.acesa) { lit = 1; break; }
    }
    ws.flags['fogueira-acesa'] = lit;

    if (!gpuLost) renderer.render(world, ws, rawDt);
    ambience.update(rawDt, ws, renderer.camera.view);

    sinceSave += rawDt;
    if (sinceSave > PERSIST.autosaveSeconds) {
      sinceSave = 0;
      void saveWorld(world, ws);
    }

    if (hudOn) updateHud();
    requestAnimationFrame(frame);
  }

  function updateHud(): void {
    const self = world.first(CCastaway);
    const needs = self !== null ? world.get(self, CNeeds) : null;
    const fps = (1000 / Math.max(1, renderer.frameMs)).toFixed(0);
    const lines = [
      `dia ${ws.sky.day}  ${formatClock(ws.sky)}  ${ws.sky.season}  ${moonName(ws.sky.moonPhase)}`,
      `${describe(ws.weather)}   vento ${(ws.weather.wind * 100) | 0}%   maré ${ws.tide.toFixed(2)}`,
      needs ? `impulso: ${dominantNeed(needs)}   humor ${(world.need(self!, CCastaway).mood * 100) | 0}%` : '',
      `história: ${ws.activeStory ?? '—'}   entidades ${world.entityCount}   partículas ${renderer.particleCount}`,
      `${fps} fps   quadro ${renderer.frameMs.toFixed(1)} ms   desenho ${renderer.renderMs.toFixed(1)} ms   qualidade ${renderer.quality}   [i] hud  [p] pausa  [f] tela cheia  [m] som`,
    ];
    hudEl.textContent = lines.filter(Boolean).join('\n');
  }

  window.addEventListener('beforeunload', () => {
    void saveWorld(world, ws);
  });

  // Ponte de desenvolvimento: inspecionar o mundo e tirar um quadro sem plugins.
  (window as { __driftwood?: unknown }).__driftwood = {
    world, ws, renderer, scheduler, bus,
    components: { CBrain, CCastaway, CNeeds, CProp, CTransform },
    /** Foca a câmera no náufrago e devolve o que ele está fazendo. */
    look(view = 18) {
      const e = world.first(CCastaway, CTransform);
      if (e === null) return 'ninguém na ilha';
      const tr = world.need(e, CTransform);
      const br = world.need(e, CBrain);
      renderer.camera.snap({ x: tr.x, y: tr.y + view * 0.25, view, label: 'ele' });
      renderer.camera.cut({ x: tr.x, y: tr.y + view * 0.25, view, label: 'ele' }, 600);
      return { entidade: e, x: tr.x, y: tr.y, ação: br.action, alvo: br.targetX };
    },
    /** Avança N passos de simulação instantaneamente (para testar dias inteiros). */
    fastForward(steps: number) {
      for (let i = 0; i < steps; i++) stepSimulation(sim);
      return { dia: ws.sky.day, hora: formatClock(ws.sky), clima: describe(ws.weather) };
    },
    /** Um quadro renderizado agora, em PNG (dataURL). */
    snapshot(): string {
      renderer.render(world, ws, 1 / 60);
      const gl = renderer.gl;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const c2d = out.getContext('2d')!;
      const img = c2d.createImageData(w, h);
      // WebGL entrega de baixo para cima; inverte as linhas.
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4;
        img.data.set(px.subarray(src, src + w * 4), y * w * 4);
      }
      c2d.putImageData(img, 0, 0);
      return out.toDataURL('image/png');
    },
  };

  bootEl.classList.add('gone');
  setTimeout(() => bootEl.remove(), 1400);
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  bootEl.textContent = String(err?.message ?? err);
  bootEl.style.color = '#c98';
});

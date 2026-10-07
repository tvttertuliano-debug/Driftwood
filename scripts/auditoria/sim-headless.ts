/**
 * Simulação sem render, usada na auditoria de 07/10/2026 como prova executável.
 *
 *   npx esbuild scripts/auditoria/sim-headless.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/sim.mjs && node /tmp/sim.mjs 771203 360
 *
 * Mede: fenômenos iniciados x eventos `fenômeno` emitidos, linhas de crônica
 * que nunca chegam à tela (não passam pelo evento `crônica`), crescimento de
 * entidades, props longe da ilha e custo por passo.
 */
import { Scheduler, World } from '../../src/core/ecs.ts';
import { EventBus } from '../../src/core/events.ts';
import { SIM } from '../../src/core/config.ts';
import { createWorldState } from '../../src/sim/worldState.ts';
import { genesis } from '../../src/sim/genesis.ts';
import {
  agingSystem, appearSystem, critterSystem, ecologySystem, ephemeralSystem,
  fireSystem, physicsSystem, timeSystem,
} from '../../src/sim/systems.ts';
import { actSystem, mindSystem } from '../../src/ai/brain.ts';
import { directorSystem } from '../../src/story/director.ts';
import { CBody, CPlant, CProp, CTransform } from '../../src/sim/components.ts';
import type { DriftContext } from '../../src/sim/context.ts';

const seed = Number(process.argv[2] ?? 771203);
const days = Number(process.argv[3] ?? 120);

const world = new World(4096);
const ws = createWorldState(seed);
const bus = new EventBus();
genesis(world, ws);
const scheduler = new Scheduler<DriftContext>().add(
  timeSystem, mindSystem, agingSystem, actSystem, critterSystem, physicsSystem,
  ephemeralSystem, appearSystem, ecologySystem, fireSystem, directorSystem,
);
const ctx: DriftContext = { world, ws, bus, dt: SIM.step, elapsed: 0 };

let phenomenaStarted = 0;
let phenomenaEvents = 0;
let prevPhenomenon = 'nenhum';
bus.on('fenômeno', () => phenomenaEvents++);

const onScreen = new Set<string>();
bus.on('crônica', (ev) => onScreen.add(String(ev.text)));
let registered = 0;
let neverShown = 0;
const neverShownSamples = new Set<string>();
let maxPropX = 0;

const stepsPerDay = 86400 / (SIM.step * SIM.minutesPerSecond * 60);
for (let d = 1; d <= days; d++) {
  for (let i = 0; i < stepsPerDay; i++) {
    const before = ws.chronicle.length > 0 ? ws.chronicle[ws.chronicle.length - 1] : null;
    bus.setClock(ws.worldSeconds);
    scheduler.run(ctx);
    const fresh: string[] = [];
    for (let k = ws.chronicle.length - 1; k >= 0 && ws.chronicle[k] !== before; k--) fresh.push(ws.chronicle[k].text);
    bus.dispatch();
    for (const t of fresh) {
      registered++;
      if (!onScreen.has(t)) {
        neverShown++;
        if (neverShownSamples.size < 12) neverShownSamples.add(t);
      }
    }
    onScreen.clear();
    if (ws.weather.phenomenon !== prevPhenomenon) {
      if (ws.weather.phenomenon !== 'nenhum') phenomenaStarted++;
      prevPhenomenon = ws.weather.phenomenon;
    }
    if (i % 2000 === 0) {
      for (const e of world.query(CProp, CTransform)) maxPropX = Math.max(maxPropX, Math.abs(world.need(e, CTransform).x));
    }
  }
  if (d % 60 === 0 || d === days) {
    let plants = 0;
    for (const _ of world.query(CPlant)) plants++;
    const props: Record<string, number> = {};
    for (const e of world.query(CProp)) {
      const p = world.need(e, CProp);
      props[p.kind] = (props[p.kind] ?? 0) + 1;
    }
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) { bus.setClock(ws.worldSeconds); scheduler.run(ctx); bus.dispatch(); }
    const ms = (performance.now() - t0) / 2000;
    console.log(`dia ${d}: entidades=${world.entityCount} plantas=${plants} ms/passo=${ms.toFixed(4)} props=${JSON.stringify(props)}`);
  }
}

console.log(`fenômenos iniciados=${phenomenaStarted}, eventos 'fenômeno' emitidos=${phenomenaEvents}`);
console.log(`linhas de crônica=${registered}, nunca exibidas na tela=${neverShown}`);
console.log(`maior |x| de uma construção=${maxPropX.toFixed(1)} (meia-largura da ilha=120); com CBody: ${[...world.query(CProp, CBody)].length}`);
console.log('exemplos nunca exibidos:', [...neverShownSamples]);

import { Stage, type System } from '../core/ecs.ts';
import { approach, clamp01, lerp, osc } from '../core/math.ts';
import { WORLD, SIM } from '../core/config.ts';
import { advance, readSky, temperature } from './calendar.ts';
import { severity, stepWeather, isDangerous } from './weather.ts';
import { tideAt } from './tides.ts';
import { bump, flag, narrate, setFlag } from './worldState.ts';
import {
  CBody, CCastaway, CCritter, CPlant, CProp, CRare, CTransform, CVisual,
} from './components.ts';
import { DOES_NOT_WEAR } from './queries.ts';
import type { DriftContext } from './context.ts';

/**
 * Sistemas de mundo. Cada um faz uma coisa só e não sabe da existência dos outros.
 */

// ───────────────────────────────── tempo ─────────────────────────────────

export const timeSystem: System<DriftContext> = {
  name: 'tempo',
  stage: Stage.Time,
  update(ctx) {
    const { ws } = ctx;
    const worldDt = ctx.dt * SIM.minutesPerSecond * 60;
    advance(ws.cal, ctx.dt);
    ws.worldSeconds += worldDt;

    const prevDay = ws.sky.day;
    ws.sky = readSky(ws.cal);
    ws.tide = tideAt(ws.sky);

    const phenomenonBefore = ws.weather.phenomenon;
    const changed = stepWeather(ws.weather, ws.sky, worldDt, ws.rngWeather);
    if (changed) ctx.bus.emit('clima', { kind: changed });
    if (ws.weather.lightning > 0.98) ctx.bus.emit('raio');

    if (ws.sky.day !== prevDay) {
      ctx.bus.emit('novo-dia', { day: ws.sky.day });
      if (ws.sky.day % SIM.daysPerSeason === 0) {
        ctx.bus.emit('nova-estação', { season: ws.sky.season });
        narrate(ws, ctx.bus, `Começou o ${ws.sky.season}.`, 'maravilha');
      }
    }
    // Anuncia só na passagem de "nenhum" para um fenômeno. Antes o teste era
    // `phenomenonTime <= worldDt`, verdadeiro no passo em que ele começa (0) e
    // também no seguinte (exatamente worldDt): toda aurora saía duas vezes.
    if (phenomenonBefore === 'nenhum' && ws.weather.phenomenon !== 'nenhum') {
      ctx.bus.emit('fenômeno', { kind: ws.weather.phenomenon });
      const nomes: Record<string, string> = {
        'arco-íris': 'Um arco-íris abriu sobre a água.',
        aurora: 'O céu do norte começou a brilhar em cortinas verdes.',
        eclipse: 'O sol foi engolido no meio da tarde.',
        meteoros: 'Riscos de luz atravessaram o céu a noite inteira.',
      };
      const t = nomes[ws.weather.phenomenon];
      if (t) narrate(ws, ctx.bus, t, 'maravilha');
    }
  },
};

// ───────────────────────────────── física ─────────────────────────────────

export const physicsSystem: System<DriftContext> = {
  name: 'física',
  stage: Stage.Physics,
  update(ctx) {
    const { ws } = ctx;
    const waterY = WORLD.seaLevel + ws.tide;
    for (const e of ctx.world.query(CBody, CTransform)) {
      const b = ctx.world.need(e, CBody);
      const tr = ctx.world.need(e, CTransform);
      if (b.asleep) {
        // Corpos adormecidos só acordam se a água subir até eles. (A condição
        // estava invertida — acordava quando a água estava *longe* —, e um corpo
        // boiante em terra nunca dormia.)
        if (b.buoyant && tr.y <= waterY + 0.6) b.asleep = false;
        else continue;
      }

      if (b.buoyant && tr.y <= waterY + 0.6) {
        // Empuxo + balanço da onda: destroços dançam sem simulação cara.
        const wave = osc(ws.worldSeconds, 7.5, tr.x * 0.05) * (0.3 + ws.weather.wind * 0.9);
        const target = waterY + wave * 0.6;
        tr.y = approach(tr.y, target, 3.2, ctx.dt);
        tr.rot = approach(tr.rot, wave * 0.16, 2.2, ctx.dt);
        b.vy = 0;
        b.vx = approach(b.vx, ws.weather.windDir * ws.weather.wind * 1.6, 0.7, ctx.dt);
        tr.x += b.vx * ctx.dt;
      } else {
        b.vy += WORLD.gravity * ctx.dt;
        tr.x += b.vx * ctx.dt;
        tr.y += b.vy * ctx.dt;
        const ground = ws.island.surfaceAt(tr.x);
        if (tr.y <= ground) {
          tr.y = ground;
          if (Math.abs(b.vy) > 2) b.vy = -b.vy * b.bounce;
          else b.vy = 0;
          b.vx = approach(b.vx, 0, 6, ctx.dt);
          b.grounded = true;
          if (Math.abs(b.vx) < 0.05 && Math.abs(b.vy) < 0.05) b.asleep = true;
        } else {
          b.grounded = false;
        }
      }
    }
  },
};

// ───────────────────────────────── ecologia ─────────────────────────────────

/** Roda 1x a cada 10 passos: crescimento é assunto de dias, não de frames. */
export const ecologySystem: System<DriftContext> = {
  name: 'ecologia',
  stage: Stage.Ecology,
  every: 10,
  update(ctx) {
    const { ws } = ctx;
    const worldDt = ctx.dt * 10 * SIM.minutesPerSecond * 60;
    const days = worldDt / 86400;
    const temp = temperature(ws.sky);
    const water = clamp01(ws.weather.rain * 2 + 0.35);

    for (const e of ctx.world.query(CPlant)) {
      const p = ctx.world.need(e, CPlant);
      // Uma palmeira leva ~30 dias de mundo para virar adulta. Dá para ver acontecer.
      const rate = (1 / 30) * lerp(0.4, 1.25, temp) * lerp(0.55, 1.15, water) * p.health;
      const before = p.growth;
      p.growth = clamp01(p.growth + rate * days);
      if (before < 0.5 && p.growth >= 0.5) ctx.bus.emit('planta-cresceu', { entity: e });
      if (p.growth > 0.75 && p.species === 'palmeira') {
        const fruiting = ws.sky.season === 'verão' || ws.sky.season === 'primavera' ? 1.6 : 0.5;
        p.fruit = Math.min(4, p.fruit + days * 0.5 * fruiting);
      }
      // Tempestade castiga; sol de inverno cansa.
      if (isDangerous(ws.weather)) p.health = clamp01(p.health - days * severity(ws.weather) * 0.4);
      else p.health = clamp01(p.health + days * 0.15);
    }

    // Erosão: tempestades comem a praia, a calmaria devolve areia.
    const sev = severity(ws.weather);
    if (sev > 0.5) {
      const side = ws.weather.windDir > 0 ? ws.island.shoreRight : ws.island.shoreLeft;
      ws.island.erode(side, 14, sev * days * 3.2);
      if (ws.rngWeather.chance(days * 2)) ctx.bus.emit('erosão', { x: side });
    } else {
      ws.island.settle(days * 0.06);
    }

    // Desgaste das construções: sal, vento e tempo. O mundo cobra manutenção.
    for (const e of ctx.world.query(CProp)) {
      const p = ctx.world.need(e, CProp);
      if (p.progress < 1 || DOES_NOT_WEAR.has(p.kind)) continue;
      const wear = days * (0.006 + sev * 0.09) * (p.kind === 'castelo-de-areia' ? 12 : 1);
      p.condition = clamp01(p.condition - wear);
      if (p.condition <= 0) {
        ctx.bus.emit('ruína', { kind: p.kind, entity: e });
        if (p.kind === 'castelo-de-areia') {
          narrate(ws, ctx.bus, 'A maré levou o castelo de areia. Era previsível. Ainda assim.', 'perda');
        } else {
          narrate(ws, ctx.bus, `${p.kind} não resistiu.`, 'perda');
        }
        ctx.world.destroy(e);
      }
    }
  },
};

// ───────────────────────────────── bichos ─────────────────────────────────

export const critterSystem: System<DriftContext> = {
  name: 'bichos',
  stage: Stage.Act,
  update(ctx) {
    const { ws } = ctx;
    for (const e of ctx.world.query(CCritter, CTransform)) {
      const c = ctx.world.need(e, CCritter);
      const tr = ctx.world.need(e, CTransform);
      c.timer -= ctx.dt;

      switch (c.species) {
        case 'caranguejo': {
          if (c.timer <= 0) {
            c.state = ws.rngAmbient.chance(0.45) ? 'parado' : 'andando';
            c.timer = ws.rngAmbient.range(1.5, 6);
            if (c.state === 'andando') tr.facing = ws.rngAmbient.chance(0.5) ? 1 : -1;
          }
          if (c.state === 'andando') {
            tr.x += tr.facing * 3.2 * ctx.dt;
            if (!ws.island.isBeach(tr.x)) tr.facing = -tr.facing as 1 | -1;
          }
          tr.y = ws.island.surfaceAt(tr.x);
          break;
        }
        case 'gaivota': {
          // Voo em oito preguiçoso sobre a arrebentação.
          const t = ws.worldSeconds * 0.06 + c.seed;
          tr.x = c.homeX + Math.sin(t) * 42;
          tr.y = 14 + Math.sin(t * 2.1) * 6 + ws.weather.wind * 4;
          tr.facing = Math.cos(t) >= 0 ? 1 : -1;
          break;
        }
        case 'papagaio': {
          const castaway = ctx.world.first(CCastaway, CTransform);
          const target = castaway ? ctx.world.need(castaway, CTransform).x : c.homeX;
          if (c.bond > 0.3) {
            // Acompanha, mas mantém a dignidade a alguns metros.
            const want = target + (tr.x < target ? -6 : 6);
            tr.x = approach(tr.x, want, 0.8, ctx.dt);
            tr.y = approach(tr.y, ws.island.surfaceAt(tr.x) + 6.5, 1.4, ctx.dt);
          } else {
            const t = ws.worldSeconds * 0.04 + c.seed;
            tr.x = c.homeX + Math.sin(t) * 20;
            tr.y = ws.island.surfaceAt(tr.x) + 9 + Math.sin(t * 3) * 1.6;
          }
          break;
        }
        default:
          break;
      }
    }
  },
};

// ───────────────────────────────── efêmeros ─────────────────────────────────

export const ephemeralSystem: System<DriftContext> = {
  name: 'efêmeros',
  stage: Stage.Physics,
  update(ctx) {
    // Entidades de eventos raros têm relógio próprio e somem ao zerar.
    for (const e of ctx.world.query(CRare)) {
      const r = ctx.world.need(e, CRare);
      r.ttl -= ctx.dt;
      r.phase += ctx.dt;
      if (r.ttl <= 0) {
        ctx.bus.emit('raro-fim', { event: r.event, entity: e });
        ctx.world.destroy(e);
      }
    }
  },
};

// ───────────────────────────── aparição suave ─────────────────────────────

/** Tudo que nasce, nasce com fade. Nada aparece com um estalo. */
export const appearSystem: System<DriftContext> = {
  name: 'aparição',
  stage: Stage.Physics,
  update(ctx) {
    for (const e of ctx.world.query(CVisual)) {
      const v = ctx.world.need(e, CVisual);
      if (v.opacity < 1) {
        v.opacity = clamp01(v.opacity + ctx.dt * 0.6);
      }
    }
  },
};

// ───────────────────────────── envelhecimento ─────────────────────────────

export const agingSystem: System<DriftContext> = {
  name: 'envelhecer',
  stage: Stage.Mind,
  every: 20,
  update(ctx) {
    const { ws } = ctx;
    for (const e of ctx.world.query(CCastaway)) {
      const who = ctx.world.need(e, CCastaway);
      const prevDays = Math.floor(who.ageDays);
      who.ageDays = ws.sky.day + ws.sky.t;
      who.weathering = clamp01(who.ageDays / 240);
      who.beard = clamp01(0.05 + who.ageDays / 90);
      const wantedOutfit = who.ageDays > 120 ? 3 : who.ageDays > 60 ? 2 : who.ageDays > 18 ? 1 : 0;
      if (wantedOutfit !== who.outfit) {
        who.outfit = wantedOutfit;
        ctx.bus.emit('nova-roupa', { outfit: wantedOutfit });
        narrate(ws, ctx.bus, 'Ele mudou de roupa. A anterior tinha virado outra coisa.', 'rotina');
      }
      if (Math.floor(who.ageDays) !== prevDays && Math.floor(who.ageDays) % 30 === 0 && who.ageDays > 1) {
        narrate(ws, ctx.bus, `${Math.floor(who.ageDays)} dias.`, 'maravilha');
        bump(ws, 'meses');
      }
    }
  },
};

/** Fogueira apaga com chuva e com o tempo. Pequeno, mas é o que faz o lugar viver. */
export const fireSystem: System<DriftContext> = {
  name: 'fogo',
  stage: Stage.Ecology,
  every: 20,
  update(ctx) {
    // Em segundos de mundo: uma fogueira alimentada dura umas seis horas, e a
    // chuva a mata em minutos.
    const dt = ctx.dt * 20 * SIM.minutesPerSecond * 60;
    for (const e of ctx.world.query(CProp)) {
      const p = ctx.world.need(e, CProp);
      if (p.kind !== 'fogueira' || !p.flags.acesa) continue;
      p.flags.combustível = (p.flags.combustível ?? 1) - dt * (0.000046 + ctx.ws.weather.rain * 0.0009);
      if (p.flags.combustível <= 0) {
        p.flags.acesa = 0;
        p.flags.combustível = 1;
        ctx.bus.emit('fogo-apagou');
      }
    }
  },
};

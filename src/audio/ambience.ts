import { clamp01, lerp } from '../core/math.ts';
import type { EventBus } from '../core/events.ts';
import type { WorldState } from '../sim/worldState.ts';

/**
 * Som ambiente inteiramente sintetizado — nenhum arquivo de áudio, nenhuma
 * amostra de terceiros. Mar, vento e chuva são ruído filtrado; bichos são
 * osciladores curtos. Música só aparece em momentos raros: o silêncio é parte
 * da experiência.
 */

function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    } else {
      data[i] = white;
    }
  }
  return buf;
}

interface Layer {
  gain: GainNode;
  filter: BiquadFilterNode;
  source: AudioBufferSourceNode;
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sea: Layer | null = null;
  private wind: Layer | null = null;
  private rain: Layer | null = null;
  private surfLfo = 0;
  private nextBird = 3;
  private nextInsect = 2;
  private nextCrackle = 0.5;
  private started = false;
  /** Volume geral desejado (0..1). */
  volume = 0.55;
  enabled = true;

  /** Precisa ser chamado a partir de um gesto do usuário nos navegadores. */
  async start(): Promise<void> {
    if (this.started || !this.enabled) return;
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;
    this.started = true;
    const ctx: AudioContext = new Ctor();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    this.sea = this.makeNoiseLayer(ctx, master, true, 'lowpass', 420, 0.0);
    this.wind = this.makeNoiseLayer(ctx, master, true, 'bandpass', 620, 0.0);
    this.rain = this.makeNoiseLayer(ctx, master, false, 'highpass', 1800, 0.0);

    // Sobe devagar: nada de tapa no ouvido ao abrir.
    master.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 4);
  }

  private makeNoiseLayer(
    ctx: AudioContext, dest: AudioNode, brown: boolean,
    type: BiquadFilterType, freq: number, gain: number,
  ): Layer {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, 4, brown);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = type === 'bandpass' ? 0.7 : 1;
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(filter).connect(g).connect(dest);
    source.start();
    return { gain: g, filter, source };
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + Math.min(0.04, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.05);
  }

  private burst(dur: number, vol: number, from: number, to: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, dur, true);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  /** Liga os eventos do mundo aos sons pontuais. */
  bind(bus: EventBus): void {
    bus.on('raio', () => this.burst(2.4, 0.5, 900, 60));
    bus.on('fogo-aceso', () => this.tone(220, 0.5, 0.06, 'triangle', 320));
    bus.on('obra-pronta', () => {
      // Três notas. É a coisa mais parecida com música que o programa faz.
      this.tone(392, 0.6, 0.05);
      setTimeout(() => this.tone(523, 0.6, 0.045), 260);
      setTimeout(() => this.tone(659, 1.1, 0.04), 520);
    });
    bus.on('evento-raro', () => {
      this.tone(330, 1.6, 0.035, 'sine', 660);
      setTimeout(() => this.tone(495, 2.2, 0.03), 700);
    });
    bus.on('descoberta', () => this.tone(294, 1.2, 0.045, 'sine', 440));
  }

  /** Atualização contínua: mistura os leitos de ruído conforme o mundo. */
  update(dt: number, ws: WorldState, cameraView: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sea || !this.wind || !this.rain) return;

    // Câmera longe = som mais distante. Detalhe pequeno, efeito grande.
    const proximity = clamp01(1.2 - cameraView / 120);

    this.surfLfo += dt * 0.16;
    const surge = 0.5 + 0.5 * Math.sin(this.surfLfo * 2 * Math.PI);
    const w = ws.weather;

    const seaGain = lerp(0.05, 0.2, clamp01(w.wind)) * (0.6 + surge * 0.4) * proximity;
    this.sea.gain.gain.value += (seaGain - this.sea.gain.gain.value) * Math.min(1, dt * 1.5);
    this.sea.filter.frequency.value = lerp(280, 900, clamp01(w.wind)) * (0.8 + surge * 0.4);

    const windGain = Math.pow(clamp01(w.wind), 1.7) * 0.16 * proximity;
    this.wind.gain.gain.value += (windGain - this.wind.gain.gain.value) * Math.min(1, dt * 1.2);
    this.wind.filter.frequency.value = lerp(320, 1400, clamp01(w.wind));

    const rainGain = clamp01(w.rain) * 0.13 * proximity;
    this.rain.gain.gain.value += (rainGain - this.rain.gain.gain.value) * Math.min(1, dt * 2);

    this.master.gain.value += (this.volume - this.master.gain.value) * Math.min(1, dt * 0.5);

    // Pássaros de dia, insetos de noite. Nunca ao mesmo tempo.
    const day = ws.sky.daylight;
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 2 + Math.random() * 14 / Math.max(0.05, day);
      if (day > 0.25 && w.rain < 0.4 && Math.random() < 0.8) {
        const base = 900 + Math.random() * 1600;
        this.tone(base, 0.1, 0.02 * proximity, 'sine', base * (1 + Math.random() * 0.6));
        if (Math.random() < 0.6) {
          setTimeout(() => this.tone(base * 1.15, 0.08, 0.016 * proximity, 'sine', base * 0.9), 130);
        }
      }
    }

    this.nextInsect -= dt;
    if (this.nextInsect <= 0) {
      this.nextInsect = 0.6 + Math.random() * 2.5;
      if (day < 0.15 && w.rain < 0.3) {
        this.tone(2400 + Math.random() * 900, 0.06, 0.008 * proximity, 'triangle');
      }
    }

    this.nextCrackle -= dt;
    if (this.nextCrackle <= 0) {
      this.nextCrackle = 0.15 + Math.random() * 0.5;
      if (ws.flags['fogueira-acesa']) this.burst(0.06, 0.05 * proximity, 2600, 700);
    }
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    this.ctx?.resume().catch(() => undefined);
  }
}

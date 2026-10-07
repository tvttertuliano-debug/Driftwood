import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSeed } from '../src/core/rng.ts';
import { PERSIST } from '../src/core/config.ts';
import { genesis } from '../src/sim/genesis.ts';
import { createSimulation } from '../src/simulation.ts';
import { buildSave, loadWorld, REJECTED_KEY, saveProblem } from '../src/persist/save.ts';

describe('parseSeed', () => {
  it.each([
    ['123', 123],
    ['0', 0],
    ['4294967295', 4294967295],
    [771203, 771203],
  ])('aceita %s', (raw, seed) => expect(parseSeed(raw)).toBe(seed));

  it.each([null, undefined, '', '  ', 'abc', '1.5', '-3', '4294967296', NaN, 'Infinity'])(
    'recusa %s',
    (raw) => expect(parseSeed(raw)).toBeNull(),
  );
});

function validBlob() {
  const sim = createSimulation(771203);
  genesis(sim.world, sim.ws);
  return JSON.parse(JSON.stringify(buildSave(sim.world, sim.ws, 0)));
}

describe('saveProblem', () => {
  it('um save recém-feito serve', () => expect(saveProblem(validBlob())).toBeNull());

  it('recusa versão diferente, semente inválida, relógio ou mundo ausentes', () => {
    expect(saveProblem({ ...validBlob(), version: PERSIST.version + 1 })).toMatch(/versão/);
    expect(saveProblem({ ...validBlob(), seed: null })).toMatch(/semente/);
    expect(saveProblem({ ...validBlob(), minutes: undefined })).toMatch(/relógio/);
    expect(saveProblem({ ...validBlob(), ecs: undefined })).toMatch(/ecs/);
    expect(saveProblem('texto')).not.toBeNull();
  });
});

describe('loadWorld', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).window = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  it('carrega um save válido', async () => {
    store.set(PERSIST.key, JSON.stringify(validBlob()));
    const loaded = await loadWorld();
    expect(loaded?.blob.seed).toBe(771203);
    expect(store.has(REJECTED_KEY)).toBe(false);
  });

  it('guarda de lado, em vez de perder, um save que não pode usar', async () => {
    for (const raw of ['{isto não é json', JSON.stringify({ ...validBlob(), version: 999 })]) {
      store.clear();
      store.set(PERSIST.key, raw);
      expect(await loadWorld()).toBeNull();
      expect(store.get(REJECTED_KEY)).toBe(raw);
    }
  });
});

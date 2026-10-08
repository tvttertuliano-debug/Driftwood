/**
 * ECS mínimo e rápido (sparse-set), sem dependências.
 *
 * Regras da casa:
 *  - Componentes são dados puros. Nenhum método, nenhuma referência a render.
 *  - Sistemas são funções puras sobre o World + Context. Nenhum sistema conhece outro.
 *  - Comunicação entre sistemas acontece por eventos (core/events) ou por componentes.
 *  - A ordem de execução é dada por estágios, nunca por import order.
 */

export type Entity = number;

export interface ComponentType<T> {
  readonly id: number;
  readonly name: string;
  /** Fábrica usada na desserialização e por `world.add(e, Type)`. */
  readonly create: () => T;
  /** Se false, o componente não vai para o save (ex.: caches de render). */
  readonly persist: boolean;
}

let nextComponentId = 0;
const registry: ComponentType<any>[] = [];

export function defineComponent<T>(name: string, create: () => T, persist = true): ComponentType<T> {
  const type: ComponentType<T> = { id: nextComponentId++, name, create, persist };
  registry.push(type);
  return type;
}

export function componentRegistry(): readonly ComponentType<any>[] {
  return registry;
}

class Store<T> {
  /** entity -> índice denso (-1 quando ausente). */
  private sparse: Int32Array;
  readonly entities: number[] = [];
  readonly data: T[] = [];

  constructor(capacity: number) {
    this.sparse = new Int32Array(capacity).fill(-1);
  }

  ensure(capacity: number): void {
    if (capacity <= this.sparse.length) return;
    const next = new Int32Array(Math.max(capacity, this.sparse.length * 2)).fill(-1);
    next.set(this.sparse);
    this.sparse = next;
  }

  has(e: Entity): boolean {
    return e < this.sparse.length && this.sparse[e] >= 0;
  }

  get(e: Entity): T | undefined {
    const i = e < this.sparse.length ? this.sparse[e] : -1;
    return i >= 0 ? this.data[i] : undefined;
  }

  set(e: Entity, value: T): T {
    this.ensure(e + 1);
    const i = this.sparse[e];
    if (i >= 0) {
      this.data[i] = value;
      return value;
    }
    this.sparse[e] = this.data.length;
    this.entities.push(e);
    this.data.push(value);
    return value;
  }

  remove(e: Entity): void {
    if (!this.has(e)) return;
    const i = this.sparse[e];
    const last = this.data.length - 1;
    const lastEntity = this.entities[last];
    this.data[i] = this.data[last];
    this.entities[i] = lastEntity;
    this.sparse[lastEntity] = i;
    this.data.pop();
    this.entities.pop();
    this.sparse[e] = -1;
  }

  get size(): number {
    return this.data.length;
  }
}

export class World {
  private stores = new Map<number, Store<any>>();
  private alive: Uint8Array;
  private freeList: Entity[] = [];
  private nextEntity: Entity = 1; // 0 é reservado como "nenhum"
  private capacity: number;
  /** Marcadas para destruição no fim do frame — evita invalidar iterações. */
  private doomed: Entity[] = [];

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
  }

  private grow(needed: number): void {
    if (needed <= this.capacity) return;
    const cap = Math.max(needed, this.capacity * 2);
    const next = new Uint8Array(cap);
    next.set(this.alive);
    this.alive = next;
    this.capacity = cap;
  }

  create(): Entity {
    const e = this.freeList.pop() ?? this.nextEntity++;
    this.grow(e + 1);
    this.alive[e] = 1;
    return e;
  }

  isAlive(e: Entity): boolean {
    return e > 0 && e < this.capacity && this.alive[e] === 1;
  }

  /** Destruição adiada: segura até `flush()`. */
  destroy(e: Entity): void {
    if (!this.isAlive(e)) return;
    this.alive[e] = 2; // moribundo: ainda legível neste frame
    this.doomed.push(e);
  }

  flush(): void {
    if (this.doomed.length === 0) return;
    for (const e of this.doomed) {
      for (const store of this.stores.values()) store.remove(e);
      this.alive[e] = 0;
      this.freeList.push(e);
    }
    this.doomed.length = 0;
  }

  private store<T>(type: ComponentType<T>): Store<T> {
    let s = this.stores.get(type.id);
    if (!s) {
      s = new Store<T>(this.capacity);
      this.stores.set(type.id, s);
    }
    return s;
  }

  add<T>(e: Entity, type: ComponentType<T>, init?: Partial<T>): T {
    const value = type.create();
    if (init) Object.assign(value as object, init);
    return this.store(type).set(e, value);
  }

  put<T>(e: Entity, type: ComponentType<T>, value: T): T {
    return this.store(type).set(e, value);
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.store(type).get(e);
  }

  /** Igual a `get`, mas estoura se ausente — use quando a query já garantiu presença. */
  need<T>(e: Entity, type: ComponentType<T>): T {
    const v = this.store(type).get(e);
    if (v === undefined) throw new Error(`entidade ${e} sem componente ${type.name}`);
    return v;
  }

  has<T>(e: Entity, type: ComponentType<T>): boolean {
    return this.store(type).has(e);
  }

  remove<T>(e: Entity, type: ComponentType<T>): void {
    this.store(type).remove(e);
  }

  count<T>(type: ComponentType<T>): number {
    return this.store(type).size;
  }

  /** Itera entidades que possuem todos os componentes pedidos. */
  *query(...types: ComponentType<any>[]): Generator<Entity> {
    if (types.length === 0) return;
    let smallest = this.store(types[0]);
    for (let i = 1; i < types.length; i++) {
      const s = this.store(types[i]);
      if (s.size < smallest.size) smallest = s;
    }
    // Cópia defensiva: sistemas podem criar/destruir durante a iteração.
    const candidates = smallest.entities.slice();
    outer: for (const e of candidates) {
      if (this.alive[e] !== 1) continue;
      for (const t of types) {
        if (!this.store(t).has(e)) continue outer;
      }
      yield e;
    }
  }

  /** Primeira entidade que satisfaz a query (singletons: personagem, clima...). */
  first(...types: ComponentType<any>[]): Entity | null {
    for (const e of this.query(...types)) return e;
    return null;
  }

  entitiesWith<T>(type: ComponentType<T>): readonly Entity[] {
    return this.store(type).entities;
  }

  dataOf<T>(type: ComponentType<T>): readonly T[] {
    return this.store(type).data;
  }

  /** Snapshot serializável de todos os componentes marcados como persistentes. */
  serialize(): SerializedWorld {
    const out: SerializedWorld = { nextEntity: this.nextEntity, components: {} };
    for (const type of registry) {
      const s = this.stores.get(type.id);
      if (!s || !type.persist || s.size === 0) continue;
      out.components[type.name] = { e: s.entities.slice(), d: s.data.map((d) => structuredClone(d)) };
    }
    return out;
  }

  deserialize(snapshot: SerializedWorld): void {
    this.stores.clear();
    this.alive = new Uint8Array(Math.max(this.capacity, snapshot.nextEntity + 64));
    this.capacity = this.alive.length;
    this.freeList.length = 0;
    this.doomed.length = 0;
    this.nextEntity = snapshot.nextEntity;
    const byName = new Map(registry.map((t) => [t.name, t]));
    for (const [name, blob] of Object.entries(snapshot.components)) {
      const type = byName.get(name);
      if (!type) continue; // componente removido numa versão futura: ignora com elegância
      const s = this.store(type);
      for (let i = 0; i < blob.e.length; i++) {
        const e = blob.e[i];
        this.grow(e + 1);
        this.alive[e] = 1;
        // Preenche campos novos que não existiam no save antigo.
        s.set(e, Object.assign(type.create() as object, blob.d[i]));
      }
    }
  }

  get entityCount(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.alive[i] === 1) n++;
    return n;
  }
}

export interface SerializedWorld {
  nextEntity: number;
  components: Record<string, { e: number[]; d: any[] }>;
}

/** Estágios em ordem fixa de execução. */
export enum Stage {
  /** Relógio, estações, maré, clima. */
  Time = 0,
  /** Necessidades, decisão, memória. */
  Mind = 1,
  /** Execução de ações, movimento, trabalho. */
  Act = 2,
  /** Física leve: gravidade, boias, destroços, partículas. */
  Physics = 3,
  /** Ecologia: crescimento, erosão, migração. */
  Ecology = 4,
  /** Diretor narrativo e eventos raros. */
  Director = 5,
  // Áudio e persistência não são sistemas: rodam no laço de main.ts, por quadro
  // e por intervalo de tempo real, fora do passo fixo.
}

export interface SimContext {
  world: World;
  /** Passo fixo em segundos (tempo de simulação). */
  dt: number;
  /** Segundos simulados desde o início desta sessão. */
  elapsed: number;
  [key: string]: unknown;
}

export interface System<C extends SimContext = SimContext> {
  readonly name: string;
  readonly stage: Stage;
  /** Roda a cada N passos de simulação (1 = todo passo). Sistemas caros usam >1. */
  readonly every?: number;
  update(ctx: C): void;
}

export class Scheduler<C extends SimContext = SimContext> {
  private systems: System<C>[] = [];
  private tick = 0;
  /** Custo médio por sistema em ms — usado pelo orçamento de performance. */
  readonly cost = new Map<string, number>();

  add(...systems: System<C>[]): this {
    this.systems.push(...systems);
    this.systems.sort((a, b) => a.stage - b.stage);
    return this;
  }

  run(ctx: C, profile = false): void {
    this.tick++;
    for (const sys of this.systems) {
      const every = sys.every ?? 1;
      if (every > 1 && this.tick % every !== 0) continue;
      if (profile) {
        const t0 = performance.now();
        sys.update(ctx);
        const ms = performance.now() - t0;
        this.cost.set(sys.name, (this.cost.get(sys.name) ?? ms) * 0.9 + ms * 0.1);
      } else {
        sys.update(ctx);
      }
    }
    ctx.world.flush();
  }

  get names(): string[] {
    return this.systems.map((s) => s.name);
  }
}

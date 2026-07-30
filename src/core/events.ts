/**
 * Barramento de eventos com fila de frame. Sistemas publicam; qualquer sistema
 * posterior no mesmo passo lê. O que ninguém consome expira — de propósito.
 */

export interface GameEvent {
  type: string;
  /** Momento de simulação (segundos) em que ocorreu. */
  at: number;
  [key: string]: unknown;
}

export type Listener = (ev: GameEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private any = new Set<Listener>();
  private queue: GameEvent[] = [];
  private now = 0;

  setClock(seconds: number): void {
    this.now = seconds;
  }

  on(type: string, fn: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  onAny(fn: Listener): () => void {
    this.any.add(fn);
    return () => this.any.delete(fn);
  }

  emit(type: string, payload: Record<string, unknown> = {}): void {
    this.queue.push({ type, at: this.now, ...payload });
  }

  /** Entrega tudo que foi publicado. Eventos gerados durante a entrega vão para o próximo passo. */
  dispatch(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    for (const ev of batch) {
      const set = this.listeners.get(ev.type);
      if (set) for (const fn of set) fn(ev);
      for (const fn of this.any) fn(ev);
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}

// A tiny, strongly-typed publish/subscribe bus. Generic over an event map so
// every emit/on call is checked against the declared payload type. This is the
// decoupling backbone of the client: input, resource loading, the engine
// adapter, and the renderer never reference each other — they only meet here.

// A loose hint for "an object of event-name -> payload". Not used as a generic
// constraint: interfaces (like AppEvents) lack an implicit index signature, so
// constraining to Record<string, unknown> would reject them. We only need
// `keyof E` / `E[K]`, which work on any object type.
export type EventMap = Record<string, unknown>;

export type Listener<T> = (payload: T) => void;

export class EventBus<E> {
  private readonly handlers = new Map<keyof E, Set<Listener<unknown>>>();

  // Subscribe. Returns an unsubscribe function (the idiomatic teardown handle).
  on<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(listener as Listener<unknown>);
    return () => this.off(type, listener);
  }

  // Subscribe for a single emit, then auto-unsubscribe.
  once<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof E>(type: K, listener: Listener<E[K]>): void {
    this.handlers.get(type)?.delete(listener as Listener<unknown>);
  }

  // Emit to all current subscribers. The set is copied first so a listener may
  // safely unsubscribe (or subscribe) during dispatch.
  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const listener of [...set]) listener(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

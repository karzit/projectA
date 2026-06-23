// Owns the single application EventBus and bridges raw DOM input into typed
// `pointer:*` events. Everything else in the client subscribes here; nothing
// touches the DOM event API directly. Keeping the bus and the input binding in
// one place gives us one clean teardown (`destroy`) and one obvious place to add
// keyboard, touch, or gamepad later.

import { EventBus, type Listener } from './EventBus.js';
import type { AppEvents } from './events.js';

export class EventManager {
  readonly bus = new EventBus<AppEvents>();
  private target: HTMLElement | null = null;
  private cleanups: Array<() => void> = [];

  // --- bus delegation (so callers can use the manager directly) ---
  on<K extends keyof AppEvents>(type: K, listener: Listener<AppEvents[K]>): () => void {
    return this.bus.on(type, listener);
  }
  once<K extends keyof AppEvents>(type: K, listener: Listener<AppEvents[K]>): () => void {
    return this.bus.once(type, listener);
  }
  emit<K extends keyof AppEvents>(type: K, payload: AppEvents[K]): void {
    this.bus.emit(type, payload);
  }

  // Translate pointer events on `target` into local-coordinate `pointer:*`
  // events. Pointer events unify mouse/touch/pen, so one binding covers all.
  attachInput(target: HTMLElement): void {
    this.detachInput();
    this.target = target;

    const toLocal = (e: PointerEvent): { x: number; y: number } => {
      const r = target.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      target.setPointerCapture?.(e.pointerId);
      this.bus.emit('pointer:down', { ...toLocal(e), button: e.button });
    };
    const onMove = (e: PointerEvent) => this.bus.emit('pointer:move', toLocal(e));
    const onUp = (e: PointerEvent) => {
      this.bus.emit('pointer:up', { ...toLocal(e), button: e.button });
      target.releasePointerCapture?.(e.pointerId);
    };
    const onContext = (e: Event) => e.preventDefault(); // allow right-click as an input

    const add = (type: string, fn: (e: never) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener));
    };
    add('pointerdown', onDown);
    add('pointermove', onMove);
    add('pointerup', onUp);
    add('contextmenu', onContext);

    // Keyboard is global (window), not bound to the canvas.
    const onKey = (e: KeyboardEvent) => this.bus.emit('key:down', { code: e.code, key: e.key });
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
  }

  detachInput(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.target = null;
  }

  destroy(): void {
    this.detachInput();
    this.bus.clear();
  }
}

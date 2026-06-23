// Owns the canvas surface(s) and the render loop.
//
// Design choices that matter for an MTG-style board:
//  - **Layered canvases.** Separate stacked <canvas> elements (background,
//    cards, effects/overlay, HUD). Only layers marked dirty repaint, so a
//    hovering arrow on the overlay never forces the whole board to redraw.
//  - **HiDPI correctness.** Backing store is sized in device pixels
//    (css * devicePixelRatio); the context is pre-scaled so all drawing code
//    works in CSS pixels and stays crisp on retina displays.
//  - **Fixed-timestep update + free-running render.** Game/animation logic
//    advances in fixed steps (deterministic, frame-rate independent); rendering
//    happens once per animation frame. The renderer interpolates toward target
//    positions, which is where smooth card movement/tap animations live.

import type { EventBus } from './EventBus.js';
import type { AppEvents } from './events.js';

export type LayerRenderer = (ctx: CanvasRenderingContext2D, layer: Layer) => void;

export interface Layer {
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dirty: boolean;
  render: LayerRenderer | null;
}

export interface CanvasManagerOptions {
  /** Layer names from back (drawn first) to front (drawn last). */
  layers: string[];
  /** Fixed update step in ms (default ~60Hz). */
  fixedStepMs?: number;
  bus?: EventBus<AppEvents>;
}

export class CanvasManager {
  readonly width: number = 0;
  readonly height: number = 0;
  dpr: number = 1;

  private readonly container: HTMLElement;
  private readonly layers = new Map<string, Layer>();
  private readonly order: string[];
  private readonly fixedStepMs: number;
  private readonly bus?: EventBus<AppEvents>;

  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private updateFn: ((stepMs: number) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, opts: CanvasManagerOptions) {
    this.container = container;
    this.order = opts.layers;
    this.fixedStepMs = opts.fixedStepMs ?? 1000 / 60;
    this.bus = opts.bus;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative'; // anchor the absolutely-stacked canvases
    }

    this.order.forEach((name, i) => {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.zIndex = String(i);
      // The top-most layer receives input; lower layers are transparent to it.
      canvas.style.pointerEvents = i === this.order.length - 1 ? 'auto' : 'none';
      container.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      this.layers.set(name, { name, canvas, ctx, dirty: true, render: null });
    });

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  /** The canvas of the front layer — attach input listeners to this. */
  get inputSurface(): HTMLCanvasElement {
    return this.layer(this.order[this.order.length - 1]).canvas;
  }

  layer(name: string): Layer {
    const l = this.layers.get(name);
    if (!l) throw new Error(`Unknown layer: ${name}`);
    return l;
  }

  /** Register the paint function for a layer and mark it dirty. */
  setRenderer(name: string, render: LayerRenderer): void {
    const l = this.layer(name);
    l.render = render;
    l.dirty = true;
  }

  markDirty(name: string): void {
    this.layer(name).dirty = true;
  }

  markAllDirty(): void {
    for (const l of this.layers.values()) l.dirty = true;
  }

  /** Recompute backing-store size for the current container size and DPI. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.container.clientWidth;
    const cssH = this.container.clientHeight;
    (this as { width: number }).width = cssW;
    (this as { height: number }).height = cssH;
    this.dpr = dpr;

    for (const l of this.layers.values()) {
      l.canvas.width = Math.max(1, Math.round(cssW * dpr));
      l.canvas.height = Math.max(1, Math.round(cssH * dpr));
      l.canvas.style.width = `${cssW}px`;
      l.canvas.style.height = `${cssH}px`;
      l.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
      l.dirty = true;
    }
    this.bus?.emit('viewport:resize', { width: cssW, height: cssH, dpr });
  }

  /** Start the loop. `update` runs in fixed steps; layers paint when dirty. */
  start(update?: (stepMs: number) => void): void {
    if (this.running) return;
    this.updateFn = update ?? null;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    let delta = now - this.lastTime;
    this.lastTime = now;
    if (delta > 250) delta = 250; // clamp after tab-switch / GC pauses

    if (this.updateFn) {
      this.accumulator += delta;
      while (this.accumulator >= this.fixedStepMs) {
        this.updateFn(this.fixedStepMs);
        this.accumulator -= this.fixedStepMs;
      }
    }

    for (const name of this.order) {
      const l = this.layers.get(name)!;
      if (l.dirty && l.render) {
        l.ctx.clearRect(0, 0, this.width, this.height);
        l.render(l.ctx, l);
        l.dirty = false;
      }
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const l of this.layers.values()) l.canvas.remove();
    this.layers.clear();
  }
}

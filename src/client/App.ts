// Composition root. Wires managers + renderer + interaction + DOM UI to the
// engine. The ONLY place that knows about all the pieces; they communicate
// through the EventManager bus.
//
// One-way data flow, end to end:
//
//   input → EventManager(pointer/key) → InteractionLayer → emit 'intent' (Action)
//   UI buttons (HUD) ──────────────────────────────────→ emit 'intent' (Action)
//   'intent' → App.applyIntent → reduce(state, action)
//           → emit each 'engine:event' (for renderer/log) + 'state:changed' (for HUD)
//           → mark layers dirty
//   render loop → BoardRenderer repaints board; overlay repaints interaction view
//
// `reduce` here stands in for "send to the authoritative server, await the
// redacted result". Swapping it for a WebSocket transport touches only this file.

import { CanvasManager, EventManager, ResourceManager } from './core/index.js';
import type { ResourceManifest } from './core/index.js';
import { BoardRenderer } from './render/BoardRenderer.js';
import { CardSprite } from './render/CardSprite.js';
import { Animator } from './render/Animator.js';
import { InteractionLayer } from './input/InteractionLayer.js';
import { UIRoot } from './ui/UIRoot.js';
import { UI } from './render/theme.js';
import { deckById } from './decks.js';
import { createGame, reduce } from './../engine/index.js';
import type { Action, GameEvent, GameState, PlayerId } from './../engine/index.js';

const LAYERS = ['background', 'board', 'overlay', 'fx'] as const;

export interface AppOptions {
  container: HTMLElement;
  manifest?: ResourceManifest;
  seed?: number;
  localPlayer?: PlayerId;
}

export class App {
  readonly events = new EventManager();
  readonly resources: ResourceManager;
  readonly canvas: CanvasManager;
  readonly ui: UIRoot;

  private readonly sprites = new CardSprite();
  private readonly animator = new Animator();
  private readonly local: PlayerId;
  private state: GameState;
  private readonly board: BoardRenderer;
  private readonly interaction: InteractionLayer;
  private matchActive = false;

  constructor(private readonly opts: AppOptions) {
    this.local = opts.localPlayer ?? 'P0';
    this.resources = new ResourceManager(this.events.bus);
    this.canvas = new CanvasManager(opts.container, { layers: [...LAYERS], bus: this.events.bus });

    // A default game exists so renderers always have something to draw behind
    // the menu; startMatch replaces it with the chosen decks.
    this.state = createGame({ seed: opts.seed, decks: { P0: deckById('gruul').cards, P1: deckById('boros').cards } });

    this.ui = new UIRoot(opts.container, { events: this.events, getState: () => this.state, local: this.local });

    this.board = new BoardRenderer(this.sprites, () => this.state, this.local, this.animator);
    this.interaction = new InteractionLayer({
      events: this.events,
      getState: () => this.state,
      getViewport: () => ({ width: this.canvas.width, height: this.canvas.height }),
      sprites: this.sprites,
      localPlayer: this.local,
      onChange: () => this.canvas.markDirty('overlay'),
    });

    this.events.on('intent', (action) => this.applyIntent(action));
    this.events.on('engine:event', (ev) => this.spawnEventFx(ev));
    this.events.on('viewport:resize', () => this.canvas.markAllDirty());
    this.events.on('error', (e) => console.warn('rejected intent:', e.message));

    this.installRenderers();
    this.interaction.attach();
    this.events.attachInput(this.canvas.inputSurface);
  }

  async start(): Promise<void> {
    this.ui.overlay.showLoading();
    await this.resources.loadAll(this.opts.manifest ?? {});

    // Fixed-step loop: ease every card toward its layout target, then keep the
    // animated layers dirty only while motion is in flight (so the loop idles
    // when the board is at rest).
    this.canvas.start((dt) => {
      const { targets, descs } = this.board.buildVisuals(this.canvas.width, this.canvas.height);
      this.animator.update(dt, targets, descs);
      if (this.animator.isAnimating()) {
        this.canvas.markDirty('board');
        this.canvas.markDirty('fx');
      }
    });
    this.showMenu();
  }

  private showMenu(): void {
    this.matchActive = false;
    this.ui.overlay.showMenu((myDeckId, oppDeckId) => this.startMatch(myDeckId, oppDeckId));
  }

  private startMatch(myDeckId: string, oppDeckId: string): void {
    const decks = {
      [this.local]: deckById(myDeckId).cards,
      [this.local === 'P0' ? 'P1' : 'P0']: deckById(oppDeckId).cards,
    } as Record<PlayerId, string[]>;
    this.state = createGame({ seed: this.opts.seed, decks });
    this.matchActive = true;
    this.animator.reset();
    this.ui.log.clear();
    this.ui.overlay.hide();
    this.canvas.markAllDirty();
    this.events.emit('state:changed', { state: this.state });
  }

  /** The seam: apply an action via the engine (later: the server), then fan out
   *  results for the renderer (engine:event) and the HUD (state:changed). */
  private applyIntent(action: Action): void {
    if (!this.matchActive) return; // ignore input while a screen is up
    const result = reduce(this.state, action);
    if (result.error) {
      this.events.emit('error', { message: result.error });
      return;
    }
    this.state = result.state;
    for (const ev of result.events) this.events.emit('engine:event', ev);
    this.events.emit('state:changed', { state: this.state });
    this.canvas.markDirty('board');
    this.canvas.markDirty('overlay');

    if (this.state.gameOver) {
      this.matchActive = false;
      this.ui.overlay.showGameOver(this.state.winner ? `${this.state.winner} wins` : 'Draw', () => this.showMenu());
    }
  }

  private installRenderers(): void {
    this.canvas.setRenderer('background', (ctx) => {
      ctx.fillStyle = UI.bg;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    });
    this.canvas.setRenderer('board', (ctx) => this.board.draw(ctx, this.canvas.width, this.canvas.height));
    this.canvas.setRenderer('overlay', (ctx) => this.interaction.renderOverlay(ctx, this.canvas.width, this.canvas.height));
    this.canvas.setRenderer('fx', (ctx) => this.animator.drawFx(ctx));
  }

  // Translate notable engine events into floating numbers (damage in red,
  // lifegain in green), anchored at the affected card or player.
  private spawnEventFx(ev: GameEvent): void {
    if (!this.matchActive) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (ev.type === 'damage') {
      const pos =
        ev.target.kind === 'player'
          ? this.playerAnchor(ev.target.player, w, h)
          : this.cardCenter(ev.target.instanceId, w, h);
      if (pos) this.animator.spawnFloatingText(pos.x, pos.y, `-${ev.amount}`, '#ff6b5e');
      this.canvas.markDirty('fx');
    } else if (ev.type === 'life' && ev.delta > 0) {
      const a = this.playerAnchor(ev.player, w, h);
      this.animator.spawnFloatingText(a.x, a.y, `+${ev.delta}`, '#7be08a');
      this.canvas.markDirty('fx');
    }
  }

  private cardCenter(instanceId: string, w: number, h: number): { x: number; y: number } | null {
    const cv = this.board.computeLayout(w, h).cards.find((c) => c.instanceId === instanceId);
    return cv ? { x: cv.x + cv.w / 2, y: cv.y + cv.h / 2 } : null;
  }

  private playerAnchor(player: PlayerId, w: number, h: number): { x: number; y: number } {
    return { x: w / 2, y: player === this.local ? h - 70 : 60 };
  }

  getState(): GameState {
    return this.state;
  }

  destroy(): void {
    this.interaction.detach();
    this.ui.destroy();
    this.canvas.destroy();
    this.events.destroy();
  }
}

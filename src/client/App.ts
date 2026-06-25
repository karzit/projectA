// Composition root. Wires managers + renderer + interaction + DOM UI to the
// rules engine. The ONLY place that knows about all the pieces; they communicate
// through the EventManager bus.
//
// One-way data flow:
//   input → EventManager(intent) → App.applyIntent → game.apply(action)
//        → state:changed (HUD update) + markDirty (renderer)

import { CanvasManager, EventManager, ResourceManager } from './core/index.js';
import type { ResourceManifest } from './core/index.js';
import { BoardRenderer } from './render/BoardRenderer.js';
import { CardSprite } from './render/CardSprite.js';
import { Animator } from './render/Animator.js';
import { InteractionLayer } from './input/InteractionLayer.js';
import { UIRoot } from './ui/UIRoot.js';
import { UI } from './render/theme.js';
import { deckById } from './decks.js';
import { Game, getDef } from '../rules/index.js';
import type { RulesAction, GameState, PlayerId } from '../rules/index.js';

const LAYERS = ['background', 'board', 'overlay'] as const;

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
  private game: Game;
  private readonly board: BoardRenderer;
  private readonly interaction: InteractionLayer;
  private matchActive = false;

  constructor(private readonly opts: AppOptions) {
    this.local = opts.localPlayer ?? 'A';
    this.resources = new ResourceManager(this.events.bus);
    this.canvas = new CanvasManager(opts.container, { layers: [...LAYERS], bus: this.events.bus });

    // Default game so renderers have something to draw behind the menu.
    this.game = new Game({ decks: { A: deckById('monkey').cards, B: deckById('basic').cards }, seed: opts.seed });

    this.ui = new UIRoot(opts.container, {
      events: this.events,
      getState: () => this.game.state,
      local: this.local,
    });

    this.board = new BoardRenderer(this.sprites, () => this.game.state, this.local, this.animator);
    this.interaction = new InteractionLayer({
      events: this.events,
      getState: () => this.game.state,
      getViewport: () => ({ width: this.canvas.width, height: this.canvas.height }),
      sprites: this.sprites,
      localPlayer: this.local,
      onChange: () => this.canvas.markDirty('overlay'),
      container: opts.container,
    });

    this.events.on('intent', (action) => this.applyIntent(action as RulesAction));
    this.events.on('viewport:resize', () => this.canvas.markAllDirty());
    this.events.on('error', (e) => console.warn('거부된 액션:', e.message));

    this.installRenderers();
    this.interaction.attach();
    this.events.attachInput(this.canvas.inputSurface);
  }

  async start(): Promise<void> {
    this.ui.overlay.showLoading();
    await this.resources.loadAll(this.opts.manifest ?? {});

    this.canvas.start((dt) => {
      const { targets, descs } = this.board.buildVisuals(this.canvas.width, this.canvas.height);
      this.animator.update(dt, targets, descs);
      if (this.animator.isAnimating()) {
        this.canvas.markDirty('board');
      }
    });

    this.showMenu();
  }

  private showMenu(): void {
    this.matchActive = false;
    this.ui.overlay.showMenu((myDeckId, oppDeckId) => this.startMatch(myDeckId, oppDeckId));
  }

  private startMatch(myDeckId: string, oppDeckId: string): void {
    const opp: PlayerId = this.local === 'A' ? 'B' : 'A';
    const decks = {
      [this.local]: deckById(myDeckId).cards,
      [opp]: deckById(oppDeckId).cards,
    } as Record<PlayerId, string[]>;
    this.game = new Game({ decks, seed: this.opts.seed });
    this.matchActive = true;
    this.animator.reset();
    this.ui.log.clear();
    this.ui.overlay.hide();
    this.canvas.markAllDirty();
    this.events.emit('state:changed', { state: this.game.state });
  }

  private applyIntent(action: RulesAction): void {
    if (!this.matchActive) return;
    const result = this.game.apply(action);
    if (result.error) {
      this.events.emit('error', { message: result.error });
      this.ui.log.push(`오류: ${result.error}`, 'k-damage');
      return;
    }
    this.logAction(action, result.state);
    this.events.emit('state:changed', { state: result.state });
    this.canvas.markDirty('board');
    this.canvas.markDirty('overlay');

    if (result.state.loser) {
      this.matchActive = false;
      const loser = result.state.loser;
      const text = loser === this.local ? '패배했습니다' : '승리했습니다!';
      this.ui.overlay.showGameOver(text, () => this.showMenu());
    }
  }

  private logAction(action: RulesAction, state: GameState): void {
    switch (action.type) {
      case 'placeOpening': {
        const cardName = this.cardName(action.cardId);
        this.ui.log.push(`[오프닝] ${action.player}: ${cardName} 배치`);
        break;
      }
      case 'finishOpening':
        this.ui.log.push(`[오프닝] ${action.player}: 배치 완료`);
        if (state.phase === 'main') this.ui.log.push('— 메인 페이즈 시작 (A 선턴) —', 'k-step');
        break;
      case 'play': {
        const cardName = this.cardName(action.cardId);
        this.ui.log.push(`[${action.player}] ${cardName} 사용`, 'k-cast');
        break;
      }
      case 'attack': {
        const atk = state.units[action.attackerId];
        const atName = atk ? this.cardName(atk.cardId) : '?';
        const def = state.units[action.targetId];
        const defName = def ? this.cardName(def.cardId) : '(파괴됨)';
        const atkDead = !state.units[action.attackerId];
        const defDead = !state.units[action.targetId];
        const result = atkDead && defDead ? '상호 파괴' : defDead ? '수비 파괴' : atkDead ? '공격자 파괴' : '방어 성공';
        this.ui.log.push(`[${action.player}] ${atName} → ${defName}: ${result}`, 'k-damage');
        break;
      }
      case 'pass':
        this.ui.log.push(`— ${action.player} 패스 → ${state.active} 턴 —`, 'k-step');
        break;
    }
  }

  private cardName(cardId: string): string {
    try { return getDef(cardId).name; } catch { return cardId; }
  }

  private installRenderers(): void {
    this.canvas.setRenderer('background', (ctx) => {
      ctx.fillStyle = UI.bg;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    });
    this.canvas.setRenderer('board', (ctx) => this.board.draw(ctx, this.canvas.width, this.canvas.height));
    this.canvas.setRenderer('overlay', (ctx) => this.interaction.renderOverlay(ctx, this.canvas.width, this.canvas.height));
  }

  getState(): GameState {
    return this.game.state;
  }

  destroy(): void {
    this.interaction.detach();
    this.ui.destroy();
    this.canvas.destroy();
    this.events.destroy();
  }
}

// Turns pointer/keyboard input into engine intents. It is a small state machine
// over the shared layout — it hit-tests exactly what the renderer drew, so
// clicks always land on the card you see.
//
// It NEVER mutates game state. Every decision becomes an `intent` (an engine
// Action) emitted on the bus; the engine/server is the sole authority and may
// reject it (surfaced as an `error` event). The layer also exposes a tiny `view`
// (hover / drag ghost / target arrow) that the overlay renderer paints.
//
// Supported gestures (a deliberately small but complete vertical slice):
//   - click a land in hand            → playLand
//   - click your untapped land        → tapForMana
//   - click/drag a spell from hand    → castSpell (no target), or enter targeting
//   - targeting: click a creature/player to choose the target (Esc/right-click cancels)
//   - Space                           → pass priority, or declare empty attackers/blockers

import { getDef } from '../../engine/index.js';
import type { Action, GameState, PlayerId, TargetRef } from '../../engine/index.js';
import { nextPriorityAction } from './commands.js';
import { CardSprite } from '../render/CardSprite.js';
import { layout, hitTestCard, pointInRect, type BoardLayout, type CardView, type Rect } from '../render/layout.js';
import { UI } from '../render/theme.js';
import type { EventManager } from '../core/EventManager.js';

const DRAG_THRESHOLD = 6;

type Mode = 'idle' | 'drag' | 'targeting';

interface ViewState {
  hoverId?: string;
  drag?: { cv: CardView; x: number; y: number };
  targeting?: { sourceId: string; sx: number; sy: number; x: number; y: number };
}

export interface InteractionDeps {
  events: EventManager;
  getState: () => GameState;
  getViewport: () => { width: number; height: number };
  sprites: CardSprite;
  localPlayer: PlayerId;
  onChange: () => void; // ask the host to repaint the overlay layer
}

export class InteractionLayer {
  readonly view: ViewState = {};
  private mode: Mode = 'idle';
  private pressed?: { cv: CardView; x: number; y: number; moved: boolean };
  private unsubs: Array<() => void> = [];

  constructor(private readonly deps: InteractionDeps) {}

  attach(): void {
    const { events } = this.deps;
    this.unsubs.push(
      events.on('pointer:down', (p) => this.onDown(p.x, p.y, p.button)),
      events.on('pointer:move', (p) => this.onMove(p.x, p.y)),
      events.on('pointer:up', (p) => this.onUp(p.x, p.y)),
      events.on('key:down', (k) => this.onKey(k.code)),
    );
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private lo(): BoardLayout {
    return layout(this.deps.getState(), this.deps.getViewport(), this.deps.localPlayer);
  }

  private changed(): void {
    this.deps.onChange();
  }

  private emit(action: Action): void {
    this.deps.events.emit('intent', action);
  }

  // --- pointer ---------------------------------------------------------------

  private onDown(x: number, y: number, button: number): void {
    const lo = this.lo();

    if (this.mode === 'targeting') {
      if (button === 2) return this.cancelTargeting();
      const card = hitTestCard(lo, x, y);
      if (card && getDef(card.oracleId).types.includes('creature')) {
        this.completeTarget({ kind: 'permanent', instanceId: card.instanceId });
      } else {
        const player = this.regionPlayer(lo, x, y);
        if (player) this.completeTarget({ kind: 'player', player });
        else this.cancelTargeting();
      }
      return;
    }

    const card = hitTestCard(lo, x, y);
    this.pressed = card ? { cv: card, x, y, moved: false } : undefined;
  }

  private onMove(x: number, y: number): void {
    if (this.mode === 'targeting' && this.view.targeting) {
      this.view.targeting.x = x;
      this.view.targeting.y = y;
      this.changed();
      return;
    }
    if (this.mode === 'drag' && this.view.drag) {
      this.view.drag.x = x;
      this.view.drag.y = y;
      this.changed();
      return;
    }
    if (this.pressed) {
      if (Math.hypot(x - this.pressed.x, y - this.pressed.y) > DRAG_THRESHOLD) {
        this.pressed.moved = true;
        const cv = this.pressed.cv;
        if (cv.zone === 'hand' && cv.controller === this.deps.localPlayer) {
          this.mode = 'drag';
          this.view.drag = { cv, x, y };
          this.view.hoverId = undefined;
          this.changed();
        }
      }
      return;
    }
    // hover feedback
    const id = hitTestCard(this.lo(), x, y)?.instanceId;
    if (id !== this.view.hoverId) {
      this.view.hoverId = id;
      this.changed();
    }
  }

  private onUp(x: number, y: number): void {
    if (this.mode === 'drag' && this.view.drag) {
      const cv = this.view.drag.cv;
      const overZone = pointInRect(this.playArea(this.lo()), x, y);
      this.mode = 'idle';
      this.view.drag = undefined;
      this.changed();
      // Only play/cast when dropped onto the play area; otherwise the card
      // eases back to the hand (state is unchanged).
      if (overZone) this.playOrCast(cv);
      return;
    }
    if (this.pressed && !this.pressed.moved) {
      const cv = this.pressed.cv;
      this.pressed = undefined;
      this.clickCard(cv);
      return;
    }
    this.pressed = undefined;
  }

  private onKey(code: string): void {
    if (code === 'Escape') {
      if (this.mode === 'targeting') this.cancelTargeting();
      if (this.mode === 'drag') {
        this.mode = 'idle';
        this.view.drag = undefined;
        this.changed();
      }
      return;
    }
    if (code === 'Space') {
      const action = nextPriorityAction(this.deps.getState());
      if (action) this.emit(action);
    }
  }

  // --- decisions -------------------------------------------------------------

  private clickCard(cv: CardView): void {
    const local = this.deps.localPlayer;
    const def = getDef(cv.oracleId);
    if (cv.zone === 'battlefield' && cv.controller === local) {
      const inst = this.deps.getState().cards[cv.instanceId];
      if (def.produces && !inst.tapped) {
        this.emit({ type: 'tapForMana', player: local, instanceId: cv.instanceId });
      }
      return;
    }
    if (cv.zone === 'hand' && cv.controller === local) this.playOrCast(cv);
  }

  private playOrCast(cv: CardView): void {
    const local = this.deps.localPlayer;
    if (cv.controller !== local || cv.zone !== 'hand') return;
    const def = getDef(cv.oracleId);

    if (def.types.includes('land')) {
      this.emit({ type: 'playLand', player: local, instanceId: cv.instanceId });
      return;
    }
    const needTargets = (def.targets ?? []).length > 0;
    if (needTargets) {
      const src = this.lo().cards.find((c) => c.instanceId === cv.instanceId);
      const sx = src ? src.x + src.w / 2 : 0;
      const sy = src ? src.y + src.h / 2 : 0;
      this.mode = 'targeting';
      this.view.targeting = { sourceId: cv.instanceId, sx, sy, x: sx, y: sy };
      this.changed();
    } else {
      this.emit({ type: 'castSpell', player: local, instanceId: cv.instanceId, targets: [] });
    }
  }

  private completeTarget(ref: TargetRef): void {
    const t = this.view.targeting;
    if (!t) return;
    this.emit({ type: 'castSpell', player: this.deps.localPlayer, instanceId: t.sourceId, targets: [ref] });
    this.mode = 'idle';
    this.view.targeting = undefined;
    this.changed();
  }

  private cancelTargeting(): void {
    this.mode = 'idle';
    this.view.targeting = undefined;
    this.changed();
  }

  // The local player's "play space": the band from just above the battlefield
  // down to just above the hand. Dropping a hand card here plays/casts it.
  private playArea(lo: BoardLayout): Rect {
    const field = lo.regions.p0Field;
    const hand = lo.regions.p0Hand;
    const top = field.y - 12;
    const bottom = hand.y - 12;
    return { x: 8, y: top, w: field.w - 16, h: Math.max(field.h, bottom - top) };
  }

  private regionPlayer(lo: BoardLayout, x: number, y: number): PlayerId | null {
    const opp: PlayerId = this.deps.localPlayer === 'P0' ? 'P1' : 'P0';
    if (pointInRect(lo.regions.p1Hand, x, y) || pointInRect(lo.regions.p1Field, x, y)) return opp;
    if (pointInRect(lo.regions.p0Hand, x, y) || pointInRect(lo.regions.p0Field, x, y)) return this.deps.localPlayer;
    return null;
  }

  // --- overlay rendering -----------------------------------------------------

  renderOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const lo = layout(this.deps.getState(), { width: w, height: h }, this.deps.localPlayer);

    if (this.view.hoverId && this.mode === 'idle') {
      const cv = lo.cards.find((c) => c.instanceId === this.view.hoverId);
      if (cv) {
        ctx.strokeStyle = UI.hover;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(cv.x - 2, cv.y - 2, cv.w + 4, cv.h + 4, 10);
        ctx.stroke();
      }
    }

    if (this.view.targeting) {
      this.drawArrow(ctx, this.view.targeting.sx, this.view.targeting.sy, this.view.targeting.x, this.view.targeting.y);
    }

    if (this.view.drag) {
      // Highlight the drop zone; brighten it while the pointer is over it.
      const area = this.playArea(lo);
      const active = pointInRect(area, this.view.drag.x, this.view.drag.y);
      this.drawDropZone(ctx, area, active);

      const sprite = this.deps.sprites.get(this.view.drag.cv.oracleId, true);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sprite, this.view.drag.x - this.view.drag.cv.w / 2, this.view.drag.y - this.view.drag.cv.h / 2, this.view.drag.cv.w, this.view.drag.cv.h);
      ctx.globalAlpha = 1;
    }
  }

  private drawDropZone(ctx: CanvasRenderingContext2D, r: Rect, active: boolean): void {
    ctx.save();
    ctx.fillStyle = active ? UI.dropFillActive : UI.dropFill;
    ctx.strokeStyle = UI.drop;
    ctx.lineWidth = active ? 3 : 2;
    ctx.setLineDash(active ? [] : [8, 6]);
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
    ctx.strokeStyle = UI.arrow;
    ctx.fillStyle = UI.arrow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    const s = 12;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - s * Math.cos(a - 0.4), y2 - s * Math.sin(a - 0.4));
    ctx.lineTo(x2 - s * Math.cos(a + 0.4), y2 - s * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  }
}

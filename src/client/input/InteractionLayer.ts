// Pointer/keyboard input → RulesActions.
//
// Modes:
//   idle         – hover; double-click or drag hand card → play/placeOpening;
//                  single-click own field unit → attackPending
//   attackPending – single-click enemy unit → attack; Esc/right-click → idle
//   dragging     – dragging a hand card; drop on field area → play/placeOpening
//
// Rendering and the DOM hover/zoom panel are delegated to InteractionOverlay
// and CardHoverPanel respectively — this file owns only the pointer/keyboard
// state machine and turns input into RulesAction intents.

import type { RulesAction, GameState, PlayerId, ChoiceRequest, ReactionRequest } from '../../rules/index.js';
import { canAttack, GRID_SIZE } from '../../rules/index.js';
import { nextPassAction } from './commands.js';
import { CardSprite } from '../render/CardSprite.js';
import { layout, hexCellRects, hitTestCard, pointInRect, type BoardLayout, type CardView } from '../render/layout.js';
import type { EventManager } from '../core/EventManager.js';
import { CardHoverPanel, type InteractionMode } from './CardHoverPanel.js';
import { InteractionOverlay, type OverlayView } from './InteractionOverlay.js';

export type { InteractionMode } from './CardHoverPanel.js';

export interface InteractionDeps {
  events: EventManager;
  getState: () => GameState;
  getViewport: () => { width: number; height: number };
  sprites: CardSprite;
  localPlayer: PlayerId;
  onChange: () => void;
  container: HTMLElement;
}

const DRAG_THRESHOLD = 6;
const DBLCLICK_MS = 300;

export class InteractionLayer {
  readonly view: OverlayView = {};
  private mode: InteractionMode = 'idle';
  private unsubs: Array<() => void> = [];

  private lastClickKey?: string;
  private lastClickTime = 0;
  private pressed?: { cv: CardView; x: number; y: number; moved: boolean };

  private readonly hoverPanel: CardHoverPanel;
  private readonly overlay: InteractionOverlay;

  constructor(private readonly deps: InteractionDeps) {
    this.hoverPanel = new CardHoverPanel({
      container: deps.container,
      sprites: deps.sprites,
      getState: deps.getState,
      localPlayer: deps.localPlayer,
      getViewport: deps.getViewport,
      getLayout: () => this.lo(),
      getMode: () => this.mode,
    });
    this.overlay = new InteractionOverlay({
      getState: deps.getState,
      getViewport: deps.getViewport,
      sprites: deps.sprites,
      localPlayer: deps.localPlayer,
    });
  }

  attach(): void {
    const { events } = this.deps;
    this.unsubs.push(
      events.on('pointer:down', (p) => this.onDown(p.x, p.y, p.button)),
      events.on('pointer:move', (p) => this.onMove(p.x, p.y)),
      events.on('pointer:up', (p) => this.onUp(p.x, p.y)),
      events.on('key:down', (k) => this.onKey(k.code)),
      events.on('choice:request', (p) => this.beginChoosing(p.request, p.action)),
    );
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.pressed = undefined;
    this.hoverPanel.hideAll();
  }

  // 방어/대상 선택 같은 모달 오버레이가 떠 있는지 — 배너 등과 겹치지 않게 App이 참조.
  isSelecting(): boolean {
    return this.mode === 'blockSelect' || this.mode === 'choosing' || this.mode === 'cunningReact';
  }

  renderOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.overlay.render(ctx, w, h, this.mode, this.view);
  }

  private lo(): BoardLayout {
    return layout(this.deps.getState(), this.deps.getViewport(), this.deps.localPlayer);
  }

  private changed(): void { this.deps.onChange(); }
  private emit(action: RulesAction): void { this.deps.events.emit('intent', action); }
  private get local(): PlayerId { return this.deps.localPlayer; }

  // --- pointer ---------------------------------------------------------------

  private onDown(x: number, y: number, button: number): void {
    const state = this.deps.getState();
    if (state.loser) return;
    if (button === 2) { this.cancel(); return; }
    const lo = this.lo();
    const card = hitTestCard(lo, x, y);
    this.pressed = card ? { cv: card, x, y, moved: false } : undefined;
    if (!card && this.mode === 'attackPending') this.cancel();
  }

  private onMove(x: number, y: number): void {
    if (this.mode === 'choosing') return; // no hover/drag while picking targets
    if (this.mode !== 'dragging') {
      const lo = this.lo();
      const card = hitTestCard(lo, x, y);
      const prev = this.view.hoverId;
      this.view.hoverId = card?.key;
      if (this.view.hoverId !== prev) {
        this.hoverPanel.cancelShow();
        if (this.view.hoverId) {
          const cv = lo.cards.find((c) => c.key === this.view.hoverId);
          if (cv?.faceUp) {
            // 카드 위에 ~1초 머무른 뒤에야 정보 패널을 띄운다. 카드 간 이동 시
            // 기존 패널은 즉시 닫고 새 카드의 dwell 타이머를 다시 시작한다.
            this.hoverPanel.hideAll();
            this.hoverPanel.scheduleShow(cv);
          } else {
            this.hoverPanel.scheduleHide();
          }
        } else {
          // Delayed so moving the cursor off the card onto the panel doesn't
          // immediately tear it down; entering any panel cancels the timer.
          this.hoverPanel.scheduleHide();
        }
        this.changed();
      }
    }

    if (this.pressed && !this.pressed.moved) {
      if (Math.hypot(x - this.pressed.x, y - this.pressed.y) > DRAG_THRESHOLD) {
        const cv = this.pressed.cv;
        const state = this.deps.getState();
        if (cv.zone === 'hand' && cv.controller === this.local) {
          const canDrag = state.phase === 'opening'
            ? !state.openingDone[this.local]
            : state.active === this.local;
          if (canDrag) {
            this.pressed.moved = true;
            this.mode = 'dragging';
            this.view.drag = { cv, x, y };
            this.view.hoverId = undefined;
            this.hoverPanel.hideAll();
            this.changed();
          }
        } else {
          this.pressed.moved = true;
        }
      }
    }

    if (this.mode === 'dragging' && this.view.drag) {
      this.view.drag.x = x;
      this.view.drag.y = y;
      this.changed();
    }
  }

  private onUp(x: number, y: number): void {
    const state = this.deps.getState();
    if (state.loser) { this.pressed = undefined; return; }

    // 협공 수비 선택은 상대 턴(state.active !== local) 중에 일어나므로
    // 아래의 active-turn 체크보다 먼저 처리해야 한다.
    if (this.mode === 'blockSelect' && this.view.blocking) {
      this.handleBlockSelectUp(x, y);
      this.pressed = undefined;
      return;
    }

    // 지략 반응 선택도 상대 턴 중 일어날 수 있으므로 active-turn 체크보다 먼저 처리.
    if (this.mode === 'cunningReact' && this.view.cunning) {
      this.handleCunningReactUp(x, y);
      this.pressed = undefined;
      return;
    }

    if (this.mode === 'dragging') {
      this.handleDrop(x, y, state);
      this.mode = 'idle';
      this.view.drag = undefined;
      this.pressed = undefined;
      this.changed();
      return;
    }

    if (!this.pressed || this.pressed.moved) { this.pressed = undefined; return; }
    const cv = this.pressed.cv;
    this.pressed = undefined;

    if (this.mode === 'choosing') { this.handleChoicePick(cv); return; }

    if (state.phase === 'opening') {
      this.handleOpeningClick(cv, state);
      return;
    }

    if (state.active !== this.local) return;

    if (cv.zone === 'hand' && cv.controller === this.local) {
      const now = Date.now();
      if (this.lastClickKey === cv.key && now - this.lastClickTime < DBLCLICK_MS) {
        this.lastClickKey = undefined;
        this.emit({ type: 'play', player: this.local, cardId: cv.cardId });
      } else {
        this.lastClickKey = cv.key;
        this.lastClickTime = now;
      }
      return;
    }

    if (cv.zone === 'field') {
      if (cv.controller === this.local) {
        if (cv.instanceId && canAttack(state, cv.instanceId)) {
          if (this.mode === 'attackPending' && this.view.attackerId === cv.instanceId) {
            this.cancel();
          } else {
            this.mode = 'attackPending';
            this.view.attackerId = cv.instanceId;
            this.changed();
          }
        }
      } else if (this.mode === 'attackPending' && this.view.attackerId && cv.instanceId) {
        this.emit({ type: 'attack', player: this.local, attackerId: this.view.attackerId, targetId: cv.instanceId });
        this.cancel();
      }
    }
  }

  // 협공 수비 모드 클릭: 확정 버튼 → 확정, 협공 가능 유닛 → 토글.
  private handleBlockSelectUp(x: number, y: number): void {
    const bl = this.view.blocking;
    if (!bl) return;
    // 확정 버튼 히트테스트 우선
    const confirmRect = this.overlay.blockConfirmRect;
    if (confirmRect && pointInRect(confirmRect, x, y)) {
      this.confirmBlockers();
      return;
    }
    // 협공 가능 유닛 토글
    const lo = this.lo();
    const card = hitTestCard(lo, x, y);
    if (card?.instanceId && bl.blockable.includes(card.instanceId)) {
      const idx = bl.picks.indexOf(card.instanceId);
      if (idx >= 0) bl.picks.splice(idx, 1);
      else bl.picks.push(card.instanceId);
      this.changed();
    }
  }

  // 지략 반응 모드 클릭: 봉쇄/통과 버튼 → 확정, 봉쇄 가능 유닛 → 단일 선택 토글.
  private handleCunningReactUp(x: number, y: number): void {
    const cn = this.view.cunning;
    if (!cn) return;
    if (this.overlay.cunningBlockRect && pointInRect(this.overlay.cunningBlockRect, x, y)) {
      if (cn.picks.length > 0) this.confirmCunning(true);
      return;
    }
    if (this.overlay.cunningPassRect && pointInRect(this.overlay.cunningPassRect, x, y)) {
      this.confirmCunning(false);
      return;
    }
    const lo = this.lo();
    const card = hitTestCard(lo, x, y);
    if (card?.instanceId && cn.eligibleBlockers.includes(card.instanceId)) {
      // 단일 선택 — react 액션은 blockerId 하나만 받는다.
      cn.picks = cn.picks[0] === card.instanceId ? [] : [card.instanceId];
      this.changed();
    }
  }

  private handleDrop(x: number, y: number, state: GameState): void {
    if (!this.view.drag) return;
    const lo = this.lo();
    const dropZone = this.overlay.playDropZone(lo);
    if (!pointInRect(dropZone, x, y)) return;
    const cardId = this.view.drag.cv.cardId;
    if (state.phase === 'opening') {
      if (!state.openingDone[this.local]) {
        const cell = this.cellAtPoint(lo, x, y, state) ?? firstFreeCell(state.field[this.local]);
        if (cell >= 0) this.emit({ type: 'placeOpening', player: this.local, cardId, cell });
      }
    } else if (state.active === this.local) {
      const cell = this.cellAtPoint(lo, x, y, state) ?? undefined;
      this.emit({ type: 'play', player: this.local, cardId, cell });
    }
  }

  private handleOpeningClick(cv: CardView, state: GameState): void {
    if (cv.zone !== 'hand' || cv.controller !== this.local) return;
    if (state.openingDone[this.local]) return;
    const cell = firstFreeCell(state.field[this.local]);
    if (cell >= 0) this.emit({ type: 'placeOpening', player: this.local, cardId: cv.cardId, cell });
  }

  // Hit-test (x,y) against the local player's hex cell rects.
  // Returns the cell index (0-8) if the point lands on an empty cell, else null.
  private cellAtPoint(lo: BoardLayout, x: number, y: number, state: GameState): number | null {
    const vw = this.deps.getViewport().width;
    const frontY = lo.regions.localFrontField.y;
    const backY  = lo.regions.localBackField.y;
    const rects = hexCellRects(frontY, backY, vw);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        // Only target empty cells.
        if (!state.field[this.local][i]) return i;
        return null;
      }
    }
    return null;
  }

  private onKey(code: string): void {
    if (this.mode === 'blockSelect') {
      // Esc/Space/Enter 모두 확정 (Esc = 협공 없이 단독 방어). 공격을 버리지 않는다.
      if (code === 'Escape' || code === 'Space' || code === 'Enter') this.confirmBlockers();
      return;
    }
    if (this.mode === 'cunningReact') {
      // Esc = 통과. Space/Enter = 선택된 유닛으로 봉쇄(없으면 통과).
      if (code === 'Escape') { this.confirmCunning(false); return; }
      if (code === 'Space' || code === 'Enter') {
        const cn = this.view.cunning;
        this.confirmCunning(!!cn && cn.picks.length > 0);
      }
      return;
    }
    if (code === 'Escape') { this.cancel(); return; }
    if (this.mode === 'choosing') {
      if (code === 'Space' || code === 'Enter') this.confirmChoice();
      return;
    }
    if (code === 'Space') {
      const action = nextPassAction(this.deps.getState(), this.local);
      if (action) this.emit(action);
    }
  }

  // Called by App.ts when the human is the defender and must pick blockers
  // (engine's attackReactionRequest, surfaced after a pending attack).
  beginBlockerSelection(attackerId: string, targetId: string, blockable: string[]): void {
    this.hoverPanel.hideAll();
    this.mode = 'blockSelect';
    this.view.blocking = { attackerId, targetId, blockable, picks: [] };
    this.view.attackerId = undefined;
    this.changed();
  }

  confirmBlockers(): void {
    const bl = this.view.blocking;
    if (!bl) return;
    const blockerIds = [...bl.picks];
    this.cancel();
    this.emit({ type: 'resolveAttack', player: this.local, blockerIds });
  }

  // Called by App.ts when the human is the defender of a wisdom-gated card
  // (engine's reactionRequest, surfaced after a pending 지략 opt-in play).
  beginCunningReaction(req: ReactionRequest): void {
    this.hoverPanel.hideAll();
    this.mode = 'cunningReact';
    this.view.cunning = { cardId: req.cardId, amount: req.amount, eligibleBlockers: req.eligibleBlockers, picks: [], prompt: req.prompt };
    this.view.attackerId = undefined;
    this.changed();
  }

  confirmCunning(block: boolean): void {
    const cn = this.view.cunning;
    if (!cn) return;
    const blockerId = block ? cn.picks[0] : undefined;
    this.cancel();
    this.emit({ type: 'react', player: this.local, block, blockerId });
  }

  private cancel(): void {
    if (this.mode !== 'idle' || this.view.attackerId || this.view.drag || this.view.choosing || this.view.blocking || this.view.cunning) {
      this.mode = 'idle';
      this.view.attackerId = undefined;
      this.view.drag = undefined;
      this.view.choosing = undefined;
      this.view.blocking = undefined;
      this.view.cunning = undefined;
      this.pressed = undefined;
      this.changed();
    }
  }

  // --- interactive target selection (B-3 choice protocol) --------------------

  private beginChoosing(request: ChoiceRequest, action: RulesAction): void {
    this.hoverPanel.hideAll();
    this.view.hoverId = undefined;
    this.view.attackerId = undefined;
    this.view.drag = undefined;
    this.mode = 'choosing';
    this.view.choosing = { request, action, picks: [] };
    this.changed();
  }

  private handleChoicePick(cv: CardView): void {
    const ch = this.view.choosing;
    if (!ch || !cv.instanceId) return;
    if (!ch.request.from.includes(cv.instanceId)) return; // illegal target — ignore
    const i = ch.picks.indexOf(cv.instanceId);
    if (i >= 0) {
      ch.picks.splice(i, 1); // toggle off
    } else {
      if (ch.picks.length >= ch.request.max) return; // at cap
      ch.picks.push(cv.instanceId);
    }
    // Exact-count requests confirm as soon as the count is reached.
    if (ch.request.min === ch.request.max && ch.picks.length === ch.request.max) {
      this.confirmChoice();
      return;
    }
    this.changed();
  }

  private confirmChoice(): void {
    const ch = this.view.choosing;
    if (!ch || ch.picks.length < ch.request.min) return;
    const base = ch.action;
    const picks = [...ch.picks];
    this.view.choosing = undefined;
    this.mode = 'idle';
    this.changed();
    if (base.type === 'play') this.emit({ ...base, choices: picks });
  }
}

function firstFreeCell(field: (string | null)[]): number {
  for (let i = 0; i < GRID_SIZE; i++) if (!field[i]) return i;
  return -1; // full
}

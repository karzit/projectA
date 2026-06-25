// Pointer/keyboard input → RulesActions.
//
// Modes:
//   idle         – hover; double-click or drag hand card → play/placeOpening;
//                  single-click own field unit → attackPending
//   attackPending – single-click enemy unit → attack; Esc/right-click → idle
//   dragging     – dragging a hand card; drop on field area → play/placeOpening
//
// The hover zoom panel is a DOM element (not canvas-drawn) so the mouse can
// actually enter it. It is appended to `container` (#game, position:relative).

import type { RulesAction, GameState, PlayerId, CardMeta, ChoiceRequest } from '../../rules/index.js';
import { canAttack, getDef, findCardByName } from '../../rules/index.js';
import type { PlayCondition } from '../../rules/index.js';
import { nextPassAction } from './commands.js';
import { CardSprite } from '../render/CardSprite.js';
import { layout, hitTestCard, pointInRect, type BoardLayout, type CardView, type Rect } from '../render/layout.js';
import { CARD, UI } from '../render/theme.js';
import type { EventManager } from '../core/EventManager.js';

type Mode = 'idle' | 'attackPending' | 'dragging' | 'choosing';

interface ViewState {
  hoverId?: string;
  attackerId?: string;
  drag?: { cv: CardView; x: number; y: number };
  choosing?: { request: ChoiceRequest; action: RulesAction; picks: string[] };
}

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
  readonly view: ViewState = {};
  private mode: Mode = 'idle';
  private unsubs: Array<() => void> = [];

  private lastClickKey?: string;
  private lastClickTime = 0;
  private pressed?: { cv: CardView; x: number; y: number; moved: boolean };

  // DOM hover-panel STACK — lives inside #game (position:relative) so the mouse
  // can enter it. panels[0] is the hovered-card zoom; deeper panels are spawned
  // by clicking 배경/관련 chips. Hovering any panel keeps the whole stack open;
  // leaving the stack (no panel re-entered within HIDE_DELAY) hides everything.
  private panels: HTMLDivElement[] = [];
  private hideTimer?: ReturnType<typeof setTimeout>;
  private rootCardKey?: string;

  constructor(private readonly deps: InteractionDeps) {}

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
    this.hideAll();
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
        if (this.view.hoverId) {
          const cv = lo.cards.find((c) => c.key === this.view.hoverId);
          if (cv?.faceUp) {
            this.showZoom(cv, this.deps.getState());
          } else {
            this.scheduleHide();
          }
        } else {
          // Delayed so moving the cursor off the card onto the panel doesn't
          // immediately tear it down; entering any panel cancels the timer.
          this.scheduleHide();
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
            : state.active === this.local && !state.playedThisTurn;
          if (canDrag) {
            this.pressed.moved = true;
            this.mode = 'dragging';
            this.view.drag = { cv, x, y };
            this.view.hoverId = undefined;
            this.hideAll();
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

  private handleDrop(x: number, y: number, state: GameState): void {
    if (!this.view.drag) return;
    const lo = this.lo();
    const dropZone = this.playDropZone(lo);
    if (!pointInRect(dropZone, x, y)) return;
    const cardId = this.view.drag.cv.cardId;
    if (state.phase === 'opening') {
      if (!state.openingDone[this.local]) this.emit({ type: 'placeOpening', player: this.local, cardId });
    } else if (state.active === this.local) {
      this.emit({ type: 'play', player: this.local, cardId });
    }
  }

  private handleOpeningClick(cv: CardView, state: GameState): void {
    if (cv.zone !== 'hand' || cv.controller !== this.local) return;
    if (state.openingDone[this.local]) return;
    this.emit({ type: 'placeOpening', player: this.local, cardId: cv.cardId });
  }

  private onKey(code: string): void {
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

  private cancel(): void {
    if (this.mode !== 'idle' || this.view.attackerId || this.view.drag || this.view.choosing) {
      this.mode = 'idle';
      this.view.attackerId = undefined;
      this.view.drag = undefined;
      this.view.choosing = undefined;
      this.pressed = undefined;
      this.changed();
    }
  }

  // --- interactive target selection (B-3 choice protocol) --------------------

  private beginChoosing(request: ChoiceRequest, action: RulesAction): void {
    this.hideAll();
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

  // --- zoom panel (DOM) ------------------------------------------------------

  private showZoom(cv: CardView, state: GameState): void {
    let meta;
    try { meta = getDef(cv.cardId); } catch { return; }
    this.cancelHide();

    // Rebuild the root panel; a different card collapses the spawned stack.
    if (this.rootCardKey !== cv.key) this.truncate(1);
    this.rootCardKey = cv.key;

    const el = this.ensurePanel(0);
    el.dataset['chipKey'] = '';
    const unit = cv.instanceId ? state.units[cv.instanceId] : undefined;
    el.style.width = '280px';
    el.innerHTML = this.cardPanelHtml(meta, unit);

    // Anchor to the card, overlapping it so the cursor can cross onto the panel.
    const vp = this.deps.getViewport();
    const ZW = 280;
    const ZH = el.offsetHeight || 360;
    const PAD = 10;
    const OVERLAP = 20;
    // panel-right: anchor = card right - overlap, panel extends right
    // panel-left:  anchor = card left + overlap, transform(-100%) pulls panel left
    const openRight = cv.x + cv.w - OVERLAP + ZW < vp.width - PAD;
    const anchorX = openRight ? cv.x + cv.w - OVERLAP : cv.x + OVERLAP;
    let top = cv.y;
    if (top + ZH > vp.height - PAD) top = vp.height - ZH - PAD;
    if (top < PAD) top = PAD;
    el.style.left = `${anchorX}px`;
    el.style.top = `${top}px`;
    el.classList.toggle('panel-right', openRight);
    el.classList.toggle('panel-left', !openRight);
  }

  // Full card panel markup (image, stats, keywords, 배경 chips) — shared by the
  // root hover panel and by 'card' chips, so a spawned card chains its own 배경.
  private cardPanelHtml(meta: CardMeta, unit?: { power: number; wisdom: number }): string {
    const kindLabel = meta.kind === 'unit' ? '유닛' : '주문';
    const pw = unit ? unit.power : (meta.power ?? 0);
    const ws = unit ? unit.wisdom : (meta.wisdom ?? 0);
    const statsHtml = meta.kind === 'unit'
      ? `<div style="color:#9aa6bd;font-size:12px;margin-top:4px">${kindLabel} &nbsp;·&nbsp; 힘 <b style="color:#fff">${pw}</b> &nbsp;·&nbsp; 지혜 <b style="color:#fff">${ws}</b></div>`
      : `<div style="color:#9aa6bd;font-size:12px;margin-top:4px">${kindLabel}</div>`;
    const kwHtml = meta.keywords?.length
      ? `<div style="color:#a0c4ff;font-size:11px;margin-top:6px">${meta.keywords.join(' · ')}</div>`
      : '';
    const condHtml = meta.conditions?.length
      ? `<div style="margin-top:8px">
           <div style="color:#9aa6bd;font-size:10px;font-weight:700;letter-spacing:.05em;margin-bottom:4px">배경</div>
           <div style="display:flex;flex-wrap:wrap;gap:4px">
             ${meta.conditions.map((c) => this.condChipHtml(c)).join('')}
           </div>
         </div>`
      : '';
    const spriteDataUrl = this.deps.sprites.get(meta.id, true).toDataURL();
    const imgHtml = `<img src="${spriteDataUrl}" style="display:block;margin:0 auto 10px;width:120px;height:166px;border-radius:6px">`;
    return `
      ${imgHtml}
      <div style="font-size:15px;font-weight:700">${meta.name}</div>
      ${statsHtml}
      ${kwHtml}
      ${condHtml}
    `;
  }

  // --- panel stack -----------------------------------------------------------

  private readonly HIDE_DELAY = 160;

  private ensurePanel(index: number): HTMLDivElement {
    const existing = this.panels[index];
    if (existing) return existing;
    const el = document.createElement('div');
    el.className = 'card-panel';
    el.style.cssText = 'display:block;width:280px';
    // Hovering any panel keeps the stack alive; leaving it starts the hide timer.
    el.addEventListener('mouseenter', () => this.cancelHide());
    el.addEventListener('mouseleave', () => this.scheduleHide());
    el.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest('[data-chip]') as HTMLElement | null;
      if (chip) this.onChipClick(index, chip);
    });
    this.deps.container.append(el);
    this.panels[index] = el;
    return el;
  }

  private truncate(from: number): void {
    for (let i = this.panels.length - 1; i >= from; i--) this.panels[i]?.remove();
    this.panels.length = Math.min(this.panels.length, from);
  }

  private hideAll(): void {
    clearTimeout(this.hideTimer);
    this.truncate(0);
    this.rootCardKey = undefined;
  }

  private cancelHide(): void {
    clearTimeout(this.hideTimer);
  }

  private scheduleHide(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.view.hoverId = undefined;
      this.hideAll();
      this.changed();
    }, this.HIDE_DELAY);
  }

  // Clicking a chip in panel `level` spawns (or toggles) the next panel.
  private onChipClick(level: number, chip: HTMLElement): void {
    const childIndex = level + 1;
    const key = [chip.dataset['chip'], chip.dataset['name'], chip.dataset['type'], chip.dataset['value'], chip.dataset['keyword']].filter(Boolean).join('|');
    // Toggle: re-clicking the chip that owns the current child closes it.
    if (this.panels[childIndex]?.dataset['chipKey'] === key) {
      this.truncate(childIndex);
      return;
    }
    this.truncate(childIndex);
    const el = this.ensurePanel(childIndex);
    el.dataset['chipKey'] = key;
    if (!this.fillChipPanel(el, chip)) { this.truncate(childIndex); return; }
    this.positionBeside(childIndex);
  }

  // Fill a spawned panel from a chip. Returns false if there is nothing to show.
  private fillChipPanel(el: HTMLDivElement, chip: HTMLElement): boolean {
    const type = chip.dataset['chip'];
    if (type === 'card') {
      const meta = findCardByName(chip.dataset['name'] ?? '');
      if (!meta) return false;
      el.style.width = '280px';
      el.innerHTML = this.cardPanelHtml(meta); // full panel → its 배경 chips chain on
      return true;
    }
    el.style.width = '240px';
    if (type === 'env') {
      const envType = chip.dataset['type'] ?? '';
      const envValue = chip.dataset['value'] ?? '';
      el.innerHTML = `
        <div style="font-size:12px;font-weight:700;color:#ffd580">환경 조건</div>
        <div style="margin-top:6px;font-size:13px">${envType}: <b>${envValue}</b></div>
        <div style="color:#9aa6bd;font-size:11px;margin-top:4px">이 환경이 설정돼 있어야 플레이 가능</div>`;
      return true;
    }
    if (type === 'keyword') {
      const kw = chip.dataset['keyword'] ?? '';
      el.innerHTML = `
        <div style="font-size:12px;font-weight:700;color:#a0c4ff">키워드 조건</div>
        <div style="margin-top:6px;font-size:13px">키워드: <b>${kw}</b></div>
        <div style="color:#9aa6bd;font-size:11px;margin-top:4px">이 키워드를 가진 유닛이 필드에 있어야 함</div>`;
      return true;
    }
    return false;
  }

  // Position panel `index` beside its parent without overlapping it — right side
  // preferred, then left, else stacked below/above. Clamped to the viewport.
  // Uses real client rects, so parent transforms don't matter.
  private positionBeside(index: number): void {
    const el = this.panels[index];
    const parent = this.panels[index - 1];
    if (!el || !parent) return;
    const PAD = 8;
    const GAP = 4;
    const { width: vw, height: vh } = this.deps.getViewport();
    const cont = this.deps.container.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    const pLeft = pr.left - cont.left;
    const pRight = pr.right - cont.left;
    const pTop = pr.top - cont.top;
    const pBottom = pr.bottom - cont.top;
    const cw = el.offsetWidth;
    const ch = el.offsetHeight;

    let left: number;
    let top = pTop;
    if (pRight + GAP + cw <= vw - PAD) {
      left = pRight + GAP;
    } else if (pLeft - GAP - cw >= PAD) {
      left = pLeft - GAP - cw;
    } else {
      // No room beside it: stack below (or above) so the two never overlap.
      left = Math.min(Math.max(pLeft, PAD), vw - cw - PAD);
      top = pBottom + GAP + ch <= vh - PAD ? pBottom + GAP : Math.max(PAD, pTop - GAP - ch);
    }
    if (top + ch > vh - PAD) top = vh - ch - PAD;
    if (top < PAD) top = PAD;

    // Concrete left edge (no transform) so clamping is exact.
    el.classList.remove('panel-left');
    el.classList.add('panel-right');
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  // Chip HTML for a single condition — clickable to spawn the next panel.
  private condChipHtml(cond: PlayCondition): string {
    const base = 'display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;cursor:default;border:1px solid';
    switch (cond.need) {
      case 'unit':
        return `<span data-chip="card" data-name="${cond.name}" style="${base} rgba(160,196,255,0.35);color:#a0c4ff">${cond.name}</span>`;
      case 'env':
        return `<span data-chip="env" data-type="${cond.type}" data-value="${cond.value}" style="${base} rgba(255,213,128,0.35);color:#ffd580">환경:${cond.value}</span>`;
      case 'keyword':
        return `<span data-chip="keyword" data-keyword="${cond.keyword}" style="${base} rgba(160,196,255,0.35);color:#a0c4ff">키워드:${cond.keyword}</span>`;
      case 'wisdom':
        return `<span style="${base} rgba(200,200,200,0.2);color:#9aa6bd">지혜≥${cond.amount}${cond.side === 'opponent' ? '(상대)' : ''}</span>`;
      case 'powerPresent':
        return `<span style="${base} rgba(200,200,200,0.2);color:#9aa6bd">힘≥${cond.amount} 있어야함</span>`;
      case 'noPowerAtLeast':
        return `<span style="${base} rgba(200,200,200,0.2);color:#9aa6bd">힘≥${cond.amount} 없어야함</span>`;
      default:
        return `<span style="${base} rgba(200,200,200,0.2);color:#9aa6bd">?</span>`;
    }
  }

  // --- overlay rendering (canvas) --------------------------------------------

  renderOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const state = this.deps.getState();
    const lo = layout(state, { width: w, height: h }, this.local);

    if (this.mode === 'choosing' && this.view.choosing) {
      this.drawChoosing(ctx, lo, w, h);
      return; // selection takes over the overlay
    }

    // Hover outline
    if (this.view.hoverId && this.mode === 'idle') {
      const cv = lo.cards.find((c) => c.key === this.view.hoverId);
      if (cv) {
        ctx.strokeStyle = UI.hover;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(cv.x - 2, cv.y - 2, cv.w + 4, cv.h + 4, 10);
        ctx.stroke();
      }
    }

    // Selected attacker outline
    if (this.view.attackerId) {
      const cv = lo.cards.find((c) => c.instanceId === this.view.attackerId);
      if (cv) {
        ctx.strokeStyle = UI.selected;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(cv.x - 3, cv.y - 3, cv.w + 6, cv.h + 6, 10);
        ctx.stroke();
      }
    }

    // Arrow from attacker to hovered enemy
    if (this.mode === 'attackPending' && this.view.attackerId && this.view.hoverId) {
      const attCv = lo.cards.find((c) => c.instanceId === this.view.attackerId);
      const tgtCv = lo.cards.find((c) => c.key === this.view.hoverId && c.controller !== this.local && c.zone === 'field');
      if (attCv && tgtCv) {
        this.drawArrow(ctx,
          attCv.x + attCv.w / 2, attCv.y + attCv.h / 2,
          tgtCv.x + tgtCv.w / 2, tgtCv.y + tgtCv.h / 2,
        );
      }
    }

    // Drag ghost + drop zone
    if (this.mode === 'dragging' && this.view.drag) {
      const dropZone = this.playDropZone(lo);
      const overZone = pointInRect(dropZone, this.view.drag.x, this.view.drag.y);
      this.drawDropZone(ctx, dropZone, overZone);
      const sprite = this.deps.sprites.get(this.view.drag.cv.cardId, true);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sprite, this.view.drag.x - CARD.w / 2, this.view.drag.y - CARD.h / 2, CARD.w, CARD.h);
      ctx.restore();
    }

    this.drawPhaseHint(ctx, state, w, h);
  }

  // Highlight legal targets, mark picks with an order badge, show a banner.
  private drawChoosing(ctx: CanvasRenderingContext2D, lo: BoardLayout, w: number, h: number): void {
    const ch = this.view.choosing!;
    const { from, min, max } = ch.request;

    for (const cv of lo.cards) {
      if (!cv.instanceId || !from.includes(cv.instanceId)) continue;
      const order = ch.picks.indexOf(cv.instanceId);
      const picked = order >= 0;
      ctx.save();
      ctx.strokeStyle = picked ? UI.selected : UI.drop;
      ctx.lineWidth = picked ? 3.5 : 2.5;
      if (!picked) ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.roundRect(cv.x - 3, cv.y - 3, cv.w + 6, cv.h + 6, 10);
      ctx.stroke();
      ctx.restore();
      if (picked) {
        // order badge (1-based) — matters for 혁명 pairing
        const bx = cv.x + cv.w - 12;
        const by = cv.y + 12;
        ctx.save();
        ctx.fillStyle = UI.selected;
        ctx.beginPath();
        ctx.arc(bx, by, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#10131b';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(order + 1), bx, by + 0.5);
        ctx.restore();
      }
    }

    const exact = min === max;
    const countLabel = exact ? `${ch.picks.length}/${max}` : `${ch.picks.length} (${min}~${max})`;
    const hint = exact
      ? `대상 선택 ${countLabel} · Esc 취소`
      : `대상 선택 ${countLabel} · Space 확정 · Esc 취소`;
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    const tw = ctx.measureText(hint).width;
    const px = (w - tw) / 2;
    const py = h / 2 + 2;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.beginPath();
    ctx.roundRect(px - 12, py - 15, tw + 24, 22, 5);
    ctx.fill();
    ctx.fillStyle = UI.drop;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(hint, px, py);
    ctx.restore();
  }

  // --- helpers ---------------------------------------------------------------

  private playDropZone(lo: BoardLayout): Rect {
    const field = lo.regions.localField;
    return { x: field.x + 6, y: field.y - 16, w: field.w - 12, h: field.h + 32 };
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

  private drawPhaseHint(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number): void {
    if (state.loser) return;
    let hint = '';
    if (state.phase === 'opening') {
      if (!state.openingDone[this.local]) {
        hint = `오프닝: 클릭 or 드래그로 배치 (${state.openingPlaced[this.local]}/3) · 패스로 완료`;
      }
    } else if (state.active === this.local) {
      hint = this.mode === 'attackPending'
        ? '공격 대상 클릭 (Esc: 취소)'
        : '더블클릭·드래그→필드: 카드 사용 / 내 유닛 클릭→공격 선택 / Space: 턴 종료';
    }
    if (!hint) return;
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    const tw = ctx.measureText(hint).width;
    const px = (w - tw) / 2;
    const py = h / 2 + 2;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.roundRect(px - 10, py - 14, tw + 20, 20, 4);
    ctx.fill();
    ctx.fillStyle = UI.text;
    ctx.fillText(hint, px, py);
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

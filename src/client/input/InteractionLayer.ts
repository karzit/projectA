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

import type { RulesAction, GameState, PlayerId, CardMeta, ChoiceRequest, PlayCondition } from '../../rules/index.js';
import { canAttack, canBlock, getDef, findCardByName, conditionMet, GRID_SIZE } from '../../rules/index.js';
import { nextPassAction } from './commands.js';
import { CardSprite } from '../render/CardSprite.js';
import { layout, hexCellRects, hitTestCard, pointInRect, type BoardLayout, type CardView, type Rect } from '../render/layout.js';
import { CARD, UI } from '../render/theme.js';
import type { EventManager } from '../core/EventManager.js';

type Mode = 'idle' | 'attackPending' | 'dragging' | 'choosing' | 'blockSelect';

interface ViewState {
  hoverId?: string;
  attackerId?: string;
  drag?: { cv: CardView; x: number; y: number };
  choosing?: { request: ChoiceRequest; action: RulesAction; picks: string[] };
  // 협공 수비자 선택 모드
  blocking?: { pendingAction: RulesAction; blockable: string[]; picks: string[] };
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
const HOVER_SHOW_MS = 1000; // 호버 정보 패널이 뜨기까지 카드 위에 머물러야 하는 시간

export class InteractionLayer {
  readonly view: ViewState = {};
  private mode: Mode = 'idle';
  private unsubs: Array<() => void> = [];

  private lastClickKey?: string;
  private lastClickTime = 0;
  private pressed?: { cv: CardView; x: number; y: number; moved: boolean };
  // 협공 수비 확정 버튼 영역 (drawBlockSelect에서 매 프레임 갱신, onUp에서 히트테스트)
  private blockConfirmRect?: Rect;

  // DOM hover-panel STACK — lives inside #game (position:relative) so the mouse
  // can enter it. panels[0] is the hovered-card zoom; deeper panels are spawned
  // by clicking 배경/관련 chips. Hovering any panel keeps the whole stack open;
  // leaving the stack (no panel re-entered within HIDE_DELAY) hides everything.
  private panels: HTMLDivElement[] = [];
  private hideTimer?: ReturnType<typeof setTimeout>;
  private showTimer?: ReturnType<typeof setTimeout>; // 호버 dwell 타이머
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

  // 방어/대상 선택 같은 모달 오버레이가 떠 있는지 — 배너 등과 겹치지 않게 App이 참조.
  isSelecting(): boolean {
    return this.mode === 'blockSelect' || this.mode === 'choosing';
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
        this.cancelShow();
        if (this.view.hoverId) {
          const cv = lo.cards.find((c) => c.key === this.view.hoverId);
          if (cv?.faceUp) {
            // 카드 위에 ~1초 머무른 뒤에야 정보 패널을 띄운다. 카드 간 이동 시
            // 기존 패널은 즉시 닫고 새 카드의 dwell 타이머를 다시 시작한다.
            this.hideAll();
            this.scheduleShow(cv);
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
            : state.active === this.local;
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

    // 협공 수비 선택은 상대 턴(state.active !== local) 중에 일어나므로
    // 아래의 active-turn 체크보다 먼저 처리해야 한다.
    if (this.mode === 'blockSelect' && this.view.blocking) {
      this.handleBlockSelectUp(x, y);
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
    if (this.blockConfirmRect && pointInRect(this.blockConfirmRect, x, y)) {
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

  private handleDrop(x: number, y: number, state: GameState): void {
    if (!this.view.drag) return;
    const lo = this.lo();
    const dropZone = this.playDropZone(lo);
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

  // Called by App.ts when the human is the defender and must pick blockers.
  beginBlockerSelection(pendingAction: RulesAction, blockable: string[]): void {
    this.hideAll();
    this.mode = 'blockSelect';
    this.view.blocking = { pendingAction, blockable, picks: [] };
    this.view.attackerId = undefined;
    this.changed();
  }

  confirmBlockers(): void {
    const bl = this.view.blocking;
    if (!bl) return;
    const action = { ...bl.pendingAction, blockers: bl.picks } as RulesAction;
    this.cancel();
    this.emit(action);
  }

  private cancel(): void {
    if (this.mode !== 'idle' || this.view.attackerId || this.view.drag || this.view.choosing || this.view.blocking) {
      this.mode = 'idle';
      this.view.attackerId = undefined;
      this.view.drag = undefined;
      this.view.choosing = undefined;
      this.view.blocking = undefined;
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
    el.style.width = '320px';
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
    const basePow = meta.power ?? 0;
    const baseWis = meta.wisdom ?? 0;
    const curPow = unit ? unit.power : basePow;
    const curWis = unit ? unit.wisdom : baseWis;
    const powChanged = unit && curPow !== basePow;
    const wisChanged = unit && curWis !== baseWis;

    const statVal = (cur: number, base: number, changed: boolean) => {
      if (!changed) return `<b style="color:#fff">${cur}</b>`;
      const arrow = cur > base ? '▲' : '▼';
      const color = cur > base ? '#5be0a0' : '#ff7060';
      return `<b style="color:#aaa;text-decoration:line-through">${base}</b>`
           + `<b style="color:${color}"> ${arrow}${cur}</b>`;
    };

    const statsHtml = meta.kind === 'unit'
      ? `<div style="color:#9aa6bd;font-size:13px;margin-top:5px">${kindLabel} &nbsp;·&nbsp; 힘 ${statVal(curPow, basePow, !!powChanged)} &nbsp;·&nbsp; 지혜 ${statVal(curWis, baseWis, !!wisChanged)}</div>`
      : `<div style="color:#9aa6bd;font-size:13px;margin-top:5px">${kindLabel}</div>`;

    const descHtml = meta.desc
      ? `<div style="font-size:13px;color:#c7d0e2;margin-top:10px;line-height:1.65;border-top:1px solid rgba(255,255,255,0.1);padding-top:8px">${meta.desc}</div>`
      : '';
    const kwHtml = meta.keywords?.length
      ? `<div style="color:#a0c4ff;font-size:12px;margin-top:7px">${meta.keywords.join(' · ')}</div>`
      : '';

    // 배경 조건: 현재 state에서 충족 여부 판단
    const state = this.deps.getState();
    const local = this.deps.localPlayer;
    const condHtml = meta.conditions?.length
      ? `<div style="margin-top:10px;border-top:1px solid rgba(255,200,80,0.15);padding-top:8px">
           <div style="color:#c8a84b;font-size:11px;font-weight:700;letter-spacing:.06em;margin-bottom:5px">▣ 배경 조건</div>
           <div style="display:flex;flex-wrap:wrap;gap:5px">
             ${meta.conditions.map((c) => this.condChipHtml(c, state, local)).join('')}
           </div>
         </div>`
      : '';

    const spriteDataUrl = this.deps.sprites.get(meta.id, true).toDataURL();
    const imgHtml = `<img src="${spriteDataUrl}" style="display:block;margin:0 auto 12px;width:130px;height:180px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.5)">`;
    return `
      ${imgHtml}
      <div style="font-size:17px;font-weight:700">${meta.name}</div>
      ${statsHtml}
      ${kwHtml}
      ${descHtml}
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
    el.style.cssText = 'display:block;width:320px';
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
    clearTimeout(this.showTimer);
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

  // 호버 dwell: 카드 위에 HOVER_SHOW_MS 동안 머물러야 패널을 띄운다.
  private scheduleShow(cv: CardView): void {
    clearTimeout(this.showTimer);
    const key = cv.key;
    this.showTimer = setTimeout(() => {
      if (this.view.hoverId !== key) return; // 그새 다른 곳으로 이동
      if (this.mode === 'dragging' || this.mode === 'choosing' || this.mode === 'blockSelect') return;
      const fresh = this.lo().cards.find((c) => c.key === key);
      if (fresh?.faceUp) this.showZoom(fresh, this.deps.getState());
    }, HOVER_SHOW_MS);
  }

  private cancelShow(): void {
    clearTimeout(this.showTimer);
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
      el.style.width = '320px';
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

  // Chip HTML for a single condition — shows met(green)/unmet(red) state.
  private condChipHtml(cond: PlayCondition, state?: GameState, player?: PlayerId): string {
    const met = state && player ? conditionMet(state, cond, player) : undefined;
    const metColor  = met === true  ? '#5be0a0' : met === false ? '#ff7060' : undefined;
    const metBorder = met === true  ? 'rgba(91,224,160,0.45)' : met === false ? 'rgba(255,112,96,0.45)' : undefined;
    const metIcon   = met === true  ? '✓ ' : met === false ? '✗ ' : '';

    const chip = (label: string, color: string, border: string, extra = '') => {
      const c = metColor ?? color;
      const b = metBorder ?? border;
      return `<span ${extra} style="display:inline-flex;align-items:center;gap:2px;padding:3px 9px;border-radius:12px;font-size:12px;cursor:default;border:1px solid ${b};color:${c}">${metIcon}${label}</span>`;
    };

    switch (cond.need) {
      case 'unit':
        return chip(cond.name, '#a0c4ff', 'rgba(160,196,255,0.35)',
          `data-chip="card" data-name="${cond.name}"`);
      case 'env':
        return chip(`환경:${cond.value}`, '#ffd580', 'rgba(255,213,128,0.35)',
          `data-chip="env" data-type="${cond.type}" data-value="${cond.value}"`);
      case 'keyword':
        return chip(`키워드:${cond.keyword}`, '#a0c4ff', 'rgba(160,196,255,0.35)',
          `data-chip="keyword" data-keyword="${cond.keyword}"`);
      case 'wisdom':
        return chip(`지혜≥${cond.amount}${cond.side === 'opponent' ? '(상대)' : ''}`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      case 'powerPresent':
        return chip(`힘≥${cond.amount} 있어야함`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      case 'noPowerAtLeast':
        return chip(`힘≥${cond.amount} 없어야함`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      default:
        return chip('?', '#9aa6bd', 'rgba(200,200,200,0.2)');
    }
  }

  // --- overlay rendering (canvas) --------------------------------------------

  renderOverlay(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const state = this.deps.getState();
    const lo = layout(state, { width: w, height: h }, this.local);

    if (this.mode === 'choosing' && this.view.choosing) {
      this.drawChoosing(ctx, lo, w, h);
      return;
    }
    if (this.mode === 'blockSelect' && this.view.blocking) {
      this.drawBlockSelect(ctx, lo, w, h);
      return;
    }

    // Hover glow outline (C-14-5)
    if (this.view.hoverId && this.mode === 'idle') {
      const cv = lo.cards.find((c) => c.key === this.view.hoverId);
      if (cv) {
        ctx.save();
        ctx.strokeStyle = UI.hover;
        ctx.lineWidth = 2;
        ctx.shadowColor = UI.hover;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(cv.x - 2, cv.y - 2, cv.w + 4, cv.h + 4, 10);
        ctx.stroke();
        ctx.restore();
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
  private drawBlockSelect(ctx: CanvasRenderingContext2D, lo: BoardLayout, w: number, h: number): void {
    const bl = this.view.blocking!;
    const state = this.deps.getState();
    const pa = bl.pendingAction as { attackerId?: string; targetId?: string };

    // Dim everything except involved units
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // 공격자→방어대상 화살표 (붉은색) — 카드 위에 그리기 전 먼저 배경처럼 깐다.
    const atkCv = lo.cards.find((c) => c.instanceId === pa.attackerId);
    const tgtCv = lo.cards.find((c) => c.instanceId === pa.targetId);
    if (atkCv && tgtCv) {
      this.drawArrow(ctx,
        atkCv.x + atkCv.w / 2, atkCv.y + atkCv.h / 2,
        tgtCv.x + tgtCv.w / 2, tgtCv.y + tgtCv.h / 2,
        '#ff5040',
      );
    }

    for (const cv of lo.cards) {
      if (!cv.instanceId) continue;
      const isBlockable = bl.blockable.includes(cv.instanceId);
      const isSelected  = bl.picks.includes(cv.instanceId);
      const isTarget    = cv.instanceId === pa.targetId;
      const isAttacker  = cv.instanceId === pa.attackerId;

      if (!isBlockable && !isTarget && !isAttacker) continue;

      // Redraw card at full alpha to punch through dim
      const sprite = this.deps.sprites.get(cv.cardId, cv.faceUp);
      ctx.save();
      ctx.drawImage(sprite, cv.x, cv.y, cv.w, cv.h);
      ctx.restore();

      // Outline
      ctx.save();
      if (isAttacker) {
        ctx.strokeStyle = '#ff5040';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#ff5040';
        ctx.shadowBlur = 14;
      } else if (isTarget) {
        ctx.strokeStyle = '#ff9040';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#ff9040';
        ctx.shadowBlur = 10;
      } else {
        ctx.strokeStyle = isSelected ? '#60c8ff' : 'rgba(96,200,255,0.7)';
        ctx.lineWidth = isSelected ? 3.5 : 2;
        ctx.shadowColor = '#60c8ff';
        ctx.shadowBlur = isSelected ? 14 : 6;
        if (!isSelected) ctx.setLineDash([5, 3]);
      }
      ctx.beginPath();
      ctx.roundRect(cv.x - 3, cv.y - 3, cv.w + 6, cv.h + 6, 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 역할 라벨 (카드 상단)
      const label = isAttacker ? '공격자' : isTarget ? '방어 대상' : null;
      if (label) {
        ctx.save();
        const lw = 56;
        ctx.fillStyle = isAttacker ? '#ff5040' : '#ff9040';
        ctx.beginPath();
        ctx.roundRect(cv.x + cv.w / 2 - lw / 2, cv.y - 20, lw, 16, 4);
        ctx.fill();
        ctx.fillStyle = '#15100e';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cv.x + cv.w / 2, cv.y - 11);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }

      // 협공 선택 표식 (+/✓ 배지)
      if (isBlockable) {
        ctx.save();
        const bx = cv.x + cv.w / 2;
        const by = cv.y + cv.h - 14;
        ctx.fillStyle = isSelected ? '#60c8ff' : 'rgba(20,30,45,0.85)';
        ctx.strokeStyle = '#60c8ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isSelected ? '#10131b' : '#60c8ff';
        ctx.font = 'bold 14px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isSelected ? '✓' : '+', bx, by + 0.5);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }

      // Draw stat overlay on top for blockable + target units
      if ((isBlockable || isTarget || isAttacker) && cv.faceUp) {
        const unit = state.units[cv.instanceId];
        if (unit) {
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          ctx.beginPath();
          ctx.roundRect(cv.x + cv.w - 44, cv.y + cv.h - 22, 38, 16, 4);
          ctx.fill();
          ctx.font = '700 10px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#fff';
          ctx.fillText(`힘${unit.power}`, cv.x + cv.w - 34, cv.y + cv.h - 14);
          ctx.fillText(`지${unit.wisdom}`, cv.x + cv.w - 15, cv.y + cv.h - 14);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.restore();
        }
      }
    }

    // 협공 전력 합산 표시 (방어 성공 여부 미리보기)
    const atkPow = pa.attackerId ? (state.units[pa.attackerId]?.power ?? 0) : 0;
    const defBase = pa.targetId ? (state.units[pa.targetId]?.power ?? 0) : 0;
    const blockSum = bl.picks.reduce((s, id) => s + (state.units[id]?.power ?? 0), 0);
    const combined = defBase + blockSum;
    const repels = combined >= atkPow;

    // Bottom panel: status + confirm button
    const panelW = 440, panelH = 46;
    const px = w / 2 - panelW / 2, py = h - 66;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 10);
    ctx.fill();
    ctx.stroke();

    // 좌측 상태 텍스트
    const status = bl.picks.length > 0
      ? `협공 ${bl.picks.length}명 · 방어력 ${combined} vs 공격 ${atkPow}`
      : `협공 없음 · 방어력 ${combined} vs 공격 ${atkPow}`;
    ctx.fillStyle = '#cdd6ea';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(status, px + 14, py + 16);

    // 결과 미리보기
    ctx.fillStyle = repels ? '#5be0a0' : '#ff7060';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(repels ? '✓ 방어 성공 (모두 생존)' : '✗ 방어 실패 (참여 유닛 파괴)', px + 14, py + 33);

    // 우측 확정 버튼
    const btnW = 116, btnH = 32;
    const bx = px + panelW - btnW - 10, by = py + (panelH - btnH) / 2;
    this.blockConfirmRect = { x: bx, y: by, w: btnW, h: btnH };
    ctx.fillStyle = repels ? '#2e7d52' : '#7a4a44';
    ctx.strokeStyle = repels ? '#5be0a0' : '#ff9080';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, btnW, btnH, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('방어 확정 ▸', bx + btnW / 2, by + btnH / 2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

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
    const front = lo.regions.localFrontField;
    const back = lo.regions.localBackField;
    const top = Math.min(front.y, back.y) - 16;
    const bottom = Math.max(front.y + front.h, back.y + back.h) + 16;
    return { x: front.x + 6, y: top, w: front.w - 12, h: bottom - top };
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

  private drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string = UI.arrow): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
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
    ctx.restore();
  }
}

function firstFreeCell(field: (string | null)[]): number {
  for (let i = 0; i < GRID_SIZE; i++) if (!field[i]) return i;
  return -1; // full
}

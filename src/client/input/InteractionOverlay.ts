// Canvas overlay rendering for interaction state: hover glow, attack arrows,
// drag ghost, the 협공 block-select modal, and the choice-target modal.
// Pure presentation — reads InteractionLayer's view state and `mode`, writes
// nothing back except `blockConfirmRect` (the confirm-button hit rect, which
// InteractionLayer reads to handle clicks). No pointer/keyboard logic here.

import type { GameState, PlayerId, ChoiceRequest, RulesAction } from '../../rules/index.js';
import { canAttack, canMove, HEX_ADJACENT } from '../../rules/index.js';
import { layout, pointInRect, hexCellRects, type BoardLayout, type CardView, type Rect } from '../render/layout.js';
import { CardSprite } from '../render/CardSprite.js';
import { CARD, UI } from '../render/theme.js';
import type { InteractionMode } from './CardHoverPanel.js';

export interface BlockingView { attackerId: string; targetId: string; blockable: string[]; picks: string[] }
export interface ChoosingView { request: ChoiceRequest; action: RulesAction; picks: string[] }
export interface DragView { cv: CardView; x: number; y: number }
// 지략 opt-in 반응 뷰 — 봉쇄 가능한 유닛 중 최대 1개를 골라 봉쇄하거나, 통과시킨다.
export interface CunningView { cardId: string; amount: number; eligibleBlockers: string[]; picks: string[]; prompt: string }

export interface OverlayView {
  hoverId?: string;
  attackerId?: string;
  drag?: DragView;
  choosing?: ChoosingView;
  blocking?: BlockingView;
  cunning?: CunningView;
}

export interface InteractionOverlayDeps {
  getState: () => GameState;
  getViewport: () => { width: number; height: number };
  sprites: CardSprite;
  localPlayer: PlayerId;
}

export class InteractionOverlay {
  // 협공 수비 확정 버튼 영역 — render()에서 매 프레임 갱신, InteractionLayer가
  // 클릭 히트테스트에 사용한다.
  blockConfirmRect?: Rect;
  // 지략 반응 봉쇄/통과 버튼 영역.
  cunningBlockRect?: Rect;
  cunningPassRect?: Rect;
  // 행동 선택 메뉴(공격/이동) 버튼 영역 — C-17.
  actionAttackRect?: Rect;
  actionMoveRect?: Rect;

  constructor(private readonly deps: InteractionOverlayDeps) {}

  private get local(): PlayerId { return this.deps.localPlayer; }

  render(ctx: CanvasRenderingContext2D, w: number, h: number, mode: InteractionMode, view: OverlayView): void {
    const state = this.deps.getState();
    const lo = layout(state, this.deps.getViewport(), this.local);

    if (mode === 'choosing' && view.choosing) {
      this.drawChoosing(ctx, lo, w, h, view.choosing);
      return;
    }
    if (mode === 'blockSelect' && view.blocking) {
      this.drawBlockSelect(ctx, lo, w, h, view.blocking);
      return;
    }
    if (mode === 'cunningReact' && view.cunning) {
      this.drawCunningReact(ctx, lo, w, h, view.cunning);
      return;
    }
    if (mode === 'actionMenu' && view.attackerId) {
      this.drawActionMenu(ctx, lo, state, view.attackerId);
      return;
    }

    // Hover glow outline (C-14-5)
    if (view.hoverId && mode === 'idle') {
      const cv = lo.cards.find((c) => c.key === view.hoverId);
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
    if (view.attackerId) {
      const cv = lo.cards.find((c) => c.instanceId === view.attackerId);
      if (cv) {
        ctx.strokeStyle = UI.selected;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(cv.x - 3, cv.y - 3, cv.w + 6, cv.h + 6, 10);
        ctx.stroke();
      }
    }

    // Arrow from attacker to hovered enemy
    if (mode === 'attackPending' && view.attackerId && view.hoverId) {
      const attCv = lo.cards.find((c) => c.instanceId === view.attackerId);
      const tgtCv = lo.cards.find((c) => c.key === view.hoverId && c.controller !== this.local && c.zone === 'field');
      if (attCv && tgtCv) {
        this.drawArrow(ctx,
          attCv.x + attCv.w / 2, attCv.y + attCv.h / 2,
          tgtCv.x + tgtCv.w / 2, tgtCv.y + tgtCv.h / 2,
        );
      }
    }

    // 이동 가능 칸 하이라이트 (movePending)
    if (mode === 'movePending' && view.attackerId) {
      const unit = state.units[view.attackerId];
      if (unit) {
        const vw = this.deps.getViewport().width;
        const rects = hexCellRects(lo.regions.localFrontField.y, lo.regions.localBackField.y, vw);
        for (const cell of HEX_ADJACENT[unit.cell] ?? []) {
          if (!canMove(state, view.attackerId, cell)) continue;
          const r = rects[cell];
          if (!r) continue;
          ctx.save();
          ctx.fillStyle = 'rgba(96,200,255,0.18)';
          ctx.strokeStyle = '#60c8ff';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.roundRect(r.x, r.y, r.w, r.h, 8);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }

    // Drag ghost + drop zone
    if (mode === 'dragging' && view.drag) {
      const dropZone = this.playDropZone(lo);
      const overZone = pointInRect(dropZone, view.drag.x, view.drag.y);
      this.drawDropZone(ctx, dropZone, overZone);
      const sprite = this.deps.sprites.get(view.drag.cv.cardId, true);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sprite, view.drag.x - CARD.w / 2, view.drag.y - CARD.h / 2, CARD.w, CARD.h);
      ctx.restore();
    }

    this.drawPhaseHint(ctx, state, w, h, mode);
  }

  // Drop zone rect (front+back field area) — also used by InteractionLayer for
  // drag-drop hit-testing, so it stays exported via the instance.
  playDropZone(lo: BoardLayout): Rect {
    const front = lo.regions.localFrontField;
    const back = lo.regions.localBackField;
    const top = Math.min(front.y, back.y) - 16;
    const bottom = Math.max(front.y + front.h, back.y + back.h) + 16;
    return { x: front.x + 6, y: top, w: front.w - 12, h: bottom - top };
  }

  // Highlight legal targets, mark picks with an order badge, show a banner.
  private drawBlockSelect(ctx: CanvasRenderingContext2D, lo: BoardLayout, w: number, h: number, bl: BlockingView): void {
    const state = this.deps.getState();

    // Dim everything except involved units
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // 공격자→방어대상 화살표 (붉은색) — 카드 위에 그리기 전 먼저 배경처럼 깐다.
    const atkCv = lo.cards.find((c) => c.instanceId === bl.attackerId);
    const tgtCv = lo.cards.find((c) => c.instanceId === bl.targetId);
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
      const isTarget    = cv.instanceId === bl.targetId;
      const isAttacker  = cv.instanceId === bl.attackerId;

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
    const atkPow = state.units[bl.attackerId]?.power ?? 0;
    const defBase = state.units[bl.targetId]?.power ?? 0;
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

  // 지략 opt-in 반응: 봉쇄 가능한 유닛(최대 1개 선택) 강조 + 봉쇄/통과 버튼.
  private drawCunningReact(ctx: CanvasRenderingContext2D, lo: BoardLayout, w: number, h: number, cn: CunningView): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    for (const cv of lo.cards) {
      if (!cv.instanceId || !cn.eligibleBlockers.includes(cv.instanceId)) continue;
      const isSelected = cn.picks.includes(cv.instanceId);

      const sprite = this.deps.sprites.get(cv.cardId, cv.faceUp);
      ctx.save();
      ctx.drawImage(sprite, cv.x, cv.y, cv.w, cv.h);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = isSelected ? '#60c8ff' : 'rgba(96,200,255,0.7)';
      ctx.lineWidth = isSelected ? 3.5 : 2;
      ctx.shadowColor = '#60c8ff';
      ctx.shadowBlur = isSelected ? 14 : 6;
      if (!isSelected) ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.roundRect(cv.x - 3, cv.y - 3, cv.w + 6, cv.h + 6, 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

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

    // Bottom panel: prompt + 봉쇄/통과 buttons
    const panelW = 460, panelH = 46;
    const px = w / 2 - panelW / 2, py = h - 66;
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.88)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, py, panelW, panelH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#cdd6ea';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(cn.prompt, px + 14, py + panelH / 2);

    const btnW = 90, btnH = 32, gap = 8;
    const passBx = px + panelW - btnW - 10, passBy = py + (panelH - btnH) / 2;
    const blockBx = passBx - btnW - gap, blockBy = passBy;
    this.cunningPassRect = { x: passBx, y: passBy, w: btnW, h: btnH };
    this.cunningBlockRect = { x: blockBx, y: blockBy, w: btnW, h: btnH };

    const canBlock = cn.picks.length > 0;
    // 봉쇄 버튼
    ctx.fillStyle = canBlock ? '#2e7d52' : 'rgba(60,60,60,0.6)';
    ctx.strokeStyle = canBlock ? '#5be0a0' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(blockBx, blockBy, btnW, btnH, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = canBlock ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('봉쇄', blockBx + btnW / 2, blockBy + btnH / 2 + 0.5);

    // 통과 버튼
    ctx.fillStyle = '#3a3530';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.roundRect(passBx, passBy, btnW, btnH, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('통과', passBx + btnW / 2, passBy + btnH / 2 + 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // 유닛 클릭 직후 뜨는 행동 선택 메뉴 (C-17): 공격/이동 중 하나를 명시적으로 고른다.
  // 둘 다 불가능한 옵션은 흐리게 표시하고 클릭을 무시한다(InteractionLayer가
  // actionAttackRect/actionMoveRect + canAttack/canMove로 재검증).
  private drawActionMenu(ctx: CanvasRenderingContext2D, lo: BoardLayout, state: GameState, unitId: string): void {
    const cv = lo.cards.find((c) => c.instanceId === unitId);
    if (!cv) return;

    ctx.save();
    ctx.strokeStyle = UI.selected;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(cv.x - 3, cv.y - 3, cv.w + 6, cv.h + 6, 10);
    ctx.stroke();
    ctx.restore();

    const canAtk = canAttack(state, unitId);
    const u = state.units[unitId];
    const canMv = !!u && (HEX_ADJACENT[u.cell] ?? []).some((c) => canMove(state, unitId, c));

    const btnW = 88, btnH = 36, gap = 8;
    const menuW = btnW * 2 + gap;
    let mx = cv.x + cv.w / 2 - menuW / 2;
    let my = cv.y - btnH - 14;
    if (my < 4) my = cv.y + cv.h + 14; // 화면 위쪽에 붙으면 카드 아래로

    const atkRect: Rect = { x: mx, y: my, w: btnW, h: btnH };
    const mvRect: Rect = { x: mx + btnW + gap, y: my, w: btnW, h: btnH };
    this.actionAttackRect = atkRect;
    this.actionMoveRect = mvRect;

    const drawBtn = (r: Rect, label: string, enabled: boolean) => {
      ctx.save();
      ctx.fillStyle = enabled ? 'rgba(20,30,45,0.92)' : 'rgba(40,40,40,0.7)';
      ctx.strokeStyle = enabled ? '#60c8ff' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = enabled ? '#ffffff' : 'rgba(255,255,255,0.35)';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.restore();
    };
    drawBtn(atkRect, '⚔ 공격', canAtk);
    drawBtn(mvRect, '➤ 이동', canMv);
  }

  private drawChoosing(ctx: CanvasRenderingContext2D, lo: BoardLayout, w: number, h: number, ch: ChoosingView): void {
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

  private drawPhaseHint(ctx: CanvasRenderingContext2D, state: GameState, w: number, h: number, mode: InteractionMode): void {
    if (state.loser) return;
    let hint = '';
    if (state.phase === 'opening') {
      if (!state.openingDone[this.local]) {
        hint = `오프닝: 클릭 or 드래그로 배치 (${state.openingPlaced[this.local]}/3) · 패스로 완료`;
      }
    } else if (state.active === this.local) {
      hint = mode === 'attackPending' ? '공격 대상 클릭 (Esc: 취소)'
        : mode === 'movePending' ? '이동할 칸 클릭 (아군 유닛이 있으면 위치 교환, Esc: 취소)'
        : mode === 'actionMenu' ? '공격 또는 이동 선택 (Esc: 취소)'
        : '더블클릭·드래그→필드: 카드 사용 / 내 유닛 클릭→행동 선택 / Space: 턴 종료';
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

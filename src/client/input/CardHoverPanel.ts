// DOM hover/zoom card-info panel stack. Pure presentation: shows a card's
// stats/keywords/배경 conditions on hover, and lets 배경 chips spawn nested
// panels (card/env/keyword) for drill-down. Lives as a DOM overlay (not
// canvas) inside `container` (position:relative) so the mouse can actually
// enter the panel without it disappearing.
//
// Owned and driven by InteractionLayer: it calls scheduleShow/scheduleHide
// from pointer-move handling and hideAll on mode changes. This module has no
// pointer/keyboard logic of its own.

import type { GameState, PlayerId, CardMeta, PlayCondition, Side } from '../../rules/index.js';
import { getDef, findCardByName, conditionMet } from '../../rules/index.js';
import { CardSprite } from '../render/CardSprite.js';
import type { BoardLayout, CardView } from '../render/layout.js';

export type InteractionMode = 'idle' | 'actionMenu' | 'attackPending' | 'movePending' | 'dragging' | 'choosing' | 'blockSelect' | 'cunningReact';

export interface CardHoverPanelDeps {
  container: HTMLElement;
  sprites: CardSprite;
  getState: () => GameState;
  localPlayer: PlayerId;
  getViewport: () => { width: number; height: number };
  getLayout: () => BoardLayout; // fresh layout lookup when the dwell timer fires
  getMode: () => InteractionMode;
}

const HOVER_SHOW_MS = 1000; // 호버 정보 패널이 뜨기까지 카드 위에 머물러야 하는 시간
const HIDE_DELAY = 160;

export class CardHoverPanel {
  // DOM hover-panel STACK — panels[0] is the hovered-card zoom; deeper panels
  // are spawned by clicking 배경/관련 chips. Hovering any panel keeps the
  // whole stack open; leaving it (no panel re-entered within HIDE_DELAY) hides
  // everything.
  private panels: HTMLDivElement[] = [];
  private hideTimer?: ReturnType<typeof setTimeout>;
  private showTimer?: ReturnType<typeof setTimeout>; // 호버 dwell 타이머
  private rootCardKey?: string;

  constructor(private readonly deps: CardHoverPanelDeps) {}

  // 호버 dwell: 카드 위에 HOVER_SHOW_MS 동안 머물러야 패널을 띄운다.
  scheduleShow(cv: CardView): void {
    clearTimeout(this.showTimer);
    const key = cv.key;
    this.showTimer = setTimeout(() => {
      const mode = this.deps.getMode();
      if (mode === 'dragging' || mode === 'choosing' || mode === 'blockSelect') return;
      const fresh = this.deps.getLayout().cards.find((c) => c.key === key);
      if (fresh?.faceUp) this.showZoom(fresh, this.deps.getState());
    }, HOVER_SHOW_MS);
  }

  cancelShow(): void {
    clearTimeout(this.showTimer);
  }

  scheduleHide(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideAll(), HIDE_DELAY);
  }

  cancelHide(): void {
    clearTimeout(this.hideTimer);
  }

  hideAll(): void {
    clearTimeout(this.hideTimer);
    clearTimeout(this.showTimer);
    this.truncate(0);
    this.rootCardKey = undefined;
  }

  // --- zoom panel (DOM) -------------------------------------------------------

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

    const evolveHtml = meta.evolveTarget
      ? `<div style="margin-top:10px;border-top:1px solid rgba(180,140,255,0.15);padding-top:8px">
           <div style="color:#c9a8ff;font-size:11px;font-weight:700;letter-spacing:.06em;margin-bottom:5px">▣ 진행 대상</div>
           <div style="display:flex;flex-wrap:wrap;gap:5px">${this.evolveChipHtml(meta.evolveTarget)}</div>
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
      ${evolveHtml}
    `;
  }

  // --- panel stack -------------------------------------------------------------

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

  // Clicking a chip in panel `level` spawns (or toggles) the next panel.
  private onChipClick(level: number, chip: HTMLElement): void {
    const childIndex = level + 1;
    const key = [chip.dataset['chip'], chip.dataset['cardid'], chip.dataset['name'], chip.dataset['type'], chip.dataset['value'], chip.dataset['keyword']].filter(Boolean).join('|');
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
      // 진행 칩은 cardId로 직접 지목(이름이 바뀌어도 안전); 배경:unit 칩은 카드
      // 이름으로 찾는다(조건이 이름 기반이라 id를 모름).
      const cardId = chip.dataset['cardid'];
      let meta;
      try {
        meta = cardId ? getDef(cardId) : findCardByName(chip.dataset['name'] ?? '');
      } catch { meta = undefined; }
      if (!meta) return false;
      el.style.width = '320px';
      el.innerHTML = this.cardPanelHtml(meta); // full panel → its 배경/진행 chips chain on
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

    // side가 명시된 경우에만 접미어를 붙인다 — 'any'(unit 기본값)와 'own'(그 외
    // 조건들의 기본값)은 표시하지 않아 화면이 지저분해지지 않게 한다.
    const sideSuffix = (side: Side | undefined, ownDefault: boolean) => {
      if (side === 'opponent') return '(상대)';
      if (side === 'own' && !ownDefault) return '(아군)';
      return '';
    };

    switch (cond.need) {
      case 'unit':
        return chip(`${cond.name}${sideSuffix(cond.side, false)}`, '#a0c4ff', 'rgba(160,196,255,0.35)',
          `data-chip="card" data-name="${cond.name}"`);
      case 'env':
        return chip(`환경:${cond.value}`, '#ffd580', 'rgba(255,213,128,0.35)',
          `data-chip="env" data-type="${cond.type}" data-value="${cond.value}"`);
      case 'keyword':
        return chip(`키워드:${cond.keyword}`, '#a0c4ff', 'rgba(160,196,255,0.35)',
          `data-chip="keyword" data-keyword="${cond.keyword}"`);
      case 'wisdom':
        return chip(`지혜≥${cond.amount}${sideSuffix(cond.side, true)}`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      case 'unitWisdom':
        return chip(`단일 유닛 지혜≥${cond.amount}${sideSuffix(cond.side, true)}`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      case 'powerPresent':
        return chip(`힘≥${cond.amount} 있어야함${sideSuffix(cond.side, true)}`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      case 'noPowerAtLeast':
        return chip(`힘≥${cond.amount} 없어야함${sideSuffix(cond.side, true)}`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      case 'dead':
        return chip(`묘지:${cond.keyword}${sideSuffix(cond.side, true)}`, '#9aa6bd', 'rgba(200,200,200,0.2)');
      case 'trapped':
        return chip(`오행산 유닛 존재${sideSuffix(cond.side, true)}`, '#9aa6bd', 'rgba(200,200,200,0.2)');
    }
  }

  // 진행(evolve) 대상 카드 미리보기 칩. cardId로 직접 지목한다(이름 매칭이 아니라
  // getDef(id)) — 진행 대상은 배경 조건이 아니라 meta.evolveTarget이라 이름 검색
  // 경로(condChipHtml의 'unit' 케이스)와는 별개 데이터가 필요하다.
  private evolveChipHtml(evolveTarget: string): string {
    let name = evolveTarget;
    try { name = getDef(evolveTarget).name; } catch { /* unknown id — show raw */ }
    return `<span data-chip="card" data-cardid="${evolveTarget}"
      style="display:inline-flex;align-items:center;gap:2px;padding:3px 9px;border-radius:12px;
             font-size:12px;cursor:pointer;border:1px solid rgba(180,140,255,0.4);color:#c9a8ff">
      진행 → ${name}</span>`;
  }
}

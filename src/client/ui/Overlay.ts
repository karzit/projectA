// Full-screen screens layered over the board: loading, lobby, solo-play deck
// picker, deck editor, and game over.

import { allDecks } from '../decks.js';
import { DeckEditor } from './DeckEditor.js';

export interface LobbyCallbacks {
  onSolo: () => void;
  onDeck: () => void;
  onSettings: () => void;
}

export class Overlay {
  private readonly el: HTMLDivElement;
  private progressFill: HTMLDivElement | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen hidden';
    parent.append(this.el);
  }

  hide(): void {
    this.el.className = 'screen hidden';
    this.el.innerHTML = '';
    this.progressFill = null;
  }

  showLoading(): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';
    const h = h1('로딩 중…');
    const bar = div('progress');
    this.progressFill = div('');
    bar.append(this.progressFill);
    this.el.append(h, bar);
  }

  setProgress(loaded: number, total: number): void {
    if (!this.progressFill) return;
    const pct = total === 0 ? 100 : Math.round((loaded / total) * 100);
    this.progressFill.style.width = `${pct}%`;
  }

  showLobby(cb: LobbyCallbacks): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';

    const title = h1('카드 게임');

    const grid = div('lobby-grid');
    grid.append(
      lobbyBtn('⚔️  솔로 플레이', '커스텀 룰셋 · AI 상대', 'primary', cb.onSolo),
      lobbyBtn('📖  덱 편성', '카드 목록 · 덱 구성', 'ghost', cb.onDeck),
      lobbyBtn('⚙️  환경설정', '음량 · 속도', 'ghost', cb.onSettings),
    );

    this.el.append(title, grid);
  }

  showDeckEditor(onBack: () => void): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';
    this.progressFill = null;
    new DeckEditor(this.el, onBack);
  }

  showSoloPick(onStart: (myDeckId: string, oppDeckId: string) => void, onBack: () => void): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';

    const title = h1('솔로 플레이');

    const panel = div('panel');
    const mine = deckSelect('내 덱');
    const opp = deckSelect('상대 덱');
    if (opp.select.options.length > 1) opp.select.selectedIndex = 1;

    const start = document.createElement('button');
    start.className = 'primary';
    start.textContent = '게임 시작 ▸';
    start.addEventListener('click', () => onStart(mine.select.value, opp.select.value));

    const back = document.createElement('button');
    back.className = 'ghost';
    back.textContent = '← 로비';
    back.addEventListener('click', onBack);

    panel.append(mine.label, opp.label, start, back);
    this.el.append(title, panel);
  }

  showStub(title: string, onBack: () => void): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';
    const h = h1(title);
    const msg = document.createElement('p');
    msg.textContent = '준비 중입니다.';
    msg.style.cssText = 'color:#9aa6bd;margin:0;font-size:15px;';
    const back = document.createElement('button');
    back.className = 'ghost';
    back.textContent = '← 로비';
    back.addEventListener('click', onBack);
    this.el.append(h, msg, back);
  }

  showInGameMenu(onResume: () => void, onForfeit: () => void): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';

    const title = h1('일시정지');

    const panel = div('panel');
    panel.style.minWidth = '260px';

    const resume = document.createElement('button');
    resume.className = 'primary';
    resume.textContent = '계속하기';
    resume.addEventListener('click', onResume);

    const forfeit = document.createElement('button');
    forfeit.className = 'ghost';
    forfeit.style.color = '#ff7060';
    forfeit.textContent = '항복';
    forfeit.addEventListener('click', onForfeit);

    panel.append(resume, forfeit);
    this.el.append(title, panel);
  }

  showGameOver(text: string, onLobby: () => void): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';
    const title = h1(text);
    const again = document.createElement('button');
    again.className = 'primary';
    again.textContent = '로비로';
    again.addEventListener('click', onLobby);
    this.el.append(title, again);
  }
}

function deckSelect(labelText: string): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  for (const d of allDecks()) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    select.append(opt);
  }
  label.append(select);
  return { label, select };
}

function lobbyBtn(label: string, sub: string, cls: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `lobby-btn ${cls}`;
  const lbl = document.createElement('span');
  lbl.className = 'lobby-btn-label';
  lbl.textContent = label;
  const desc = document.createElement('span');
  desc.className = 'lobby-btn-sub';
  desc.textContent = sub;
  btn.append(lbl, desc);
  btn.addEventListener('click', onClick);
  return btn;
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  if (className) d.className = className;
  return d;
}

function h1(text: string): HTMLHeadingElement {
  const h = document.createElement('h1');
  h.textContent = text;
  return h;
}

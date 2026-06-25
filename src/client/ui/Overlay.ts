// Full-screen screens layered over the board: loading, main menu (deck picker),
// and game over.

import { PRESET_DECKS } from '../decks.js';

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

  showMenu(onStart: (myDeckId: string, oppDeckId: string) => void): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';

    const title = h1('카드 게임');
    const subtitle = document.createElement('h2');
    subtitle.textContent = '커스텀 룰셋 (덱 15장, 전부 오프닝부터 패에)';

    const panel = div('panel');
    const mine = deckSelect('내 덱');
    const opp = deckSelect('상대 덱');
    if (opp.select.options.length > 1) opp.select.selectedIndex = 1;

    const start = document.createElement('button');
    start.className = 'primary';
    start.textContent = '게임 시작 ▸';
    start.addEventListener('click', () => onStart(mine.select.value, opp.select.value));

    panel.append(mine.label, opp.label, start);
    this.el.append(title, subtitle, panel);
  }

  showGameOver(text: string, onRematch: () => void): void {
    this.el.className = 'screen';
    this.el.innerHTML = '';
    const title = h1(text);
    const again = document.createElement('button');
    again.className = 'primary';
    again.textContent = '메뉴로';
    again.addEventListener('click', onRematch);
    this.el.append(title, again);
  }
}

function deckSelect(labelText: string): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  for (const d of PRESET_DECKS) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    select.append(opt);
  }
  label.append(select);
  return { label, select };
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

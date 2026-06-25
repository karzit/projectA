// In-game HUD (DOM): phase/turn pill, field counts, action prompt, pass button.

import type { GameState, PlayerId } from '../../rules/index.js';
import type { EventManager } from '../core/EventManager.js';
import { advanceLabel, nextPassAction } from '../input/commands.js';

export class Hud {
  private readonly pill: HTMLSpanElement;
  private readonly fieldInfo: HTMLSpanElement;
  private readonly prompt: HTMLSpanElement;
  private readonly button: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly events: EventManager,
    private readonly getState: () => GameState,
    private readonly local: PlayerId,
  ) {
    const top = el('div', 'hud-bar top');
    this.fieldInfo = el('span', 'hud-field');
    top.append(this.fieldInfo);

    const bottom = el('div', 'hud-bar bottom');
    this.pill = el('span', 'hud-pill');
    this.prompt = el('span', 'hud-prompt');
    this.button = el('button', 'hud-btn') as HTMLButtonElement;
    this.button.textContent = '패스 ▸';
    this.button.addEventListener('click', () => this.advance());
    bottom.append(this.pill, this.prompt, this.button);

    parent.append(top, bottom);
  }

  private advance(): void {
    const action = nextPassAction(this.getState(), this.local);
    if (action) this.events.emit('intent', action);
  }

  update(s: GameState): void {
    const opp: PlayerId = this.local === 'A' ? 'B' : 'A';
    const myField = s.field[this.local].length;
    const oppField = s.field[opp].length;
    const myHand = s.hand[this.local].length;
    const oppHand = s.hand[opp].length;
    this.fieldInfo.textContent = `상대 필드:${oppField}  패:${oppHand}  /  내 필드:${myField}  패:${myHand}`;

    if (s.loser) {
      this.pill.textContent = s.loser === this.local ? '패배' : '승리';
      this.prompt.textContent = '';
      this.button.disabled = true;
      this.button.textContent = '게임 종료';
      return;
    }

    const phase = s.phase === 'opening' ? '오프닝' : `${s.turn}턴`;
    const active = s.phase === 'main' ? (s.active === this.local ? ' · 내 턴' : ` · ${opp} 턴`) : '';
    this.pill.textContent = `${phase}${active}`;

    if (s.phase === 'opening') {
      const myDone = s.openingDone[this.local];
      const oppDone = s.openingDone[opp];
      this.prompt.textContent = myDone
        ? (oppDone ? '오프닝 완료 → 메인 시작' : '상대 배치 대기 중')
        : `내 배치: ${s.openingPlaced[this.local]}/3`;
    } else {
      this.prompt.textContent = s.active === this.local ? '행동하거나 패스' : '상대 행동 대기';
    }

    const canAct = !s.loser && (
      s.phase === 'opening' ? !s.openingDone[this.local] : s.active === this.local
    );
    this.button.disabled = !canAct;
    this.button.textContent = advanceLabel(s, this.local);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

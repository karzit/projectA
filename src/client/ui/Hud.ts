// In-game HUD (DOM): life totals top/bottom, a turn/phase pill, a contextual
// prompt, and the pass/advance button. Re-renders from a GameState snapshot on
// every `state:changed`. Emits intents through the bus — it never touches state.

import type { GameState, PlayerId } from '../../engine/index.js';
import type { EventManager } from '../core/EventManager.js';
import { advanceLabel, nextPriorityAction } from '../input/commands.js';

export class Hud {
  private readonly topLife: HTMLDivElement;
  private readonly bottomLife: HTMLDivElement;
  private readonly pill: HTMLSpanElement;
  private readonly prompt: HTMLSpanElement;
  private readonly button: HTMLButtonElement;
  private readonly timer: HTMLDivElement;
  private readonly timerFill: HTMLDivElement;
  private readonly timerSecs: HTMLSpanElement;
  private lastSecs = -1;

  constructor(
    parent: HTMLElement,
    private readonly events: EventManager,
    private readonly getState: () => GameState,
    private readonly local: PlayerId,
  ) {
    const opp: PlayerId = local === 'P0' ? 'P1' : 'P0';

    const top = el('div', 'hud-bar top');
    this.topLife = el('div', 'hud-life');
    this.topLife.innerHTML = `♥ <b>20</b><span class="who">${opp}</span>`;
    top.append(this.topLife);

    const bottom = el('div', 'hud-bar bottom');
    this.bottomLife = el('div', 'hud-life');
    this.bottomLife.innerHTML = `♥ <b>20</b><span class="who">${local} (you)</span>`;
    this.pill = el('span', 'hud-pill');
    this.prompt = el('span', 'hud-prompt');
    // Turn timer: a countdown bar + seconds.
    this.timer = el('div', 'hud-timer hidden');
    const bar = el('div', 'bar');
    this.timerFill = el('div', 'fill');
    this.timerSecs = el('span', 'secs');
    bar.append(this.timerFill);
    this.timer.append(bar, this.timerSecs);

    this.button = el('button', 'hud-btn') as HTMLButtonElement;
    this.button.textContent = 'Pass ▸';
    this.button.addEventListener('click', () => this.advance());
    bottom.append(this.bottomLife, this.pill, this.prompt, this.timer, this.button);

    parent.append(top, bottom);
  }

  showTimer(visible: boolean): void {
    this.timer.classList.toggle('hidden', !visible);
  }

  setTimer(remainingMs: number, limitMs: number): void {
    const frac = limitMs > 0 ? Math.max(0, Math.min(1, remainingMs / limitMs)) : 0;
    this.timerFill.style.width = `${frac * 100}%`;
    const low = remainingMs <= 5000;
    this.timerFill.style.background = low ? '#ff5470' : '#7fd1ff';
    this.timer.classList.toggle('low', low);
    const secs = Math.ceil(remainingMs / 1000);
    if (secs !== this.lastSecs) {
      this.timerSecs.textContent = `${secs}s`;
      this.lastSecs = secs;
    }
  }

  private advance(): void {
    const action = nextPriorityAction(this.getState());
    if (action) this.events.emit('intent', action);
  }

  update(s: GameState): void {
    const opp: PlayerId = this.local === 'P0' ? 'P1' : 'P0';
    setLife(this.topLife, s.players[opp].life);
    setLife(this.bottomLife, s.players[this.local].life);

    this.pill.textContent = `Turn ${s.turn} · ${s.step}${s.activePlayer === this.local ? ' · your turn' : ''}`;

    this.prompt.textContent = promptFor(s, this.local);

    const canAct = !s.gameOver && (!!s.priority || !!s.awaiting);
    this.button.disabled = !canAct;
    this.button.textContent = s.gameOver ? 'Game over' : advanceLabel(s);
  }
}

function promptFor(s: GameState, local: PlayerId): string {
  if (s.gameOver) return s.winner ? `${s.winner} wins` : 'Draw';
  if (s.awaiting) {
    const mine = s.awaiting.player === local;
    const what = s.awaiting.kind === 'declareAttackers' ? 'attackers' : 'blockers';
    return `${mine ? 'Declare your' : `${s.awaiting.player} declares`} ${what}`;
  }
  if (s.stack.length > 0) return `Stack: ${s.stack.length} — respond or pass`;
  if (s.priority === local) return 'You have priority';
  return `${s.priority ?? '—'} to act`;
}

function setLife(node: HTMLElement, life: number): void {
  const b = node.querySelector('b');
  if (b) b.textContent = String(life);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

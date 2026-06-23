// Scrolling game log. Subscribes (via the host) to the `engine:event` stream and
// renders a human-readable line per meaningful event. Noisy/internal events
// (priority changes, every zone move) are filtered out.

import { getDef } from '../../engine/index.js';
import type { GameEvent, GameState } from '../../engine/index.js';

export class LogPanel {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'log-panel';
    parent.append(this.el);
  }

  clear(): void {
    this.el.innerHTML = '';
  }

  push(e: GameEvent): void {
    const line = this.format(e);
    if (!line) return;
    const row = document.createElement('div');
    row.className = `row ${line.cls}`;
    row.textContent = line.text;
    this.el.append(row);
    this.el.scrollTop = this.el.scrollHeight;
  }

  private name(instanceId: string): string {
    const c = this.getState().cards[instanceId];
    return c ? getDef(c.oracleId).name : '?';
  }

  private format(e: GameEvent): { text: string; cls: string } | null {
    switch (e.type) {
      case 'cast':
        return { text: `${e.controller} casts ${getDef(e.oracleId).name}`, cls: 'k-cast' };
      case 'trigger':
        return { text: `⚡ ${getDef(e.oracleId).name} triggers`, cls: 'k-cast' };
      case 'resolve':
        return { text: `↳ resolves`, cls: '' };
      case 'damage': {
        const who = e.target.kind === 'player' ? e.target.player : this.name(e.target.instanceId);
        return { text: `${who} takes ${e.amount} damage`, cls: 'k-damage' };
      }
      case 'life':
        return { text: `${e.player} life → ${e.total}`, cls: '' };
      case 'destroyed':
        return { text: `${this.name(e.instanceId)} is destroyed`, cls: 'k-damage' };
      case 'stepChange':
        return { text: `— turn ${e.turn} · ${e.step} (${e.activePlayer}) —`, cls: 'k-step' };
      case 'gameOver':
        return { text: e.winner ? `${e.winner} wins the game` : 'the game is a draw', cls: 'k-over' };
      default:
        return null; // zoneChange / draw / tap / priority / awaiting are too noisy
    }
  }
}

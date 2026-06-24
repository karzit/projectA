// Per-turn time limit. Deliberately a CLIENT concern: the engine stays
// deterministic and wall-clock-free, so a timeout is just an automatic sequence
// of normal Actions (pass priority / declare no attackers-blockers) that the
// host fires when the clock runs out. An authoritative server would enforce the
// same rule the same way later.
//
// The clock belongs to the active player's turn: it refills when the turn
// number changes and counts down across the whole turn (it does NOT refill each
// priority window). Run out and the turn is auto-completed.

import type { GameState } from '../engine/index.js';

export class TurnTimer {
  readonly limitMs: number;
  remainingMs: number;
  private lastTurn = -1;

  constructor(limitSeconds: number) {
    this.limitMs = Math.max(1, limitSeconds) * 1000;
    this.remainingMs = this.limitMs;
  }

  reset(): void {
    this.remainingMs = this.limitMs;
  }

  // Refill when a new turn begins. Call on every state change.
  onState(state: GameState): void {
    if (state.turn !== this.lastTurn) {
      this.lastTurn = state.turn;
      this.reset();
    }
  }

  // Advance the clock by `dt` ms when `active`. Returns true exactly once, on the
  // tick it reaches zero, so the host can auto-complete the turn.
  tick(dt: number, active: boolean): boolean {
    if (!active || this.remainingMs <= 0) return false;
    this.remainingMs -= dt;
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      return true;
    }
    return false;
  }

  fraction(): number {
    return this.remainingMs / this.limitMs;
  }

  seconds(): number {
    return Math.ceil(this.remainingMs / 1000);
  }
}

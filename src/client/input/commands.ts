// Small shared helpers that turn the current game state into the obvious "next"
// action. Used by both the keyboard (Space) and the HUD pass button so they
// always agree on what "advance" means.

import type { Action, GameState } from '../../engine/index.js';

// The action that moves the game forward for whoever must act right now:
// resolve a required combat declaration (as "none"), or pass priority.
export function nextPriorityAction(s: GameState): Action | null {
  if (s.gameOver) return null;
  if (s.awaiting) {
    return s.awaiting.kind === 'declareAttackers'
      ? { type: 'declareAttackers', player: s.awaiting.player, attackers: [] }
      : { type: 'declareBlockers', player: s.awaiting.player, blocks: {} };
  }
  if (s.priority) return { type: 'passPriority', player: s.priority };
  return null;
}

// A human-readable label for the pass/advance control, given the state.
export function advanceLabel(s: GameState): string {
  if (s.gameOver) return 'Game over';
  if (s.awaiting?.kind === 'declareAttackers') return 'No attacks ▸';
  if (s.awaiting?.kind === 'declareBlockers') return 'No blocks ▸';
  if (s.stack.length > 0) return 'Pass (resolve) ▸';
  return 'Pass / next ▸';
}

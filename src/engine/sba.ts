// State-Based Actions. Checked repeatedly until the game state is stable —
// before any player would receive priority and after every resolution. This is
// where creatures die and players lose, never inline in effect code.

import { getDef } from './cards.js';
import { moveCard } from './zones.js';
import type { GameEvent, GameState, PlayerId } from './types.js';

const PLAYERS: PlayerId[] = ['P0', 'P1'];

export function checkGameOver(state: GameState, events: GameEvent[]): void {
  if (state.gameOver) return;
  const losers = PLAYERS.filter((p) => state.players[p].hasLost);
  if (losers.length === 0) return;

  state.gameOver = true;
  state.priority = null;
  state.awaiting = null;
  const survivors = PLAYERS.filter((p) => !state.players[p].hasLost);
  state.winner = survivors.length === 1 ? survivors[0] : null; // null = draw
  events.push({ type: 'gameOver', winner: state.winner });
}

export function runSBA(state: GameState, events: GameEvent[]): void {
  let changed = true;
  while (changed) {
    changed = false;

    // Creatures with lethal damage are destroyed.
    for (const id of Object.keys(state.cards)) {
      const c = state.cards[id];
      if (c.zone !== 'battlefield') continue;
      const d = getDef(c.oracleId);
      if (!d.types.includes('creature')) continue;
      const toughness = d.toughness ?? 0;
      if (toughness > 0 && c.damage >= toughness) {
        moveCard(state, id, 'graveyard', events);
        events.push({ type: 'destroyed', instanceId: id });
        changed = true;
      }
    }

    // A player at 0 or less life, or who attempted to draw from an empty
    // library, loses the game.
    for (const pid of PLAYERS) {
      const p = state.players[pid];
      if (p.hasLost) continue;
      if (p.life <= 0 || p.drewFromEmpty) {
        p.hasLost = true;
        changed = true;
      }
    }
  }

  checkGameOver(state, events);
}

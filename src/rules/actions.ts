// Player intents for the new ruleset. Serializable; the reducer is the only way
// state changes.

import type { PlayerId } from './types.js';

export type RulesAction =
  // Opening phase: each side places up to 3 cards (order between players is free).
  | { type: 'placeOpening'; player: PlayerId; cardId: string }
  | { type: 'finishOpening'; player: PlayerId } // stop early (fewer than 3)
  // Main phase: on your turn, take exactly one of these, then the turn passes.
  | { type: 'play'; player: PlayerId; cardId: string; choices?: string[] } // play a card; choices feed 'chosen' effect selectors
  | { type: 'attack'; player: PlayerId; attackerId: string; targetId: string } // power combat
  | { type: 'pass'; player: PlayerId }; // do nothing (playing is optional)

export interface RulesResult {
  state: import('./types.js').GameState;
  error?: string;
}

// Player intents for the new ruleset. Serializable; the reducer is the only way
// state changes.

import type { PlayerId } from './types.js';

export type RulesAction =
  // Opening phase: each side places up to 3 cards, specifying which cell to occupy.
  | { type: 'placeOpening'; player: PlayerId; cardId: string; cell: number }
  | { type: 'finishOpening'; player: PlayerId }
  // Main phase: on your turn, take any of these (except pass), then pass to end.
  | { type: 'play'; player: PlayerId; cardId: string; choices?: string[]; cell?: number }
  | { type: 'attack'; player: PlayerId; attackerId: string; targetId: string; blockers?: string[] }
  // 공격 대신 발동하는 액티브 능력 (사제/마법사). 행동권을 소모한다.
  | { type: 'ability'; player: PlayerId; unitId: string; choices?: string[] }
  | { type: 'move'; player: PlayerId; unitId: string; toCell: number }
  | { type: 'pass'; player: PlayerId };

export interface RulesResult {
  state: import('./types.js').GameState;
  error?: string;
  choiceRequest?: import('./types.js').ChoiceRequest;
}

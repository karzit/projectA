// Player intents for the new ruleset. Serializable; the reducer is the only way
// state changes.

import type { PlayerId } from './types.js';

export type RulesAction =
  // Opening phase: each side places up to 3 cards, specifying which cell to occupy.
  | { type: 'placeOpening'; player: PlayerId; cardId: string; cell: number }
  | { type: 'finishOpening'; player: PlayerId }
  // Main phase: on your turn, take any of these (except pass), then pass to end.
  | { type: 'play'; player: PlayerId; cardId: string; choices?: string[]; cell?: number }
  // 공격 선언. 협공 가능한 수비 유닛이 있으면 즉시 해결되지 않고 수비측의
  // resolveAttack 반응을 기다린다(pendingAttack). 없으면 즉시 단독 1:1로 해결된다.
  | { type: 'attack'; player: PlayerId; attackerId: string; targetId: string }
  // 공격 대신 발동하는 액티브 능력 (사제/마법사). 행동권을 소모한다.
  | { type: 'ability'; player: PlayerId; unitId: string; choices?: string[] }
  | { type: 'move'; player: PlayerId; unitId: string; toCell: number }
  // 지략 opt-in: 수비측이 보류된 카드를 봉쇄(block)하거나 통과(block:false)시킨다.
  | { type: 'react'; player: PlayerId; block: boolean; blockerId?: string }
  // 협공 반응: 수비측이 보류된 공격에 합류시킬 유닛을 선택한다(빈 배열 = 단독 방어).
  | { type: 'resolveAttack'; player: PlayerId; blockerIds: string[] }
  // 선택(choice) 공개 시점 응답: pendingPlays 큐가 처리되다 선택 부족으로 멈춘
  // 큐 맨 앞 카드에 대해, 지금(공개 시점)의 실제 후보 기준으로 선택을 채운다.
  | { type: 'resolveChoice'; player: PlayerId; choices: string[] }
  | { type: 'pass'; player: PlayerId };

export interface RulesResult {
  state: import('./types.js').GameState;
  error?: string;
  choiceRequest?: import('./types.js').ChoiceRequest; // play(개입 즉시) 또는 pendingPlays 공개 시점 모두 이 필드로 노출된다
  reactionRequest?: import('./types.js').ReactionRequest;
  attackReactionRequest?: import('./types.js').AttackReactionRequest;
}

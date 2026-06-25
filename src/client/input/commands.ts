// Helpers that map the current rules GameState to the obvious "next" action.
// Used by both Space key and the HUD pass/advance button.

import type { RulesAction, GameState, PlayerId } from '../../rules/index.js';

export function nextPassAction(state: GameState, player: PlayerId): RulesAction | null {
  if (state.loser) return null;
  if (state.phase === 'opening') {
    if (state.openingDone[player]) return null;
    return { type: 'finishOpening', player };
  }
  if (state.active !== player) return null;
  return { type: 'pass', player };
}

export function advanceLabel(state: GameState, player: PlayerId): string {
  if (state.loser) return '게임 종료';
  if (state.phase === 'opening') return state.openingDone[player] ? '대기 중…' : '오프닝 완료 ▸';
  if (state.active !== player) return '상대 턴';
  return '패스 ▸';
}

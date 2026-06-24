// Evaluating 배경 (play conditions). Checked ONLY at the moment a card is played.
//
// This module is pure POLICY: it expresses what each condition means in terms of
// the read-only "friends" in queries.ts, and never touches state shape directly.

import { getDef } from './cards.js';
import {
  environmentHas,
  hasKeywordOnAnyField,
  hasPowerAtLeastOnSide,
  hasUnitNamed,
  wisdomOnSide,
} from './queries.js';
import type { CardDef, GameState, PlayCondition, PlayerId } from './types.js';

function conditionMet(state: GameState, cond: PlayCondition, player: PlayerId): boolean {
  switch (cond.need) {
    case 'unit':
      return hasUnitNamed(state, cond.name);
    case 'keyword':
      return hasKeywordOnAnyField(state, cond.keyword);
    case 'env':
      return environmentHas(state, cond.type, cond.value);
    case 'wisdom':
      return wisdomOnSide(state, player, cond.side ?? 'own') >= cond.amount;
    case 'powerPresent':
      return hasPowerAtLeastOnSide(state, player, cond.side ?? 'own', cond.amount);
    case 'noPowerAtLeast':
      return !hasPowerAtLeastOnSide(state, player, cond.side ?? 'own', cond.amount);
  }
}

export interface PlayCheck {
  ok: boolean;
  missing: PlayCondition[]; // conditions not yet satisfied
  reason?: string;
}

// Can `player` play `card` right now? 마왕's cannotSummon is enforced here (it
// only reaches the field via its forced 'descend').
export function canPlay(state: GameState, card: CardDef, player: PlayerId): PlayCheck {
  if (card.cannotSummon) return { ok: false, missing: [], reason: '소환 불가' };
  const missing = (card.conditions ?? []).filter((c) => !conditionMet(state, c, player));
  return { ok: missing.length === 0, missing };
}

export function canPlayId(state: GameState, cardId: string, player: PlayerId): PlayCheck {
  return canPlay(state, getDef(cardId), player);
}

import {
  environmentHas,
  hasKeywordOnAnyField,
  hasPowerAtLeastOnSide,
  hasUnitNamed,
  wisdomOnSide,
} from './queries.js';
import { getCard } from './cards/CardRegistry.js';
import type { Card } from './cards/Card.js';
import type { GameState, PlayCondition, PlayerId } from './types.js';

function conditionMet(state: GameState, cond: PlayCondition, player: PlayerId): boolean {
  switch (cond.need) {
    case 'unit':         return hasUnitNamed(state, cond.name);
    case 'keyword':      return hasKeywordOnAnyField(state, cond.keyword);
    case 'env':          return environmentHas(state, cond.type, cond.value);
    case 'wisdom':       return wisdomOnSide(state, player, cond.side ?? 'own') >= cond.amount;
    case 'powerPresent': return hasPowerAtLeastOnSide(state, player, cond.side ?? 'own', cond.amount);
    case 'noPowerAtLeast': return !hasPowerAtLeastOnSide(state, player, cond.side ?? 'own', cond.amount);
  }
}

export interface PlayCheck {
  ok: boolean;
  missing: PlayCondition[];
  reason?: string;
}

export function canPlay(state: GameState, card: Card, player: PlayerId): PlayCheck {
  if (card.meta.cannotSummon) return { ok: false, missing: [], reason: '소환 불가' };
  const missing = (card.meta.conditions ?? []).filter((c) => !conditionMet(state, c, player));
  return { ok: missing.length === 0, missing };
}

export function canPlayId(state: GameState, cardId: string, player: PlayerId): PlayCheck {
  return canPlay(state, getCard(cardId), player);
}

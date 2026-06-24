// Forced-ability evaluation (복수자 / 배신자 / 마왕) — the state-based "when to
// check" loop the README flagged as the next structural step. The data
// (ForcedAbility) and the shared Effect vocabulary live elsewhere; THIS module is
// only the loop that decides WHEN a forced ability fires.
//
// Model: after every main-phase action the reducer "settles" the board — it
// repeatedly finds a forced ability whose trigger holds and resolves it, until
// none do.
//
//   - `once` abilities are recorded in state.firedForced and never refire.
//   - non-once abilities self-limit: their effect makes the trigger stop holding
//     (복수자 fills the empty field). A per-settle `seen` set bounds the loop even
//     when an effect is a no-op, and SETTLE_LIMIT is a final safety net.
//
// A forced ability can live on a HAND card (복수자/마왕 summon themselves from
// hand) or on a FIELD unit (배신자), so both are scanned. Reads go through
// queries; writes go through effects/game. This module never touches state shape.

import { newContext, resolveEffects } from './effects.js';
import { markForcedFired } from './game.js';
import {
  defForCardId,
  defOf,
  fieldUnitIds,
  handCardIds,
  hasForcedFired,
  highestInAllStats,
  ritualCount,
  unitCount,
} from './queries.js';
import type { ForcedAbility, GameState, PlayerId } from './types.js';

const PLAYERS: PlayerId[] = ['A', 'B'];
const SETTLE_LIMIT = 100; // forced abilities self-limit well below this; a safety net.

// A pending forced ability, located on either a hand card or a field unit.
interface ForcedSource {
  key: string; // stable identity for `once` / `seen` bookkeeping
  controller: PlayerId; // the side the trigger is evaluated for
  cardId: string; // source card (for summonSelf / descend from hand)
  unitId?: string; // instanceId when the source is on the field
  ability: ForcedAbility;
}

// Every forced ability currently in play, in deterministic order: for each
// player A→B, hand cards then field units, in array/def order.
function* forcedSources(state: GameState): Generator<ForcedSource> {
  for (const p of PLAYERS) {
    for (const cardId of handCardIds(state, p)) {
      for (const ability of defForCardId(cardId).forced ?? []) {
        yield { key: `${p}:hand:${cardId}:${ability.id}`, controller: p, cardId, ability };
      }
    }
    for (const unitId of fieldUnitIds(state, p)) {
      const def = defOf(state, unitId);
      for (const ability of def.forced ?? []) {
        yield { key: `${unitId}:${ability.id}`, controller: p, cardId: def.id, unitId, ability };
      }
    }
  }
}

function triggerHolds(state: GameState, src: ForcedSource): boolean {
  const t = src.ability.trigger;
  switch (t.on) {
    case 'ownFieldEmpty':
      return unitCount(state, src.controller) === 0;
    case 'highestStat': {
      if (!src.unitId) return false; // a field-only trigger (배신자 must be in play)
      const top = highestInAllStats(state, src.controller, t.stats);
      return !!top && top.instanceId === src.unitId;
    }
    case 'ritual':
      return ritualCount(state, t.name) >= t.count;
  }
}

function fire(state: GameState, src: ForcedSource): void {
  resolveEffects(state, src.ability.effect, newContext(src.controller, src.cardId, [], src.unitId));
}

// Resolve all forced abilities to a fixpoint. Call after each main-phase action,
// BEFORE the loss check (so 복수자 can rise off an empty field and avert defeat).
export function settleForced(state: GameState): void {
  const seen = new Set<string>(); // keys tried this settle — bounds no-op loops
  for (let guard = 0; guard < SETTLE_LIMIT; guard++) {
    const next = nextFireable(state, seen);
    if (!next) break;
    seen.add(next.key);
    if (next.ability.once) markForcedFired(state, next.key);
    fire(state, next);
  }
}

function nextFireable(state: GameState, seen: Set<string>): ForcedSource | null {
  for (const src of forcedSources(state)) {
    if (seen.has(src.key)) continue;
    if (src.ability.once && hasForcedFired(state, src.key)) continue;
    if (triggerHolds(state, src)) return src;
  }
  return null;
}

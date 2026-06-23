// Zone bookkeeping. Each card's `zone` field is the source of truth for "where
// it is"; the per-player ordered arrays in state.zones give us order (library
// top, etc.) and fast iteration. moveCard keeps the two in sync.

import type { CardInstance, GameEvent, GameState, PlayerId, ZoneName } from './types.js';

// Which player's zone array holds this card for a given zone. Battlefield is
// keyed by controller; all other zones by owner.
export function zoneHolder(card: CardInstance, zone: ZoneName): PlayerId {
  return zone === 'battlefield' ? card.controller : card.owner;
}

export function listZone(state: GameState, player: PlayerId, zone: Exclude<ZoneName, 'stack'>): string[] {
  return state.zones[player][zone];
}

function removeFromCurrentZone(state: GameState, card: CardInstance): void {
  if (card.zone === 'stack') return; // stack is managed separately
  const holder = zoneHolder(card, card.zone);
  const arr = state.zones[holder][card.zone];
  const idx = arr.indexOf(card.instanceId);
  if (idx >= 0) arr.splice(idx, 1);
}

export interface MoveOpts {
  toController?: PlayerId; // change controller on the move
  toBottom?: boolean; // insert at bottom of the target array (library bottom)
}

// Move a card to a new zone, resetting permanent-only state when it leaves the
// battlefield, and emit a zoneChange event.
export function moveCard(
  state: GameState,
  instanceId: string,
  toZone: ZoneName,
  events: GameEvent[],
  opts: MoveOpts = {},
): void {
  const card = state.cards[instanceId];
  if (!card) throw new Error(`Unknown card instance: ${instanceId}`);
  const from = card.zone;

  removeFromCurrentZone(state, card);

  if (opts.toController) card.controller = opts.toController;

  // Leaving the battlefield wipes transient permanent state.
  if (from === 'battlefield' && toZone !== 'battlefield') {
    card.tapped = false;
    card.damage = 0;
    card.counters = {};
    card.summoningSick = false;
    card.attackedFlag = false;
  }
  if (toZone === 'battlefield' && from !== 'battlefield') {
    card.summoningSick = true;
    card.tapped = false;
    card.damage = 0;
  }

  card.zone = toZone;

  if (toZone !== 'stack') {
    const holder = zoneHolder(card, toZone);
    const arr = state.zones[holder][toZone];
    if (opts.toBottom) arr.push(instanceId);
    else if (toZone === 'library') arr.unshift(instanceId); // default to top
    else arr.push(instanceId);
  }

  events.push({ type: 'zoneChange', instanceId, from, to: toZone });
}

// Read-only "friends": the only place that knows the SHAPE of GameState for
// reading. Policy code (conditions / effects / reducer) asks these helpers
// instead of reaching into state.units / state.field / state.hand / getDef
// directly. Writes live in game.ts; this module never mutates.

import { getDef } from './cards.js';
import { hasEnv } from './environment.js';
import type { CardDef, EnvType, GameState, PlayerId, Side, UnitInstance } from './types.js';

export function otherPlayer(p: PlayerId): PlayerId {
  return p === 'A' ? 'B' : 'A';
}

// --- units -----------------------------------------------------------------

export function findUnit(state: GameState, id: string): UnitInstance | undefined {
  return state.units[id];
}

export function unitExists(state: GameState, id: string): boolean {
  return !!state.units[id];
}

export function defOf(state: GameState, id: string): CardDef {
  return getDef(state.units[id].cardId);
}

export function allUnits(state: GameState): UnitInstance[] {
  return Object.values(state.units);
}

export function allUnitIds(state: GameState): string[] {
  return [...state.field.A, ...state.field.B];
}

export function fieldUnitIds(state: GameState, player: PlayerId): string[] {
  return [...state.field[player]];
}

export function unitsControlledBy(state: GameState, player: PlayerId): UnitInstance[] {
  return state.field[player].map((id) => state.units[id]).filter(Boolean);
}

export function unitCount(state: GameState, player: PlayerId): number {
  return state.field[player].length;
}

export function unitsOnSide(state: GameState, player: PlayerId, side: Side): UnitInstance[] {
  if (side === 'any') return allUnits(state);
  return unitsControlledBy(state, side === 'own' ? player : otherPlayer(player));
}

// --- stats -----------------------------------------------------------------

export function powerOf(state: GameState, id: string): number {
  return state.units[id]?.power ?? 0;
}

export function wisdomOf(state: GameState, id: string): number {
  return state.units[id]?.wisdom ?? 0;
}

export function wisdomOnSide(state: GameState, player: PlayerId, side: Side): number {
  return unitsOnSide(state, player, side).reduce((sum, u) => sum + u.wisdom, 0);
}

export function hasPowerAtLeastOnSide(state: GameState, player: PlayerId, side: Side, amount: number): boolean {
  return unitsOnSide(state, player, side).some((u) => u.power >= amount);
}

// The unit that is strictly highest across ALL of `stats` on the player's side
// (used by 배신자). Returns null if no single unit tops every stat.
export function highestInAllStats(state: GameState, player: PlayerId, stats: Array<'power' | 'wisdom'>): UnitInstance | null {
  const units = unitsControlledBy(state, player);
  for (const u of units) {
    const topsEach = stats.every((s) => units.every((o) => o === u || u[s] > o[s]));
    if (topsEach) return u;
  }
  return null;
}

// --- presence checks -------------------------------------------------------

export function hasUnitNamed(state: GameState, name: string): boolean {
  return allUnits(state).some((u) => getDef(u.cardId).name === name);
}

// A unit's effective keyword check, reading the (mutable) instance keywords and
// honoring the '*' all-keywords marker (마왕). Instance keywords are the source
// of truth so effects can grant/strip keywords like they buff 힘/지혜.
export function unitHasKeyword(unit: UnitInstance, keyword: string): boolean {
  return unit.keywords.includes('*') || unit.keywords.includes(keyword);
}

export function hasKeywordOnAnyField(state: GameState, keyword: string): boolean {
  return allUnits(state).some((u) => unitHasKeyword(u, keyword));
}

export function environmentHas(state: GameState, type: EnvType, value: string): boolean {
  return hasEnv(state.environment, type, value);
}

// --- hand & turn -----------------------------------------------------------

export function inHand(state: GameState, player: PlayerId, cardId: string): boolean {
  return state.hand[player].includes(cardId);
}

export function handCount(state: GameState, player: PlayerId): number {
  return state.hand[player].length;
}

export function handCardIds(state: GameState, player: PlayerId): string[] {
  return [...state.hand[player]];
}

// Card definition for a cardId — the read friend so policy code (forced.ts)
// never calls getDef directly.
export function defForCardId(cardId: string): CardDef {
  return getDef(cardId);
}

// --- forced abilities & rituals --------------------------------------------

export function ritualCount(state: GameState, name: string): number {
  return state.rituals[name] ?? 0;
}

export function hasForcedFired(state: GameState, key: string): boolean {
  return state.firedForced.includes(key);
}

export function isActiveTurn(state: GameState, player: PlayerId): boolean {
  return state.active === player;
}

export function isOpeningPhase(state: GameState): boolean {
  return state.phase === 'opening';
}

export function isMainPhase(state: GameState): boolean {
  return state.phase === 'main';
}

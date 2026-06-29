// Read-only "friends": the only place that knows the shape of GameState for
// reading. Board and conditions call these; nothing else reads state directly.

import { getDef } from './cards/CardRegistry.js';

import { hasEnv } from './environment.js';
import type { CardMeta } from './cards/Card.js';
import type { EnvType, GameState, PlayerId, Side, StatName, UnitInstance } from './types.js';

export function otherPlayer(p: PlayerId): PlayerId {
  return p === 'A' ? 'B' : 'A';
}

// --- Grid helpers ----------------------------------------------------------
// Hex grid adjacency (same-player cells). Used for movement and 협공.
//   Back row (5-8) sits behind front row (0-4), offset so each back cell
//   nestles between two front cells.
//
//   Back:  [5] [6] [7] [8]
//   Front: [0][1][2][3][4]
export const HEX_ADJACENT: Readonly<Record<number, readonly number[]>> = {
  0: [1, 5],
  1: [0, 2, 5, 6],
  2: [1, 3, 6, 7],
  3: [2, 4, 7, 8],
  4: [3, 8],
  5: [0, 1, 6],
  6: [1, 2, 5, 7],
  7: [2, 3, 6, 8],
  8: [3, 4, 7],
};

// Default cross-side attack range: which opponent front-row cells a unit in
// each cell can target. Back-row units shoot through the front line.
export const ATTACK_TARGETS: Readonly<Record<number, readonly number[]>> = {
  0: [0, 1],
  1: [0, 1, 2],
  2: [1, 2, 3],
  3: [2, 3, 4],
  4: [3, 4],
  5: [0, 1],
  6: [1, 2],
  7: [2, 3],
  8: [3, 4],
};

export function hexAdjacent(a: number, b: number): boolean {
  return (HEX_ADJACENT[a] as number[] | undefined)?.includes(b) ?? false;
}

export function unitAtCell(state: GameState, player: PlayerId, cell: number): string | null {
  return state.field[player][cell] ?? null;
}

// All opponent cells that an attacker can target (non-empty cells within attack range).
export function attackableTargets(state: GameState, attackerId: string): string[] {
  const u = state.units[attackerId];
  if (!u) return [];
  const opp = otherPlayer(u.controller);
  const targetCells = (ATTACK_TARGETS[u.cell] as number[] | undefined) ?? [];
  return targetCells
    .map((c) => state.field[opp][c])
    .filter((id): id is string => !!id && !isTrapped(state, id));
}

// --- units -----------------------------------------------------------------

export function findUnit(state: GameState, id: string): UnitInstance | undefined {
  return state.units[id];
}

export function unitExists(state: GameState, id: string): boolean {
  return !!state.units[id];
}

export function defOf(state: GameState, id: string): CardMeta {
  return getDef(state.units[id].cardId);
}

export function allUnits(state: GameState): UnitInstance[] {
  return Object.values(state.units);
}

export function allUnitIds(state: GameState): string[] {
  return [...state.field.A, ...state.field.B].filter((id): id is string => !!id);
}

export function fieldUnitIds(state: GameState, player: PlayerId): string[] {
  return state.field[player].filter((id): id is string => !!id);
}

export function unitsControlledBy(state: GameState, player: PlayerId): UnitInstance[] {
  return state.field[player]
    .filter((id): id is string => !!id)
    .map((id) => state.units[id])
    .filter(Boolean) as UnitInstance[];
}

export function unitCount(state: GameState, player: PlayerId): number {
  return state.field[player].filter(Boolean).length;
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

export function highestInAllStats(state: GameState, player: PlayerId, stats: Array<StatName>): UnitInstance | null {
  const units = unitsControlledBy(state, player);
  for (const u of units) {
    const topsEach = stats.every((s) => units.every((o) => o === u || u[s] > o[s]));
    if (topsEach) return u;
  }
  return null;
}

// --- cunning (지략) ---------------------------------------------------------

export function cunningOf(state: GameState, id: string): number {
  return state.units[id]?.cunning ?? 0;
}

export function cunningBlockerFor(state: GameState, opponent: PlayerId, amount: number): string | null {
  for (const id of state.field[opponent]) {
    if (!id) continue;
    const u = state.units[id];
    if (!u) continue;
    if (state.cunningUsedThisTurn.includes(id)) continue;
    if (u.cunning >= amount) return id;
  }
  return null;
}

export function isCardLocked(state: GameState, player: PlayerId, cardId: string): boolean {
  const locked = state.lockedThisTurn[player][cardId] ?? 0;
  if (locked === 0) return false;
  const inHand = state.hand[player].filter((c) => c === cardId).length;
  return locked >= inHand;
}

// Returns true if the specific hand slot at index is one of the locked copies.
// The first `lockedCount` occurrences of that cardId in the hand array are considered locked.
export function isHandSlotLocked(state: GameState, player: PlayerId, index: number): boolean {
  const hand = state.hand[player];
  const cardId = hand[index];
  if (!cardId) return false;
  const locked = state.lockedThisTurn[player][cardId] ?? 0;
  if (locked === 0) return false;
  let occurrences = 0;
  for (let i = 0; i <= index; i++) {
    if (hand[i] === cardId) occurrences++;
  }
  return occurrences <= locked;
}

export function isTrapped(state: GameState, instanceId: string): boolean {
  return state.trapped.includes(instanceId);
}

// A unit can attack if it hasn't already acted this turn and is not trapped in 오행산.
export function canAttack(state: GameState, instanceId: string): boolean {
  const u = state.units[instanceId];
  if (!u) return false;
  if (unitHasKeyword(u, 'cannotAttack')) return false;
  if (isTrapped(state, instanceId)) return false;
  return !state.actedThisTurn.includes(instanceId);
}

// A unit can move to toCell if it hasn't acted, the cell is adjacent, the cell is empty, and not trapped.
export function canMove(state: GameState, instanceId: string, toCell: number): boolean {
  const u = state.units[instanceId];
  if (!u) return false;
  if (state.actedThisTurn.includes(instanceId)) return false;
  if (isTrapped(state, instanceId)) return false;
  if (!hexAdjacent(u.cell, toCell)) return false;
  return !state.field[u.controller][toCell];
}

// A unit can cooperate in defense if it hasn't already blocked this turn,
// and its cell is adjacent to the attacked unit's cell.
export function canBlock(state: GameState, instanceId: string, attackedCell?: number): boolean {
  if (isTrapped(state, instanceId)) return false;
  const u = state.units[instanceId];
  if (!u) return false;
  // '이중방어' 유닛(전사)은 한 턴에 두 번까지 협공할 수 있다.
  const maxBlocks = unitHasKeyword(u, '이중방어') ? 2 : 1;
  const used = state.blockedThisTurn.filter((id) => id === instanceId).length;
  if (used >= maxBlocks) return false;
  if (attackedCell === undefined) return true;
  return hexAdjacent(u.cell, attackedCell);
}

// --- presence checks -------------------------------------------------------

export function hasUnitNamed(state: GameState, name: string): boolean {
  return allUnits(state).some((u) => getDef(u.cardId).name === name);
}

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

export function defForCardId(cardId: string): CardMeta {
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

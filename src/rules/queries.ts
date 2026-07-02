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

// findUnit과 달리 없으면 조용히 undefined를 주지 않고 던진다. 호출부가 이미 존재를
// 전제하는 위치(예: controllerOf 같은 편의 getter)에서 써서, 유닛이 사라진 뒤에도
// 핸들을 들고 있다가 잘못된 기본값(예: 'A')으로 조용히 오귀속되는 사고를 막는다.
export function requireUnit(state: GameState, id: string): UnitInstance {
  const u = state.units[id];
  if (!u) throw new Error(`requireUnit: no such unit ${id}`);
  return u;
}

export function defOf(state: GameState, id: string): CardMeta {
  return getDef(requireUnit(state, id).cardId);
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

export function maxWisdomOnSide(state: GameState, player: PlayerId, side: Side): number {
  const units = unitsOnSide(state, player, side);
  return units.length > 0 ? Math.max(...units.map((u) => u.wisdom)) : 0;
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

// 지략 opt-in: 임계 amount를 봉쇄할 수 있는 (미사용) 수비측 유닛 전부.
export function eligibleCunningBlockers(state: GameState, opponent: PlayerId, amount: number): string[] {
  const out: string[] = [];
  for (const id of state.field[opponent]) {
    if (!id) continue;
    const u = state.units[id];
    if (!u) continue;
    if (state.cunningUsedThisTurn.includes(id)) continue;
    if (u.cunning >= amount) out.push(id);
  }
  return out;
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

// 묘지(graveyard)에 해당 키워드를 가진 사망 유닛이 있는가 (교회 배경: 사망한 용사).
export function hasDeadWithKeyword(state: GameState, player: PlayerId, keyword: string, side: Side): boolean {
  const sides: PlayerId[] = side === 'any' ? ['A', 'B'] : side === 'opponent' ? [otherPlayer(player)] : [player];
  return sides.some((p) => state.graveyard[p].some((u) => u.keywords.includes('*') || u.keywords.includes(keyword)));
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
  if (unitHasKeyword(u, 'cannotMove')) return false;
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

// 협공(cooperative defense): targetId가 협공 가능한 수비측 유닛 전부. 대상 자신이
// noCoop(마왕 등)면 협공 수비를 받을 수 없으므로 빈 배열(= 단독 1:1로 즉시 해결).
export function coopBlockersFor(state: GameState, targetId: string): string[] {
  const target = state.units[targetId];
  if (!target) return [];
  if (unitHasKeyword(target, 'noCoop')) return [];
  const out: string[] = [];
  for (const id of state.field[target.controller]) {
    if (!id || id === targetId) continue;
    const u = state.units[id];
    if (!u || unitHasKeyword(u, 'noCoop')) continue;
    if (!canBlock(state, id, target.cell)) continue;
    out.push(id);
  }
  return out;
}

// --- presence checks -------------------------------------------------------

export function hasUnitNamed(state: GameState, name: string): boolean {
  return allUnits(state).some((u) => getDef(u.cardId).name === name);
}

// 특정 플레이어 전장에 해당 cardId 유닛이 있는가 (목 없는 기사: 머리 존재 확인).
export function hasUnitWithCardOnField(state: GameState, player: PlayerId, cardId: string): boolean {
  return fieldUnitIds(state, player).some((id) => state.units[id]?.cardId === cardId);
}

export function unitHasKeyword(unit: UnitInstance, keyword: string): boolean {
  return unit.keywords.includes('*') || unit.keywords.includes(keyword);
}

// instanceId 기반 편의형 — 유닛이 없으면 false.
export function unitIdHasKeyword(state: GameState, instanceId: string, keyword: string): boolean {
  const u = state.units[instanceId];
  return !!u && unitHasKeyword(u, keyword);
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

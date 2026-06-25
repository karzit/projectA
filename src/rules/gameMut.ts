// Low-level state mutations for the new ruleset. Every write to GameState
// happens here. Reads live in queries.ts; this module never queries.

import { emptyEnvironment } from './environment.js';
import { getDef } from './cards/CardRegistry.js';
import { unitCount } from './queries.js';
import type { CardMeta } from './cards/Card.js';
import type { GameState, PlayerId, StatName } from './types.js';

export interface SetupConfig {
  decks: Record<PlayerId, string[]>;
  starting?: PlayerId;
  seed?: number;
}

export function createGame(config: SetupConfig): GameState {
  return {
    environment: emptyEnvironment(),
    field: { A: [], B: [] },
    hand: { A: [...config.decks.A], B: [...config.decks.B] },
    units: {},
    seed: (config.seed ?? 12345) >>> 0,
    nextId: 1,
    turn: 1,
    active: config.starting ?? 'A',
    phase: 'opening',
    openingPlaced: { A: 0, B: 0 },
    openingDone: { A: false, B: false },
    openingPlays: { A: [], B: [] },
    rituals: {},
    firedForced: [],
    turnBuffs: [],
    pendingEvents: [],
    playedThisTurn: false,
    attackedThisTurn: [],
    blockedThisTurn: [],
    cunningUsedThisTurn: [],
    lockedThisTurn: { A: [], B: [] },
    loser: null,
  };
}

export function destroyUnit(state: GameState, instanceId: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  const def = getDef(u.cardId);
  state.pendingEvents.push({ kind: 'unitDied', instanceId, cardId: u.cardId, name: def.name, controller: u.controller });
  removeUnit(state, instanceId);
}

export function exitUnit(state: GameState, instanceId: string): void {
  removeUnit(state, instanceId);
}

function removeUnit(state: GameState, instanceId: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  const arr = state.field[u.controller];
  const i = arr.indexOf(instanceId);
  if (i >= 0) arr.splice(i, 1);
  delete state.units[instanceId];
}

export function summon(state: GameState, player: PlayerId, cardId: string): string {
  const idx = state.hand[player].indexOf(cardId);
  if (idx >= 0) state.hand[player].splice(idx, 1);
  return placeUnit(state, player, cardId);
}

export function summonCard(state: GameState, player: PlayerId, cardId: string): string {
  return placeUnit(state, player, cardId);
}

function placeUnit(state: GameState, player: PlayerId, cardId: string): string {
  const def = getDef(cardId);
  const instanceId = `u_${state.nextId++}`;
  state.units[instanceId] = {
    instanceId,
    cardId,
    owner: player,
    controller: player,
    keywords: initialKeywords(def),
    power: def.power ?? 0,
    wisdom: def.wisdom ?? 0,
    cunning: def.cunning ?? 0,
  };
  state.field[player].push(instanceId);
  return instanceId;
}

export function evolveTo(state: GameState, instanceId: string, newCardId: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  const def = getDef(newCardId);
  u.cardId = newCardId;
  u.keywords = initialKeywords(def);
}

function initialKeywords(def: CardMeta): string[] {
  if (def.allKeywords) return ['*'];
  const kws = [...(def.keywords ?? [])];
  if (def.cannotAttack && !kws.includes('cannotAttack')) kws.push('cannotAttack');
  return kws;
}

export function grantKeyword(state: GameState, instanceId: string, keyword: string): void {
  const u = state.units[instanceId];
  if (!u || u.keywords.includes('*') || u.keywords.includes(keyword)) return;
  u.keywords.push(keyword);
}

export function revokeKeyword(state: GameState, instanceId: string, keyword: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  const i = u.keywords.indexOf(keyword);
  if (i >= 0) u.keywords.splice(i, 1);
}

export function removeFromHand(state: GameState, player: PlayerId, cardId: string): void {
  const arr = state.hand[player];
  const i = arr.indexOf(cardId);
  if (i >= 0) arr.splice(i, 1);
}

export function addToHand(state: GameState, player: PlayerId, cardId: string): void {
  state.hand[player].push(cardId);
}

export function setController(state: GameState, instanceId: string, to: PlayerId): void {
  const u = state.units[instanceId];
  if (!u || u.controller === to) return;
  const from = state.field[u.controller];
  const i = from.indexOf(instanceId);
  if (i >= 0) from.splice(i, 1);
  u.controller = to;
  state.field[to].push(instanceId);
}

export function modifyStat(state: GameState, instanceId: string, stat: StatName, amount: number): void {
  const u = state.units[instanceId];
  if (u) u[stat] = Math.max(0, u[stat] + amount);
}

export function addTurnBuff(state: GameState, instanceId: string, stat: StatName, amount: number): void {
  modifyStat(state, instanceId, stat, amount);
  state.turnBuffs.push({ instanceId, stat, amount });
}

export function clearTurnBuffs(state: GameState): void {
  for (const b of state.turnBuffs) modifyStat(state, b.instanceId, b.stat, -b.amount);
  state.turnBuffs = [];
}

export function grantCunning(state: GameState, instanceId: string, amount: number): void {
  const u = state.units[instanceId];
  if (u) u.cunning = Math.max(0, u.cunning + amount);
}

// Mark a 지략 unit as having spent its 지략 this turn, and lock the blocked card
// for the playing player for the rest of their turn.
export function spendCunning(state: GameState, blockerId: string, player: PlayerId, cardId: string): void {
  if (!state.cunningUsedThisTurn.includes(blockerId)) state.cunningUsedThisTurn.push(blockerId);
  if (!state.lockedThisTurn[player].includes(cardId)) state.lockedThisTurn[player].push(cardId);
}

export function resetCunningTurn(state: GameState): void {
  state.cunningUsedThisTurn = [];
  state.lockedThisTurn = { A: [], B: [] };
}

export function swapStats(state: GameState, aId: string, bId: string): void {
  const a = state.units[aId];
  const b = state.units[bId];
  if (!a || !b) return;
  const { power: p, wisdom: w } = a;
  a.power = b.power; a.wisdom = b.wisdom;
  b.power = p;       b.wisdom = w;
}

export function performRitual(state: GameState, name: string): void {
  state.rituals[name] = (state.rituals[name] ?? 0) + 1;
}

export function markForcedFired(state: GameState, key: string): void {
  if (!state.firedForced.includes(key)) state.firedForced.push(key);
}

export function nextRandom(state: GameState): number {
  let s = (state.seed + 0x6d2b79f5) >>> 0;
  state.seed = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A player whose field is empty at end of turn loses. On a simultaneous empty
// (both fields), the turn-ender (the player who just passed) loses.
export function checkLoss(state: GameState, turnEnder?: PlayerId): PlayerId | null {
  const aEmpty = unitCount(state, 'A') === 0;
  const bEmpty = unitCount(state, 'B') === 0;
  if (aEmpty && bEmpty) return turnEnder ?? 'A';
  if (aEmpty) return 'A';
  if (bEmpty) return 'B';
  return null;
}

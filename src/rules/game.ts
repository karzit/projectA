// Game setup + the WRITE layer for the new ruleset. Setup (createGame) plus every
// state MUTATION lives here (summon, destroy, setController, stat changes, ritual
// counter, forced-fired bookkeeping, the seeded PRNG). Policy code never mutates
// state shape directly — it calls these. Reads live in queries.ts.

import { emptyEnvironment } from './environment.js';
import { getDef } from './cards.js';
import { handCount, unitCount } from './queries.js';
import type { GameState, PlayerId, UnitInstance } from './types.js';

export interface SetupConfig {
  decks: Record<PlayerId, string[]>; // exactly 15 cardIds each; all start in hand
  starting?: PlayerId;
  seed?: number;
}

export function createGame(config: SetupConfig): GameState {
  return {
    environment: emptyEnvironment(),
    field: { A: [], B: [] },
    hand: { A: [...config.decks.A], B: [...config.decks.B] }, // all cards in hand
    units: {},
    seed: (config.seed ?? 12345) >>> 0,
    nextId: 1,
    turn: 1,
    active: config.starting ?? 'A',
    phase: 'opening',
    openingPlaced: { A: 0, B: 0 },
    openingDone: { A: false, B: false },
    rituals: {},
    firedForced: [],
    loser: null,
  };
}

// Remove a unit from play (combat loss or card effect). The card is gone; this
// is how a field empties toward the loss condition.
export function destroyUnit(state: GameState, instanceId: string): void {
  const u = state.units[instanceId];
  if (!u) return;
  const arr = state.field[u.controller];
  const i = arr.indexOf(instanceId);
  if (i >= 0) arr.splice(i, 1);
  delete state.units[instanceId];
}

// Put a unit from a player's hand onto their field (no condition check — callers
// use canPlay first). Returns the new unit's instanceId. This is the primitive
// the (future) turn loop and forced abilities build on.
export function summon(state: GameState, player: PlayerId, cardId: string): string {
  const idx = state.hand[player].indexOf(cardId);
  if (idx >= 0) state.hand[player].splice(idx, 1);
  const def = getDef(cardId);
  const instanceId = `u_${state.nextId++}`;
  const unit: UnitInstance = {
    instanceId,
    cardId,
    owner: player,
    controller: player,
    keywords: def.allKeywords ? ['*'] : [...(def.keywords ?? [])],
    power: def.power ?? 0,
    wisdom: def.wisdom ?? 0,
  };
  state.units[instanceId] = unit;
  state.field[player].push(instanceId);
  return instanceId;
}

// Remove a card from a player's hand (e.g. a spell that was played).
export function removeFromHand(state: GameState, player: PlayerId, cardId: string): void {
  const arr = state.hand[player];
  const i = arr.indexOf(cardId);
  if (i >= 0) arr.splice(i, 1);
}

// Move a unit to another player's control (배신자 defect).
export function setController(state: GameState, instanceId: string, to: PlayerId): void {
  const u = state.units[instanceId];
  if (!u || u.controller === to) return;
  const from = state.field[u.controller];
  const i = from.indexOf(instanceId);
  if (i >= 0) from.splice(i, 1);
  u.controller = to;
  state.field[to].push(instanceId);
}

// Adjust a unit's mutable stat (힘/지혜), clamped at 0. The single place stat
// writes happen — effects.ts calls this instead of touching state.units.
export function modifyStat(state: GameState, instanceId: string, stat: 'power' | 'wisdom', amount: number): void {
  const u = state.units[instanceId];
  if (u) u[stat] = Math.max(0, u[stat] + amount);
}

// Swap two units' 힘/지혜 (혁명). No-op if either is missing.
export function swapStats(state: GameState, aId: string, bId: string): void {
  const a = state.units[aId];
  const b = state.units[bId];
  if (!a || !b) return;
  const p = a.power;
  const w = a.wisdom;
  a.power = b.power;
  a.wisdom = b.wisdom;
  b.power = p;
  b.wisdom = w;
}

// Advance a named ritual counter (마왕 부활 의식). Forced triggers read the count.
export function performRitual(state: GameState, name: string): void {
  state.rituals[name] = (state.rituals[name] ?? 0) + 1;
}

// Record that a 'once' forced ability fired, so it never fires again this game.
export function markForcedFired(state: GameState, key: string): void {
  if (!state.firedForced.includes(key)) state.firedForced.push(key);
}

// Deterministic PRNG step (mulberry32), advancing state.seed. Returns [0, 1).
export function nextRandom(state: GameState): number {
  let s = (state.seed + 0x6d2b79f5) >>> 0;
  state.seed = s;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A player loses when their field AND hand are both empty.
export function checkLoss(state: GameState): PlayerId | null {
  for (const p of ['A', 'B'] as PlayerId[]) {
    if (unitCount(state, p) === 0 && handCount(state, p) === 0) return p;
  }
  return null;
}

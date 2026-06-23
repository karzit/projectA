// Test-only scenario helpers. GameState is plain data, so for targeted mechanic
// tests we construct boards directly (bypassing draw/shuffle) and then exercise
// the engine through real Actions.

import { reduce } from '../src/engine/index.js';
import type { CardInstance, GameState, PlayerId } from '../src/engine/index.js';

// A deck with several copies of every sample card, so board helpers can always
// pull a fresh copy from the library after the opening draw.
const dup = (n: number, id: string) => Array.from({ length: n }, () => id);
export const RICH_DECK: string[] = [
  ...dup(8, 'forest'),
  ...dup(8, 'mountain'),
  ...dup(8, 'plains'),
  ...dup(8, 'island'),
  ...dup(8, 'swamp'),
  ...dup(4, 'grizzly-bears'),
  ...dup(4, 'hill-giant'),
  ...dup(4, 'serra-angel'),
  ...dup(4, 'goblin-raider'),
  ...dup(4, 'lightning-strike'),
  ...dup(4, 'divination'),
  ...dup(4, 'healing-salve'),
  ...dup(4, 'inspiring-scholar'),
  ...dup(4, 'grave-warden'),
  ...dup(4, 'pain-sage'),
  ...dup(4, 'omen-owl'),
  ...dup(4, 'vindictive-ghost'),
  ...dup(4, 'toll-keeper'),
];

export function findCard(
  state: GameState,
  player: PlayerId,
  oracleId: string,
  zone: CardInstance['zone'],
): string | undefined {
  return Object.values(state.cards).find(
    (c) => c.owner === player && c.oracleId === oracleId && c.zone === zone,
  )?.instanceId;
}

function takeFromLibrary(state: GameState, player: PlayerId, oracleId: string): string {
  const id = findCard(state, player, oracleId, 'library');
  if (!id) throw new Error(`No ${oracleId} left in ${player}'s library to place`);
  const arr = state.zones[player].library;
  arr.splice(arr.indexOf(id), 1);
  return id;
}

// Move a fresh copy of `oracleId` from library directly onto the battlefield,
// ready to act (not summoning sick, untapped).
export function putOnBattlefield(state: GameState, player: PlayerId, oracleId: string): string {
  const id = takeFromLibrary(state, player, oracleId);
  const c = state.cards[id];
  c.zone = 'battlefield';
  c.controller = player;
  c.tapped = false;
  c.summoningSick = false;
  c.damage = 0;
  state.zones[player].battlefield.push(id);
  return id;
}

// Move a copy of `oracleId` from library into hand.
export function putInHand(state: GameState, player: PlayerId, oracleId: string): string {
  const id = takeFromLibrary(state, player, oracleId);
  state.cards[id].zone = 'hand';
  state.zones[player].hand.push(id);
  return id;
}

// Put a copy of `oracleId` on top of the player's library (index 0 = next draw).
export function putOnTopOfLibrary(state: GameState, player: PlayerId, oracleId: string): string {
  const id = takeFromLibrary(state, player, oracleId);
  state.zones[player].library.unshift(id);
  return id;
}

// Auto-pass priority (both players) until the stack is empty, without advancing
// past the current step. Used to resolve spells and the triggered abilities they
// queue.
export function resolveStack(state: GameState): GameState {
  let cur = state;
  let guard = 0;
  while (cur.stack.length > 0 && !cur.gameOver && cur.priority) {
    if (guard++ > 500) throw new Error('resolveStack: stuck');
    const r = reduce(cur, { type: 'passPriority', player: cur.priority });
    if (r.error) throw new Error(r.error);
    cur = r.state;
  }
  return cur;
}

// One automatic step: resolve a required declaration as "no attackers/blockers",
// otherwise pass priority for whoever holds it.
function autoStep(state: GameState): GameState {
  if (state.awaiting?.kind === 'declareAttackers') {
    const r = reduce(state, { type: 'declareAttackers', player: state.awaiting.player, attackers: [] });
    if (r.error) throw new Error(r.error);
    return r.state;
  }
  if (state.awaiting?.kind === 'declareBlockers') {
    const r = reduce(state, { type: 'declareBlockers', player: state.awaiting.player, blocks: {} });
    if (r.error) throw new Error(r.error);
    return r.state;
  }
  if (state.priority) {
    const r = reduce(state, { type: 'passPriority', player: state.priority });
    if (r.error) throw new Error(r.error);
    return r.state;
  }
  throw new Error('autoStep: no priority and nothing awaited');
}

// Drive the engine forward (auto-passing, auto-declaring empty combat) until the
// predicate holds or the game ends.
export function runUntil(state: GameState, pred: (s: GameState) => boolean): GameState {
  let cur = state;
  let guard = 0;
  while (!pred(cur) && !cur.gameOver) {
    if (guard++ > 2000) throw new Error('runUntil: too many iterations');
    cur = autoStep(cur);
  }
  return cur;
}

export const atMain1 = (s: GameState) => s.step === 'main1';
export const awaitingAttackers = (s: GameState) => s.awaiting?.kind === 'declareAttackers';
export const awaitingBlockers = (s: GameState) => s.awaiting?.kind === 'declareBlockers';

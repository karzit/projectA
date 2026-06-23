// Game construction and a couple of small driver helpers. createGame builds a
// fresh, deterministic GameState from two decklists and a seed, shuffles
// libraries, draws opening hands, and starts player one's first turn.

import { emptyPool } from './mana.js';
import { startTurn } from './phases.js';
import { drawCard } from './effects.js';
import { shuffle } from './rng.js';
import { reduce } from './reducer.js';
import type { Action } from './actions.js';
import type { CardInstance, GameEvent, GameState, PlayerId, PlayerZones } from './types.js';

export interface GameConfig {
  seed?: number;
  startingLife?: number;
  handSize?: number;
  decks: Record<PlayerId, string[]>; // ordered list of oracleIds per player
}

function emptyZones(): PlayerZones {
  return { library: [], hand: [], graveyard: [], exile: [], battlefield: [] };
}

export function createGame(config: GameConfig): GameState {
  const seed = (config.seed ?? 12345) >>> 0;
  const life = config.startingLife ?? 20;
  const handSize = config.handSize ?? 7;

  const state: GameState = {
    seed,
    nextId: 1,
    turn: 0, // startTurn() will increment to 1
    activePlayer: 'P0',
    step: 'untap',
    priority: null,
    consecutivePasses: 0,
    awaiting: null,
    stack: [],
    cards: {},
    zones: { P0: emptyZones(), P1: emptyZones() },
    players: {
      P0: { id: 'P0', life, manaPool: emptyPool(), landPlaysRemaining: 1, hasLost: false, drewFromEmpty: false },
      P1: { id: 'P1', life, manaPool: emptyPool(), landPlaysRemaining: 1, hasLost: false, drewFromEmpty: false },
    },
    combat: null,
    winner: null,
    gameOver: false,
  };

  // Instantiate every card straight into its owner's library.
  for (const pid of ['P0', 'P1'] as PlayerId[]) {
    for (const oracleId of config.decks[pid]) {
      const instanceId = `c_${state.nextId++}`;
      const card: CardInstance = {
        instanceId,
        oracleId,
        owner: pid,
        controller: pid,
        zone: 'library',
        tapped: false,
        damage: 0,
        counters: {},
        summoningSick: false,
      };
      state.cards[instanceId] = card;
      state.zones[pid].library.push(instanceId);
    }
    state.zones[pid].library = shuffle(state, state.zones[pid].library);
  }

  // Opening hands (no mulligans modeled here).
  const setupEvents: GameEvent[] = [];
  for (const pid of ['P0', 'P1'] as PlayerId[]) {
    for (let i = 0; i < handSize; i++) drawCard(state, pid, setupEvents);
  }

  // Begin P0's first turn (turn 1; their draw step is skipped per the rules).
  startTurn(state, 'P0', setupEvents);
  return state;
}

// Convenience: apply a sequence of actions, throwing on the first illegal one.
// Handy for tests and scripted scenarios.
export function applyActions(state: GameState, actions: Action[]): { state: GameState; events: GameEvent[] } {
  let cur = state;
  const all: GameEvent[] = [];
  for (const action of actions) {
    const res = reduce(cur, action);
    if (res.error) throw new Error(`Illegal action ${JSON.stringify(action)}: ${res.error}`);
    cur = res.state;
    all.push(...res.events);
  }
  return { state: cur, events: all };
}

// Auto-pass priority for whoever currently holds it, repeatedly, until the
// engine reaches `targetStep` (or a declaration is required, or the game ends).
// Models "both players keep passing" so tests can fast-forward the turn.
export function passUntil(state: GameState, targetStep: GameState['step']): GameState {
  let cur = state;
  let guard = 0;
  while (cur.step !== targetStep && !cur.gameOver && !cur.awaiting && cur.priority) {
    if (guard++ > 1000) throw new Error('passUntil: too many iterations (stuck?)');
    const res = reduce(cur, { type: 'passPriority', player: cur.priority });
    if (res.error) throw new Error(`passUntil pass failed: ${res.error}`);
    cur = res.state;
  }
  return cur;
}

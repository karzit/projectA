// Turn structure: the ordered steps, entering a step (turn-based actions +
// priority assignment), and advancing between steps and turns.

import { getDef } from './cards.js';
import { emptyCombat, dealCombatDamage } from './combat.js';
import { drawCard } from './effects.js';
import { emptyPool } from './mana.js';
import type { AwaitingAction, GameEvent, GameState, PlayerId, Step } from './types.js';

const ORDER: Step[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endCombat',
  'main2',
  'end',
  'cleanup',
];

export function otherPlayer(p: PlayerId): PlayerId {
  return p === 'P0' ? 'P1' : 'P0';
}

export function emptyManaPools(state: GameState): void {
  state.players.P0.manaPool = emptyPool();
  state.players.P1.manaPool = emptyPool();
}

export function grantPriority(state: GameState, events: GameEvent[]): void {
  state.priority = state.activePlayer;
  state.awaiting = null;
  state.consecutivePasses = 0;
  events.push({ type: 'priority', player: state.priority });
}

function setAwaiting(state: GameState, player: PlayerId, kind: AwaitingAction['kind'], events: GameEvent[]): void {
  state.priority = null;
  state.consecutivePasses = 0;
  state.awaiting = { player, kind };
  events.push({ type: 'awaiting', player, kind });
  events.push({ type: 'priority', player: null });
}

function untapActiveAndClearSickness(state: GameState): void {
  for (const id of state.zones[state.activePlayer].battlefield) {
    const c = state.cards[id];
    c.tapped = false;
    c.summoningSick = false; // controlled since the start of this turn
    c.damage = 0; // (damage already wears off at cleanup; defensive reset)
  }
}

function cleanup(state: GameState): void {
  for (const c of Object.values(state.cards)) {
    if (c.zone === 'battlefield') {
      c.damage = 0;
      c.attackedFlag = false;
    }
  }
  emptyManaPools(state);
}

export function startTurn(state: GameState, player: PlayerId, events: GameEvent[]): void {
  state.turn += 1;
  state.activePlayer = player;
  state.combat = null;
  state.players[player].landPlaysRemaining = 1;
  enterStep(state, 'untap', events);
}

function nextStep(state: GameState): Step {
  // Skip the block/damage steps when nobody is attacking.
  if (state.step === 'declareAttackers') {
    const attackerCount = state.combat ? Object.keys(state.combat.attackers).length : 0;
    if (attackerCount === 0) return 'endCombat';
  }
  const i = ORDER.indexOf(state.step);
  return ORDER[i + 1];
}

export function advanceStep(state: GameState, events: GameEvent[]): void {
  if (state.gameOver) return;
  if (state.step === 'cleanup') {
    startTurn(state, otherPlayer(state.activePlayer), events);
    return;
  }
  enterStep(state, nextStep(state), events);
}

export function enterStep(state: GameState, step: Step, events: GameEvent[]): void {
  state.step = step;
  emptyManaPools(state);
  events.push({ type: 'stepChange', step, turn: state.turn, activePlayer: state.activePlayer });

  switch (step) {
    case 'untap':
      untapActiveAndClearSickness(state);
      advanceStep(state, events); // no priority during untap
      return;

    case 'draw':
      // The player who takes the first turn of the game skips their draw.
      if (state.turn !== 1) drawCard(state, state.activePlayer, events);
      grantPriority(state, events);
      return;

    case 'beginCombat':
      state.combat = emptyCombat();
      grantPriority(state, events);
      return;

    case 'declareAttackers':
      setAwaiting(state, state.activePlayer, 'declareAttackers', events);
      return;

    case 'declareBlockers':
      setAwaiting(state, otherPlayer(state.activePlayer), 'declareBlockers', events);
      return;

    case 'combatDamage':
      dealCombatDamage(state, events);
      grantPriority(state, events); // SBA is run by the reducer after this
      return;

    case 'main2':
      state.combat = null;
      grantPriority(state, events);
      return;

    case 'cleanup':
      cleanup(state);
      advanceStep(state, events); // rolls into the next turn
      return;

    default:
      // upkeep, main1, endCombat, end
      grantPriority(state, events);
      return;
  }
}

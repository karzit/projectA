// The reducer for the new ruleset. Pure: never mutates the input; illegal
// actions return the original state plus an error.
//
// Turn model (per the confirmed rules):
//  - Opening: both sides place up to 3 cards (interleaved freely). When both have
//    placed 3 or called finishOpening, the main phase begins with the starter.
//  - Main: on your turn you take ONE action — play / attack / pass — then the
//    turn passes to the opponent. Playing is optional.
//  - Combat uses 힘 (power): the lower-power unit is destroyed; a tie destroys
//    both. Cards/effects can also destroy units.
//  - Loss: a player whose field AND hand are both empty loses.
//
// Assumptions still open (flagged in the README): 지혜(wisdom)-as-resource is not
// yet wired; forced abilities (복수자/배신자/마왕) are modeled as data but their
// automatic evaluation is a separate step; one action per main turn.

import { developAll } from './environment.js';
import { canPlay } from './conditions.js';
import { getDef } from './cards.js';
import { newContext, resolveEffects } from './effects.js';
import { settleForced } from './forced.js';
import { checkLoss, destroyUnit, removeFromHand, summon } from './game.js';
import {
  findUnit,
  inHand,
  isActiveTurn,
  isMainPhase,
  isOpeningPhase,
  otherPlayer,
  powerOf,
} from './queries.js';
import type { RulesAction, RulesResult } from './actions.js';
import type { GameState, PlayerId } from './types.js';

class Illegal extends Error {}
function fail(msg: string): never {
  throw new Illegal(msg);
}

export function reduce(prev: GameState, action: RulesAction): RulesResult {
  const state = structuredClone(prev);
  try {
    if (state.loser) fail('the game is over');
    apply(state, action);
    // Settle forced abilities (복수자/배신자/마왕) to a fixpoint before judging
    // loss — only in the main phase; during the opening, players are still
    // placing and auto-summons would interfere. (WHEN to evaluate is a design
    // choice flagged in README; main-phase-only is the current default.)
    if (isMainPhase(state)) settleForced(state);
    state.loser = checkLoss(state);
  } catch (e) {
    if (e instanceof Illegal) return { state: prev, error: e.message };
    throw e;
  }
  return { state };
}

function apply(state: GameState, action: RulesAction): void {
  switch (action.type) {
    case 'placeOpening':
      return placeOpening(state, action.player, action.cardId);
    case 'finishOpening':
      return finishOpening(state, action.player);
    case 'play':
      return play(state, action.player, action.cardId, action.choices ?? []);
    case 'attack':
      return attack(state, action.player, action.attackerId, action.targetId);
    case 'pass':
      return pass(state, action.player);
  }
}

// --- shared ----------------------------------------------------------------

function endTurn(state: GameState): void {
  state.active = otherPlayer(state.active);
  state.turn += 1;
}

// Play a card from hand: a unit is summoned (then runs its enter effects); a
// spell develops the environment and runs its effects. 배경 conditions are
// checked here only. `choices` feed the card's 'chosen' effect selectors.
function playCardInternal(state: GameState, player: PlayerId, cardId: string, choices: string[]): void {
  if (!inHand(state, player, cardId)) fail('that card is not in your hand');
  const def = getDef(cardId);
  const check = canPlay(state, def, player);
  if (!check.ok) fail(`cannot play ${def.name}: ${check.reason ?? 'background conditions not met'}`);

  let sourceUnit: string | undefined;
  if (def.kind === 'unit') {
    sourceUnit = summon(state, player, cardId); // removes from hand, places on field
  } else {
    removeFromHand(state, player, cardId);
  }

  // 전개 (convenience) then the general effects, sharing one resolution context.
  state.environment = developAll(state.environment, def.develops ?? []);
  if (def.effects?.length) {
    resolveEffects(state, def.effects, newContext(player, cardId, choices, sourceUnit));
  }
}

// --- opening ---------------------------------------------------------------

function placeOpening(state: GameState, player: PlayerId, cardId: string): void {
  if (!isOpeningPhase(state)) fail('not the opening phase');
  if (state.openingDone[player]) fail('you have finished your opening');
  if (state.openingPlaced[player] >= 3) fail('opening is limited to 3 cards');
  playCardInternal(state, player, cardId, []);
  state.openingPlaced[player] += 1;
  if (state.openingPlaced[player] >= 3) state.openingDone[player] = true;
  maybeStartMain(state);
}

function finishOpening(state: GameState, player: PlayerId): void {
  if (!isOpeningPhase(state)) fail('not the opening phase');
  state.openingDone[player] = true;
  maybeStartMain(state);
}

function maybeStartMain(state: GameState): void {
  if (state.openingDone.A && state.openingDone.B) {
    state.phase = 'main';
    state.active = 'A'; // the starter takes the first main turn
    state.turn = 1;
  }
}

// --- main ------------------------------------------------------------------

function requireMainTurn(state: GameState, player: PlayerId): void {
  if (!isMainPhase(state)) fail('not the main phase');
  if (!isActiveTurn(state, player)) fail('it is not your turn');
}

function play(state: GameState, player: PlayerId, cardId: string, choices: string[]): void {
  requireMainTurn(state, player);
  playCardInternal(state, player, cardId, choices);
  endTurn(state);
}

// 힘(power) combat: compare attacker and target power; the lower is destroyed,
// a tie destroys both.
function attack(state: GameState, player: PlayerId, attackerId: string, targetId: string): void {
  requireMainTurn(state, player);
  const attacker = findUnit(state, attackerId);
  const target = findUnit(state, targetId);
  if (!attacker || attacker.controller !== player) fail('not your unit');
  if (!target || target.controller === player) fail('target must be an enemy unit');

  const ap = powerOf(state, attackerId);
  const dp = powerOf(state, targetId);
  if (ap >= dp) destroyUnit(state, targetId);
  if (ap <= dp) destroyUnit(state, attackerId);

  endTurn(state);
}

function pass(state: GameState, player: PlayerId): void {
  requireMainTurn(state, player);
  endTurn(state);
}

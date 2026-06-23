// The reducer: the single orchestrator that turns an Action into a new state.
//
//   reduce(state, action) -> { state, events, error? }
//
// Pure: it never mutates `prev`. On an illegal action it returns the original
// state plus an error string (so a server can reject without crashing). All
// mutation happens on a structural clone, after which State-Based Actions run.

import { applyEffects } from './effects.js';
import { getDef, isPermanentType } from './cards.js';
import { canPay, pay } from './mana.js';
import { emptyCombat } from './combat.js';
import { advanceStep, grantPriority, otherPlayer, startTurn } from './phases.js';
import { runSBA } from './sba.js';
import { collectTriggers } from './triggers.js';
import { moveCard } from './zones.js';
import type { Action, ReduceResult } from './actions.js';
import type { GameEvent, GameState, PlayerId, StackObject, TargetRef, TargetSpec } from './types.js';

class IllegalAction extends Error {}
function fail(msg: string): never {
  throw new IllegalAction(msg);
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function nextId(state: GameState, prefix: string): string {
  return `${prefix}_${state.nextId++}`;
}

export function reduce(prev: GameState, action: Action): ReduceResult {
  const state = clone(prev);
  const events: GameEvent[] = [];
  try {
    if (state.gameOver) fail('the game is over');
    apply(state, action, events);
    runSBA(state, events);
    // After the board settles, gather triggered abilities that watched the
    // events produced this step and put them on the stack.
    collectTriggers(state, events);
  } catch (e) {
    if (e instanceof IllegalAction) return { state: prev, events: [], error: e.message };
    throw e;
  }
  return { state, events };
}

function apply(state: GameState, action: Action, events: GameEvent[]): void {
  switch (action.type) {
    case 'passPriority':
      return passPriority(state, action.player, events);
    case 'playLand':
      return playLand(state, action.player, action.instanceId, events);
    case 'tapForMana':
      return tapForMana(state, action.player, action.instanceId, events);
    case 'castSpell':
      return castSpell(state, action.player, action.instanceId, action.targets ?? [], events);
    case 'declareAttackers':
      return declareAttackers(state, action.player, action.attackers, events);
    case 'declareBlockers':
      return declareBlockers(state, action.player, action.blocks, events);
  }
}

// --- timing / priority guards ---------------------------------------------

function requirePriority(state: GameState, player: PlayerId): void {
  if (state.awaiting) fail('a declaration is required before passing priority');
  if (state.priority !== player) fail('you do not have priority');
}

function requireSorceryTiming(state: GameState, player: PlayerId): void {
  if (state.activePlayer !== player) fail('only the active player may do this');
  if (state.step !== 'main1' && state.step !== 'main2') fail('only during a main phase');
  if (state.stack.length > 0) fail('the stack must be empty');
}

// --- priority & stack resolution ------------------------------------------

function passPriority(state: GameState, player: PlayerId, events: GameEvent[]): void {
  if (state.awaiting) fail('a declaration is required, not a priority pass');
  if (state.priority !== player) fail('you do not have priority');

  state.consecutivePasses += 1;
  if (state.consecutivePasses < 2) {
    state.priority = otherPlayer(player);
    events.push({ type: 'priority', player: state.priority });
    return;
  }

  // All players passed in succession.
  state.consecutivePasses = 0;
  if (state.stack.length > 0) {
    resolveTop(state, events);
    runSBA(state, events);
    if (!state.gameOver) grantPriority(state, events); // active player gets priority
  } else {
    advanceStep(state, events);
  }
}

function resolveTop(state: GameState, events: GameEvent[]): void {
  const obj = state.stack.pop();
  if (!obj) return;
  events.push({ type: 'resolve', stackId: obj.id });
  const def = getDef(obj.oracleId);

  if (obj.kind === 'spell' && obj.cardInstanceId) {
    if (isPermanentType(def)) {
      moveCard(state, obj.cardInstanceId, 'battlefield', events, { toController: obj.controller });
    } else {
      applyEffects(state, obj, events);
      moveCard(state, obj.cardInstanceId, 'graveyard', events);
    }
  } else {
    applyEffects(state, obj, events);
  }
}

// --- special actions -------------------------------------------------------

function playLand(state: GameState, player: PlayerId, instanceId: string, events: GameEvent[]): void {
  requirePriority(state, player);
  requireSorceryTiming(state, player);
  const card = state.cards[instanceId];
  if (!card || card.owner !== player) fail('no such card');
  if (card.zone !== 'hand') fail('that card is not in your hand');
  if (!getDef(card.oracleId).types.includes('land')) fail('that card is not a land');
  if (state.players[player].landPlaysRemaining <= 0) fail('no land plays remaining this turn');

  moveCard(state, instanceId, 'battlefield', events, { toController: player });
  state.players[player].landPlaysRemaining -= 1;
  state.consecutivePasses = 0; // a game action occurred
}

function tapForMana(state: GameState, player: PlayerId, instanceId: string, events: GameEvent[]): void {
  requirePriority(state, player);
  const card = state.cards[instanceId];
  if (!card || card.zone !== 'battlefield' || card.controller !== player) fail('not a permanent you control');
  const def = getDef(card.oracleId);
  if (!def.produces || def.produces.length === 0) fail('that permanent produces no mana');
  if (card.tapped) fail('that permanent is already tapped');

  card.tapped = true;
  events.push({ type: 'tap', instanceId, tapped: true });
  state.players[player].manaPool[def.produces[0]] += 1; // mana abilities don't use the stack
  state.consecutivePasses = 0;
}

function castSpell(
  state: GameState,
  player: PlayerId,
  instanceId: string,
  targets: TargetRef[],
  events: GameEvent[],
): void {
  requirePriority(state, player);
  const card = state.cards[instanceId];
  if (!card || card.controller !== player) fail('no such card');
  if (card.zone !== 'hand') fail('that card is not in your hand');
  const def = getDef(card.oracleId);
  if (def.types.includes('land')) fail('lands are played, not cast');
  if (!def.cost) fail('that card cannot be cast');

  const instantSpeed = def.types.includes('instant') || !!def.keywords?.includes('flash');
  if (!instantSpeed) requireSorceryTiming(state, player);

  const required = def.targets ?? [];
  if (targets.length !== required.length) fail('wrong number of targets');
  validateTargets(state, player, required, targets);

  const pool = state.players[player].manaPool;
  if (!canPay(pool, def.cost)) fail('not enough mana available');
  state.players[player].manaPool = pay(pool, def.cost);

  moveCard(state, instanceId, 'stack', events);
  const obj: StackObject = {
    id: nextId(state, 'stk'),
    kind: 'spell',
    controller: player,
    oracleId: def.oracleId,
    cardInstanceId: instanceId,
    effect: def.effect ?? [],
    targets,
  };
  state.stack.push(obj);
  events.push({ type: 'cast', stackId: obj.id, oracleId: def.oracleId, controller: player });

  // The caster retains priority and may respond to their own spell.
  state.priority = player;
  state.consecutivePasses = 0;
  events.push({ type: 'priority', player });
}

function isCreatureOnField(state: GameState, ref: TargetRef): boolean {
  if (ref.kind !== 'permanent') return false;
  const c = state.cards[ref.instanceId];
  return !!c && c.zone === 'battlefield' && getDef(c.oracleId).types.includes('creature');
}

function validateTargets(state: GameState, caster: PlayerId, specs: TargetSpec[], refs: TargetRef[]): void {
  specs.forEach((spec, i) => {
    const ref = refs[i];
    switch (spec) {
      case 'anyTarget':
        if (ref.kind === 'player') return;
        if (isCreatureOnField(state, ref)) return;
        fail('invalid target (any target must be a player or creature)');
        break;
      case 'creature':
        if (isCreatureOnField(state, ref)) return;
        fail('invalid target (must be a creature)');
        break;
      case 'player':
        if (ref.kind === 'player') return;
        fail('invalid target (must be a player)');
        break;
      case 'opponent':
        if (ref.kind === 'player' && ref.player !== caster) return;
        fail('invalid target (must be an opponent)');
        break;
    }
  });
}

// --- combat ----------------------------------------------------------------

function declareAttackers(state: GameState, player: PlayerId, attackers: string[], events: GameEvent[]): void {
  if (!state.awaiting || state.awaiting.kind !== 'declareAttackers') fail('not the declare-attackers step');
  if (state.awaiting.player !== player) fail('it is not your combat');
  if (!state.combat) state.combat = emptyCombat();
  const defender = otherPlayer(player);

  // Validate the whole set before committing (all-or-nothing).
  for (const id of attackers) {
    const c = state.cards[id];
    if (!c || c.controller !== player || c.zone !== 'battlefield') fail('invalid attacker');
    const def = getDef(c.oracleId);
    if (!def.types.includes('creature')) fail('only creatures can attack');
    if (c.tapped) fail('a tapped creature cannot attack');
    if (c.summoningSick && !def.keywords?.includes('haste')) fail('a summoning-sick creature cannot attack');
  }

  for (const id of attackers) {
    const c = state.cards[id];
    const def = getDef(c.oracleId);
    state.combat.attackers[id] = defender;
    c.attackedFlag = true;
    if (!def.keywords?.includes('vigilance')) {
      c.tapped = true;
      events.push({ type: 'tap', instanceId: id, tapped: true });
    }
  }

  grantPriority(state, events); // combat priority round in the declare-attackers step
}

function declareBlockers(
  state: GameState,
  player: PlayerId,
  blocks: Record<string, string[]>,
  events: GameEvent[],
): void {
  if (!state.awaiting || state.awaiting.kind !== 'declareBlockers') fail('not the declare-blockers step');
  if (state.awaiting.player !== player) fail('it is not your declaration');
  if (!state.combat) fail('there is no combat');

  const used = new Set<string>();
  for (const attId of Object.keys(blocks)) {
    if (!(attId in state.combat.attackers)) fail('that creature is not attacking');
    const adef = getDef(state.cards[attId].oracleId);
    for (const bId of blocks[attId]) {
      const b = state.cards[bId];
      if (!b || b.controller !== player || b.zone !== 'battlefield') fail('invalid blocker');
      if (!getDef(b.oracleId).types.includes('creature')) fail('only creatures can block');
      if (b.tapped) fail('a tapped creature cannot block');
      if (used.has(bId)) fail('a creature cannot block twice');
      used.add(bId);
      const bdef = getDef(b.oracleId);
      if (adef.keywords?.includes('flying') && !bdef.keywords?.includes('flying')) {
        fail('only a flyer can block a flyer');
      }
    }
  }

  state.combat.blocks = {};
  for (const attId of Object.keys(blocks)) state.combat.blocks[attId] = [...blocks[attId]];

  grantPriority(state, events);
}

// Re-export for convenience (engine consumers build games via game.ts).
export { startTurn };

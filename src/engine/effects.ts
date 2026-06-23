// The effect interpreter: executes a stack object's EffectSpec list against the
// game state. Card behaviour is data (EffectSpec[]) interpreted here, so adding
// cards never means adding engine branches beyond the primitive ops.

import { moveCard } from './zones.js';
import type { GameEvent, GameState, PlayerId, StackObject, TargetRef } from './types.js';

// Draw one card for `player`. Returns false (and flags the player) if the
// library is empty — the "attempt to draw from empty" loss is finalized by SBA.
export function drawCard(state: GameState, player: PlayerId, events: GameEvent[]): boolean {
  const lib = state.zones[player].library;
  if (lib.length === 0) {
    state.players[player].drewFromEmpty = true;
    events.push({ type: 'draw', player, instanceId: null });
    return false;
  }
  const id = lib[0];
  moveCard(state, id, 'hand', events);
  events.push({ type: 'draw', player, instanceId: id });
  return true;
}

function damageTarget(state: GameState, target: TargetRef, amount: number, events: GameEvent[]): void {
  if (amount <= 0) return;
  if (target.kind === 'player') {
    const p = state.players[target.player];
    p.life -= amount;
    events.push({ type: 'damage', target, amount });
    events.push({ type: 'life', player: target.player, delta: -amount, total: p.life });
  } else {
    const c = state.cards[target.instanceId];
    if (c && c.zone === 'battlefield') {
      c.damage += amount; // lethal check is deferred to SBA
      events.push({ type: 'damage', target, amount });
    }
  }
}

// Resolve `obj`'s effects in order. Ops that need a target consume the next
// entry from obj.targets, so target order must match effect order.
export function applyEffects(state: GameState, obj: StackObject, events: GameEvent[]): void {
  let ti = 0;
  for (const e of obj.effect) {
    switch (e.op) {
      case 'dealDamage': {
        const target = obj.targets[ti++];
        if (target) damageTarget(state, target, e.amount ?? 0, events);
        break;
      }
      case 'drawCards': {
        const n = e.amount ?? 1;
        for (let i = 0; i < n; i++) drawCard(state, obj.controller, events);
        break;
      }
      case 'gainLife': {
        const p = state.players[obj.controller];
        p.life += e.amount ?? 0;
        events.push({ type: 'life', player: obj.controller, delta: e.amount ?? 0, total: p.life });
        break;
      }
      case 'loseLife': {
        const p = state.players[obj.controller];
        p.life -= e.amount ?? 0;
        events.push({ type: 'life', player: obj.controller, delta: -(e.amount ?? 0), total: p.life });
        break;
      }
      case 'destroy': {
        const target = obj.targets[ti++];
        if (target && target.kind === 'permanent') {
          moveCard(state, target.instanceId, 'graveyard', events);
          events.push({ type: 'destroyed', instanceId: target.instanceId });
        }
        break;
      }
    }
  }
}

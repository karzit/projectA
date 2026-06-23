// The card event (triggered ability) system.
//
// The engine already produces a GameEvent stream describing "what just happened"
// (draws, damage, destructions, zone changes). Rather than invent a parallel
// event channel, triggered abilities WATCH that stream. After a batch of
// mutations settles (post-SBA), `collectTriggers` scans every card's triggered
// abilities against the events produced this step, and puts a matching ability
// on the stack — controlled by the card's controller, resolving like a spell's
// effect.
//
// Scope words on the condition resolve relationships against the watching card:
//   self        — this very card             (e.g. "when THIS card is drawn")
//   other       — any card but this one      (e.g. "whenever ANOTHER creature dies")
//   any         — anything
//   controller  — this card's controller     (e.g. "whenever YOU draw a card")
//   opponent    — the other player
//
// Timing note (intentional simplification): triggers are gathered once per
// reduce call after SBA. Full MTG timing (APNAP ordering of simultaneous
// triggers, last-known-information, "intervening if") is approximated — APNAP is
// honored by a simple active-player-first sort; the hook points are here to grow
// into the exact rules later.

import { getDef } from './cards.js';
import type {
  CardInstance,
  GameEvent,
  GameState,
  StackObject,
  TargetRef,
  TriggerBind,
  TriggerCondition,
  TriggeredAbility,
  ZoneName,
} from './types.js';

// Does `ev` satisfy `cond` for the watching card `src`?
function matches(cond: TriggerCondition, ev: GameEvent, src: CardInstance, state: GameState): boolean {
  switch (cond.kind) {
    case 'cardDrawn': {
      if (ev.type !== 'draw' || ev.instanceId === null) return false;
      if (cond.by === 'self') return ev.instanceId === src.instanceId;
      if (cond.by === 'controller') return ev.player === src.controller;
      if (cond.by === 'opponent') return ev.player !== src.controller;
      return true; // any
    }
    case 'destroyed': {
      if (ev.type !== 'destroyed') return false;
      return scopeAndType(ev.instanceId, cond.who, cond.cardType, src, state);
    }
    case 'leftBattlefield': {
      if (ev.type !== 'zoneChange' || ev.from !== 'battlefield' || ev.to === 'battlefield') return false;
      return scopeAndType(ev.instanceId, cond.who, cond.cardType, src, state);
    }
    case 'enteredBattlefield': {
      if (ev.type !== 'zoneChange' || ev.to !== 'battlefield' || ev.from === 'battlefield') return false;
      return scopeAndType(ev.instanceId, cond.who, cond.cardType, src, state);
    }
    case 'playerDamaged': {
      if (ev.type !== 'damage' || ev.target.kind !== 'player') return false;
      if (cond.who === 'controller') return ev.target.player === src.controller;
      if (cond.who === 'opponent') return ev.target.player !== src.controller;
      return true; // any
    }
  }
}

// Shared self/other/any + optional card-type filter for card-subject events.
function scopeAndType(
  subjectId: string,
  who: 'self' | 'other' | 'any',
  cardType: string | undefined,
  src: CardInstance,
  state: GameState,
): boolean {
  if (who === 'self' && subjectId !== src.instanceId) return false;
  if (who === 'other' && subjectId === src.instanceId) return false;
  if (cardType) {
    const subject = state.cards[subjectId];
    if (!subject || !getDef(subject.oracleId).types.includes(cardType as never)) return false;
  }
  return true;
}

// Scan all cards' triggered abilities against `events`; push matching abilities
// onto the stack (active player's first, APNAP-style). Trigger events are
// appended to `events` for the log/renderer but are NOT themselves re-scanned.
export function collectTriggers(state: GameState, events: GameEvent[]): void {
  const observed = events.slice(); // freeze: don't react to triggers we add below
  const pending: Array<{ src: CardInstance; ability: TriggeredAbility; ev: GameEvent }> = [];

  for (const id of Object.keys(state.cards)) {
    const src = state.cards[id];
    const def = getDef(src.oracleId);
    if (!def.triggers?.length) continue;

    for (const ability of def.triggers) {
      const zones: ZoneName[] = ability.zones ?? ['battlefield'];
      if (!zones.includes(src.zone)) continue;
      for (const ev of observed) {
        if (matches(ability.on, ev, src, state)) {
          pending.push({ src, ability, ev });
        }
      }
    }
  }

  if (pending.length === 0) return;

  // APNAP: the active player's triggers go on the stack first (so they resolve
  // last). A stable sort preserves per-controller ordering.
  pending.sort((a, b) => rank(a.src.controller, state) - rank(b.src.controller, state));

  for (const { src, ability, ev } of pending) {
    const obj: StackObject = {
      id: `stk_${state.nextId++}`,
      kind: 'ability',
      controller: src.controller,
      oracleId: src.oracleId,
      cardInstanceId: undefined, // the ability is independent of its source card
      effect: ability.effect,
      targets: ability.bind ? bindTarget(ability.bind, ev, state) : [],
    };
    state.stack.push(obj);
    events.push({ type: 'trigger', stackId: obj.id, oracleId: src.oracleId, controller: src.controller });
  }
}

// The card subject of a card-related event, if any.
function eventCardId(ev: GameEvent): string | null {
  if (ev.type === 'destroyed') return ev.instanceId;
  if (ev.type === 'zoneChange') return ev.instanceId;
  return null;
}

// Resolve a bind into the effect's target list from the triggering event.
function bindTarget(bind: TriggerBind, ev: GameEvent, state: GameState): TargetRef[] {
  switch (bind) {
    case 'eventPlayer': {
      if (ev.type === 'draw') return [{ kind: 'player', player: ev.player }];
      if (ev.type === 'damage' && ev.target.kind === 'player') return [{ kind: 'player', player: ev.target.player }];
      return [];
    }
    case 'eventCard': {
      const id = eventCardId(ev);
      return id ? [{ kind: 'permanent', instanceId: id }] : [];
    }
    case 'eventCardController': {
      const id = eventCardId(ev);
      const card = id ? state.cards[id] : undefined;
      return card ? [{ kind: 'player', player: card.controller }] : [];
    }
  }
}

function rank(player: string, state: GameState): number {
  return player === state.activePlayer ? 0 : 1;
}

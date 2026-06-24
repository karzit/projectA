// The effect interpreter — the shared resolution engine for both on-play card
// effects and (later) forced abilities. Card behaviour is DATA (Effect[]); this
// file is the only place that knows how each verb mutates state.
//
// Choices: effects that require the player to pick units (Selector 'chosen')
// read from a pre-supplied list of instanceIds on the context, consumed in
// order. A richer interactive "choice request" protocol can replace this later
// without changing the effect vocabulary.

import { develop } from './environment.js';
import { destroyUnit, modifyStat, nextRandom, performRitual, setController, summon, swapStats } from './game.js';
import { allUnitIds, fieldUnitIds, findUnit, inHand, otherPlayer, unitCount, unitExists } from './queries.js';
import type { CountExpr, Effect, GameState, PlayerId, Selector } from './types.js';

export interface EffectContext {
  controller: PlayerId;
  sourceCardId: string;
  sourceUnit?: string; // instanceId, when the source is a unit on the field
  choices: string[]; // pre-selected unit instanceIds for 'chosen' selectors
  cursor: { i: number }; // consumption cursor into `choices`
}

export function newContext(controller: PlayerId, sourceCardId: string, choices: string[] = [], sourceUnit?: string): EffectContext {
  return { controller, sourceCardId, sourceUnit, choices, cursor: { i: 0 } };
}

function poolFor(state: GameState, ctx: EffectContext, from: 'ownField' | 'oppField' | 'anyField'): string[] {
  if (from === 'ownField') return fieldUnitIds(state, ctx.controller);
  if (from === 'oppField') return fieldUnitIds(state, otherPlayer(ctx.controller));
  return allUnitIds(state);
}

function pickRandom(state: GameState, pool: string[], count: number): string[] {
  const arr = [...pool];
  const out: string[] = [];
  for (let k = 0; k < count && arr.length > 0; k++) {
    const idx = Math.floor(nextRandom(state) * arr.length);
    out.push(arr.splice(idx, 1)[0]);
  }
  return out;
}

// Resolve a selector to a list of unit instanceIds (only ones still in play).
function resolveSelector(state: GameState, sel: Selector, ctx: EffectContext): string[] {
  let ids: string[];
  switch (sel.kind) {
    case 'self':
      ids = ctx.sourceUnit ? [ctx.sourceUnit] : [];
      break;
    case 'ownField':
      ids = fieldUnitIds(state, ctx.controller);
      break;
    case 'oppField':
      ids = fieldUnitIds(state, otherPlayer(ctx.controller));
      break;
    case 'anyField':
      ids = allUnitIds(state);
      break;
    case 'chosen': {
      ids = ctx.choices.slice(ctx.cursor.i, ctx.cursor.i + sel.count);
      ctx.cursor.i += sel.count;
      break;
    }
    case 'random':
      ids = pickRandom(state, poolFor(state, ctx, sel.from), sel.count);
      break;
  }
  return ids.filter((id) => unitExists(state, id));
}

function evalCount(state: GameState, expr: CountExpr, ctx: EffectContext): number {
  if (typeof expr === 'number') return expr;
  if (expr === 'enemyUnitCount') return unitCount(state, otherPlayer(ctx.controller));
  return unitCount(state, ctx.controller); // ownUnitCount
}

export function resolveEffects(state: GameState, effects: readonly Effect[], ctx: EffectContext): void {
  for (const e of effects) resolveOne(state, e, ctx);
}

function resolveOne(state: GameState, e: Effect, ctx: EffectContext): void {
  switch (e.do) {
    case 'develop':
      state.environment = develop(state.environment, e.type, e.value);
      return;
    case 'destroy':
      for (const id of resolveSelector(state, e.target, ctx)) destroyUnit(state, id);
      return;
    case 'modifyStat':
      for (const id of resolveSelector(state, e.target, ctx)) modifyStat(state, id, e.stat, e.amount);
      return;
    case 'swapStats': {
      const [a] = resolveSelector(state, e.a, ctx);
      const [b] = resolveSelector(state, e.b, ctx);
      if (a && b) swapStats(state, a, b);
      return;
    }
    case 'summonSelf': // 복수자 부활
    case 'descend': // 마왕 강림
      // Both bring the source card from hand to the field. They are distinct verbs
      // only to mirror the card concepts; cannotSummon is purely a NORMAL-play gate
      // (conditions.ts) — forced summons intentionally bypass it via summon().
      if (inHand(state, ctx.controller, ctx.sourceCardId)) summon(state, ctx.controller, ctx.sourceCardId);
      return;
    case 'ritual':
      performRitual(state, e.name);
      return;
    case 'defect':
      for (const id of resolveSelector(state, e.target, ctx)) {
        const u = findUnit(state, id);
        if (u) setController(state, id, otherPlayer(u.controller));
      }
      return;
    case 'repeat': {
      const n = evalCount(state, e.times, ctx);
      for (let k = 0; k < n; k++) resolveEffects(state, e.effects, ctx);
      return;
    }
  }
}

// The top-level game object. Owns GameState, EventManager, and Board.
// User choices (RulesAction) are pure serializable data; card behavior lives in
// Card subclasses. Replay = new Game(config).replayAll(actions[]).

import { createGame, checkLoss, clearTurnBuffs, removeFromHand, markForcedFired, spendCunning, resetCunningTurn } from './gameMut.js';
import { canPlay } from './conditions.js';
import { Board } from './Board.js';
import { EventManager } from './EventManager.js';
import { CARD_REGISTRY } from './cards/CardRegistry.js';
import { makeContext, ChoiceRequired } from './GameContext.js';
import {
  canAttack,
  canBlock,
  cunningBlockerFor,
  isCardLocked,
  fieldUnitIds,
  findUnit,
  handCardIds,
  hasForcedFired,
  inHand,
  isActiveTurn,
  isMainPhase,
  isOpeningPhase,
  otherPlayer,
  powerOf,
} from './queries.js';
import type { RulesAction } from './actions.js';
import type { ChoiceRequest, GameState, PlayerId } from './types.js';
import type { UnitCard } from './cards/Card.js';

export interface RulesResult {
  state: GameState;
  error?: string;
  // Set when the played card needs the player to choose targets. The same play
  // action should be re-issued with `choices` filled from `choiceRequest.from`.
  choiceRequest?: ChoiceRequest;
}

const SETTLE_LIMIT = 100;

class Illegal extends Error {}
function fail(msg: string): never { throw new Illegal(msg); }

// A play prevented by 지략 (cunning). Unlike Illegal, its state mutations
// (지략 소진 + 카드 잠금) are committed — they are the point of the block — so
// apply() returns the error WITHOUT rolling the snapshot back.
class Blocked extends Error {}

export class Game {
  readonly state: GameState;
  readonly board: Board;
  private readonly events: EventManager;
  private readonly actionLog: RulesAction[] = [];

  constructor(config: Parameters<typeof createGame>[0], existingState?: GameState) {
    this.state = existingState ? structuredClone(existingState) : createGame(config);
    this.events = new EventManager();
    this.board = new Board(this.state, this.events, CARD_REGISTRY);
    this._subscribeHandCards();
    if (existingState) this._subscribeFieldUnits();
  }

  // Reconstruct a live Game from a plain GameState snapshot (e.g. for tests that
  // manipulate state directly). Subscriptions are rebuilt from current hand/field.
  static fromState(state: GameState): Game {
    return new Game({ decks: { A: [], B: [] } }, state);
  }

  static replayAll(config: Parameters<typeof createGame>[0], actions: RulesAction[]): Game {
    const g = new Game(config);
    for (const a of actions) g.apply(a);
    return g;
  }

  // Apply an action. Mutates this.state on success; restores state + subscriptions on error.
  apply(action: RulesAction): RulesResult {
    if (this.state.loser) return { state: this.state, error: 'the game is over' };
    const snap = structuredClone(this.state);
    const snapSubs = this._snapshotSubscriptions();
    try {
      this._apply(action);
      if (isMainPhase(this.state)) this._settle();
      if (action.type === 'pass') this.state.loser = checkLoss(this.state, action.player);
      this.actionLog.push(action);
      return { state: this.state };
    } catch (e) {
      if (e instanceof ChoiceRequired) {
        // The card needs target choices. Roll back and ask the player; they
        // re-issue the same action with `choices` filled (onPlay re-runs clean).
        Object.assign(this.state, snap);
        this._restoreSubscriptions(snapSubs);
        return { state: this.state, choiceRequest: e.request };
      }
      if (e instanceof Blocked) {
        // Commit the block's mutations (지략 소진 + 잠금); just surface the error.
        // Logged so replay reproduces the block (re-applying re-triggers it).
        this.actionLog.push(action);
        return { state: this.state, error: e.message };
      }
      if (e instanceof Illegal) {
        Object.assign(this.state, snap);
        this._restoreSubscriptions(snapSubs);
        return { state: this.state, error: e.message };
      }
      throw e;
    }
  }

  // Rebuild subscriptions for all current hand cards and field units.
  // Call after directly manipulating game.state (e.g. in tests).
  syncSubscriptions(): void {
    this.events.clear();
    this._subscribeHandCards();
    this._subscribeFieldUnits();
  }

  serialize(): { state: GameState; log: RulesAction[] } {
    return { state: structuredClone(this.state), log: [...this.actionLog] };
  }

  // --- private ---------------------------------------------------------------

  private _subscribeHandCards(): void {
    for (const p of ['A', 'B'] as PlayerId[]) {
      for (const cardId of handCardIds(this.state, p)) {
        const card = CARD_REGISTRY.get(cardId);
        card.subscribe(makeContext(undefined, p, cardId, this.board, this.events));
      }
    }
  }

  private _subscribeFieldUnits(): void {
    for (const p of ['A', 'B'] as PlayerId[]) {
      for (const unitId of fieldUnitIds(this.state, p)) {
        const u = this.state.units[unitId];
        if (!u) continue;
        const card = CARD_REGISTRY.get(u.cardId);
        card.subscribe(makeContext(unitId, u.controller, u.cardId, this.board, this.events));
      }
    }
  }

  private _snapshotSubscriptions() {
    return {
      static: [...this.events.getStaticSubs()],
      event: [...this.events.getEventSubs()],
    };
  }

  private _restoreSubscriptions(snap: ReturnType<Game['_snapshotSubscriptions']>) {
    this.events.clear();
    for (const s of snap.static) this.events.onStatic(s);
    for (const s of snap.event) this.events.on(s);
  }

  private _apply(action: RulesAction): void {
    switch (action.type) {
      case 'placeOpening': return this._placeOpening(action.player, action.cardId);
      case 'finishOpening': return this._finishOpening(action.player);
      case 'play': return this._play(action.player, action.cardId, action.choices ?? []);
      case 'attack': return this._attack(action.player, action.attackerId, action.targetId, action.blockers ?? []);
      case 'pass': return this._pass(action.player);
    }
  }

  // --- opening ---------------------------------------------------------------

  private _placeOpening(player: PlayerId, cardId: string): void {
    if (!isOpeningPhase(this.state)) fail('not the opening phase');
    if (this.state.openingDone[player]) fail('you have finished your opening');
    if (this.state.openingPlaced[player] >= 3) fail('opening is limited to 3 cards');
    this._placeOpeningCard(player, cardId);
    this.state.openingPlaced[player] += 1;
    if (this.state.openingPlaced[player] >= 3) this.state.openingDone[player] = true;
    this._maybeStartMain();
  }

  private _finishOpening(player: PlayerId): void {
    if (!isOpeningPhase(this.state)) fail('not the opening phase');
    this.state.openingDone[player] = true;
    this._maybeStartMain();
  }

  private _placeOpeningCard(player: PlayerId, cardId: string): void {
    if (!inHand(this.state, player, cardId)) fail('that card is not in your hand');
    const card = CARD_REGISTRY.get(cardId);
    const check = canPlay(this.state, card, player);
    if (!check.ok) fail(`cannot play ${card.name}: ${check.reason ?? 'background conditions not met'}`);
    const unitId = card.kind === 'unit'
      ? this.board.summon(player, cardId)
      : (removeFromHand(this.state, player, cardId), undefined);
    this.state.openingPlays[player].push({ cardId, controller: player, choices: [], unitId });
  }

  private _maybeStartMain(): void {
    if (!(this.state.openingDone.A && this.state.openingDone.B)) return;
    this.state.phase = 'main';
    this.state.active = 'A';
    this.state.turn = 1;
    for (const player of ['A', 'B'] as PlayerId[]) {
      for (const dp of this.state.openingPlays[player]) {
        const card = CARD_REGISTRY.get(dp.cardId);
        const ctx = makeContext(dp.unitId, dp.controller, dp.cardId, this.board, this.events, dp.choices);
        card.onPlay(ctx);
      }
    }
  }

  // --- main ------------------------------------------------------------------

  private _requireMainTurn(player: PlayerId): void {
    if (!isMainPhase(this.state)) fail('not the main phase');
    if (!isActiveTurn(this.state, player)) fail('it is not your turn');
  }

  private _play(player: PlayerId, cardId: string, choices: string[]): void {
    this._requireMainTurn(player);
    if (this.state.playedThisTurn) fail('이번 턴에 이미 카드를 냈습니다');
    if (!inHand(this.state, player, cardId)) fail('that card is not in your hand');
    if (isCardLocked(this.state, player, cardId)) fail('이번 턴에 지략으로 봉쇄된 카드입니다');
    const card = CARD_REGISTRY.get(cardId);
    const check = canPlay(this.state, card, player);
    if (!check.ok) fail(`cannot play ${card.name}: ${check.reason ?? 'background conditions not met'}`);
    // 지략(cunning): an opponent unit may block a wisdom-conditioned play.
    const opponent = otherPlayer(player);
    for (const cond of card.meta.conditions ?? []) {
      if (cond.need !== 'wisdom') continue;
      const blocker = cunningBlockerFor(this.state, opponent, cond.amount);
      if (blocker === null) continue;
      spendCunning(this.state, blocker, player, cardId);
      throw new Blocked(`${card.name}이(가) 지략으로 봉쇄되었습니다`);
    }
    const unitId = card.kind === 'unit'
      ? this.board.summon(player, cardId)
      : (removeFromHand(this.state, player, cardId), undefined);
    const ctx = makeContext(unitId, player, cardId, this.board, this.events, choices);
    card.onPlay(ctx);
    this.state.playedThisTurn = true;
  }

  private _attack(player: PlayerId, attackerId: string, targetId: string, blockers: string[]): void {
    this._requireMainTurn(player);
    const attacker = findUnit(this.state, attackerId);
    const target = findUnit(this.state, targetId);
    if (!attacker || attacker.controller !== player) fail('not your unit');
    if (!target || target.controller === player) fail('target must be an enemy unit');
    if (!canAttack(this.state, attackerId)) fail('this unit cannot attack');

    const defender = target.controller;

    if (blockers.length === 0) {
      // 1:1 전투
      const ap = powerOf(this.state, attackerId);
      const dp = powerOf(this.state, targetId);
      if (ap >= dp) this.board.destroyUnit(targetId);
      if (ap <= dp) this.board.destroyUnit(attackerId);
    } else {
      // 협공: 수비 유닛 유효성 검사
      const allBlockers = [targetId, ...blockers];
      for (const bid of allBlockers) {
        const bu = findUnit(this.state, bid);
        if (!bu || bu.controller !== defender) fail(`blocker ${bid} is not a defender unit`);
        if (!canBlock(this.state, bid)) fail(`unit ${bid} already cooperated in defense this turn`);
      }

      const ap = powerOf(this.state, attackerId);
      const totalDp = allBlockers.reduce((sum, bid) => sum + powerOf(this.state, bid), 0);

      if (totalDp >= ap) {
        // 협공 성공 — 동점 포함 전원 생존 (공격자도 협공전에서는 죽지 않음)
      } else {
        // 협공 실패 — 수비 유닛 전원 파괴
        for (const bid of allBlockers) this.board.destroyUnit(bid);
      }

      this.state.blockedThisTurn.push(...allBlockers);
    }

    this.state.attackedThisTurn.push(attackerId);
  }

  private _pass(player: PlayerId): void {
    this._requireMainTurn(player);
    this._endTurn();
  }

  private _endTurn(): void {
    clearTurnBuffs(this.state);
    this.state.playedThisTurn = false;
    this.state.attackedThisTurn = [];
    this.state.blockedThisTurn = [];
    resetCunningTurn(this.state);
    this.state.active = otherPlayer(this.state.active);
    this.state.turn += 1;
    this.state.pendingEvents.push({ kind: 'turnStart', active: this.state.active });
  }

  // --- settle loop -----------------------------------------------------------

  private _settle(): void {
    for (let outer = 0; outer < SETTLE_LIMIT; outer++) {
      // Phase 1: drain one event → fire matching event subscriptions.
      if (this.state.pendingEvents.length > 0) {
        const ev = this.state.pendingEvents.shift()!;
        const subs = [...this.events.getEventSubs()];
        for (const sub of subs) {
          if (sub.once && hasForcedFired(this.state, sub.key)) continue;
          if (!sub.filter(ev)) continue;
          if (sub.once) markForcedFired(this.state, sub.key);
          sub.fire(ev);
        }
        // Synthesise selfDied: call onDeath() for the dead unit's card.
        if (ev.kind === 'unitDied') {
          try {
            const card = CARD_REGISTRY.get(ev.cardId);
            if ('onDeath' in card && typeof (card as UnitCard).onDeath === 'function') {
              const ctx = makeContext(ev.instanceId, ev.controller, ev.cardId, this.board, this.events);
              (card as UnitCard).onDeath(ctx);
            }
          } catch { /* unknown card — skip */ }
        }
        continue;
      }

      // Phase 2: static-condition triggers to fixpoint.
      const seen = new Set<string>();
      let anyFired = false;
      for (let inner = 0; inner < SETTLE_LIMIT; inner++) {
        const subs = this.events.getStaticSubs();
        const next = subs.find((s) =>
          !seen.has(s.key) &&
          !(s.once && hasForcedFired(this.state, s.key)) &&
          s.check(this.state),
        );
        if (!next) break;
        seen.add(next.key);
        if (next.once) markForcedFired(this.state, next.key);
        next.fire();
        anyFired = true;
        if (this.state.pendingEvents.length > 0) break;
      }
      if (!anyFired) break;
    }
  }
}

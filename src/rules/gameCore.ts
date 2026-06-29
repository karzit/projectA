// The top-level game object. Owns GameState, EventManager, and Board.

import { createGame, checkLoss, clearTurnBuffs, removeFromHand, markForcedFired, spendCunning, resetCunningTurn, resetBondTurn, markBondPlayed, moveUnit } from './gameMut.js';
import { canPlay } from './conditions.js';
import { Board } from './Board.js';
import { EventManager } from './EventManager.js';
import { CARD_REGISTRY } from './cards/CardRegistry.js';
import { makeContext, ChoiceRequired } from './GameContext.js';
import {
  attackableTargets,
  isTrapped,
  canAttack,
  canBlock,
  canMove,
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
import { GRID_SIZE } from './types.js';
import type { UnitCard } from './cards/Card.js';

export interface RulesResult {
  state: GameState;
  error?: string;
  choiceRequest?: ChoiceRequest;
}

const SETTLE_LIMIT = 100;

class Illegal extends Error {}
function fail(msg: string): never { throw new Illegal(msg); }

// A play prevented by 지략 (cunning). Unlike Illegal, its state mutations
// (지략 소진 + 카드 잠금) are committed before the error is returned.
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

  static fromState(state: GameState): Game {
    return new Game({ decks: { A: [], B: [] } }, state);
  }

  static replayAll(config: Parameters<typeof createGame>[0], actions: RulesAction[]): Game {
    const g = new Game(config);
    for (const a of actions) g.apply(a);
    return g;
  }

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
        Object.assign(this.state, snap);
        this._restoreSubscriptions(snapSubs);
        return { state: this.state, choiceRequest: e.request };
      }
      if (e instanceof Blocked) {
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
      case 'placeOpening': return this._placeOpening(action.player, action.cardId, action.cell);
      case 'finishOpening': return this._finishOpening(action.player);
      case 'play': return this._play(action.player, action.cardId, action.choices ?? [], action.cell);
      case 'attack': return this._attack(action.player, action.attackerId, action.targetId, action.blockers ?? []);
      case 'ability': return this._ability(action.player, action.unitId, action.choices ?? []);
      case 'move': return this._move(action.player, action.unitId, action.toCell);
      case 'pass': return this._pass(action.player);
    }
  }

  // --- opening ---------------------------------------------------------------

  private _placeOpening(player: PlayerId, cardId: string, cell: number): void {
    if (!isOpeningPhase(this.state)) fail('오프닝 페이즈가 아닙니다');
    if (this.state.openingDone[player]) fail('오프닝을 이미 완료했습니다');
    if (this.state.openingPlaced[player] >= 3) fail('오프닝에는 최대 3장까지 낼 수 있습니다');
    if (cell < 0 || cell >= GRID_SIZE) fail('유효하지 않은 셀 번호입니다');
    if (this.state.field[player][cell]) fail('해당 셀은 이미 사용 중입니다');
    this._placeOpeningCard(player, cardId, cell);
    this.state.openingPlaced[player] += 1;
    if (this.state.openingPlaced[player] >= 3) this.state.openingDone[player] = true;
    this._maybeStartMain();
  }

  private _finishOpening(player: PlayerId): void {
    if (!isOpeningPhase(this.state)) fail('오프닝 페이즈가 아닙니다');
    this.state.openingDone[player] = true;
    this._maybeStartMain();
  }

  private _placeOpeningCard(player: PlayerId, cardId: string, cell: number): void {
    if (!inHand(this.state, player, cardId)) fail('패에 없는 카드입니다');
    const card = CARD_REGISTRY.get(cardId);
    const check = canPlay(this.state, card, player);
    if (!check.ok) fail(check.reason ?? `${card.name}: 배경 조건을 충족하지 못했습니다`);
    const unitId = card.kind === 'unit'
      ? this.board.summon(player, cardId, cell)
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
    if (!isMainPhase(this.state)) fail('메인 페이즈가 아닙니다');
    if (!isActiveTurn(this.state, player)) fail('상대방의 턴입니다');
  }

  private _play(player: PlayerId, cardId: string, choices: string[], cell?: number): void {
    this._requireMainTurn(player);
    if (!inHand(this.state, player, cardId)) fail('패에 없는 카드입니다');
    if (isCardLocked(this.state, player, cardId)) fail('이번 턴에 지략으로 봉쇄된 카드입니다');
    const card = CARD_REGISTRY.get(cardId);
    const check = canPlay(this.state, card, player);
    if (!check.ok) fail(check.reason ?? `${card.name}: 배경 조건을 충족하지 못했습니다`);
    const opponent = otherPlayer(player);
    for (const cond of card.meta.conditions ?? []) {
      if (cond.need !== 'wisdom') continue;
      const blocker = cunningBlockerFor(this.state, opponent, cond.amount);
      if (blocker === null) continue;
      spendCunning(this.state, blocker, player, cardId);
      throw new Blocked(`${card.name}이(가) 지략으로 봉쇄되었습니다`);
    }
    const isBond = card.meta.keywords?.includes('결속') ?? false;
    if (isBond && this.state.bondPlayedThisTurn[player]) fail('결속 카드는 한 턴에 한 장만 낼 수 있습니다');
    const isIntervene = card.meta.keywords?.includes('개입') ?? false;
    const unitId = card.kind === 'unit'
      ? this.board.summon(player, cardId, cell)
      : (removeFromHand(this.state, player, cardId), undefined);
    if (isBond) markBondPlayed(this.state, player);
    if (isIntervene) {
      // 개입 카드: 즉시 처리
      const ctx = makeContext(unitId, player, cardId, this.board, this.events, choices);
      card.onPlay(ctx);
    } else {
      // 일반 카드: 턴 종료 시 순서대로 처리
      this.state.pendingPlays.push({ cardId, controller: player, choices, unitId });
    }
  }

  private _attack(player: PlayerId, attackerId: string, targetId: string, blockers: string[]): void {
    this._requireMainTurn(player);
    const attacker = findUnit(this.state, attackerId);
    let target = findUnit(this.state, targetId);
    if (!attacker || attacker.controller !== player) fail('내 유닛이 아닙니다');
    if (!target || target.controller === player) fail('적 유닛을 대상으로 해야 합니다');
    if (!canAttack(this.state, attackerId)) {
      const u = this.state.units[attackerId];
      if (u && u.keywords?.includes('cannotAttack')) fail(`${u.cardId}: 이 유닛은 공격할 수 없습니다`);
      fail('이 유닛은 이번 턴에 이미 행동했습니다');
    }

    // Validate target is within attack range.
    const validTargets = attackableTargets(this.state, attackerId);
    if (!validTargets.includes(targetId)) fail('해당 유닛은 공격 범위 밖에 있습니다');

    // 대리 전투: 저오능/사오정이 삼장법사를 대신해 전투 (blockers가 없을 때만).
    if (blockers.length === 0 && target.cardId === 'tang-monk') {
      const interceptId = fieldUnitIds(this.state, target.controller).find((id) =>
        (this.state.units[id]?.cardId === 'je-o-neung' ||
         this.state.units[id]?.cardId === 'sa-o-jeong') &&
        !isTrapped(this.state, id),
      );
      if (interceptId) {
        targetId = interceptId;
        target = findUnit(this.state, targetId)!;
      }
    }

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
        if (!bu || bu.controller !== defender) fail('협공 유닛은 수비 측 유닛이어야 합니다');
        // Additional blockers (not the primary target) must be adjacent to the target's cell.
        const isExtra = bid !== targetId;
        if (!canBlock(this.state, bid, isExtra ? target.cell : undefined)) {
          fail('이 유닛은 협공할 수 없습니다 (이미 협공했거나 인접하지 않음)');
        }
      }

      const ap = powerOf(this.state, attackerId);
      const totalDp = allBlockers.reduce((sum, bid) => sum + powerOf(this.state, bid), 0);

      if (totalDp >= ap) {
        // 협공 성공 — 동점 포함 전원 생존
      } else {
        // 협공 실패 — 수비 유닛 전원 파괴
        for (const bid of allBlockers) this.board.destroyUnit(bid);
      }

      this.state.blockedThisTurn.push(...allBlockers);
    }

    this.state.actedThisTurn.push(attackerId);
  }

  private _ability(player: PlayerId, unitId: string, choices: string[]): void {
    this._requireMainTurn(player);
    const u = findUnit(this.state, unitId);
    if (!u || u.controller !== player) fail('내 유닛이 아닙니다');
    const card = CARD_REGISTRY.get(u.cardId);
    if (!card.meta.activeAbility) fail('이 유닛은 발동할 능력이 없습니다');
    if (isTrapped(this.state, unitId)) fail('오행산에 갇힌 유닛입니다');
    if (this.state.actedThisTurn.includes(unitId)) fail('이 유닛은 이번 턴에 이미 행동했습니다');
    const ctx = makeContext(unitId, player, u.cardId, this.board, this.events, choices);
    (card as UnitCard).onAbility(ctx);
    this.state.actedThisTurn.push(unitId);
  }

  private _move(player: PlayerId, unitId: string, toCell: number): void {
    this._requireMainTurn(player);
    const u = findUnit(this.state, unitId);
    if (!u || u.controller !== player) fail('내 유닛이 아닙니다');
    if (!canMove(this.state, unitId, toCell)) {
      if (this.state.actedThisTurn.includes(unitId)) fail('이 유닛은 이번 턴에 이미 행동했습니다');
      if (this.state.field[player][toCell]) fail('해당 셀은 이미 다른 유닛이 있습니다');
      fail('해당 셀로 이동할 수 없습니다 (인접하지 않음)');
    }
    moveUnit(this.state, unitId, toCell);
    this.state.actedThisTurn.push(unitId);
  }

  private _pass(player: PlayerId): void {
    this._requireMainTurn(player);
    this._endTurn();
  }

  private _endTurn(): void {
    // 큐에 쌓인 카드 효과를 순서대로 처리
    for (const dp of this.state.pendingPlays) {
      const card = CARD_REGISTRY.get(dp.cardId);
      const ctx = makeContext(dp.unitId, dp.controller, dp.cardId, this.board, this.events, dp.choices);
      card.onPlay(ctx);
    }
    this.state.pendingPlays = [];
    this.state.pendingEvents.push({ kind: 'turnEnd', active: this.state.active });
    clearTurnBuffs(this.state);
    this.state.actedThisTurn = [];
    this.state.blockedThisTurn = [];
    resetCunningTurn(this.state);
    resetBondTurn(this.state);
    this.state.active = otherPlayer(this.state.active);
    this.state.turn += 1;
    this.state.pendingEvents.push({ kind: 'turnStart', active: this.state.active });
  }

  // --- settle loop -----------------------------------------------------------

  private _settle(): void {
    for (let outer = 0; outer < SETTLE_LIMIT; outer++) {
      if (this.state.pendingEvents.length > 0) {
        const ev = this.state.pendingEvents.shift()!;
        const subs = [...this.events.getEventSubs()];
        for (const sub of subs) {
          if (sub.once && hasForcedFired(this.state, sub.key)) continue;
          if (!sub.filter(ev)) continue;
          if (sub.once) markForcedFired(this.state, sub.key);
          sub.fire(ev);
        }
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

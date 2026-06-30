// Battlefield mediator. The only place that writes to GameState (via gameMut.ts
// primitives) and the only place that reads via queries.ts. Cards call Board
// methods from their onPlay / subscribe callbacks — never touching state directly.

import * as G from './gameMut.js';
import * as Q from './queries.js';
import { develop } from './environment.js';
import type { EventManager } from './EventManager.js';
import type { CardRegistry } from './cards/CardRegistry.js';
import type { GameEvent, GameState, PlayerId, StatName } from './types.js';
import { makeContext } from './GameContext.js';

// A thin handle over a unit instanceId — gives units method-call semantics.
export class UnitHandle {
  constructor(
    readonly instanceId: string,
    private readonly board: Board,
  ) {}

  get power(): number { return Q.powerOf(this.board.state, this.instanceId); }
  get wisdom(): number { return Q.wisdomOf(this.board.state, this.instanceId); }
  get cunning(): number { return Q.cunningOf(this.board.state, this.instanceId); }
  get cardId(): string { return this.board.state.units[this.instanceId]?.cardId ?? ''; }
  get controller(): PlayerId { return this.board.state.units[this.instanceId]?.controller ?? 'A'; }
  get cell(): number { return this.board.state.units[this.instanceId]?.cell ?? 0; }

  buffStat(stat: StatName, amount: number): void { this.board.modifyStat(this.instanceId, stat, amount); }
  grantCunning(amount: number): void { this.board.grantCunning(this.instanceId, amount); }
  addTurnBuff(stat: StatName, amount: number): void { this.board.addTurnBuff(this.instanceId, stat, amount); }
  destroy(): void { this.board.destroyUnit(this.instanceId); }
  exit(): void { this.board.exitUnit(this.instanceId); }
  defectTo(to: PlayerId): void { this.board.setController(this.instanceId, to); }
  grantKeyword(kw: string): void { G.grantKeyword(this.board.state, this.instanceId, kw); }
  revokeKeyword(kw: string): void { G.revokeKeyword(this.board.state, this.instanceId, kw); }
  evolve(): void { this.board.evolveUnit(this.instanceId); }
  trap(): void { this.board.trap(this.instanceId); }
  untrap(): void { this.board.untrap(this.instanceId); }
}

export class Board {
  constructor(
    public readonly state: GameState,
    private readonly events: EventManager,
    private readonly registry: CardRegistry,
  ) {}

  // --- reads -----------------------------------------------------------------

  getUnit(id: string): UnitHandle | undefined {
    return Q.unitExists(this.state, id) ? new UnitHandle(id, this) : undefined;
  }

  unitsOn(player: PlayerId): UnitHandle[] {
    return Q.fieldUnitIds(this.state, player).map((id) => new UnitHandle(id, this));
  }

  allFieldUnitIds(): string[] { return Q.allUnitIds(this.state); }

  unitCount(player: PlayerId): number { return Q.unitCount(this.state, player); }
  isInHand(player: PlayerId, cardId: string): boolean { return Q.inHand(this.state, player, cardId); }
  otherPlayer(p: PlayerId): PlayerId { return Q.otherPlayer(p); }
  ritualCount(name: string): number { return Q.ritualCount(this.state, name); }
  highestInAllStats(player: PlayerId, stats: StatName[]) {
    return Q.highestInAllStats(this.state, player, stats);
  }

  pickRandom(scope: 'ownField' | 'oppField', player: PlayerId, n: number): string[] {
    const pool = scope === 'ownField'
      ? Q.fieldUnitIds(this.state, player)
      : Q.fieldUnitIds(this.state, Q.otherPlayer(player));
    return _pickRandom(this.state, pool, n);
  }

  pickRandomFrom(pool: string[]): string | null {
    const picked = _pickRandom(this.state, pool, 1);
    return picked[0] ?? null;
  }

  unitAtCell(player: PlayerId, cell: number): string | null { return Q.unitAtCell(this.state, player, cell); }

  // 부동(不動): 이번 턴 능동 플레이어가 아무 행동도 하지 않았는가.
  // 능동 턴에는 능동 플레이어 유닛만 행동하므로 actedThisTurn이 비었는지로 판정한다.
  noActionThisTurn(): boolean { return this.state.actedThisTurn.length === 0; }
  handOf(player: PlayerId): string[] { return Q.handCardIds(this.state, player); }
  fieldOf(player: PlayerId): string[] { return Q.fieldUnitIds(this.state, player); }
  controllerOf(instanceId: string): PlayerId { return this.state.units[instanceId]?.controller ?? 'A'; }
  powerOf(instanceId: string): number { return Q.powerOf(this.state, instanceId); }
  wisdomOf(instanceId: string): number { return Q.wisdomOf(this.state, instanceId); }
  cunningOf(instanceId: string): number { return Q.cunningOf(this.state, instanceId); }
  unitHasKeyword(instanceId: string, keyword: string): boolean {
    const u = this.state.units[instanceId];
    return !!u && Q.unitHasKeyword(u, keyword);
  }
  hasUnitWithCardOnField(player: PlayerId, cardId: string): boolean {
    return Q.hasUnitWithCardOnField(this.state, player, cardId);
  }

  // --- 타겟팅 리액션 파이프라인 ------------------------------------------------
  // 상대(공격/주문 주체)가 한 유닛을 대상으로 할 때 통과시키는 window. 주문·전투
  // 공격이 공유한다. 수비측의 자동 리액션을 적용해 최종 대상 id를 반환하거나, 대상이
  // 취소되면 null을 반환한다.
  //  - 성검(주문 한정): 대상이 '성검' 보호를 받는 용사면 지략 +5. wisdom-gated 주문의
  //    임계가 (실효 지략) 이하이면 무효화(null).
  //  - 호위(난입): 수비측에 '호위' 유닛이 있으면 다른 무작위 아군이 대신 대상이 된다.
  resolveTargeting(targetId: string, opts: { kind: 'spell' | 'attack'; wisdomAmount?: number }): string | null {
    const u = this.state.units[targetId];
    if (!u) return null;
    const defender = u.controller;

    // 성검: 이 유닛을 대상으로 하는 주문에 대해 지략 5 (wisdom-gated 주문만 실효).
    if (opts.kind === 'spell' && opts.wisdomAmount !== undefined) {
      const effCunning = Q.cunningOf(this.state, targetId) + (Q.unitHasKeyword(u, '성검') ? 5 : 0);
      if (effCunning >= opts.wisdomAmount) return null; // 무효화
    }

    // 호위: 다른 무작위 아군 하나가 대신 받는다.
    const hasGuard = Q.fieldUnitIds(this.state, defender).some(
      (id) => id !== targetId && Q.unitHasKeyword(this.state.units[id]!, '호위'),
    );
    if (hasGuard) {
      const others = Q.fieldUnitIds(this.state, defender).filter((id) => id !== targetId);
      const redirect = this.pickRandomFrom(others);
      if (redirect) return redirect;
    }

    return targetId;
  }

  // --- writes ----------------------------------------------------------------

  // Place a card from hand to field. Optional cell; auto-assigns if omitted.
  summon(player: PlayerId, cardId: string, cell?: number): string {
    const instanceId = G.summon(this.state, player, cardId, cell);
    this._subscribeUnit(instanceId, player, cardId);
    return instanceId;
  }

  // Spawn a card to field without requiring it in hand.
  summonCard(player: PlayerId, cardId: string, cell?: number): string {
    const instanceId = G.summonCard(this.state, player, cardId, cell);
    this._subscribeUnit(instanceId, player, cardId);
    this._checkCellTrap(instanceId);
    return instanceId;
  }

  moveUnit(instanceId: string, toCell: number): void {
    G.moveUnit(this.state, instanceId, toCell);
    this._checkCellTrap(instanceId);
  }

  // 교회: 묘지에서 키워드 일치 사망 유닛을 부활 (스탯/레벨 유지, exp 리셋). 재구독한다.
  reviveFromGraveyard(player: PlayerId, keyword: string, cell?: number): string | null {
    const instanceId = G.reviveFromGraveyard(this.state, player, keyword, cell);
    if (instanceId) {
      const cardId = this.state.units[instanceId]!.cardId;
      this._subscribeUnit(instanceId, player, cardId);
    }
    return instanceId;
  }

  destroyUnit(instanceId: string): void {
    const u = this.state.units[instanceId];
    if (!u) return;
    G.destroyUnit(this.state, instanceId);
    this.events.unsubscribeUnit(instanceId);
  }

  exitUnit(instanceId: string): void {
    G.exitUnit(this.state, instanceId);
    this.events.unsubscribeUnit(instanceId);
  }

  setController(instanceId: string, to: PlayerId): void {
    G.setController(this.state, instanceId, to);
  }

  modifyStat(instanceId: string, stat: StatName, amount: number): void {
    G.modifyStat(this.state, instanceId, stat, amount);
  }

  addTurnBuff(instanceId: string, stat: StatName, amount: number): void {
    G.addTurnBuff(this.state, instanceId, stat, amount);
  }

  swapStats(a: string, b: string): void { G.swapStats(this.state, a, b); }
  swapPositions(a: string, b: string): void { G.swapPositions(this.state, a, b); }
  setTrap(byPlayer: PlayerId, cell: number): void { G.placeCellTrap(this.state, byPlayer, cell); }
  clearNegativeTurnBuffs(player: PlayerId): void { G.clearNegativeTurnBuffsForPlayer(this.state, player); }

  grantCunning(instanceId: string, amount: number): void { G.grantCunning(this.state, instanceId, amount); }

  addToHand(player: PlayerId, cardId: string): void { G.addToHand(this.state, player, cardId); }

  lockCard(player: PlayerId, cardId: string): void { G.lockCard(this.state, player, cardId); }

  // 1:1 강제 전투 — forced 효과에서 사용 (blockers 없음)
  resolveCombat1v1(attackerId: string, targetId: string): void {
    const ap = Q.powerOf(this.state, attackerId);
    const dp = Q.powerOf(this.state, targetId);
    if (ap > dp) this.destroyUnit(targetId);
    else if (ap < dp) this.destroyUnit(attackerId);
    else { this.destroyUnit(attackerId); this.destroyUnit(targetId); }
  }

  environmentTypes(): string[] { return Object.keys(this.state.environment); }

  removeEnvironment(type: string): void {
    delete this.state.environment[type];
  }

  developEnv(type: string, value: string): void {
    const prev = this.state.environment[type];
    this.state.environment = develop(this.state.environment, type, value);
    if (this.state.environment[type] !== prev) {
      this.state.pendingEvents.push({ kind: 'envChanged', type, value });
    }
  }

  performRitual(name: string): void { G.performRitual(this.state, name); }

  // 즉시 패배 선언 (마왕 최후).
  declareLoss(player: PlayerId): void { G.declareLoss(this.state, player); }

  // 한 유닛의 인접 셀 중 비어 있는 첫 칸 (목 없는 기사의 머리 소환용). 없으면 null.
  freeAdjacentCell(player: PlayerId, cell: number): number | null {
    for (const adj of Q.HEX_ADJACENT[cell] ?? []) {
      if (!Q.unitAtCell(this.state, player, adj)) return adj;
    }
    return null;
  }

  heroKillScoreOf(player: PlayerId): number { return this.state.heroKillScore[player] ?? 0; }
  addHeroKillScore(player: PlayerId, amount: number): void { G.addHeroKillScore(this.state, player, amount); }

  // 영웅담 레벨링: emit a custom event (e.g. heroLevelUp) + update unit display fields.
  emitEvent(ev: GameEvent): void { this.state.pendingEvents.push(ev); }
  setHeroProgress(instanceId: string, level: number, exp: number, expMax: number): void {
    G.setHeroProgress(this.state, instanceId, level, exp, expMax);
  }

  // Evolve a unit to its meta.evolveTarget, re-subscribing with the new card's behaviors.
  evolveUnit(instanceId: string): void {
    const u = this.state.units[instanceId];
    if (!u) return;
    const card = this.registry.get(u.cardId);
    if (!card.meta.evolveTarget) return;
    G.evolveTo(this.state, instanceId, card.meta.evolveTarget);
    this.events.unsubscribeUnit(instanceId);
    this._subscribeUnit(instanceId, u.controller, card.meta.evolveTarget);
  }

  // Evolve a unit to an explicit target card, re-subscribing.
  evolveUnitTo(instanceId: string, newCardId: string): void {
    const u = this.state.units[instanceId];
    if (!u) return;
    G.evolveTo(this.state, instanceId, newCardId);
    this.events.unsubscribeUnit(instanceId);
    this._subscribeUnit(instanceId, u.controller, newCardId);
  }

  // 오행산 trap / untrap
  trap(instanceId: string): void { G.trapUnit(this.state, instanceId); }
  untrap(instanceId: string): void { G.untrapUnit(this.state, instanceId); }
  isTrapped(instanceId: string): boolean { return Q.isTrapped(this.state, instanceId); }

  // 패악질: 3가지 효과 중 하나 (random), 또는 전부
  mayhemOne(unitId: string): void { this._mayhem(unitId, false); }
  mayhemAll(unitId: string): void { this._mayhem(unitId, true); }

  private _mayhem(unitId: string, all: boolean): void {
    const u = this.state.units[unitId];
    if (!u) return;
    const controller = u.controller;
    const effects = ['a', 'b', 'c'];
    const toFire = all ? effects : [this.pickRandomFrom(effects) ?? 'a'];
    for (const choice of toFire) {
      if (choice === 'a') {
        // 효과1: 내 패 무작위 1장 잠금
        const hand = this.handOf(controller);
        if (hand.length > 0) {
          const target = this.pickRandomFrom(hand)!;
          this.lockCard(controller, target);
        }
      } else if (choice === 'b') {
        // 효과2: 무작위 유닛 공격 — 적이면 전투, 아군이면 스탯 감소 (trapped 제외)
        const others = this.allFieldUnitIds().filter((id) => id !== unitId && !Q.isTrapped(this.state, id));
        if (others.length === 0) continue;
        const targetId = this.pickRandomFrom(others)!;
        if (this.controllerOf(targetId) !== controller) {
          this.resolveCombat1v1(unitId, targetId);
        } else {
          this.modifyStat(targetId, 'power', -this.powerOf(unitId));
          this.modifyStat(targetId, 'wisdom', -this.wisdomOf(unitId));
        }
      } else {
        // 효과3: 다른 모든 아군 유닛 -2 힘 (trapped 제외 — modifyStat이 내부에서도 차단하지만 명시)
        for (const id of this.fieldOf(controller)) {
          if (id !== unitId && !Q.isTrapped(this.state, id)) this.modifyStat(id, 'power', -2);
        }
      }
    }
  }

  // 삼장법사 여정 이동: 매 턴 cell-1. cell===0 도달 시 전 유닛 진행 + 자신 진행.
  journeyStep(unitId: string): void {
    const u = this.state.units[unitId];
    if (!u) return;
    if (u.cell > 0) {
      const nextCell = u.cell - 1;
      // Only move if the target cell is empty (journey pauses if blocked).
      if (!this.state.field[u.controller][nextCell]) {
        G.moveUnit(this.state, unitId, nextCell);
      }
    }
    // Check completion after potential move.
    const after = this.state.units[unitId];
    if (after && after.cell === 0) {
      // Evolve all allies first.
      for (const id of this.fieldOf(after.controller)) {
        if (id !== unitId) this.evolveUnit(id);
      }
      // Evolve 삼장법사 → 전단공덕불.
      this.evolveUnit(unitId);
    }
  }

  private _checkCellTrap(instanceId: string): void {
    const u = this.state.units[instanceId];
    if (!u) return;
    const opp = Q.otherPlayer(u.controller);
    const idx = this.state.cellTraps.findIndex((t) => t.byPlayer === opp && t.cell === u.cell);
    if (idx < 0) return;
    this.state.cellTraps.splice(idx, 1);
    if (Q.powerOf(this.state, instanceId) < 5) {
      this.destroyUnit(instanceId);
    } else {
      G.modifyStat(this.state, instanceId, 'power', -5);
    }
  }

  private _subscribeUnit(instanceId: string, controller: PlayerId, cardId: string): void {
    const card = this.registry.get(cardId);
    const ctx = makeContext(instanceId, controller, cardId, this, this.events);
    card.subscribe(ctx);
  }
}

function _pickRandom(state: GameState, pool: string[], count: number): string[] {
  const arr = [...pool];
  const out: string[] = [];
  for (let k = 0; k < count && arr.length > 0; k++) {
    const idx = Math.floor(G.nextRandom(state) * arr.length);
    out.push(arr.splice(idx, 1)[0]);
  }
  return out;
}

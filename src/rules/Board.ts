// Battlefield mediator. The only place that writes to GameState (via gameMut.ts
// primitives) and the only place that reads via queries.ts. Cards call Board
// methods from their onPlay / subscribe callbacks — never touching state directly.

import * as G from './gameMut.js';
import * as Q from './queries.js';
import { develop } from './environment.js';
import type { EventManager } from './EventManager.js';
import type { CardRegistry } from './cards/CardRegistry.js';
import { GRID_SIZE, type GameEvent, type GameState, type PlayerId, type StatName } from './types.js';
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
  // 존재하지 않는 유닛에 접근하면 던진다(오귀속 방지) — power/wisdom/cunning과 달리
  // cardId/controller/cell은 잘못된 기본값이 효과를 엉뚱한 진영에 적용시킬 수 있다.
  get cardId(): string { return Q.requireUnit(this.board.state, this.instanceId).cardId; }
  get controller(): PlayerId { return Q.requireUnit(this.board.state, this.instanceId).controller; }
  get cell(): number { return Q.requireUnit(this.board.state, this.instanceId).cell; }

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

  // 환대 활성화 중엔 적 유닛도 아군으로 간주해 이 목록에 합쳐진다(배경조건/아군 대상
  // 카드가 이 메서드를 통해 유닛 풀을 얻으므로 여기서 한 곳만 바꾸면 된다).
  unitsOn(player: PlayerId): UnitHandle[] {
    const ids = this.state.hospitality
      ? [...Q.fieldUnitIds(this.state, player), ...Q.fieldUnitIds(this.state, Q.otherPlayer(player))]
      : Q.fieldUnitIds(this.state, player);
    return ids.map((id) => new UnitHandle(id, this));
  }

  allFieldUnitIds(): string[] { return Q.allUnitIds(this.state); }

  unitCount(player: PlayerId): number { return Q.unitCount(this.state, player); }
  isInHand(player: PlayerId, cardId: string): boolean { return Q.inHand(this.state, player, cardId); }
  removeFromHand(player: PlayerId, cardId: string): void { G.removeFromHand(this.state, player, cardId); }
  otherPlayer(p: PlayerId): PlayerId { return Q.otherPlayer(p); }
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
  controllerOf(instanceId: string): PlayerId { return Q.requireUnit(this.state, instanceId).controller; }
  powerOf(instanceId: string): number { return Q.powerOf(this.state, instanceId); }
  wisdomOf(instanceId: string): number { return Q.wisdomOf(this.state, instanceId); }
  cunningOf(instanceId: string): number { return Q.cunningOf(this.state, instanceId); }
  unitHasKeyword(instanceId: string, keyword: string): boolean {
    return Q.unitIdHasKeyword(this.state, instanceId, keyword);
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
  //  - 호위(난입): 수비측 손에 '호위' 카드가 있으면 그 카드가 손에서 즉시 발동(소모)되어
  //    다른 무작위 아군이 대신 대상이 된다.
  resolveTargeting(targetId: string, opts: { kind: 'spell' | 'attack'; wisdomAmount?: number }): string | null {
    const u = Q.findUnit(this.state, targetId);
    if (!u) return null;
    const defender = u.controller;

    // 성검: 이 유닛을 대상으로 하는 주문에 대해 지략 5 (wisdom-gated 주문만 실효).
    if (opts.kind === 'spell' && opts.wisdomAmount !== undefined) {
      const effCunning = Q.cunningOf(this.state, targetId) + (Q.unitHasKeyword(u, '성검') ? 5 : 0);
      if (effCunning >= opts.wisdomAmount) return null; // 무효화
    }

    // 호위: 손에 있는 '호위' 카드 하나가 대신 다른 무작위 아군에게 대상을 넘기고 소모된다.
    const guardCardId = Q.findHandCardWithKeyword(this.state, defender, '호위');
    if (guardCardId) {
      const others = Q.fieldUnitIds(this.state, defender).filter((id) => id !== targetId);
      const redirect = this.pickRandomFrom(others);
      if (redirect) {
        this.removeFromHand(defender, guardCardId);
        return redirect;
      }
    }

    return targetId;
  }

  // 대리 전투: targetId가 '대리방어필요' 키워드를 가지면(삼장법사), 같은 컨트롤러의
  // '대리방어' 키워드를 가진(트랩되지 않은) 유닛이 있을 때 그 유닛이 대신 공격받는다
  // (저오능/사오정). 공격 선언 시점에 호출 — 협공 후보 계산 전에 대상을 확정한다.
  substituteDefender(targetId: string): string {
    const u = Q.findUnit(this.state, targetId);
    if (!u || !Q.unitHasKeyword(u, '대리방어필요')) return targetId;
    const sub = Q.fieldUnitIds(this.state, u.controller).find(
      (id) => Q.unitIdHasKeyword(this.state, id, '대리방어') && !Q.isTrapped(this.state, id),
    );
    return sub ?? targetId;
  }

  // --- writes ----------------------------------------------------------------

  // Place a card from hand to field. Optional cell; auto-assigns if omitted.
  // If the field is full, the unit is simply discarded (never created) —
  // the returned id then refers to nothing.
  summon(player: PlayerId, cardId: string, cell?: number): string {
    const instanceId = G.summon(this.state, player, cardId, cell);
    if (Q.unitExists(this.state, instanceId)) this.#subscribeUnit(instanceId, player, cardId);
    return instanceId;
  }

  // Spawn a card to field without requiring it in hand. If the field is full,
  // the unit is simply discarded (never created) — the returned id then
  // refers to nothing.
  summonCard(player: PlayerId, cardId: string, cell?: number): string {
    const instanceId = G.summonCard(this.state, player, cardId, cell);
    if (Q.unitExists(this.state, instanceId)) {
      this.#subscribeUnit(instanceId, player, cardId);
      this.#checkCellTrap(instanceId);
    }
    return instanceId;
  }

  moveUnit(instanceId: string, toCell: number): void {
    G.moveUnit(this.state, instanceId, toCell);
    this.#checkCellTrap(instanceId);
  }

  // 교회: 묘지에서 키워드 일치 사망 유닛을 부활 (스탯/레벨 유지, exp 리셋). 재구독한다.
  reviveFromGraveyard(player: PlayerId, keyword: string, cell?: number): string | null {
    const instanceId = G.reviveFromGraveyard(this.state, player, keyword, cell);
    if (instanceId) {
      const cardId = Q.findUnit(this.state, instanceId)!.cardId;
      this.#subscribeUnit(instanceId, player, cardId);
    }
    return instanceId;
  }

  destroyUnit(instanceId: string, killerId?: string): void {
    if (!Q.unitExists(this.state, instanceId)) return;
    G.destroyUnit(this.state, instanceId, killerId);
    this.events.unsubscribeUnit(instanceId);
  }

  exitUnit(instanceId: string): void {
    G.exitUnit(this.state, instanceId);
    this.events.unsubscribeUnit(instanceId);
  }

  // 컨트롤 이동(배신 등). 이동할 자리가 없으면 유닛은 사망 처리된다.
  setController(instanceId: string, to: PlayerId): void {
    if (Q.unitCount(this.state, to) >= GRID_SIZE) {
      this.destroyUnit(instanceId);
      return;
    }
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

  // 황폐(D-1 소모전 규칙, 사용자 결정 2026-07-06): 필드의 모든 유닛에게 -1 힘을
  // 주고 힘이 0 이하가 된 유닛은 파괴한다. 협공 벽처럼 "성립하는 공격이 없는"
  // 진짜 교착도 시간이 지나면 강제로 끝나도록 만드는 것이 목적이라 무승부
  // 규칙 없이도 게임이 종료된다. modifyStat이 이미 trapped 유닛은 건드리지
  // 않으므로(오행산 면역) 여기서도 자동으로 면제된다.
  applyDesolation(): void {
    const ids = Q.allUnitIds(this.state);
    for (const id of ids) this.modifyStat(id, 'power', -1);
    for (const id of ids) {
      if (Q.unitExists(this.state, id) && Q.powerOf(this.state, id) <= 0) this.destroyUnit(id);
    }
  }

  addToHand(player: PlayerId, cardId: string): void { G.addToHand(this.state, player, cardId); }

  lockCard(player: PlayerId, cardId: string): void { G.lockCard(this.state, player, cardId); }

  setHospitality(active: boolean): void { G.setHospitality(this.state, active); }

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
    const u = Q.findUnit(this.state, instanceId);
    if (!u) return;
    const card = this.registry.get(u.cardId);
    if (!card.meta.evolveTarget) return;
    G.evolveTo(this.state, instanceId, card.meta.evolveTarget);
    this.events.unsubscribeUnit(instanceId);
    this.#subscribeUnit(instanceId, u.controller, card.meta.evolveTarget);
  }

  // Evolve a unit to an explicit target card, re-subscribing.
  evolveUnitTo(instanceId: string, newCardId: string): void {
    const u = Q.findUnit(this.state, instanceId);
    if (!u) return;
    G.evolveTo(this.state, instanceId, newCardId);
    this.events.unsubscribeUnit(instanceId);
    this.#subscribeUnit(instanceId, u.controller, newCardId);
  }

  // 오행산 trap / untrap
  trap(instanceId: string): void { G.trapUnit(this.state, instanceId); }
  untrap(instanceId: string): void { G.untrapUnit(this.state, instanceId); }
  isTrapped(instanceId: string): boolean { return Q.isTrapped(this.state, instanceId); }

  // 패악질: 3가지 효과 중 하나 (random), 또는 전부
  mayhemOne(unitId: string): void { this.#mayhem(unitId, false); }
  mayhemAll(unitId: string): void { this.#mayhem(unitId, true); }

  #mayhem(unitId: string, all: boolean): void {
    const u = Q.findUnit(this.state, unitId);
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

  // 삼장법사 여정 완주 판정: 이동은 일반 유닛처럼 플레이어가 직접 하고,
  // 매 턴 끝에 cell 0에 도달해 있는지만 확인한다 — 도달 시 전 유닛 진행 + 자신 진행.
  checkJourneyArrival(unitId: string): void {
    const u = Q.findUnit(this.state, unitId);
    if (!u || u.cell !== 0) return;
    // Evolve all allies first.
    for (const id of this.fieldOf(u.controller)) {
      if (id !== unitId) this.evolveUnit(id);
    }
    // Evolve 삼장법사 → 전단공덕불.
    this.evolveUnit(unitId);
  }

  #checkCellTrap(instanceId: string): void {
    const u = Q.findUnit(this.state, instanceId);
    if (!u) return;
    const opp = Q.otherPlayer(u.controller);
    if (!G.consumeCellTrap(this.state, opp, u.cell)) return;
    if (Q.powerOf(this.state, instanceId) < 5) {
      this.destroyUnit(instanceId);
    } else {
      G.modifyStat(this.state, instanceId, 'power', -5);
    }
  }

  #subscribeUnit(instanceId: string, controller: PlayerId, cardId: string): void {
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

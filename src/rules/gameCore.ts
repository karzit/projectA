// The top-level game object. Owns GameState, EventManager, and Board.

import { createGame, checkLoss, clearTurnBuffs, removeFromHand, addToHand, markForcedFired, spendCunning, resetCunningTurn, resetBondTurn, markBondPlayed, setPendingReaction, setPendingAttack, moveUnit, swapUnits } from './gameMut.js';
import { canPlay } from './conditions.js';
import { Board } from './Board.js';
import { EventManager } from './EventManager.js';
import type { StaticSub, EventSub } from './EventManager.js';
import { CARD_REGISTRY } from './cards/CardRegistry.js';
import { makeContext, ChoiceRequired } from './GameContext.js';
import type { GameContext } from './GameContext.js';
import type { Card } from './cards/Card.js';
import {
  attackableTargets,
  isTrapped,
  canAttack,
  canMove,
  coopBlockersFor,
  hexAdjacent,
  eligibleCunningBlockers,
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
  unitAtCell,
} from './queries.js';
import type { RulesAction } from './actions.js';
import type { AttackReactionRequest, ChoiceRequest, GameState, PlayerId, ReactionRequest } from './types.js';
import { GRID_SIZE } from './types.js';
import type { UnitCard } from './cards/Card.js';

export interface RulesResult {
  state: GameState;
  error?: string;
  choiceRequest?: ChoiceRequest;
  reactionRequest?: ReactionRequest;
  attackReactionRequest?: AttackReactionRequest;
}

const SETTLE_LIMIT = 100;
// 황폐(D-1 소모전 규칙, 사용자 결정 2026-07-06): 이 턴 수부터 매 턴의 시작과
// 종료 시 필드의 모든 유닛이 -1 힘을 받는다(Board.applyDesolation). 협공 벽
// 같은 "성립하는 공격이 없는" 진짜 교착도 결국 강제로 끝나게 만드는 목적이라
// 무승부 판정 없이 소모전으로 게임을 종료시킨다.
export const DESOLATION_START_TURN = 35;

interface SubscriptionSnapshot {
  static: StaticSub[];
  event: EventSub[];
}

class Illegal extends Error {}
function fail(msg: string): never { throw new Illegal(msg); }

// A play prevented by 지략 (cunning). Unlike Illegal, its state mutations
// (지략 소진 + 카드 잠금) are committed before the error is returned.
class Blocked extends Error {}

export class Game {
  // `readonly`는 재할당만 막는다 — 이 객체 자체는 apply()가 제자리에서 계속 변형하는
  // 살아있는 참조이며, 클라이언트(App.ts의 getState)에도 그대로 노출된다. 읽기 전용
  // 계약이다: 외부 코드는 이 값을 읽기만 해야 하며, 절대 직접 써서는 안 된다 — 쓰면
  // apply()의 스냅샷 롤백/결정론 보장이 깨진다. 모든 쓰기는 game.apply(action)을
  // 거쳐야 한다.
  readonly state: GameState;
  readonly board: Board;
  private readonly events: EventManager;
  private readonly actionLog: RulesAction[] = [];

  constructor(config: Parameters<typeof createGame>[0], existingState?: GameState) {
    this.state = existingState ? structuredClone(existingState) : createGame(config);
    this.events = new EventManager();
    this.board = new Board(this.state, this.events, CARD_REGISTRY);
    this.#subscribeHandCards();
    if (existingState) this.#subscribeFieldUnits();
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
    // 지략 반응 대기 중에는 react 액션만 허용.
    if (this.state.pendingReaction && action.type !== 'react') {
      return { state: this.state, error: '지략 반응 대기 중입니다 (react 필요)' };
    }
    // 협공 반응 대기 중에는 resolveAttack 액션만 허용.
    if (this.state.pendingAttack && action.type !== 'resolveAttack') {
      return { state: this.state, error: '협공 반응 대기 중입니다 (resolveAttack 필요)' };
    }
    const snap = structuredClone(this.state);
    const snapSubs = this.#snapshotSubscriptions();
    try {
      this.#apply(action);
      // play가 지략 opt-in으로 보류되면 반응 요청을 surface (settle/패배 판정 보류).
      const pr = this.state.pendingReaction;
      if (pr) {
        this.actionLog.push(action);
        return {
          state: this.state,
          reactionRequest: { player: pr.player, controller: pr.play.controller, cardId: pr.play.cardId, amount: pr.amount, eligibleBlockers: pr.eligibleBlockers, prompt: `${pr.amount} 지략으로 봉쇄하시겠습니까?` },
        };
      }
      // attack이 협공 가능한 수비 유닛을 만나면 보류되고 수비측 반응을 기다린다.
      const pa = this.state.pendingAttack;
      if (pa) {
        this.actionLog.push(action);
        return {
          state: this.state,
          attackReactionRequest: { player: pa.defender, attackerId: pa.attackerId, targetId: pa.targetId, blockable: pa.blockable, prompt: '협공할 유닛을 선택하세요 (선택하지 않으면 단독 방어)' },
        };
      }
      if (isMainPhase(this.state)) this.#settle();
      this.actionLog.push(action);
      return { state: this.state };
    } catch (e) {
      if (e instanceof ChoiceRequired) {
        Object.assign(this.state, snap);
        this.#restoreSubscriptions(snapSubs);
        return { state: this.state, choiceRequest: e.request };
      }
      if (e instanceof Blocked) {
        this.actionLog.push(action);
        return { state: this.state, error: e.message };
      }
      if (e instanceof Illegal) {
        Object.assign(this.state, snap);
        this.#restoreSubscriptions(snapSubs);
        return { state: this.state, error: e.message };
      }
      throw e;
    }
  }

  syncSubscriptions(): void {
    this.events.clear();
    this.#subscribeHandCards();
    this.#subscribeFieldUnits();
  }

  serialize(): { state: GameState; log: RulesAction[] } {
    return { state: structuredClone(this.state), log: [...this.actionLog] };
  }

  // --- private ---------------------------------------------------------------

  #subscribeHandCards(): void {
    for (const p of ['A', 'B'] as PlayerId[]) {
      for (const cardId of handCardIds(this.state, p)) {
        const card = CARD_REGISTRY.get(cardId);
        card.subscribe(makeContext(undefined, p, cardId, this.board, this.events));
      }
    }
  }

  #subscribeFieldUnits(): void {
    for (const p of ['A', 'B'] as PlayerId[]) {
      for (const unitId of fieldUnitIds(this.state, p)) {
        const u = findUnit(this.state, unitId);
        if (!u) continue;
        const card = CARD_REGISTRY.get(u.cardId);
        card.subscribe(makeContext(unitId, u.controller, u.cardId, this.board, this.events));
      }
    }
  }

  #snapshotSubscriptions(): SubscriptionSnapshot {
    return {
      static: [...this.events.getStaticSubs()],
      event: [...this.events.getEventSubs()],
    };
  }

  #restoreSubscriptions(snap: SubscriptionSnapshot) {
    this.events.clear();
    for (const s of snap.static) this.events.onStatic(s);
    for (const s of snap.event) this.events.on(s);
  }

  #apply(action: RulesAction): void {
    switch (action.type) {
      case 'placeOpening': return this.#placeOpening(action.player, action.cardId, action.cell);
      case 'finishOpening': return this.#finishOpening(action.player);
      case 'play': return this.#play(action.player, action.cardId, action.choices ?? [], action.cell);
      case 'attack': return this.#attack(action.player, action.attackerId, action.targetId);
      case 'ability': return this.#ability(action.player, action.unitId, action.choices ?? []);
      case 'move': return this.#move(action.player, action.unitId, action.toCell);
      case 'react': return this.#react(action.player, action.block, action.blockerId);
      case 'resolveAttack': return this.#resolveAttack(action.player, action.blockerIds);
      case 'pass': return this.#pass(action.player);
    }
  }

  // --- opening ---------------------------------------------------------------

  #placeOpening(player: PlayerId, cardId: string, cell: number): void {
    if (!isOpeningPhase(this.state)) fail('오프닝 페이즈가 아닙니다');
    if (this.state.openingDone[player]) fail('오프닝을 이미 완료했습니다');
    if (this.state.openingPlaced[player] >= 3) fail('오프닝에는 최대 3장까지 낼 수 있습니다');
    if (cell < 0 || cell >= GRID_SIZE) fail('유효하지 않은 셀 번호입니다');
    if (unitAtCell(this.state, player, cell)) fail('해당 셀은 이미 사용 중입니다');
    this.#placeOpeningCard(player, cardId, cell);
    this.state.openingPlaced[player] += 1;
    if (this.state.openingPlaced[player] >= 3) this.state.openingDone[player] = true;
    this.#maybeStartMain();
  }

  #finishOpening(player: PlayerId): void {
    if (!isOpeningPhase(this.state)) fail('오프닝 페이즈가 아닙니다');
    this.state.openingDone[player] = true;
    this.#maybeStartMain();
  }

  #placeOpeningCard(player: PlayerId, cardId: string, cell: number): void {
    if (!inHand(this.state, player, cardId)) fail('패에 없는 카드입니다');
    const card = CARD_REGISTRY.get(cardId);
    const check = canPlay(this.state, card, player);
    if (!check.ok) fail(check.reason ?? `${card.name}: 배경 조건을 충족하지 못했습니다`);
    const unitId = card.kind === 'unit'
      ? this.board.summon(player, cardId, cell)
      : (removeFromHand(this.state, player, cardId), undefined);
    this.state.openingPlays[player].push({ cardId, controller: player, choices: [], unitId });
  }

  #maybeStartMain(): void {
    if (!(this.state.openingDone.A && this.state.openingDone.B)) return;
    this.state.phase = 'main';
    this.state.active = 'A';
    this.state.turn = 1;
    for (const player of ['A', 'B'] as PlayerId[]) {
      for (const dp of this.state.openingPlays[player]) {
        const card = CARD_REGISTRY.get(dp.cardId);
        const ctx = makeContext(dp.unitId, dp.controller, dp.cardId, this.board, this.events, dp.choices);
        // 오프닝 배치는 choices를 받을 창구가 없다(dp.choices는 항상 []) — 선택이
        // 필요한 카드는 여기서 불발한다.
        this.#runOnPlayOrFizzle(ctx, card);
      }
      // 처리 완료된 오프닝 배치는 큐에서 비운다 — 남아 있으면 isRevealed(D-2)가
      // 계속 "미공개"로 오판해 메인 페이즈 유닛이 배경 조건/공격에서 사라진다.
      this.state.openingPlays[player] = [];
    }
  }

  // --- main ------------------------------------------------------------------

  #requireMainTurn(player: PlayerId): void {
    if (!isMainPhase(this.state)) fail('메인 페이즈가 아닙니다');
    if (!isActiveTurn(this.state, player)) fail('상대방의 턴입니다');
  }

  #play(player: PlayerId, cardId: string, choices: string[], cell?: number): void {
    this.#requireMainTurn(player);
    if (!inHand(this.state, player, cardId)) fail('패에 없는 카드입니다');
    if (isCardLocked(this.state, player, cardId)) fail('이번 턴에 지략으로 봉쇄된 카드입니다');
    const card = CARD_REGISTRY.get(cardId);
    const check = canPlay(this.state, card, player);
    if (!check.ok) fail(check.reason ?? `${card.name}: 배경 조건을 충족하지 못했습니다`);
    this.#resolvePlay(player, cardId, choices, cell);
  }

  // play의 실제 발동. 결속·소환/손패 이탈까지는 항상 즉시 커밋된다(카드 사본 이중 사용
  // 방지). 지략 opt-in은 "카드 효과가 실제로 처리되는 시점"에만 반응한다 — 상대가 무엇을
  // 냈는지 모르는 상태에서 막을 수는 없으므로, 손패에 그대로 있는 시점(=낸 시점)이 아니라
  // 효과가 발동하려는 바로 그 순간에 체크한다. `개입` 카드는 이 순간이 지금(같은 호출
  // 안)이고, 일반 카드는 턴 종료 큐 처리 때(_drainPendingPlays)다 — 둘 다 동일한 지점
  // (onPlay 호출 직전)에서 확인하며, 봉쇄되면 이미 커밋된 손패 이탈/결속 표시를 되돌린다.
  // 사본(state clone + 스크래치 Board/EventManager)에서 onPlay를 시험 실행해 주어진
  // choices가 충분한지 검사한다. 실제 상태는 건드리지 않는다(사본은 버려짐). 충분하면
  // true, 부족하면 해당 ChoiceRequest를 반환한다. onPlay 내부의 다른 예외(카드 버그)는
  // 여기서 판단할 문제가 아니므로 통과시킨다 — 실제 실행 시 그대로 드러난다.
  #choicesSatisfiable(cardId: string, player: PlayerId, choices: string[]): true | ChoiceRequest {
    const card = CARD_REGISTRY.get(cardId);
    const scratchState = structuredClone(this.state);
    const scratchEvents = new EventManager();
    const scratchBoard = new Board(scratchState, scratchEvents, CARD_REGISTRY);
    const unitId = card.kind === 'unit' ? scratchBoard.summon(player, cardId) : undefined;
    const ctx = makeContext(unitId, player, cardId, scratchBoard, scratchEvents, choices);
    try {
      card.onPlay(ctx);
      return true;
    } catch (e) {
      if (e instanceof ChoiceRequired) return e.request;
      return true;
    }
  }

  // onPlay를 실제로 실행한다. 낸 시점에 선택이 충분해도(_choicesSatisfiable 검증
  // 통과, 또는 지략 반응을 통과해서 재개되는 경우) 그 사이 대상이 사라지는 등 상태가
  // 바뀌어 지금은 불충분할 수 있다. pass/react 액션엔 선택을 실을 창구가 없어 되돌릴
  // 수 없으므로, 이런 잔여 케이스는 효과를 불발(fizzle)시킨다 — 카드 버그(다른 예외)는
  // 그대로 던진다.
  #runOnPlayOrFizzle(ctx: GameContext, card: Card): void {
    try {
      card.onPlay(ctx);
    } catch (e) {
      if (!(e instanceof ChoiceRequired)) throw e;
    }
  }

  #resolvePlay(player: PlayerId, cardId: string, choices: string[], cell?: number): void {
    const card = CARD_REGISTRY.get(cardId);
    const isBond = card.meta.keywords?.includes('결속') ?? false;
    if (isBond && this.state.bondPlayedThisTurn[player]) fail('결속 카드는 한 턴에 한 장만 낼 수 있습니다');
    const isIntervene = card.meta.keywords?.includes('개입') ?? false;
    // 개입 카드는 지금 onPlay가 실행되므로 선택 부족 시 ChoiceRequired가 자연히 이
    // play 액션에서 표면화된다. 일반(큐잉) 카드는 onPlay가 나중(pass 시점)에 실행되는데
    // pass 액션에는 선택을 실을 창구가 없어, 부족한 선택이 그대로 큐에 실리면 나중에
    // 되돌릴 수 없는 교착에 빠진다 — 그래서 낸 시점에 사본으로 미리 검증한다.
    if (!isIntervene) {
      const probe = this.#choicesSatisfiable(card.id, player, choices);
      if (probe !== true) throw new ChoiceRequired(probe);
    }
    const unitId = card.kind === 'unit'
      ? this.board.summon(player, cardId, cell)
      : (removeFromHand(this.state, player, cardId), undefined);
    if (isBond) markBondPlayed(this.state, player);
    if (!isIntervene) {
      // 일반 카드: 턴 종료 시 순서대로 처리 (반응 체크도 그때)
      this.state.pendingPlays.push({ cardId, controller: player, choices, unitId });
      return;
    }
    // 개입 카드: 지금이 처리 시점 — 여기서 지략 반응을 확인한다 (낸 시점이 아니라).
    const opponent = otherPlayer(player);
    for (const cond of card.meta.conditions ?? []) {
      if (cond.need !== 'wisdom') continue;
      const blockers = eligibleCunningBlockers(this.state, opponent, cond.amount);
      if (blockers.length === 0) continue;
      setPendingReaction(this.state, {
        player: opponent,
        amount: cond.amount,
        eligibleBlockers: blockers,
        source: 'immediate',
        play: { cardId, controller: player, choices, cell, unitId },
      });
      return; // 반응 대기 — 손패 이탈/결속 표시는 봉쇄 시 _react가 되돌린다.
    }
    const ctx = makeContext(unitId, player, cardId, this.board, this.events, choices);
    card.onPlay(ctx);
  }

  // 지략 opt-in 반응: 수비측이 보류된 카드를 봉쇄(block)하거나 통과시킨다.
  #react(player: PlayerId, block: boolean, blockerId?: string): void {
    const pr = this.state.pendingReaction;
    if (!pr) fail('반응할 대상이 없습니다');
    if (player !== pr.player) fail('상대가 반응할 차례가 아닙니다');
    if (block) {
      if (blockerId !== undefined && !pr.eligibleBlockers.includes(blockerId)) fail('봉쇄할 수 없는 유닛입니다');
      const bid = blockerId ?? pr.eligibleBlockers[0];
      if (!bid) fail('봉쇄할 지략 유닛이 없습니다');
      spendCunning(this.state, bid, pr.play.controller, pr.play.cardId); // 지략 1회 소진 + 카드 잠금
      setPendingReaction(this.state, null);
      // 효과 무산 — 카드는 이미 손패를 떠난 상태였으므로(개입/일반 공통) 돌려준다.
      const card = CARD_REGISTRY.get(pr.play.cardId);
      if (card.meta.keywords?.includes('결속')) this.state.bondPlayedThisTurn[pr.play.controller] = false;
      // 유닛 카드는 이미 필드에 소환된 상태였다 — 봉쇄되면 필드에서 제거(사망 처리 아님).
      if (pr.play.unitId) this.board.exitUnit(pr.play.unitId);
      addToHand(this.state, pr.play.controller, pr.play.cardId);
      if (pr.source === 'queued') {
        this.state.pendingPlays.shift(); // 큐 맨 앞의 항목(보류 대상) 제거
        this.#drainPendingPlays(); // 나머지 큐 계속 처리
      }
      // source === 'immediate': 이번 play 액션은 여기서 끝난다.
    } else {
      setPendingReaction(this.state, null);
      if (pr.source === 'immediate') {
        const { controller, cardId, choices } = pr.play;
        const ctx = makeContext(undefined, controller, cardId, this.board, this.events, choices);
        this.#runOnPlayOrFizzle(ctx, CARD_REGISTRY.get(cardId));
      } else {
        // 큐 맨 앞 카드를 실행하고(재확인 없이 — 이미 통과함) 나머지 큐를 계속 처리한다.
        const dp = this.state.pendingPlays.shift();
        if (dp) {
          const ctx = makeContext(dp.unitId, dp.controller, dp.cardId, this.board, this.events, dp.choices);
          this.#runOnPlayOrFizzle(ctx, CARD_REGISTRY.get(dp.cardId));
        }
        this.#drainPendingPlays();
      }
    }
  }

  // 공격 선언. 협공 가능한 수비 유닛이 있으면 즉시 해결하지 않고 pendingAttack을 설정해
  // 수비측의 resolveAttack 반응을 기다린다. 없으면 즉시 단독 1:1로 해결한다.
  #attack(player: PlayerId, attackerId: string, targetId: string): void {
    this.#requireMainTurn(player);
    const attacker = findUnit(this.state, attackerId);
    let target = findUnit(this.state, targetId);
    if (!attacker || attacker.controller !== player) fail('내 유닛이 아닙니다');
    if (!target || target.controller === player) fail('적 유닛을 대상으로 해야 합니다');
    if (!canAttack(this.state, attackerId)) {
      if (attacker.keywords.includes('cannotAttack')) fail(`${attacker.cardId}: 이 유닛은 공격할 수 없습니다`);
      fail('이 유닛은 이번 턴에 이미 행동했습니다');
    }

    // Validate target is within attack range.
    const validTargets = attackableTargets(this.state, attackerId);
    if (!validTargets.includes(targetId)) fail('해당 유닛은 공격 범위 밖에 있습니다');

    // 대리 전투: '대리방어필요' 대상은 같은 컨트롤러의 '대리방어' 유닛이 있으면 대신 받는다
    // (저오능/사오정 → 삼장법사). 카드별 분기 없이 키워드로 표현 — Board.substituteDefender.
    const substituteId = this.board.substituteDefender(targetId);
    if (substituteId !== targetId) {
      targetId = substituteId;
      target = findUnit(this.state, targetId)!;
    }

    const blockable = coopBlockersFor(this.state, targetId);
    if (blockable.length === 0) {
      this.#resolveSoloCombat(attackerId, targetId);
      this.state.actedThisTurn.push(attackerId);
      return;
    }

    // 협공 가능한 수비 유닛이 있다 — 수비측의 resolveAttack 반응을 기다린다.
    setPendingAttack(this.state, { defender: target.controller, attackerId, targetId, blockable });
  }

  // 협공 반응: 수비측이 보류된 공격에 합류시킬 유닛을 선택한다(빈 배열 = 단독 방어).
  #resolveAttack(player: PlayerId, blockerIds: string[]): void {
    const pa = this.state.pendingAttack;
    if (!pa) fail('반응할 공격이 없습니다');
    if (player !== pa.defender) fail('상대가 반응할 차례가 아닙니다');
    const seen = new Set<string>();
    for (const bid of blockerIds) {
      if (!pa.blockable.includes(bid)) fail('협공할 수 없는 유닛입니다');
      if (seen.has(bid)) fail('중복된 협공 유닛입니다');
      seen.add(bid);
    }
    const { attackerId, targetId } = pa;
    setPendingAttack(this.state, null);
    if (blockerIds.length === 0) {
      this.#resolveSoloCombat(attackerId, targetId);
    } else {
      this.#resolveCoopCombat(attackerId, targetId, blockerIds);
    }
    this.state.actedThisTurn.push(attackerId);
  }

  // 1:1 전투 — 호위(난입)로 대상이 다른 아군으로 리다이렉트될 수 있다.
  #resolveSoloCombat(attackerId: string, targetId: string): void {
    const finalTarget = this.board.resolveTargeting(targetId, { kind: 'attack' }) ?? targetId;
    // 고블린 떼: 공격 시 다른 미행동 고블린이 함께 공격(힘 합산, 전원 행동 처리).
    const goblinAllies = this.#goblinSupporters(attackerId);
    // 방어 유닛에 풀플레이트(수비강화3) 적용
    const armored = this.#applyArmor([finalTarget]);
    const ap = powerOf(this.state, attackerId) + goblinAllies.reduce((s, id) => s + powerOf(this.state, id), 0);
    const dp = powerOf(this.state, finalTarget);
    const targetImmune = this.board.unitHasKeyword(finalTarget, 'combatImmune');
    if (ap >= dp && !targetImmune) this.board.destroyUnit(finalTarget);
    if (ap <= dp) {
      // 패배: 공격에 참여한 고블린(선두 + 합류) 전부 파괴. 전투 면역 유닛은 제외.
      for (const id of [attackerId, ...goblinAllies]) {
        if (!this.board.unitHasKeyword(id, 'combatImmune')) this.board.destroyUnit(id);
      }
    }
    this.#revertArmor(armored);
    for (const id of goblinAllies) this.state.actedThisTurn.push(id);
  }

  // 협공: 수비측이 선택한 blockerIds + 1차 대상의 합산 힘으로 해결한다.
  #resolveCoopCombat(attackerId: string, targetId: string, blockerIds: string[]): void {
    const allBlockers = [targetId, ...blockerIds];
    // 협공에 참여한 모든 방어 유닛에 풀플레이트(수비강화3) 적용
    const armored = this.#applyArmor(allBlockers);
    const ap = powerOf(this.state, attackerId);
    const totalDp = allBlockers.reduce((sum, bid) => sum + powerOf(this.state, bid), 0);

    if (totalDp < ap) {
      // 협공 실패 — 수비 유닛 전원 파괴 (전투 면역 제외)
      for (const bid of allBlockers) {
        if (!this.board.unitHasKeyword(bid, 'combatImmune')) this.board.destroyUnit(bid);
      }
    }
    // totalDp >= ap: 협공 성공 — 동점 포함 전원 생존
    this.#revertArmor(armored);
    this.state.blockedThisTurn.push(...allBlockers);
  }

  // 풀플레이트(수비강화3): 공격받는 방어 유닛에게 전투 동안만 +3 힘.
  // 적용된 유닛 id 목록을 반환한다.
  #applyArmor(defenderIds: string[]): string[] {
    const armored = defenderIds.filter((id) => this.board.unitHasKeyword(id, '수비강화3'));
    for (const id of armored) this.board.modifyStat(id, 'power', 3);
    return armored;
  }

  // 전투 종료 — 생존한(아직 필드에 있는) 방어 유닛의 +3을 복구한다.
  #revertArmor(armored: string[]): void {
    for (const id of armored) {
      if (this.board.getUnit(id)) this.board.modifyStat(id, 'power', -3);
    }
  }

  // 고블린 떼: 공격하는 고블린과 함께 공격하는 미행동 아군 고블린들. 협력 방어처럼
  // 선두 공격자의 인접 셀에 있는 고블린만 합류한다(힘 합산). 패배 시 참여 고블린 전부 파괴.
  #goblinSupporters(attackerId: string): string[] {
    if (!this.board.unitHasKeyword(attackerId, '고블린')) return [];
    const controller = this.board.controllerOf(attackerId);
    const leadCell = this.board.getUnit(attackerId)?.cell ?? -1;
    return this.board.fieldOf(controller).filter(
      (id) => id !== attackerId &&
        this.board.unitHasKeyword(id, '고블린') &&
        canAttack(this.state, id) &&
        hexAdjacent(leadCell, this.board.getUnit(id)!.cell),
    );
  }

  #ability(player: PlayerId, unitId: string, choices: string[]): void {
    this.#requireMainTurn(player);
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

  #move(player: PlayerId, unitId: string, toCell: number): void {
    this.#requireMainTurn(player);
    const u = findUnit(this.state, unitId);
    if (!u || u.controller !== player) fail('내 유닛이 아닙니다');
    if (!canMove(this.state, unitId, toCell)) {
      if (this.state.actedThisTurn.includes(unitId)) fail('이 유닛은 이번 턴에 이미 행동했습니다');
      fail('해당 셀로 이동할 수 없습니다');
    }
    // 대상 칸이 아군 유닛으로 점유돼 있으면 이동 대신 위치를 맞바꾼다 — 두 유닛
    // 모두 이번 턴 행동을 소모한다.
    const occupantId = unitAtCell(this.state, player, toCell);
    if (occupantId) {
      swapUnits(this.state, unitId, occupantId);
      this.state.actedThisTurn.push(unitId, occupantId);
      return;
    }
    moveUnit(this.state, unitId, toCell);
    this.state.actedThisTurn.push(unitId);
  }

  #pass(player: PlayerId): void {
    this.#requireMainTurn(player);
    this.#drainPendingPlays();
  }

  // 큐에 쌓인 카드 효과를 순서대로 처리한다. 지략 opt-in 대상(wisdom 조건 카드)을
  // 만나면 처리 시점(= 지금, 카드가 "공개"되는 순간)에 반응 여부를 확인하고, 봉쇄
  // 가능하면 여기서 멈춰(pendingReaction) 수비측의 react를 기다린다 — _react가 재개한다.
  // 큐가 완전히 비면 턴을 마무리한다.
  #drainPendingPlays(): void {
    while (this.state.pendingPlays.length > 0) {
      const dp = this.state.pendingPlays[0];
      const card = CARD_REGISTRY.get(dp.cardId);
      const opponent = otherPlayer(dp.controller);
      let paused = false;
      for (const cond of card.meta.conditions ?? []) {
        if (cond.need !== 'wisdom') continue;
        const blockers = eligibleCunningBlockers(this.state, opponent, cond.amount);
        if (blockers.length === 0) continue;
        setPendingReaction(this.state, {
          player: opponent,
          amount: cond.amount,
          eligibleBlockers: blockers,
          source: 'queued',
          play: { cardId: dp.cardId, controller: dp.controller, choices: dp.choices, unitId: dp.unitId },
        });
        paused = true;
        break;
      }
      if (paused) return; // 반응 대기 — 아직 미해결, 큐는 그대로 둔다 (_react가 재개)
      this.state.pendingPlays.shift();
      const ctx = makeContext(dp.unitId, dp.controller, dp.cardId, this.board, this.events, dp.choices);
      this.#runOnPlayOrFizzle(ctx, card);
    }
    this.#finishEndTurn();
  }

  #finishEndTurn(): void {
    const turnEnder = this.state.active;
    this.state.pendingEvents.push({ kind: 'turnEnd', active: this.state.active });
    clearTurnBuffs(this.state);
    this.state.actedThisTurn = [];
    this.state.blockedThisTurn = [];
    resetCunningTurn(this.state);
    resetBondTurn(this.state);
    // 황폐(턴 종료분): DESOLATION_START_TURN 이후엔 매 턴 종료 시에도 필드
    // 전체가 -1 힘을 받는다. settle 전에 적용해 죽음으로 인한 강제 능력(사망
    // 트리거 등)이 같은 정산 루프에서 함께 풀린다.
    if (this.state.turn >= DESOLATION_START_TURN) this.board.applyDesolation();
    // 패배 판정은 턴 종료 효과(공개된 카드 큐 + turnEnd 이벤트 + 강제 능력)가 모두
    // 정산된 뒤, 상대 턴이 시작되기 전에 한다 — 복수자 같은 필드-빔 반응이 판정보다
    // 먼저 발동할 기회를 갖는다.
    this.#settle();
    this.state.loser = this.state.loser ?? checkLoss(this.state, turnEnder);
    if (this.state.loser) return; // 게임 종료 — 다음 턴은 시작하지 않는다
    this.state.active = otherPlayer(this.state.active);
    this.state.turn += 1;
    this.state.pendingEvents.push({ kind: 'turnStart', active: this.state.active });
    // 황폐(턴 시작분): 새 턴이 임계값 이후면 시작 시에도 한 번 더 적용한다.
    // 이 시점에 필드가 통째로 비어도 즉시 패배 판정하지 않는다 — 규칙상 패배는
    // "자신 턴 종료 시 자신 필드가 비어 있는가"만 보므로, 빈 필드로 자기 턴을
    // 보내다 그 턴이 끝날 때 자연히 checkLoss에 걸린다.
    if (this.state.turn >= DESOLATION_START_TURN) {
      this.board.applyDesolation();
      this.#settle();
    }
  }

  // --- settle loop -----------------------------------------------------------

  #settle(): void {
    for (let outer = 0; outer < SETTLE_LIMIT; outer++) {
      if (outer === SETTLE_LIMIT - 1) {
        // 강제 능력 연쇄가 SETTLE_LIMIT를 넘도록 끝나지 않는다 — 무한 루프 카드 조합
        // 버그일 가능성이 높다. 조용히 끊지 않고 콘솔에 남긴다(게임은 계속 진행됨).
        console.warn(`Game._settle: SETTLE_LIMIT(${SETTLE_LIMIT}) reached — possible infinite forced-ability chain`);
      }
      if (this.state.pendingEvents.length > 0) {
        const ev = this.state.pendingEvents.shift()!;
        const subs = [...this.events.getEventSubs()];
        for (const sub of subs) {
          if (sub.once && hasForcedFired(this.state, sub.key)) continue;
          if (!sub.filter(ev)) continue;
          if (sub.once) markForcedFired(this.state, sub.key);
          sub.fire(ev);
        }
        if (ev.kind === 'unitDied' && CARD_REGISTRY.has(ev.cardId)) {
          const card = CARD_REGISTRY.get(ev.cardId);
          if ('onDeath' in card && typeof (card as UnitCard).onDeath === 'function') {
            const ctx = makeContext(ev.instanceId, ev.controller, ev.cardId, this.board, this.events);
            (card as UnitCard).onDeath(ctx); // 실제 onDeath 버그는 여기서 그대로 던져진다 (삼키지 않음)
          }
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

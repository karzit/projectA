// MCTS(적대적 UCT) 기반 범용 AI. 후보 액션을 실제로 클론된 Game에 적용해 보고
// 그 결과 상태를 리프에서 평가하는 것까지는 이전 SimAI(그리디)와 같지만,
// 여기서는 한 수만 보고 고르는 대신 트리를 여러 겹 확장해 "이 액션 이후
// 상대가 최선으로 응수하면" 까지 내다본다. 트리 노드는 항상 완전히 해석된
// GameState 하나이고(choice/attack-reaction은 트리 레벨을 만들지 않고 기존
// 정책으로 즉시 결정해 엣지 하나에 접어 넣는다), 리프 값은 랜덤 롤아웃이
// 아니라 기존 그리디가 쓰던 #evaluate 휴리스틱을 그대로 재사용한다(35턴
// 황폐 시작 전까지 랜덤 롤아웃은 비용 대비 노이즈만 큼).
import {
  Game, canPlayId, canAttack, canMove, isCardLocked, otherPlayer, CARD_REGISTRY,
  attackableTargets, HEX_ADJACENT, otherPlayer as opp, eligibleCunningBlockers,
  DESOLATION_START_TURN,
} from '../../rules/index.js';
import type { AttackReactionRequest, ChoiceRequest, GameState, PlayerId, RulesAction } from '../../rules/index.js';
import type { EventManager } from '../core/EventManager.js';
import { resolveWeights, type DeckStrategy, type EvalWeights } from './DeckStrategy.js';

const STEP_MS = 700;
const CHOICE_MS = 400;

// Front-row cells preferred for placement scans (center-out).
const FRONT_CELLS = [2, 1, 3, 0, 4] as const;
const BACK_CELLS = [6, 5, 7, 8] as const;

// 결정 1회당 시뮬레이션(트리 확장) 횟수. 시간 기반 예산 대신 고정 카운트를
// 써서 브라우저 메인 스레드 블로킹 시간을 예측 가능하게 유지한다.
const MCTS_ITERATIONS = 200;
// UCB1 탐험 계수 — 값 스케일이 대략 수십~수백(±1000은 승패 확정)이라 표준
// sqrt(2)보다 조금 키워 탐험을 유지한다.
const UCB_C = 20;

// 최근 행동 이력에서 반복 사이클을 감지하는 데 쓰는 길이. 트리 탐색이 생겨도
// 라이브락 안전판은 검증 전까지 존치한다.
const IDLE_HISTORY_LEN = 24;
const MIN_CYCLE_LEN = 2;

function actionSignature(action: RulesAction): string | null {
  switch (action.type) {
    case 'move':
      return `move:${action.unitId}:${action.toCell}`;
    case 'ability':
      return `ability:${action.unitId}`;
    case 'attack':
      return `attack:${action.attackerId}:${action.targetId}`;
    case 'pass':
      return null;
    default:
      return null;
  }
}

// action을 (choices/attack-reaction까지 포함해) 하나의 완결된 결과로 접어
// 넣은 트리 엣지. 이 정책들은 기존 SimAI 그대로 재사용한다.
class Resolver {
  constructor(private readonly player: PlayerId, private readonly strategy: DeckStrategy) {}

  // action을 state에 적용하고, 뒤에 붙는 choiceRequest/attackReactionRequest를
  // 즉시 해석해 완전히 정착된 결과 상태를 돌려준다. 불법이거나 완결 안 되면 null.
  resolve(state: GameState, action: RulesAction): GameState | null {
    const game = Game.fromState(state);
    const result = game.apply(action);
    if (result.choiceRequest) return this.#bestChoiceOutcome(state, action, result.choiceRequest);
    if (result.attackReactionRequest) return this.#worstCaseAttackOutcome(state, action, result.attackReactionRequest);
    if (result.error) return null;
    return result.state;
  }

  // 선택(choice)이 붙는 액션은 후보 선택지를 각각 실제로 적용해 보고 그 행동을
  // 낸 쪽 관점으로 가장 나은 결과를 채택한다(카드 이름 하드코딩 없이 일반화).
  // pass 한 번이 큐 공개 중 여러 카드에서 연달아 멈출 수 있으므로(각각 resolveChoice로
  // 재개) 더 이상 멈추지 않을 때까지 반복한다 — 첫 멈춤(=req)만 브랜치별 후보로
  // 탐색하고, 그 이후 멈춤은 범용 휴리스틱(pickChoices)으로 채운다.
  #bestChoiceOutcome(state: GameState, action: RulesAction, req: ChoiceRequest): GameState | null {
    let best: { state: GameState; score: number } | null = null;
    for (const choices of this.#choiceOptions(req, state)) {
      const game = Game.fromState(state);
      let result = game.apply(action);
      let isFirst = true;
      while (result.choiceRequest) {
        const cr = result.choiceRequest;
        const picked = isFirst ? choices : pickChoices(cr, game.state);
        const followUp = isFirst && (action.type === 'play' || action.type === 'ability')
          ? ({ ...action, choices: picked } as RulesAction)
          : ({ type: 'resolveChoice', player: cr.player, choices: picked } as RulesAction);
        isFirst = false;
        result = game.apply(followUp);
      }
      if (result.error) continue;
      const score = this.evaluateFor(req.player, result.state);
      if (!best || score > best.score) best = { state: result.state, score };
    }
    return best?.state ?? null;
  }

  #choiceOptions(req: ChoiceRequest, state: GameState): string[][] {
    if (req.min === 1 && req.max === 1 && req.from.length > 1 && req.from.length <= 10) {
      return req.from.map((id) => [id]);
    }
    return [pickChoices(req, state)];
  }

  // 협공 대상 공격은 방어측 반응(블로커 참가 여부)에 따라 결과가 갈린다 —
  // 안 막음/전원 참가 두 극단을 실제로 풀어보고, 공격한 쪽 관점으로 더 나쁜
  // (=방어측이 합리적으로 고를) 쪽을 채택한다.
  #worstCaseAttackOutcome(state: GameState, action: RulesAction, req: AttackReactionRequest): GameState | null {
    let worst: { state: GameState; score: number } | null = null;
    const attacker = (action as { player: PlayerId }).player;
    for (const blockerIds of [[], req.blockable]) {
      const game = Game.fromState(state);
      const attackResult = game.apply(action);
      if (!attackResult.attackReactionRequest) continue;
      const result = game.apply({ type: 'resolveAttack', player: req.player, blockerIds } as RulesAction);
      if (result.error) continue;
      const score = this.evaluateFor(attacker, result.state);
      if (!worst || score < worst.score) worst = { state: result.state, score };
    }
    return worst?.state ?? null;
  }

  // this.player 고정 시점이 아니라, 임의의 forPlayer 관점으로 평가해야 하는
  // choice/attack-reaction 해석(행동을 실제로 낸 쪽 관점이어야 그 쪽 최선을
  // 재현함)에 쓰는 범용 evaluate.
  evaluateFor(forPlayer: PlayerId, state: GameState): number {
    return evaluateState(forPlayer, state, this.strategy);
  }
}

// ── 평가(리프 값) ──────────────────────────────────────────────────────────
// 순수 함수화: forPlayer 관점으로 GameState 하나를 채점한다. MCTS 트리는
// 항상 루트 AI의 this.player 고정 관점(evaluateState(this.player, ...))을
// 쓰고, choice/attack-reaction 해석기(Resolver)만 행동 주체 관점으로 부른다.
function fieldUnits(state: GameState, player: PlayerId): string[] {
  return state.field[player].filter((id): id is string => !!id);
}

function evaluateState(forPlayer: PlayerId, state: GameState, strategy?: DeckStrategy): number {
  if (state.loser === forPlayer) return -1000;
  if (state.loser === otherPlayer(forPlayer)) return 1000;

  const w: EvalWeights = resolveWeights(strategy);
  const my = fieldUnits(state, forPlayer);
  const foe = fieldUnits(state, otherPlayer(forPlayer));
  const myPower = my.reduce((s, id) => s + (state.units[id]?.power ?? 0), 0);
  const foePower = foe.reduce((s, id) => s + (state.units[id]?.power ?? 0), 0);
  const emptyFieldPenalty = my.length === 0 ? -w.emptyField : 0;

  // reserveCells: 토큰 엔진 덱은 빈 칸이 없으면 토큰 소환이 통째로 버려진다 —
  // 부족분 1칸당 15는 유닛 하나를 더 내는 이득(power+unitCount+chain ≈ 10)을
  // 눌러, 남는 유닛을 손패에 대기시키게 하는 크기. reserveExempt 카드(희생양 등
  // 예약이 지키려는 토큰 자체)가 차지한 칸은 빈 칸으로 친다 — 안 그러면 토큰
  // 소환이 예약 위반 페널티를 물어 토큰을 낳는 행동이 평가상 순손실이 된다.
  const reserve = strategy?.reserveCells ?? 0;
  const exempt = strategy?.reserveExempt;
  const condExempt = strategy?.reserveExemptIfEnvMissing;
  const exemptCells = (exempt || condExempt)
    ? my.filter((id) => {
        const cardId = state.units[id]!.cardId;
        if (exempt?.includes(cardId)) return true;
        // 조건부 면제: 지정 환경이 지금 없을 때만(소굴 재건 플레이 보호) —
        // 환경이 살아 있는 평상시엔 정상적으로 칸을 차지한 것으로 센다.
        const envKey = condExempt?.[cardId];
        if (!envKey) return false;
        const sep = envKey.indexOf(':');
        return state.environment[envKey.slice(0, sep)] !== envKey.slice(sep + 1);
      }).length
    : 0;
  const emptyOwnCells = state.field[forPlayer].length - my.length + exemptCells;
  const reservePenalty = reserve > emptyOwnCells ? (reserve - emptyOwnCells) * 15 : 0;

  return (myPower - foePower) + (my.length - foe.length) * w.unitCount + emptyFieldPenalty - reservePenalty
    + playableCardCount(state, forPlayer) * w.playable
    - riskyUnitCount(state, forPlayer) * w.risky
    - keystoneScore(state, otherPlayer(forPlayer), w.keystoneOpp)
    + keystoneScore(state, forPlayer, w.keystoneSelf)
    + evolutionProximity(state, forPlayer, w.evolve)
    + heroExpProximity(state, forPlayer, w.heroExp)
    + cunningBlockValue(state, forPlayer, otherPlayer(forPlayer), w.cunningBlock)
    - cunningBlockValue(state, otherPlayer(forPlayer), forPlayer, w.cunningBlock)
    + desolationReserve(state, forPlayer, w.desolationReserve)
    + progressScore(state, forPlayer, strategy, myPower);
}

// 황폐 보험 — 황폐기(턴35~)엔 필드 유닛이 매 턴 시작/종료 -1로 녹아, 자기 턴에
// 갓 낸 유닛만 그 턴 종료의 패배 판정(자기 필드 비면 패배)을 확실히 넘긴다.
// 즉 손패의 유닛 카드는 황폐기의 "턴당 생존권"이고, 이걸 평가에 넣지 않으면
// AI가 황폐 직전에 마지막 유닛까지 필드에 내버린다(계측, cult 미러 seed 1:
// B가 턴34에 마지막 사교도를 내 감쇠 3회를 맞고 턴36 판정 전에 잃음 — 턴36에
// 냈다면 감쇠 1회로 생존했다. 이런 홀짝 구조로 미러전 선공 96%까지 치우침).
// 판정 자체(-1000)는 MCTS가 2수 안에서만 보므로, 그보다 앞선 턴의 "쥐고 있기"
// 결정은 이 항이 만든다. 임박 시점(턴30)부터 선형으로 켜져 턴34에 0.8 — 약체
// 유닛의 플레이 이득(~10)을 넘어서는 크기(가중치 15 기준 12)가 되게 설계.
function desolationReserve(state: GameState, player: PlayerId, weight: number): number {
  const ramp = Math.min(1, Math.max(0, (state.turn - (DESOLATION_START_TURN - 5)) / 5));
  if (ramp === 0) return 0;
  let unitCards = 0;
  for (const cardId of state.hand[player]) {
    if (CARD_REGISTRY.getDef(cardId).kind === 'unit') unitCards++;
  }
  return ramp * weight * Math.min(unitCards, 3);
}

// player가 지금 보유한(미사용) 지략으로 threatFor의 손패에 있는 지혜 조건 카드
// 중 몇 장을 봉쇄 위협할 수 있는지 — 상대(threatFor)가 그 카드를 내도 안전한
// 봉쇄 수단을 쥐고 있다는 가치. 카드 이름이 아니라 conditions 구조만 본다.
function cunningBlockValue(state: GameState, player: PlayerId, threatFor: PlayerId, weight: number): number {
  let score = 0;
  for (const cardId of state.hand[threatFor]) {
    for (const cond of CARD_REGISTRY.getDef(cardId).conditions ?? []) {
      if (cond.need !== 'wisdom') continue;
      if (eligibleCunningBlockers(state, player, cond.amount).length > 0) score += weight;
    }
  }
  return score;
}

// 레벨업(영웅담) 유닛의 다음 레벨업 근접도 — 처치 점수가 다음 임계치에 가까울수록
// 크게 쳐서, "지금 죽이면 레벨업 코앞"인 유닛을 지키고 그 유닛으로 처치를 몰아주게
// 만든다. exp/expMax는 def.levels 유닛에만 설정된다(gameMut.ts setHeroProgress).
function heroExpProximity(state: GameState, player: PlayerId, weight: number): number {
  let score = 0;
  for (const id of fieldUnits(state, player)) {
    const u = state.units[id];
    if (!u || u.expMax === undefined || u.expMax <= 0) continue;
    score += weight * Math.min(1, (u.exp ?? 0) / u.expMax);
  }
  return score;
}

// 덱 특화 체인 진행 점수 — 카드별 점수(필드 전액/손 절반) + 환경 진행 점수.
// 점수 설계 원칙(단계가 뒤일수록 커야 전진 기울기가 생김)은 DeckStrategy 참조.
// myPower: chainGate 판정용 자기 필드 총 힘. "상대에게 강한 몬스터를 넘겨주는"
// 체인 카드(예: 마왕성 입성)는 손에 쥐고 있는 동안은 정상 점수를 그대로 주되
// (쥐고만 있어도 손해볼 이유가 없어야 함), **실제로 낸 직후(pendingPlays)**에
// 자기 필드가 그 대가를 감당 못 할 정도로 약하면 오히려 마이너스를 준다 — 그래야
// "지금 내기" vs "쥐고 기다리기" 사이에 진짜 평가 차이가 생겨 서두르지 않는다.
// (손패/대기 점수를 똑같이 깎기만 하면 둘 다 동률로 낮아질 뿐 결정에 영향이
// 없다 — 첫 구현에서 실측으로 확인한 무효 패턴.) 실측: heroic이 9~13턴 만에
// 마왕성까지 밀어붙여 cult에게 44/44 마왕을 넘기고 이후 소모전으로 갈리다 패배.
function progressScore(state: GameState, player: PlayerId, strategy: DeckStrategy | undefined, myPower: number): number {
  if (!strategy) return 0;
  let score = 0;
  const cards = strategy.chainCards;
  const gate = strategy.chainGate;
  // readiness(0~1)를 가파른 선형으로 접어(계수 6) readiness < 5/6부터는 마이너스가
  // 되게 한다 — 완만한 접힘(계수 2)은 실측상 페널티가 다른 행동과의 격차를 못
  // 뒤집어 그대로 재입산해버렸다(디버그 로그: myPower 31~39인데도 그대로 플레이).
  const gatedFactor = (cardId: string): number => {
    const threshold = gate?.[cardId];
    if (threshold === undefined || threshold <= 0) return 1;
    const readiness = Math.min(1, myPower / threshold);
    return 6 * readiness - 5;
  };
  if (cards) {
    for (const unitId of fieldUnits(state, player)) {
      score += cards[state.units[unitId]!.cardId] ?? 0;
    }
    for (const cardId of state.hand[player]) {
      score += (cards[cardId] ?? 0) * 0.5;
    }
    // 정산 대기(pendingPlays) 중인 체인 스펠도 손패와 동일하게 친다(그렇지 않으면
    // "체인 스펠을 낸 직후 ~ pass 정산 전" 중간 상태가 손패 점수만 빠진 평가
    // 골짜기가 되어, MCTS가 그 자식(−수십)을 재방문해 pass의 보상까지 파고들
    // 확률이 급감한다 — 의식류가 조건을 다 갖추고도 사장되는 실측 원인) — 단
    // chainGate가 걸린 카드는 여기서만 준비도에 따라 감점/가점된다.
    for (const p of state.pendingPlays) {
      if (p.controller === player && p.unitId === undefined) {
        score += (cards[p.cardId] ?? 0) * 0.5 * gatedFactor(p.cardId);
      }
    }
  }
  const envs = strategy.envScores;
  if (envs) {
    for (const [type, value] of Object.entries(state.environment)) {
      score += envs[`${type}:${value}`] ?? 0;
    }
  }
  return score;
}

// 배경 조건이 이름/키워드로 의존하는 필드 유닛("키스톤")의 가치. 자기 키스톤
// 보호와 상대 키스톤 파괴 유인 양쪽에 재사용 — 카드 이름이 아니라
// conditions/keywords 구조만 본다.
function keystoneScore(state: GameState, player: PlayerId, weight: number): number {
  const neededNames = new Map<string, number>();
  const neededKeywords = new Map<string, number>();
  const dependentCards = [
    ...state.hand[player],
    ...fieldUnits(state, player).map((id) => state.units[id]!.cardId),
  ];
  for (const cardId of dependentCards) {
    for (const cond of CARD_REGISTRY.getDef(cardId).conditions ?? []) {
      if (cond.need === 'unit' && cond.side !== 'opponent') {
        neededNames.set(cond.name, (neededNames.get(cond.name) ?? 0) + 1);
      } else if (cond.need === 'keyword') {
        neededKeywords.set(cond.keyword, (neededKeywords.get(cond.keyword) ?? 0) + 1);
      }
    }
  }
  if (neededNames.size === 0 && neededKeywords.size === 0) return 0;

  let score = 0;
  for (const id of fieldUnits(state, player)) {
    const def = CARD_REGISTRY.getDef(state.units[id]!.cardId);
    const deps = (neededNames.get(def.name) ?? 0)
      + (def.keywords ?? []).reduce((s, k) => s + (neededKeywords.get(k) ?? 0), 0);
    if (deps > 0) score += Math.min(deps, 4) * weight;
  }
  return score;
}

function evolveChainDepth(cardId: string, seen: Set<string> = new Set()): number {
  const def = CARD_REGISTRY.getDef(cardId);
  if (!def.evolveTarget || seen.has(cardId)) return 0;
  seen.add(cardId);
  return 1 + evolveChainDepth(def.evolveTarget, seen);
}

// 진화(evolveTarget) 체인 중인 필드 유닛의 완주 임박도 — 남은 단계가 적을수록
// 가중치가 가파르게 커진다.
function evolutionProximity(state: GameState, player: PlayerId, weight: number): number {
  let score = 0;
  for (const id of fieldUnits(state, player)) {
    const depth = evolveChainDepth(state.units[id]!.cardId);
    if (depth > 0) score += weight / depth;
  }
  return score;
}

// 배경 조건 때문에 손에 카드가 많아도 실제로 낼 수 있는 카드 수가 적으면
// 다음 턴의 선택지가 좁다.
function playableCardCount(state: GameState, player: PlayerId): number {
  return state.hand[player]
    .filter((id) => !isCardLocked(state, player, id) && canPlayId(state, id, player).ok)
    .length;
}

// 다음 상대 턴에 죽을 수 있는(사거리 안 + 힘으로 밀리는) 내 유닛 수. 협공은
// 고려하지 않는 대략치.
function riskyUnitCount(state: GameState, player: PlayerId): number {
  const foeUnits = fieldUnits(state, otherPlayer(player));
  let count = 0;
  for (const myId of fieldUnits(state, player)) {
    const myPower = state.units[myId]?.power ?? 0;
    const threatened = foeUnits.some((foeId) => {
      const foePower = state.units[foeId]?.power ?? 0;
      return foePower >= myPower && attackableTargets(state, foeId).includes(myId);
    });
    if (threatened) count++;
  }
  return count;
}

// ── choice 정책 ───────────────────────────────────────────────────────────
function pickChoices(req: ChoiceRequest, state: GameState): string[] {
  const from = req.from;
  const max = req.max;
  const cardId = req.cardId;
  const myUnits = fieldUnits(state, req.player);
  const foeUnits = fieldUnits(state, opp(req.player));

  switch (cardId) {
    case 'health-potion': {
      const allies = from.filter((id) => myUnits.includes(id));
      const foePowers = foeUnits.map((id) => state.units[id]?.power ?? 0);
      const scored = allies.map((id) => {
        const p = state.units[id]?.power ?? 0;
        const gains = foePowers.filter((ep) => p < ep && p + 2 >= ep).length;
        return { id, score: gains * 10 + p };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 1).map((x) => x.id);
    }

    case 'revolution': {
      const myPicks = from
        .filter((id) => myUnits.includes(id))
        .sort((a, b) => (state.units[a]?.power ?? 0) - (state.units[b]?.power ?? 0));
      const foePicks = from
        .filter((id) => foeUnits.includes(id))
        .sort((a, b) => (state.units[b]?.power ?? 0) - (state.units[a]?.power ?? 0));

      const pairs: string[] = [];
      const n = Math.min(myPicks.length, foePicks.length, Math.floor(max / 2));
      for (let i = 0; i < n; i++) {
        const myPow = state.units[myPicks[i]]?.power ?? 0;
        const foePow = state.units[foePicks[i]]?.power ?? 0;
        if (foePow > myPow) pairs.push(myPicks[i], foePicks[i]);
      }
      return pairs;
    }

    default:
      return from.slice(0, max);
  }
}

// ── 액션 enumeration (MCTS 공용) ──────────────────────────────────────────
// 부동 카드는 이번 턴 이미 행동(공격/이동)했으면 후보에서 제외 — 지금 내면
// 부동 보상(다음 의식 획득 등)이 무조건 무효라 카드만 버리는 셈.
function legalPlayActions(state: GameState, player: PlayerId): RulesAction[] {
  const actions: RulesAction[] = [];
  for (const cardId of state.hand[player]) {
    if (isCardLocked(state, player, cardId)) continue;
    if (!canPlayId(state, cardId, player).ok) continue;
    const def = CARD_REGISTRY.getDef(cardId);
    if (state.actedThisTurn.length > 0 && (def.keywords?.includes('부동') ?? false)) continue;

    if (def.kind === 'unit') {
      for (const cell of candidatePlayCells(state, player)) {
        actions.push({ type: 'play', player, cardId, cell });
      }
    } else {
      actions.push({ type: 'play', player, cardId });
    }
  }
  return actions;
}

// 유닛 소환 후보 셀 — 9칸 전수 나열은 분기폭만 키워 MCTS 반복 예산(200회)을
// 낭비한다. 상위 3칸으로 좁히되, 예전엔 "전열 중앙 2 + 후열 1" 고정이었던 걸
// 점수화(전열 가산 + 인접 아군 수 = 협공 대형 밀집도)로 바꿔, 이미 아군이 있는
// 자리 옆이 전열 3순위보다 유리하면 그쪽을 후보에 넣는다. 동점은 기존 중앙부터
// 순서(FRONT_CELLS/BACK_CELLS)로 깨진다.
function candidatePlayCells(state: GameState, player: PlayerId): number[] {
  const field = state.field[player];
  const order = [...FRONT_CELLS, ...BACK_CELLS];
  const empties = order.filter((c) => !field[c]);
  if (empties.length <= 3) return empties;

  const frontSet = new Set<number>(FRONT_CELLS);
  const scored = empties.map((c, i) => {
    const adjacentAllies = ((HEX_ADJACENT[c] as number[] | undefined) ?? [])
      .filter((n) => field[n]).length;
    const score = (frontSet.has(c) ? 2 : 1) + adjacentAllies - i * 0.01;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((x) => x.c);
}

// 부동(不動) 카드(첫/두/세/마지막 의식, 여관, 여신의 도움 등)를 이번 턴에 이미
// 냈다면 pendingPlays 큐에 걸려 턴 종료(pass) 때 onPlay가 처리된다 — 그 시점의
// noActionThisTurn()은 큐잉 "이후"에 벌어진 공격/이동까지 포함해 판정하므로,
// 이번 턴에 조금이라도 더 움직이면 그 카드는 그대로 불발된다. 옛 그리디 SimAI엔
// 이 상태를 감지해 남은 공격/이동/능력을 자제하는 로직이 있었는데(세션 39),
// MCTS로 갈아탈 때(세션 52) 빠졌다 — 카드 이름이 아니라 키워드로만 판별해 복원.
function hasPendingImmobilePlay(state: GameState, player: PlayerId): boolean {
  return state.pendingPlays.some(
    (p) => p.controller === player && (CARD_REGISTRY.getDef(p.cardId).keywords?.includes('부동') ?? false),
  );
}

function legalMoveActions(state: GameState, player: PlayerId): RulesAction[] {
  const actions: RulesAction[] = [];
  if (hasPendingImmobilePlay(state, player)) return actions;
  for (const unitId of fieldUnits(state, player)) {
    if (state.actedThisTurn.includes(unitId) || state.trapped.includes(unitId)) continue;
    const u = state.units[unitId];
    if (!u) continue;
    const adjacent = (HEX_ADJACENT[u.cell] as number[] | undefined) ?? [];
    for (const toCell of adjacent) {
      if (!canMove(state, unitId, toCell)) continue;
      actions.push({ type: 'move', player, unitId, toCell });
    }
  }
  return actions;
}

function legalAttackAndAbilityActions(state: GameState, player: PlayerId): RulesAction[] {
  const actions: RulesAction[] = [];
  if (hasPendingImmobilePlay(state, player)) return actions;
  for (const attackerId of fieldUnits(state, player)) {
    if (!canAttack(state, attackerId)) continue;
    const unit = state.units[attackerId];
    if (unit && CARD_REGISTRY.getDef(unit.cardId).activeAbility) {
      actions.push({ type: 'ability', player, unitId: attackerId });
    }
    for (const targetId of attackableTargets(state, attackerId)) {
      actions.push({ type: 'attack', player, attackerId, targetId });
    }
  }
  return actions;
}

// 용사(영웅담) 피보나치 레벨업 임계값 — Hero.ts의 표와 동일(전개 우선순위
// 근사용 로컬 사본이라 정확한 fibBonus/nextThreshold 재현은 필요 없음).
const FIB_LEVELS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];

// 공격이 확정 처치(1:1 근사 — 협공 미고려)인지, 그리고 그 처치가 공격자를
// 다음 피보나치 레벨업 임계값 너머로 밀어주는지를 대략 채점한다. 정확한 판정은
// 협공/개입 등으로 달라질 수 있어 근사치지만, 이건 전개 순서(어느 액션을 MCTS
// 예산 안에서 먼저 펼쳐볼지)만 결정하고 최종 선택은 UCB가 하므로 근사로 충분하다.
function attackImpact(state: GameState, player: PlayerId, attackerId: string, targetId: string): number {
  const attacker = state.units[attackerId];
  const target = state.units[targetId];
  if (!attacker || !target) return 0;
  if (attacker.power < target.power) return 0; // 확정 처치 아님
  let bonus = 20;
  if (CARD_REGISTRY.getDef(attacker.cardId).levels) {
    const prevScore = state.heroKillScore[player] ?? 0;
    const newScore = prevScore + target.power + target.wisdom;
    if (FIB_LEVELS.some((f) => prevScore < f && newScore >= f)) bonus += 30;
  }
  return bonus;
}

// 전개(expansion) 우선순위 — 200회 반복 예산에서 무작위 전개는 "제물준비→의식→
// pass" 같은 3수 콤보 라인을 사실상 발견하지 못한다(분기폭 수십 × 깊이 3).
// 체인 카드 플레이(뒤 단계일수록 먼저)와 부동 카드 대기 중의 pass(큐 정산 =
// 콤보의 결실)를 앞세워 유망 라인이 노드의 첫 방문들에서 곧장 트리에 실리게
// 한다. 확정 처치/레벨업 공격도 같은 이유로 앞세운다(가지치기 전에 유망
// 액션부터 예산을 쓰게). 이후 균형은 UCB 선택이 잡는다. 상대 노드에도 루트
// 덱의 chainCards가 적용되는데, 다른 덱 상대면 전부 0이라 무해하고 미러전이면
// 오히려 정확해진다.
function expandPriority(state: GameState, player: PlayerId, action: RulesAction, strategy: DeckStrategy): number {
  switch (action.type) {
    case 'play': {
      const chain = strategy.chainCards?.[action.cardId] ?? 0;
      return chain > 0 ? 100 + chain : 10;
    }
    case 'pass': return hasPendingImmobilePlay(state, player) ? 1000 : 5;
    case 'attack': return 8 + attackImpact(state, player, action.attackerId, action.targetId);
    case 'ability': return 8;
    case 'move': return 1;
    default: return 0;
  }
}

// 진행 중인 턴(main phase)에서 player가 지금 낼 수 있는 모든 액션을 전개
// 우선순위 내림차순으로 돌려준다. pass는 언제나 폴백으로 포함한다.
function legalActions(state: GameState, player: PlayerId, strategy: DeckStrategy): RulesAction[] {
  const actions = [
    ...legalPlayActions(state, player),
    ...legalMoveActions(state, player),
    ...legalAttackAndAbilityActions(state, player),
    { type: 'pass', player } as RulesAction,
  ];
  return actions
    .map((a) => ({ a, p: expandPriority(state, player, a, strategy) }))
    .sort((x, y) => y.p - x.p)
    .map((x) => x.a);
}

// ── MCTS 트리 ──────────────────────────────────────────────────────────────
interface MctsNode {
  state: GameState;
  parent: MctsNode | null;
  actionFromParent: RulesAction | null;
  untried: RulesAction[];
  children: MctsNode[];
  visits: number;
  totalValue: number; // 항상 루트 AI(this.player) 관점 값의 누적
}

class MctsSearch {
  private readonly resolver: Resolver;

  constructor(private readonly rootPlayer: PlayerId, private readonly strategy: DeckStrategy) {
    this.resolver = new Resolver(rootPlayer, strategy);
  }

  // rootState에서 rootPlayer가 지금 낼 최선의 액션 하나를 고른다. rootState는
  // 항상 rootPlayer의 main-phase 차례(state.active === rootPlayer)여야 한다.
  search(rootState: GameState): RulesAction | null {
    const root: MctsNode = {
      state: rootState,
      parent: null,
      actionFromParent: null,
      untried: legalActions(rootState, rootPlayer(rootState, this.rootPlayer), this.strategy),
      children: [],
      visits: 0,
      totalValue: 0,
    };
    if (root.untried.length === 0) return null;

    for (let i = 0; i < MCTS_ITERATIONS; i++) {
      const leaf = this.#select(root);
      const expanded = this.#expand(leaf);
      const value = this.#evaluateLeaf(expanded.state);
      this.#backprop(expanded, value);
    }

    if (root.children.length === 0) return null;
    let best = root.children[0];
    for (const c of root.children) if (c.visits > best.visits) best = c;
    return best.actionFromParent;
  }

  // 완전히 확장된 노드를 따라 내려가다 미시도 액션이 남은 노드에서 멈춘다.
  #select(node: MctsNode): MctsNode {
    let cur = node;
    while (cur.untried.length === 0 && cur.children.length > 0) {
      const decisionMaker = cur.state.active;
      const forRoot = decisionMaker === this.rootPlayer;
      let bestChild = cur.children[0];
      let bestScore = -Infinity;
      for (const child of cur.children) {
        const exploit = child.totalValue / child.visits;
        const signedExploit = forRoot ? exploit : -exploit;
        const explore = UCB_C * Math.sqrt(Math.log(cur.visits) / child.visits);
        const ucb = signedExploit + explore;
        if (ucb > bestScore) { bestScore = ucb; bestChild = child; }
      }
      cur = bestChild;
    }
    return cur;
  }

  // 미시도 액션 하나를 실제로 풀어(choice/attack-reaction까지 해석) 자식으로 추가.
  // 액션이 종국에 불법/미해결이면 후보에서 제거하고 같은 노드에서 재시도.
  // untried는 legalActions가 전개 우선순위 내림차순으로 정렬해 두므로 앞에서
  // 꺼낸다(무작위 전개였다면 체인 콤보 라인을 반복 예산 안에 발견하지 못한다).
  #expand(node: MctsNode): MctsNode {
    if (node.state.loser) return node; // 이미 끝난 국면 — 더 확장할 게 없음
    while (node.untried.length > 0) {
      const action = node.untried.shift()!;
      const resolved = this.resolver.resolve(node.state, action);
      if (!resolved) continue;
      const child: MctsNode = {
        state: resolved,
        parent: node,
        actionFromParent: action,
        untried: resolved.loser ? [] : legalActions(resolved, resolved.active, this.strategy),
        children: [],
        visits: 0,
        totalValue: 0,
      };
      node.children.push(child);
      return child;
    }
    return node; // 시도해볼 액션이 전부 불법이었음 — 이 노드 자체를 리프로 재평가
  }

  #evaluateLeaf(state: GameState): number {
    return evaluateState(this.rootPlayer, state, this.strategy);
  }

  #backprop(node: MctsNode, value: number): void {
    let cur: MctsNode | null = node;
    while (cur) {
      cur.visits++;
      cur.totalValue += value;
      cur = cur.parent;
    }
  }
}

function rootPlayer(state: GameState, fallback: PlayerId): PlayerId {
  return state.active ?? fallback;
}

// ── AI 본체 ────────────────────────────────────────────────────────────────
export class MctsAI {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubChoice: () => void;
  private readonly recentActions: string[] = [];
  private readonly search: MctsSearch;

  constructor(
    protected readonly player: PlayerId,
    private readonly events: EventManager,
    private readonly getState: () => GameState,
    private readonly strategy: DeckStrategy = {},
  ) {
    this.search = new MctsSearch(this.player, this.strategy);
    this.unsubChoice = this.events.on('choice:request', ({ request, action }: { request: ChoiceRequest; action: RulesAction }) => {
      if (request.player !== this.player) return;
      const choices = pickChoices(request, this.getState());
      // 개입 카드(play/ability)는 같은 액션에 choices를 채워 재시도, 그 외(pass 등으로
      // 큐 공개 중 멈춘 경우)는 resolveChoice로 재개한다.
      const filled = action.type === 'play' || action.type === 'ability'
        ? ({ ...action, choices } as RulesAction)
        : ({ type: 'resolveChoice', player: this.player, choices } as RulesAction);
      setTimeout(() => this.#emit(filled), CHOICE_MS);
    });
  }

  react(): void {
    this.cancel();
    const state = this.getState();
    if (state.loser) return;

    if (state.phase === 'opening' && !state.openingDone[this.player]) {
      this.timer = setTimeout(() => this.#openingStep(), STEP_MS);
    } else if (state.phase === 'main' && state.active === this.player) {
      this.timer = setTimeout(() => this.#mainStep(), STEP_MS);
    }
  }

  cancel(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  destroy(): void {
    this.cancel();
    this.unsubChoice();
  }

  #emit(action: RulesAction): void {
    this.events.emit('intent', action);
  }

  // ── opening (변경 없음 — 후보 최대 3장이라 MCTS 도입 실익이 적음) ────────

  #openingStep(): void {
    const state = this.getState();
    if (state.openingDone[this.player]) return;

    if (state.openingPlaced[this.player] < 3) {
      const cell = this.#pickOpeningCell(state);
      const card = cell >= 0 ? this.#bestOpeningCard(state, cell) : null;
      if (card) {
        this.#emit({ type: 'placeOpening', player: this.player, cardId: card, cell });
        return;
      }
    }
    this.#emit({ type: 'finishOpening', player: this.player });
  }

  #pickOpeningCell(state: GameState): number {
    const field = state.field[this.player];
    for (const c of FRONT_CELLS) { if (!field[c]) return c; }
    for (const c of BACK_CELLS) { if (!field[c]) return c; }
    return -1;
  }

  #bestOpeningCard(state: GameState, cell: number): string | null {
    const hand = [...state.hand[this.player]];
    const filtered = hand.filter((id) => {
      const def = CARD_REGISTRY.getDef(id);
      return def.kind === 'unit' && canPlayId(state, id, this.player).ok;
    });
    if (filtered.length === 0) return null;

    let best: { cardId: string; score: number } | null = null;
    for (const cardId of filtered) {
      const game = Game.fromState(state);
      const placed = game.apply({ type: 'placeOpening', player: this.player, cardId, cell });
      if (placed.error) continue;
      game.apply({ type: 'finishOpening', player: this.player });
      game.apply({ type: 'finishOpening', player: opp(this.player) });
      const survives = fieldUnits(game.state, this.player)
        .some((id) => game.state.units[id]?.cardId === cardId);
      const power = CARD_REGISTRY.getDef(cardId).power ?? 0;
      const chainBonus = (this.strategy.chainCards?.[cardId] ?? 0) > 0 ? 5 : 0;
      const score = (survives ? 1000 : 0) + power + chainBonus;
      if (!best || score > best.score) best = { cardId, score };
    }
    return best?.cardId ?? null;
  }

  // ── main (MCTS) ───────────────────────────────────────────────────────────

  #mainStep(): void {
    const state = this.getState();
    if (state.active !== this.player || state.loser) return;

    const chosen = this.search.search(state);
    if (chosen && chosen.type !== 'pass' && this.#repeatsRecentCycle(chosen)) {
      this.#emit({ type: 'pass', player: this.player });
      return;
    }

    if (chosen) {
      this.#recordAction(chosen);
      this.#emit(chosen);
      return;
    }
    this.#emit({ type: 'pass', player: this.player });
  }

  // ── idle / cycle detection (안전판 — 그대로 존치) ─────────────────────────

  #repeatsRecentCycle(action: RulesAction): boolean {
    const sig = actionSignature(action);
    if (!sig) return false;
    const seq = [...this.recentActions, sig];
    for (let period = MIN_CYCLE_LEN; period * 2 <= seq.length; period++) {
      let matches = true;
      for (let i = seq.length - period * 2; i < seq.length - period; i++) {
        if (seq[i] !== seq[i + period]) { matches = false; break; }
      }
      if (matches) return true;
    }
    return false;
  }

  #recordAction(action: RulesAction): void {
    const sig = actionSignature(action);
    if (!sig) return;
    this.recentActions.push(sig);
    while (this.recentActions.length > IDLE_HISTORY_LEN) this.recentActions.shift();
  }
}

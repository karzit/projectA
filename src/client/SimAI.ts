// AI that drives the opponent automatically via real simulation: candidate
// actions are actually applied to a cloned Game (Game.fromState + apply) and
// the resulting GameState is scored, rather than hand-scoring the action in
// isolation. Still single-step greedy per stage (play > move > attack > pass);
// multi-step lookahead is a future upgrade.

import {
  Game, canPlayId, canAttack, canMove, isCardLocked, otherPlayer, CARD_REGISTRY,
  GRID_SIZE, attackableTargets, HEX_ADJACENT, otherPlayer as opp, exitUnit,
} from '../rules/index.js';
import type { AttackReactionRequest, ChoiceRequest, GameState, PlayerId, RulesAction } from '../rules/index.js';
import type { EventManager } from './core/EventManager.js';

const STEP_MS = 700;
const CHOICE_MS = 400;

// Front-row cells preferred for placement scans (center-out).
const FRONT_CELLS = [2, 1, 3, 0, 4] as const;
const BACK_CELLS = [6, 5, 7, 8] as const;

// 최근 행동 이력에서 반복 사이클을 감지하는 데 쓰는 길이. 결속 액티브가 여러
// 유닛에 걸쳐 대상을 교대하는 패턴은 턴당 여러 액션 × 2턴짜리 주기(예: 주기
// 10)까지 나올 수 있어, 12로는 주기 6까지밖에 못 잡던 걸 24로 늘려 실제
// 주기까지 감지한다(2026-07-06 8회차, seed 71 heroic↔journey 라이브락) —
// 너무 짧으면 우연한 반복을 오탐하고, 너무 길면 실제 장기전을 교착으로 오판한다.
const IDLE_HISTORY_LEN = 24;
// 이 길이의 부분열이 이력 안에서 반복되면(주기 1~IDLE_HISTORY_LEN/2) "같은
// 사이클을 다시 밟는 중"으로 본다.
const MIN_CYCLE_LEN = 2;

// (행동 종류, 유닛, 대상/목적지) 하나를 사람이 비교 가능한 문자열로 정규화.
// 액션 자체(JSON)가 아니라 "의미 있는 반복"만 잡도록 choices 등 부가 필드는
// 무시한다.
function actionSignature(action: RulesAction): string | null {
  switch (action.type) {
    case 'move':
      return `move:${action.unitId}:${action.toCell}`;
    case 'ability':
      return `ability:${action.unitId}`;
    case 'attack':
      return `attack:${action.attackerId}:${action.targetId}`;
    case 'pass':
      return null; // pass는 반복이어도 무해하므로 이력/감지 대상에서 제외
    default:
      return null;
  }
}

export class SimAI {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubChoice: () => void;
  // 이번 플레이어가 최근에 낸 (move/ability/attack) 액션 서명 이력 — 오래된
  // 것부터. no-op 반복(라이브락)을 감지해 pass로 빠지는 데만 쓴다.
  private readonly recentActions: string[] = [];

  constructor(
    protected readonly player: PlayerId,
    private readonly events: EventManager,
    private readonly getState: () => GameState,
  ) {
    this.unsubChoice = this.events.on('choice:request', ({ request, action }: { request: ChoiceRequest; action: RulesAction }) => {
      if (request.player !== this.player) return;
      const choices = this.#bestLiveChoices(request, action, this.getState());
      const filled = { ...(action as RulesAction), choices } as RulesAction;
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

  // ── emit ───────────────────────────────────────────────────────────────────

  #emit(action: RulesAction): void {
    this.events.emit('intent', action);
  }

  // ── opening ────────────────────────────────────────────────────────────────

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

  // Raw power alone misjudges "combo-only" cards (e.g. 수보리조사: does nothing
  // but self-exit unless a 미후왕 is already on the field) — during opening no
  // ally can ever be revealed yet (D-2), so any such card is a guaranteed waste
  // there. Rather than special-casing card ids, force-resolve a what-if opening
  // (place candidate, then finish opening for both sides) in a clone and see
  // whether the candidate's own unit actually survives on the field.
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
      const survives = this.#fieldUnits(game.state, this.player)
        .some((id) => game.state.units[id]?.cardId === cardId);
      const power = CARD_REGISTRY.getDef(cardId).power ?? 0;
      const score = (survives ? 1000 : 0) + power + this.extraOpeningScore(state, cardId);
      if (!best || score > best.score) best = { cardId, score };
    }
    return best?.cardId ?? null;
  }

  // ── main ───────────────────────────────────────────────────────────────────

  #mainStep(): void {
    const state = this.getState();
    if (state.active !== this.player || state.loser) return;

    const play = this.#bestPlay(state);
    if (play) { this.#emit(play); return; }

    const baseline = this.#evaluate(state);

    // 내 '부동' 카드(의식 등 — 이번 턴 무행동 시에만 보상)가 큐에 대기 중이면
    // 공격/능력/이동 어느 것이든 그 보상을 무효화한다(actedThisTurn 소모).
    // 즉시 승리하는 공격이 아닌 한 행동을 아끼고 pass로 부동을 지킨다.
    const holdForImmobility = this.#immobilityPending(state);

    // 공격/능력을 이동보다 먼저 소진한다. 이동도 행동권을 소모하므로(공격 OR
    // 이동) 이동을 먼저 하면 "공격하러 전열로 간" 유닛이 정작 그 턴에 공격을
    // 못 하고, 매 턴 재배치만 반복하는 라이브락에 빠진다(특히 스왑 이동은 두
    // 유닛의 행동권을 모두 소모해 전열 공격수까지 무력화했다).
    const atk = this.#bestAttack(state, baseline);
    const abl = holdForImmobility ? null : this.#bestAbility(state, baseline);
    // 공격과 액티브 능력은 같은 행동권을 놓고 경쟁한다(한 유닛당 둘 중 하나) — 더 나은 쪽을 고른다.
    let chosen: RulesAction | null = null;
    if (holdForImmobility) chosen = atk && atk.score >= 1000 ? atk.action : null;
    else if (atk && abl) chosen = atk.score >= abl.score ? atk.action : abl.action;
    else if (atk) chosen = atk.action;
    else if (abl) chosen = abl.action;
    else chosen = this.#bestMove(state, baseline);

    // 공격/능력이 순유효타(kills/score 개선)를 못 찾으면 이 지점의 행동은
    // "진짜 이득 없는" 재배치일 뿐이다 — 그런데도 이동만은 static score가
    // 그대로여도(unlocksAttack 등으로) 채택될 수 있어, 결속 액티브가 대상을
    // 번갈아 고르거나 이동이 두 위치를 왕복하는 사이클에서 영원히 no-op을
    // 반복하는 라이브락이 생겼다(2026-07-06 8회차). 실제로 채택하려는 행동이
    // 최근 이력에서 이미 밟은 반복 사이클의 재현이면 거부하고 pass로 넘어간다.
    if (chosen && this.#repeatsRecentCycle(chosen)) chosen = null;

    if (chosen) {
      this.#recordAction(chosen);
      this.#emit(chosen);
      return;
    }

    this.#emit({ type: 'pass', player: this.player });
  }

  // ── simulation core ────────────────────────────────────────────────────────

  // Actually apply `action` to a cloned Game and score the resulting state.
  // Returns null if the action is illegal. Fills choices (if the engine asks
  // for them) with our own greedy choice-picker before scoring.
  #simulateAndScore(state: GameState, action: RulesAction): number | null {
    return this.#simulate(state, action)?.score ?? null;
  }

  // Same as #simulateAndScore but also hands back the resulting state, so
  // callers can inspect what actually happened (e.g. did an attack kill
  // anything) rather than just the aggregate score.
  #simulate(state: GameState, action: RulesAction): { state: GameState; score: number } | null {
    const game = Game.fromState(state);
    const result = game.apply(action);
    if (result.choiceRequest) {
      return this.#simulateBestChoice(state, action, result.choiceRequest);
    }
    if (result.attackReactionRequest) {
      return this.#resolveAttackReactionWorstCase(state, action, result.attackReactionRequest);
    }
    if (result.error) return null;
    return { state: result.state, score: this.#evaluate(result.state) };
  }

  // 선택(choice)이 붙는 액션은 후보 선택지를 각각 실제로 적용해 보고 가장 점수가
  // 좋은 결과를 채택한다 — 사제 버프 대상, 사술-환몽 강탈 대상 같은 "누구를
  // 고르느냐"가 액션 가치 자체를 좌우하는 카드를 덱별 하드코딩 없이 일반적으로
  // 잘 쓰게 만든다. 어떤 선택으로도 완결되지 않으면(#pickChoices가 min을 못
  // 채우는 경우 포함) null — 후보에서 제외해 실행 단계의 choice:request ↔ 빈
  // choices 재제출 무한 왕복(라이브락)을 막는 기존 규약 유지.
  #simulateBestChoice(
    state: GameState,
    action: RulesAction,
    req: ChoiceRequest,
  ): { state: GameState; score: number } | null {
    let best: { state: GameState; score: number } | null = null;
    for (const choices of this.#choiceOptions(req, state)) {
      const game = Game.fromState(state);
      let result = game.apply(action);
      if (result.choiceRequest) result = game.apply({ ...action, choices } as RulesAction);
      if (result.choiceRequest || result.error) continue;
      const score = this.#evaluate(result.state);
      if (!best || score > best.score) best = { state: result.state, score };
    }
    return best;
  }

  // 시도해 볼 choices 조합 목록. 단일 선택(min=max=1)은 후보 전부를 각각 —
  // 다중 선택은 조합 폭발을 피해 기존 #pickChoices 휴리스틱 하나만.
  #choiceOptions(req: ChoiceRequest, state: GameState): string[][] {
    if (req.min === 1 && req.max === 1 && req.from.length > 1 && req.from.length <= 10) {
      return req.from.map((id) => [id]);
    }
    return [this.#pickChoices(req, state)];
  }

  // 실전 choice:request 응답 — 시뮬레이션과 같은 정책으로 각 후보를 적용해 최고
  // 점수 선택지를 고른다. 완결되지 않는 상황(예: 한 pass에 선택 카드가 여러 장
  // 큐돼 두 번째 요청이 남음)에서는 기존 #pickChoices 휴리스틱으로 폴백.
  #bestLiveChoices(req: ChoiceRequest, action: RulesAction, state: GameState): string[] {
    const options = this.#choiceOptions(req, state);
    if (options.length > 1) {
      let best: { choices: string[]; score: number } | null = null;
      for (const choices of options) {
        const game = Game.fromState(state);
        let result = game.apply(action);
        if (result.choiceRequest) result = game.apply({ ...action, choices } as RulesAction);
        if (result.choiceRequest || result.error) continue;
        const score = this.#evaluate(result.state);
        if (!best || score > best.score) best = { choices, score };
      }
      if (best) return best.choices;
    }
    return this.#pickChoices(req, state);
  }

  // An attack against a coop-blockable target pauses for the defender's
  // reaction instead of resolving inline — scoring the paused state as-is
  // would look like "nothing happened" (no casualties yet) and make every
  // such attack look free. Bracket the real outcome by resolving both
  // extremes (defender declines vs. defender throws every available blocker
  // in) and assume a rational defender picks whichever hurts us more.
  #resolveAttackReactionWorstCase(
    state: GameState,
    action: RulesAction,
    req: AttackReactionRequest,
  ): { state: GameState; score: number } | null {
    let worst: { state: GameState; score: number } | null = null;
    for (const blockerIds of [[], req.blockable]) {
      const game = Game.fromState(state);
      const attackResult = game.apply(action);
      if (!attackResult.attackReactionRequest) continue;
      const result = game.apply({ type: 'resolveAttack', player: req.player, blockerIds } as RulesAction);
      if (result.error) continue;
      const score = this.#evaluate(result.state);
      if (!worst || score < worst.score) worst = { state: result.state, score };
    }
    return worst;
  }

  #evaluate(state: GameState): number {
    if (state.loser === this.player) return -1000;
    if (state.loser === otherPlayer(this.player)) return 1000;

    const my = this.#fieldUnits(state, this.player);
    const foe = this.#fieldUnits(state, otherPlayer(this.player));
    const myPower = my.reduce((s, id) => s + (state.units[id]?.power ?? 0), 0);
    const foePower = foe.reduce((s, id) => s + (state.units[id]?.power ?? 0), 0);
    const emptyFieldPenalty = my.length === 0 ? -50 : 0;

    return (myPower - foePower) + (my.length - foe.length) * 3 + emptyFieldPenalty
      + this.extraEvaluate(state);
  }

  // ── deck-specific extension points ─────────────────────────────────────────
  // 기본 SimAI는 덱 종류를 모른다 — 덱별 하위 클래스(`ai/deckAI.ts`)가 이 훅을
  // 오버라이드해 그 덱 고유의 승리 조건(사교 의식의 지혜 임계, 영웅담의 결속
  // 시너지 등)을 일반 전투 스코어 위에 얹는다. 카드 이름을 하드코딩하지 않고
  // 키워드/스탯 같은 일반 신호로만 가중치를 준다.

  // 승패가 이미 갈린 상태(±1000)에는 적용되지 않음 — evaluate()가 그 경우
  // 조기 반환하므로 이 훅까지 안 옴.
  protected extraEvaluate(_state: GameState): number { return 0; }

  // 오프닝 카드 후보 채점에 더할 가산점(생존여부·파워 기준 점수 위에 얹힘).
  protected extraOpeningScore(_state: GameState, _cardId: string): number { return 0; }

  // ── play (cards) ───────────────────────────────────────────────────────────

  #bestPlay(state: GameState): RulesAction | null {
    const hand = state.hand[this.player];
    // 턴을 그냥 끝냈을 때의 도달점 — 아래 "상대 유닛 선물" 판정의 비교 기준.
    const passSim = this.#simulateThenPass(state, null);
    let best: { action: RulesAction; score: number } | null = null;

    const candidates: RulesAction[] = [];
    for (const cardId of hand) {
      if (isCardLocked(state, this.player, cardId)) continue;
      if (!canPlayId(state, cardId, this.player).ok) continue;
      const def = CARD_REGISTRY.getDef(cardId);

      // '부동' 카드는 이번 턴 이미 행동(공격/이동)했다면 보류 — 지금 내면 부동
      // 보상(다음 의식 획득, 폭탄/여관 발동 자체)이 무조건 무효라 카드만 버리는
      // 셈이다. 아직 아무도 행동 안 한 턴에 내면 #immobilityPending 억제가
      // 남은 행동을 막아 부동을 지켜준다.
      if (state.actedThisTurn.length > 0 && (def.keywords?.includes('부동') ?? false)) continue;

      if (def.kind === 'unit') {
        for (let cell = 0; cell < GRID_SIZE; cell++) {
          if (state.field[this.player][cell]) continue;
          candidates.push({ type: 'play', player: this.player, cardId, cell });
        }
      } else {
        candidates.push({ type: 'play', player: this.player, cardId });
      }
    }

    for (const action of candidates) {
      const score = this.#simulateAndScore(state, action);
      if (score === null) continue;
      if (passSim) {
        const resolved = this.#simulateThenPass(state, action);
        if (resolved && this.#isDudPlay(action, resolved.state, passSim.state)) continue;
        if (this.#giftsUnitsToFoe(state, action, passSim, resolved)) continue;
      }
      if (!best || score > best.score) best = { action, score };
    }

    return best?.action ?? null;
  }

  // 카드를 내고 턴을 끝낸 도달점이 "그냥 턴을 끝낸 것 + 손에서 그 카드 한 장
  // 소실"과 완전히 같으면(전장·환경·오행산·내 손패 이득 전무) 이번 국면에서
  // 아무 일도 하지 않는 허탕 플레이다 — 예: 미후왕 없는 수보리조사, 제물이
  // 모자란 의식. 내면 카드만 영구히 잃으므로(드로우가 없는 게임이라 회수 불가)
  // 후보에서 제외해 손에 보관한다. 오프닝의 생존 시뮬레이션 검사(#bestOpeningCard)를
  // 메인 페이즈로 일반화한 것 — 카드 이름이 아니라 해석된 결과로만 판정한다.
  #isDudPlay(action: RulesAction, resolved: GameState, passed: GameState): boolean {
    if (action.type !== 'play') return false;
    const sig = (s: GameState) => {
      const units = (['A', 'B'] as PlayerId[]).map((p) =>
        s.field[p].map((id) => {
          const u = id ? s.units[id] : null;
          return u ? `${u.cardId}@${u.cell}:${u.power}/${u.wisdom}` : '·';
        }).join(',')).join('#');
      return `${units}#${JSON.stringify(s.environment)}#${[...s.trapped].sort().join(',')}`;
    };
    if (sig(resolved) !== sig(passed)) return false;
    // 내 손패가 "낸 카드 한 장만 빠진 것"과 정확히 같아야 허탕 (카드 획득도 효과다).
    const after = [...resolved.hand[this.player]].sort();
    const expected = [...passed.hand[this.player]];
    const idx = expected.indexOf(action.cardId);
    if (idx >= 0) expected.splice(idx, 1);
    expected.sort();
    return after.length === expected.length && after.every((c, i) => c === expected[i]);
  }

  // 큐에 쌓이는 onPlay 효과(개입 제외)는 pass 시점에야 풀리므로, "낸 직후"만
  // 채점하는 1-ply 시뮬레이션에는 상대 전장에 유닛을 깔아주는 카드(모험의 시작
  // → … → 마왕성 입성 퀘스트 체인)의 해악이 전혀 잡히지 않는다. 후보 카드를
  // 내고 바로 턴을 끝냈을 때를 그냥 턴을 끝냈을 때와 비교해, 점수가 나빠지면서
  // 상대 유닛 수까지 늘어나면 "상대에게 유닛을 선물하는 카드"로 보고 거른다.
  // 카드 이름이 아니라 해석된 결과로만 판정 — 선물을 상쇄하고도 남는 이득이
  // 있는 카드(점수가 안 나빠짐)는 여전히 낼 수 있다.
  #giftsUnitsToFoe(
    state: GameState,
    action: RulesAction,
    passSim: { state: GameState; score: number },
    resolved: { state: GameState; score: number } | null,
  ): boolean {
    if (this.#giftCheck(passSim, resolved)) return true;
    // 상대 전장이 가득 차 있으면 소환이 시뮬레이션(play → 즉시 pass)에서만
    // 불발된다 — 실제 턴은 play 뒤 공격들이 상대 유닛을 죽여 칸을 비우고 나서야
    // pass하므로, 그때 선물이 착지한다. 상대의 최약체 하나를 치워 칸을 하나
    // 확보한 가상 상태로 같은 검사를 반복해 이 구멍을 막는다.
    const foe = otherPlayer(this.player);
    if (!state.field[foe].every((c) => c)) return false;
    const probe = structuredClone(state);
    const weakest = this.#fieldUnits(probe, foe)
      .sort((a, b) => (probe.units[a]?.power ?? 0) - (probe.units[b]?.power ?? 0))[0];
    if (!weakest) return false;
    exitUnit(probe, weakest);
    const probeBase = this.#simulateThenPass(probe, null);
    if (!probeBase) return false;
    return this.#giftCheck(probeBase, this.#simulateThenPass(probe, action));
  }

  #giftCheck(
    passSim: { state: GameState; score: number },
    resolved: { state: GameState; score: number } | null,
  ): boolean {
    if (!resolved) return false;
    const foe = otherPlayer(this.player);
    const foeGained = this.#fieldUnits(resolved.state, foe).length > this.#fieldUnits(passSim.state, foe).length;
    return foeGained && resolved.score < passSim.score;
  }

  // `action`(null이면 아무것도 안 냄)을 적용한 뒤 pass까지 밟아 이번 턴에 큐된
  // onPlay 효과를 전부 해석한 상태를 채점한다.
  #simulateThenPass(state: GameState, action: RulesAction | null): { state: GameState; score: number } | null {
    const game = Game.fromState(state);
    if (action) {
      let result = game.apply(action);
      if (result.choiceRequest) {
        const choices = this.#pickChoices(result.choiceRequest, state);
        result = game.apply({ ...action, choices } as RulesAction);
      }
      if (result.choiceRequest || result.error) return null;
    }
    const passed = game.apply({ type: 'pass', player: this.player });
    if (passed.error) return null;
    return { state: passed.state, score: this.#evaluate(passed.state) };
  }

  // ── move ───────────────────────────────────────────────────────────────────

  #bestMove(state: GameState, baseline: number): RulesAction | null {
    const myUnits = this.#fieldUnits(state, this.player);
    const movable = myUnits.filter((id) => !state.actedThisTurn.includes(id) && !state.trapped.includes(id));
    let best: { action: RulesAction; score: number; unlocksAttack: boolean } | null = null;

    for (const unitId of movable) {
      const u = state.units[unitId];
      if (!u) continue;
      // A unit stuck with zero reachable targets (e.g. tucked behind an empty
      // lane) never benefits from a static score comparison — repositioning
      // doesn't change power/count, so it always looks like "no benefit" even
      // when it's the only way to ever bring a lane-blocked target (like a
      // 마왕 stashed in an unreachable cell) into range. Track that case
      // separately so it can outweigh a tied score.
      const hadTargets = attackableTargets(state, unitId).length > 0;
      const adjacent = (HEX_ADJACENT[u.cell] as number[] | undefined) ?? [];
      for (const toCell of adjacent) {
        if (!canMove(state, unitId, toCell)) continue;
        const action: RulesAction = { type: 'move', player: this.player, unitId, toCell };
        const sim = this.#simulate(state, action);
        if (!sim) continue;
        const unlocksAttack = !hadTargets && attackableTargets(sim.state, unitId).length > 0;
        if (!best || sim.score > best.score || (sim.score === best.score && unlocksAttack && !best.unlocksAttack)) {
          best = { action, score: sim.score, unlocksAttack };
        }
      }
    }

    if (!best) return null;
    // Move if it's a genuine improvement over doing nothing this stage (avoid
    // shuffling units around for no benefit), or if it sets up an attack that
    // was otherwise completely unreachable (and doesn't cost anything to do so).
    if (best.score > baseline || (best.unlocksAttack && best.score >= baseline)) return best.action;
    return null;
  }

  // ── attack ─────────────────────────────────────────────────────────────────

  #bestAttack(state: GameState, baseline: number): { action: RulesAction; score: number } | null {
    const myUnits = this.#fieldUnits(state, this.player);
    const foeUnits = this.#fieldUnits(state, otherPlayer(this.player));
    if (foeUnits.length === 0) return null;

    const candidates = myUnits.filter((id) => canAttack(state, id));
    if (candidates.length === 0) return null;

    let best: { action: RulesAction; score: number; kills: boolean } | null = null;
    for (const attackerId of candidates) {
      const targets = attackableTargets(state, attackerId);
      for (const targetId of targets) {
        const action: RulesAction = { type: 'attack', player: this.player, attackerId, targetId };
        const sim = this.#simulate(state, action);
        if (!sim) continue;
        // 이 공격으로 내가 즉시 패배하면(마지막 유닛 동귀어진 등) kills 예외로도
        // 정당화될 수 없다 — pass가 항상 더 낫다.
        if (sim.state.loser === this.player) continue;
        // 순수 전투 손실(공격자 자신, 협공 실패 시 방어자들)을 넘어 내 필드가
        // 추가로 더 줄면 "동반 이탈 체인"이 붕괴한 것이다(예: 삼장법사가 죽으면
        // 저오능/사오정도 자동 이탈) — kills 예외가 이런 손해거래까지 정당화하지
        // 않도록, 내 필드 감소분이 공격자 하나(협공 없는 1:1 공방 기준)를
        // 넘어서면 체인 붕괴로 보고 kills 예외 대상에서 제외한다.
        const myLoss = myUnits.length - this.#fieldUnits(sim.state, this.player).length;
        const kills = myLoss <= 1 && this.#fieldUnits(sim.state, otherPlayer(this.player)).length < foeUnits.length;
        if (!best || sim.score > best.score) best = { action, score: sim.score, kills };
      }
    }

    if (!best) return null;
    // Take a genuine improvement outright. A trade that doesn't improve the
    // score is only worth it if it actually destroys an enemy unit — reject
    // both net-losing trades AND flat no-ops (e.g. a combatImmune attacker
    // bouncing off a stronger target forever: nothing dies on either side,
    // so the score never moves, but attacking accomplishes exactly nothing).
    if (best.score <= baseline && !best.kills) return null;
    return best;
  }

  // 공격 대신 발동하는 액티브 능력 (사제/마법사). 공격과 동일한 행동권을 소모하므로
  // _bestAttack과 같은 후보 유닛 풀(canAttack)에서 뽑아 점수로 경쟁시킨다.
  #bestAbility(state: GameState, baseline: number): { action: RulesAction; score: number } | null {
    const myUnits = this.#fieldUnits(state, this.player);
    let best: { action: RulesAction; score: number } | null = null;
    for (const unitId of myUnits) {
      const u = state.units[unitId];
      if (!u || !canAttack(state, unitId)) continue;
      if (!CARD_REGISTRY.getDef(u.cardId).activeAbility) continue;
      const action: RulesAction = { type: 'ability', player: this.player, unitId };
      const score = this.#simulateAndScore(state, action);
      if (score !== null && (!best || score > best.score)) best = { action, score };
    }
    if (!best || best.score < baseline) return null;
    return best;
  }

  // ── choice handling ────────────────────────────────────────────────────────

  #pickChoices(req: ChoiceRequest, state: GameState): string[] {
    const from = req.from;
    const max = req.max;
    const cardId = req.cardId;
    const myUnits = this.#fieldUnits(state, this.player);
    const foeUnits = this.#fieldUnits(state, opp(this.player));

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

  // ── idle / cycle detection ─────────────────────────────────────────────────

  // 이력 끝에 signature를 이어붙였을 때, 그 결과가 어떤 주기 p(2 <= p <=
  // len/2)로 완전히 반복되는 꼬리를 만드는지 검사한다. 예: [X, Y, X, Y]는
  // 주기 2로 반복 — X 다음에 또 Y가 나와도 여전히 주기 2 반복이므로 이
  // 사이클의 연장은 전부 "이미 밟은 패턴의 재현"으로 본다.
  #repeatsRecentCycle(action: RulesAction): boolean {
    const sig = actionSignature(action);
    if (!sig) return false; // pass 등은 감지 대상 아님(무해)
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

  // ── helpers ────────────────────────────────────────────────────────────────

  // 내가 이번 턴에 낸 '부동' 키워드 카드(의식 등)가 큐에 대기 중인가 — 있으면
  // 이번 턴 행동(공격/능력/이동)이 pass 시점의 부동 보상을 무효화한다.
  #immobilityPending(state: GameState): boolean {
    return state.pendingPlays.some((p) => p.controller === this.player
      && (CARD_REGISTRY.getDef(p.cardId).keywords?.includes('부동') ?? false));
  }

  #fieldUnits(state: GameState, player: PlayerId): string[] {
    return state.field[player].filter((id): id is string => !!id);
  }
}

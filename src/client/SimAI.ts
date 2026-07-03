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

export class SimAI {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubChoice: () => void;

  constructor(
    private readonly player: PlayerId,
    private readonly events: EventManager,
    private readonly getState: () => GameState,
  ) {
    this.unsubChoice = this.events.on('choice:request', ({ request, action }: { request: ChoiceRequest; action: RulesAction }) => {
      if (request.player !== this.player) return;
      const choices = this.#pickChoices(request, this.getState());
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
      const score = (survives ? 1000 : 0) + power;
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

    // 공격/능력을 이동보다 먼저 소진한다. 이동도 행동권을 소모하므로(공격 OR
    // 이동) 이동을 먼저 하면 "공격하러 전열로 간" 유닛이 정작 그 턴에 공격을
    // 못 하고, 매 턴 재배치만 반복하는 라이브락에 빠진다(특히 스왑 이동은 두
    // 유닛의 행동권을 모두 소모해 전열 공격수까지 무력화했다).
    const atk = this.#bestAttack(state, baseline);
    const abl = this.#bestAbility(state, baseline);
    // 공격과 액티브 능력은 같은 행동권을 놓고 경쟁한다(한 유닛당 둘 중 하나) — 더 나은 쪽을 고른다.
    if (atk && abl) { this.#emit(atk.score >= abl.score ? atk.action : abl.action); return; }
    if (atk) { this.#emit(atk.action); return; }
    if (abl) { this.#emit(abl.action); return; }

    const mv = this.#bestMove(state, baseline);
    if (mv) { this.#emit(mv); return; }

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
    let result = game.apply(action);
    if (result.choiceRequest) {
      const choices = this.#pickChoices(result.choiceRequest, state);
      result = game.apply({ ...action, choices } as RulesAction);
    }
    // 선택을 채워 넣어도 여전히 선택을 요구하면(#pickChoices가 min을 못 채움 —
    // 예: 사제 능력인데 대상이 될 아군이 없음) 이 액션은 완결 불가능하다.
    // null을 돌려 후보에서 제외하지 않으면 실행 단계에서 choice:request ↔ 빈
    // choices 재제출 무한 왕복(라이브락)에 빠진다.
    if (result.choiceRequest) return null;
    if (result.attackReactionRequest) {
      return this.#resolveAttackReactionWorstCase(state, action, result.attackReactionRequest);
    }
    if (result.error) return null;
    return { state: result.state, score: this.#evaluate(result.state) };
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

    return (myPower - foePower) + (my.length - foe.length) * 3 + emptyFieldPenalty;
  }

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
      if (passSim && this.#giftsUnitsToFoe(state, action, passSim)) continue;
      if (!best || score > best.score) best = { action, score };
    }

    return best?.action ?? null;
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
  ): boolean {
    if (this.#giftCheck(state, action, passSim)) return true;
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
    return this.#giftCheck(probe, action, probeBase);
  }

  #giftCheck(
    state: GameState,
    action: RulesAction,
    passSim: { state: GameState; score: number },
  ): boolean {
    const resolved = this.#simulateThenPass(state, action);
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

  // ── helpers ────────────────────────────────────────────────────────────────

  #fieldUnits(state: GameState, player: PlayerId): string[] {
    return state.field[player].filter((id): id is string => !!id);
  }
}

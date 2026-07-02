// AI that drives the opponent automatically via real simulation: candidate
// actions are actually applied to a cloned Game (Game.fromState + apply) and
// the resulting GameState is scored, rather than hand-scoring the action in
// isolation. Still single-step greedy per stage (play > move > attack > pass);
// multi-step lookahead is a future upgrade.

import {
  Game, canPlayId, canAttack, canMove, isCardLocked, otherPlayer, CARD_REGISTRY,
  GRID_SIZE, attackableTargets, HEX_ADJACENT, otherPlayer as opp,
} from '../rules/index.js';
import type { ChoiceRequest, GameState, PlayerId, RulesAction } from '../rules/index.js';
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
  // Opening placement isn't scored by combat simulation (no opponent on field
  // yet to fight) — keep the simple front-row spread heuristic.

  #openingStep(): void {
    const state = this.getState();
    if (state.openingDone[this.player]) return;

    if (state.openingPlaced[this.player] < 3) {
      const card = this.#strongestPlayable(state);
      if (card) {
        const cell = this.#pickOpeningCell(state);
        if (cell >= 0) {
          this.#emit({ type: 'placeOpening', player: this.player, cardId: card, cell });
          return;
        }
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

  #strongestPlayable(state: GameState): string | null {
    const hand = [...state.hand[this.player]];
    const filtered = hand.filter((id) => {
      const def = CARD_REGISTRY.getDef(id);
      return def.kind === 'unit' && canPlayId(state, id, this.player).ok;
    });
    if (filtered.length === 0) return null;
    filtered.sort((a, b) => (CARD_REGISTRY.getDef(b).power ?? 0) - (CARD_REGISTRY.getDef(a).power ?? 0));
    return filtered[0];
  }

  // ── main ───────────────────────────────────────────────────────────────────

  #mainStep(): void {
    const state = this.getState();
    if (state.active !== this.player || state.loser) return;

    const play = this.#bestPlay(state);
    if (play) { this.#emit(play); return; }

    const baseline = this.#evaluate(state);

    const mv = this.#bestMove(state, baseline);
    if (mv) { this.#emit(mv); return; }

    const atk = this.#bestAttack(state, baseline);
    const abl = this.#bestAbility(state, baseline);
    // 공격과 액티브 능력은 같은 행동권을 놓고 경쟁한다(한 유닛당 둘 중 하나) — 더 나은 쪽을 고른다.
    if (atk && abl) { this.#emit(atk.score >= abl.score ? atk.action : abl.action); return; }
    if (atk) { this.#emit(atk.action); return; }
    if (abl) { this.#emit(abl.action); return; }

    this.#emit({ type: 'pass', player: this.player });
  }

  // ── simulation core ────────────────────────────────────────────────────────

  // Actually apply `action` to a cloned Game and score the resulting state.
  // Returns null if the action is illegal. Fills choices (if the engine asks
  // for them) with our own greedy choice-picker before scoring.
  #simulateAndScore(state: GameState, action: RulesAction): number | null {
    const game = Game.fromState(state);
    let result = game.apply(action);
    if (result.choiceRequest) {
      const choices = this.#pickChoices(result.choiceRequest, state);
      result = game.apply({ ...action, choices } as RulesAction);
    }
    if (result.error) return null;
    return this.#evaluate(result.state);
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
    let best: { action: RulesAction; score: number } | null = null;

    for (const cardId of hand) {
      if (isCardLocked(state, this.player, cardId)) continue;
      if (!canPlayId(state, cardId, this.player).ok) continue;
      const def = CARD_REGISTRY.getDef(cardId);

      if (def.kind === 'unit') {
        for (let cell = 0; cell < GRID_SIZE; cell++) {
          if (state.field[this.player][cell]) continue;
          const action: RulesAction = { type: 'play', player: this.player, cardId, cell };
          const score = this.#simulateAndScore(state, action);
          if (score !== null && (!best || score > best.score)) best = { action, score };
        }
      } else {
        const action: RulesAction = { type: 'play', player: this.player, cardId };
        const score = this.#simulateAndScore(state, action);
        if (score !== null && (!best || score > best.score)) best = { action, score };
      }
    }

    return best?.action ?? null;
  }

  // ── move ───────────────────────────────────────────────────────────────────

  #bestMove(state: GameState, baseline: number): RulesAction | null {
    const myUnits = this.#fieldUnits(state, this.player);
    const movable = myUnits.filter((id) => !state.actedThisTurn.includes(id) && !state.trapped.includes(id));
    let best: { action: RulesAction; score: number } | null = null;

    for (const unitId of movable) {
      const u = state.units[unitId];
      if (!u) continue;
      const adjacent = (HEX_ADJACENT[u.cell] as number[] | undefined) ?? [];
      for (const toCell of adjacent) {
        if (!canMove(state, unitId, toCell)) continue;
        const action: RulesAction = { type: 'move', player: this.player, unitId, toCell };
        const score = this.#simulateAndScore(state, action);
        if (score !== null && (!best || score > best.score)) best = { action, score };
      }
    }

    // Only move if it's a genuine improvement over doing nothing this stage
    // (avoid shuffling units around for no benefit).
    if (best && best.score > baseline) return best.action;
    return null;
  }

  // ── attack ─────────────────────────────────────────────────────────────────

  #bestAttack(state: GameState, baseline: number): { action: RulesAction; score: number } | null {
    const myUnits = this.#fieldUnits(state, this.player);
    const foeUnits = this.#fieldUnits(state, otherPlayer(this.player));
    if (foeUnits.length === 0) return null;

    const candidates = myUnits.filter((id) => canAttack(state, id));
    if (candidates.length === 0) return null;

    const desperate = foeUnits.length >= myUnits.length;

    let best: { action: RulesAction; score: number } | null = null;
    for (const attackerId of candidates) {
      const targets = attackableTargets(state, attackerId);
      for (const targetId of targets) {
        const action: RulesAction = { type: 'attack', player: this.player, attackerId, targetId };
        const score = this.#simulateAndScore(state, action);
        if (score !== null && (!best || score > best.score)) best = { action, score };
      }
    }

    if (!best) return null;
    // Take it if it's not a net loss, or we're desperate (losing anyway).
    if (best.score < baseline && !desperate) return null;
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

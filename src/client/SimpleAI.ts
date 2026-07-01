// AI that drives the opponent automatically.
//
// Decision hierarchy (each step: pick the best available action, then re-evaluate):
//   Opening : place units on strategic cells (front-row center spread), then finishOpening.
//   Main    : 1) play best scoring card (with strategic cell)
//             2) move units to unlock new attacks or improve coverage
//             3) attack best matchup per unit (win > tie when desperate > skip)
//             4) pass.

import { canPlayId, canAttack, canMove, isCardLocked, otherPlayer, CARD_REGISTRY, GRID_SIZE, attackableTargets, ATTACK_TARGETS, HEX_ADJACENT } from '../rules/index.js';
import type { ChoiceRequest, GameState, PlayerId, RulesAction } from '../rules/index.js';
import type { EventManager } from './core/EventManager.js';

const STEP_MS = 700;
const CHOICE_MS = 400;

// Front-row cells preferred for strong units (center has widest attack range).
const FRONT_CELLS = [2, 1, 3, 0, 4] as const; // center-out priority
const BACK_CELLS  = [6, 5, 7, 8]    as const;

export class SimpleAI {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubChoice: () => void;

  constructor(
    private readonly player: PlayerId,
    private readonly events: EventManager,
    private readonly getState: () => GameState,
  ) {
    this.unsubChoice = this.events.on('choice:request', ({ request, action }: { request: ChoiceRequest; action: RulesAction }) => {
      if (request.player !== this.player) return;
      const choices = this._pickChoices(request);
      const filled = { ...(action as RulesAction), choices } as RulesAction;
      setTimeout(() => this._emit(filled), CHOICE_MS);
    });
  }

  react(): void {
    this.cancel();
    const state = this.getState();
    if (state.loser) return;

    if (state.phase === 'opening' && !state.openingDone[this.player]) {
      this.timer = setTimeout(() => this._openingStep(), STEP_MS);
    } else if (state.phase === 'main' && state.active === this.player) {
      this.timer = setTimeout(() => this._mainStep(), STEP_MS);
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

  private _emit(action: RulesAction): void {
    this.events.emit('intent', action);
  }

  // ── opening ────────────────────────────────────────────────────────────────

  private _openingStep(): void {
    const state = this.getState();
    if (state.openingDone[this.player]) return;

    if (state.openingPlaced[this.player] < 3) {
      const card = this._strongestPlayable(state, 'unit');
      if (card) {
        const cell = this._pickOpeningCell(state);
        if (cell >= 0) {
          this._emit({ type: 'placeOpening', player: this.player, cardId: card, cell });
          return;
        }
      }
    }
    this._emit({ type: 'finishOpening', player: this.player });
  }

  // Pick next opening cell: spread across front row (center-out), then back.
  private _pickOpeningCell(state: GameState): number {
    const field = state.field[this.player];
    for (const c of FRONT_CELLS) { if (!field[c]) return c; }
    for (const c of BACK_CELLS)  { if (!field[c]) return c; }
    return -1;
  }

  // ── main ───────────────────────────────────────────────────────────────────

  private _mainStep(): void {
    const state = this.getState();
    if (state.active !== this.player || state.loser) return;

    const card = this._bestCard(state);
    if (card) {
      const cell = card.isUnit ? this._pickPlayCell(state) : undefined;
      this._emit({ type: 'play', player: this.player, cardId: card.id, ...(cell !== undefined ? { cell } : {}) });
      return;
    }

    const mv = this._bestMove(state);
    if (mv) {
      this._emit({ type: 'move', player: this.player, unitId: mv.unitId, toCell: mv.toCell });
      return;
    }

    const atk = this._bestAttack(state);
    if (atk) {
      this._emit({ type: 'attack', player: this.player, ...atk });
      return;
    }

    this._emit({ type: 'pass', player: this.player });
  }

  // ── cell selection ─────────────────────────────────────────────────────────

  // Choose a cell for a newly played unit. Strong units go to front row,
  // otherwise fill any free cell (back row acceptable for support units).
  private _pickPlayCell(state: GameState): number | undefined {
    const field = state.field[this.player];
    // Prefer front row (wide attack coverage)
    for (const c of FRONT_CELLS) { if (!field[c]) return c; }
    for (const c of BACK_CELLS)  { if (!field[c]) return c; }
    return undefined; // grid full — summon will fail anyway
  }

  // ── card selection ─────────────────────────────────────────────────────────

  private _bestCard(state: GameState): { id: string; isUnit: boolean } | null {
    const hand = state.hand[this.player];
    const hasFreCell = state.field[this.player].some((c) => !c);
    let best: string | null = null;
    let bestScore = -Infinity;

    for (const id of hand) {
      if (isCardLocked(state, this.player, id)) continue; // 지략으로 봉쇄된 카드
      if (!canPlayId(state, id, this.player).ok) continue;
      const def = CARD_REGISTRY.getDef(id);
      // 필드가 꽉 찼으면 유닛 카드 스킵 (소환 실패 방지)
      if (def.kind === 'unit' && !hasFreCell) continue;
      const score = this._cardScore(id, state);
      if (score > bestScore) { bestScore = score; best = id; }
    }
    if (!best) return null;
    return { id: best, isUnit: CARD_REGISTRY.getDef(best).kind === 'unit' };
  }

  private _cardScore(cardId: string, state: GameState): number {
    const def = CARD_REGISTRY.getDef(cardId);
    const myUnits = this._fieldUnits(state, this.player);
    const enemyUnits = this._fieldUnits(state, otherPlayer(this.player));
    const behind = myUnits.length < enemyUnits.length;
    const desperate = myUnits.length === 0;

    if (def.kind === 'unit') {
      const pow = def.power ?? 0;
      const beatsCount = enemyUnits.filter((id) => pow > (state.units[id]?.power ?? 0)).length;
      // Bonus for filling an empty field (loss-prevention)
      const survivalBonus = desperate ? 20 : (behind ? 4 : 0);
      return pow + beatsCount * 2 + survivalBonus;
    }
    return this._spellScore(cardId, state);
  }

  private _spellScore(cardId: string, state: GameState): number {
    const myUnits = this._fieldUnits(state, this.player);
    const enemyUnits = this._fieldUnits(state, otherPlayer(this.player));

    switch (cardId) {
      case 'health-potion': {
        if (myUnits.length === 0) return -5;
        const flips = myUnits.filter((id) => {
          const myPow = state.units[id]?.power ?? 0;
          return enemyUnits.some(
            (eid) => myPow < (state.units[eid]?.power ?? 0) && myPow + 2 >= (state.units[eid]?.power ?? 0),
          );
        }).length;
        return 3 + flips * 3;
      }

      case 'adventure-start':
        return myUnits.length < 2 ? 5 : 2;

      case 'quest-slime':
        return enemyUnits.length < 2 ? 3 : 1;

      case 'revolution': {
        const enemyMax = Math.max(...enemyUnits.map((id) => state.units[id]?.power ?? 0), 0);
        const myMin = myUnits.length
          ? Math.min(...myUnits.map((id) => state.units[id]?.power ?? 0))
          : 999;
        return enemyMax > myMin ? 7 : -2;
      }

      case 'revival-ritual':
        return 1;

      default:
        return 2;
    }
  }

  // ── movement selection ─────────────────────────────────────────────────────

  // Find the best move: move a unit to a cell that unlocks a new attack or
  // improves coverage. Only consider moves that directly enable a winning attack.
  private _bestMove(state: GameState): { unitId: string; toCell: number } | null {
    const myUnits = this._fieldUnits(state, this.player);
    const enemyUnits = this._fieldUnits(state, otherPlayer(this.player));
    if (enemyUnits.length === 0) return null;

    // canMove는 actedThisTurn + trapped + hexAdjacent + 빈 셀을 모두 검사
    const movable = myUnits.filter((id) => !state.actedThisTurn.includes(id) && !state.trapped.includes(id));

    let best: { unitId: string; toCell: number; score: number } | null = null;

    for (const unitId of movable) {
      const u = state.units[unitId];
      if (!u) continue;
      // 이미 이길 수 있는 공격 대상이 있으면 이동보다 공격 우선
      const currentTargets = attackableTargets(state, unitId);
      const alreadyCanWin = currentTargets.some(
        (tid) => u.power > (state.units[tid]?.power ?? 0),
      );
      if (alreadyCanWin) continue;

      const adjacent = (HEX_ADJACENT[u.cell] as number[] | undefined) ?? [];
      for (const toCell of adjacent) {
        if (!canMove(state, unitId, toCell)) continue; // 엔진 검사 위임

        // Simulate: what targets would this unit have from toCell?
        const targetCells = (ATTACK_TARGETS[toCell] as number[] | undefined) ?? [];
        const opp = otherPlayer(this.player);
        const newTargets = targetCells
          .map((c) => state.field[opp][c])
          .filter((id): id is string => !!id);

        const winsFromNew = newTargets.filter(
          (tid) => u.power > (state.units[tid]?.power ?? 0),
        ).length;
        if (winsFromNew === 0) continue;

        // Prefer front-row cells and more wins
        const frontBonus = toCell < 5 ? 1 : 0;
        const score = winsFromNew * 3 + frontBonus;
        if (!best || score > best.score) best = { unitId, toCell, score };
      }
    }

    return best ? { unitId: best.unitId, toCell: best.toCell } : null;
  }

  // ── attack selection ───────────────────────────────────────────────────────

  private _bestAttack(state: GameState): { attackerId: string; targetId: string } | null {
    const myUnits = this._fieldUnits(state, this.player);
    const enemyUnits = this._fieldUnits(state, otherPlayer(this.player));
    if (enemyUnits.length === 0) return null;

    // canAttack이 actedThisTurn + trapped + cannotAttack 키워드까지 검사
    const candidates = myUnits.filter((id) => canAttack(state, id));
    if (candidates.length === 0) return null;

    const desperate = enemyUnits.length >= myUnits.length;

    let best: { attackerId: string; targetId: string; score: number } | null = null;

    for (const attackerId of candidates) {
      const targets = attackableTargets(state, attackerId);
      const ap = state.units[attackerId]?.power ?? 0;
      for (const targetId of targets) {
        const dp = state.units[targetId]?.power ?? 0;
        let score: number;
        if (ap > dp) {
          // Winning attack: bonus for killing high-power threats
          score = 10 + dp;
        } else if (ap === dp) {
          // Tie: both die. Worth it when desperate (reduces enemy count equally).
          score = desperate ? 3 : -2;
        } else {
          // Losing attack: avoid unless truly desperate (would lose anyway)
          score = dp - ap - 10;
        }

        if (!best || score > best.score) best = { attackerId, targetId, score };
      }
    }

    if (!best) return null;
    // Only skip negative-score attacks if we have a non-desperate position
    if (best.score < 0 && !desperate) return null;
    return { attackerId: best.attackerId, targetId: best.targetId };
  }

  // ── choice handling ────────────────────────────────────────────────────────

  private _pickChoices(req: ChoiceRequest): string[] {
    const state = this.getState();
    const from = req.from;
    const max = req.max;
    const cardId = req.cardId;
    const myUnits = this._fieldUnits(state, this.player);
    const enemyUnits = this._fieldUnits(state, otherPlayer(this.player));

    switch (cardId) {
      case 'health-potion': {
        const allies = from.filter((id) => myUnits.includes(id));
        const enemyPowers = enemyUnits.map((id) => state.units[id]?.power ?? 0);
        const scored = allies.map((id) => {
          const p = state.units[id]?.power ?? 0;
          const gains = enemyPowers.filter((ep) => p < ep && p + 2 >= ep).length;
          return { id, score: gains * 10 + p };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 1).map((x) => x.id);
      }

      case 'revolution': {
        const myPicks = from
          .filter((id) => myUnits.includes(id))
          .sort((a, b) => (state.units[a]?.power ?? 0) - (state.units[b]?.power ?? 0));
        const enemyPicks = from
          .filter((id) => enemyUnits.includes(id))
          .sort((a, b) => (state.units[b]?.power ?? 0) - (state.units[a]?.power ?? 0));

        const pairs: string[] = [];
        const n = Math.min(myPicks.length, enemyPicks.length, Math.floor(max / 2));
        for (let i = 0; i < n; i++) {
          const myPow = state.units[myPicks[i]]?.power ?? 0;
          const enPow = state.units[enemyPicks[i]]?.power ?? 0;
          if (enPow > myPow) pairs.push(myPicks[i], enemyPicks[i]);
        }
        return pairs;
      }

      default:
        return from.slice(0, max);
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private _fieldUnits(state: GameState, player: PlayerId): string[] {
    return state.field[player].filter((id): id is string => !!id);
  }

  private _strongestPlayable(state: GameState, kind: 'unit' | 'spell'): string | null {
    const hand = [...state.hand[this.player]];
    const filtered = hand.filter((id) => {
      const def = CARD_REGISTRY.getDef(id);
      return def.kind === kind && canPlayId(state, id, this.player).ok;
    });
    if (filtered.length === 0) return null;
    filtered.sort((a, b) => (CARD_REGISTRY.getDef(b).power ?? 0) - (CARD_REGISTRY.getDef(a).power ?? 0));
    return filtered[0];
  }
}

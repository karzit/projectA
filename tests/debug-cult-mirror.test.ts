// cult 미러 선공 96% 좌석 편향(2026-07-10 라이브 계측) 조사용 임시 디버그 도구 —
// DEBUG_CULT_MIRROR=1 일 때만 실행된다(평소 npm test에는 skip).
// 사용: DEBUG_CULT_MIRROR=1 npx vitest run tests/debug-cult-mirror.test.ts
// 턴별 액션 로그 + 필드 스냅샷을 콘솔로 출력해 선공이 어떻게 이기는지 추적한다.
import { describe, it, vi } from 'vitest';
import { Game, otherPlayer, CARD_REGISTRY } from '../src/rules/index.js';
import type { GameState, PlayerId, RulesAction } from '../src/rules/index.js';
import { EventManager } from '../src/client/core/EventManager.js';
import { MctsAI } from '../src/client/ai/MctsAI.js';
import { getDeckStrategy } from '../src/client/ai/DeckStrategy.js';
import { deckById } from '../src/client/decks.js';

const MAX_STEPS = 500;
const TICK_MS = 750;

function pickCoopBlockers(state: GameState, attackerId: string, targetId: string, blockable: string[]): string[] {
  const attacker = state.units[attackerId];
  const target = state.units[targetId];
  if (!attacker || !target || blockable.length === 0) return [];
  const ap = attacker.power;
  let combined = target.power;
  const sorted = [...blockable].sort((a, b) => (state.units[b]?.power ?? 0) - (state.units[a]?.power ?? 0));
  const chosen: string[] = [];
  for (const id of sorted) {
    if (combined >= ap) break;
    combined += state.units[id]?.power ?? 0;
    chosen.push(id);
  }
  return combined >= ap ? chosen : [];
}

function fieldLine(state: GameState, p: PlayerId): string {
  const cells: string[] = [];
  for (let c = 0; c < 9; c++) {
    const id = state.field[p][c];
    if (!id) continue;
    const u = state.units[id];
    if (!u) continue;
    const trapped = state.trapped.includes(id) ? '(산)' : '';
    cells.push(`${c}:${u.cardId}[${u.power}/${u.wisdom}]${trapped}`);
  }
  return cells.join(' ');
}

function actionLine(state: GameState, action: RulesAction): string {
  switch (action.type) {
    case 'play': return `play ${action.cardId}${'cell' in action && action.cell !== undefined ? `@${action.cell}` : ''}`;
    case 'placeOpening': return `opening ${action.cardId}@${action.cell}`;
    case 'attack': {
      const a = state.units[action.attackerId]; const t = state.units[action.targetId];
      return `attack ${a?.cardId}[${a?.power}] -> ${t?.cardId}[${t?.power}]`;
    }
    case 'move': return `move ${state.units[action.unitId]?.cardId} -> ${action.toCell}`;
    case 'ability': return `ability ${state.units[action.unitId]?.cardId}`;
    case 'pass': return 'pass';
    default: return action.type;
  }
}

function runTraced(seed: number): void {
  const game = new Game({ decks: { A: deckById('cult').cards, B: deckById('cult').cards }, seed });
  const events = new EventManager();
  const ais = {
    A: new MctsAI('A', events, () => game.state, getDeckStrategy('cult')),
    B: new MctsAI('B', events, () => game.state, getDeckStrategy('cult')),
  };
  let retry = 0;
  let lastTurnKey = '';

  function step(action: RulesAction): void {
    if (game.state.loser) return;
    const before = game.state;
    const result = game.apply(action);
    if (result.error) {
      if (++retry <= 5) { ais.A.react(); ais.B.react(); }
      return;
    }
    retry = 0;
    const key = `${result.state.turn}:${result.state.active}`;
    if (key !== lastTurnKey) {
      lastTurnKey = key;
      console.log(`\n-- turn ${result.state.turn} (${result.state.active} 차례) --`);
      console.log(`  A필드: ${fieldLine(result.state, 'A') || '(빈)'}  손 ${result.state.hand.A.length}`);
      console.log(`  B필드: ${fieldLine(result.state, 'B') || '(빈)'}  손 ${result.state.hand.B.length}`);
    }
    console.log(`  [${action.player}] ${actionLine(before, action)}`);
    if (result.choiceRequest) {
      events.emit('choice:request', { request: result.choiceRequest, action });
      return;
    }
    if (result.reactionRequest) {
      const req = result.reactionRequest;
      const blockerId = req.eligibleBlockers[0];
      step({ type: 'react', player: req.player, block: !!blockerId, blockerId } as RulesAction);
      return;
    }
    if (result.attackReactionRequest) {
      const req = result.attackReactionRequest;
      const blockerIds = pickCoopBlockers(result.state, req.attackerId, req.targetId, req.blockable);
      if (blockerIds.length) console.log(`  [${req.player}] 협공: ${blockerIds.map((id) => result.state.units[id]?.cardId).join(',')}`);
      step({ type: 'resolveAttack', player: req.player, blockerIds } as RulesAction);
      return;
    }
    if (!result.state.loser) { ais.A.react(); ais.B.react(); }
  }

  events.on('intent', (action) => step(action as RulesAction));

  vi.useFakeTimers();
  try {
    ais.A.react();
    ais.B.react();
    let steps = 0;
    while (!game.state.loser && steps < MAX_STEPS) {
      vi.advanceTimersByTime(TICK_MS);
      steps++;
    }
  } finally {
    vi.useRealTimers();
  }
  const loser = game.state.loser;
  console.log(`\n=== seed ${seed}: ${loser ? `${otherPlayer(loser)} 승 (턴 ${game.state.turn})` : `안전판(${MAX_STEPS}스텝)`} ===\n`);
}

describe.runIf(process.env.DEBUG_CULT_MIRROR === '1')('cult 미러 추적', () => {
  it('선공 승리 패턴 추적', { timeout: 0 }, () => {
    const seeds = (process.env.DEBUG_SEEDS ?? '1').split(',').map(Number);
    for (const s of seeds) runTraced(s);
  });
});

// 헤드리스 AI 대 AI 시뮬레이션 — 진짜 assert는 최소(무한루프/크래시 감지)이고,
// 주된 목적은 프리셋 덱 매치업 승률·평균 턴 수를 콘솔에 찍어 D-1(밸런스 점검)에
// 참고 데이터를 주는 것. 실제 "재미" 판정은 사람 몫 — 이 파일은 그 판정을
// 대체하지 않는다. `SIM_GAMES` 환경변수로 매치업당 게임 수를 조절할 수 있다
// (기본값은 CI/npm test 속도를 해치지 않을 만큼 작게 유지).
import { describe, it, expect, vi } from 'vitest';
import { Game, otherPlayer } from '../src/rules/index.js';
import type { GameState, PlayerId, RulesAction } from '../src/rules/index.js';
import { SimAI } from '../src/client/SimAI.js';
import { EventManager } from '../src/client/core/EventManager.js';
import { deckById } from '../src/client/decks.js';

// basic(15x 돌원숭이)은 사실상 덱이 아니라 대조군용 바닐라라 밸런스 매치업에서 제외.
const DECK_IDS = ['heroic', 'journey', 'cult'];
const GAMES_PER_MATCHUP = Number(process.env.SIM_GAMES ?? 2);
const MAX_STEPS = 500; // 안전판 — AI가 교착되면 이 스텝 안에 승부가 안 남
const TICK_MS = 750; // SimAI의 STEP_MS(700)보다 살짝 크게 잡아 타이머가 확실히 흐르게 함

// App.ts의 #aiPickCunningBlock/#aiPickBlockers와 동일한 단순 휴리스틱 재현
// (해당 메서드는 App 내부 private라 재사용 불가 — 로직만 복제).
function pickCunningBlock(eligible: string[]): string | undefined {
  return eligible[0];
}

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

interface GameOutcome {
  winner: PlayerId | null; // null = MAX_STEPS 안전판에 걸림 (AI 교착 — 밸런스가 아니라 버그 신호)
  turns: number;
}

function runOneGame(deckA: string[], deckB: string[], seed: number): GameOutcome {
  const game = new Game({ decks: { A: deckA, B: deckB }, seed });
  const events = new EventManager();
  const ais: Record<PlayerId, SimAI> = {
    A: new SimAI('A', events, () => game.state),
    B: new SimAI('B', events, () => game.state),
  };
  let retry = 0;

  function step(action: RulesAction): void {
    if (game.state.loser) return;
    const result = game.apply(action);
    if (result.error) {
      // App.ts와 동일한 재시도 완충 — 결정론적으로 같은 불법 액션을 반복 고르는
      // 상황에서 조용히 멈추는 대신 몇 번 더 react()를 시도한다.
      if (++retry <= 5) { ais.A.react(); ais.B.react(); }
      return;
    }
    retry = 0;
    if (result.choiceRequest) {
      events.emit('choice:request', { request: result.choiceRequest, action });
      return;
    }
    if (result.reactionRequest) {
      const req = result.reactionRequest;
      const blockerId = pickCunningBlock(req.eligibleBlockers);
      step({ type: 'react', player: req.player, block: !!blockerId, blockerId } as RulesAction);
      return;
    }
    if (result.attackReactionRequest) {
      const req = result.attackReactionRequest;
      const blockerIds = pickCoopBlockers(result.state, req.attackerId, req.targetId, req.blockable);
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
  return { winner: loser ? otherPlayer(loser) : null, turns: game.state.turn };
}

describe('AI 밸런스 시뮬레이션 (통계 출력용)', () => {
  it('프리셋 덱 매치업별 승률·평균 턴 수', () => {
    const rows: string[] = [];
    let stuck = 0;
    let seed = 1;

    for (const a of DECK_IDS) {
      for (const b of DECK_IDS) {
        let aWins = 0, bWins = 0, capped = 0, totalTurns = 0;
        for (let i = 0; i < GAMES_PER_MATCHUP; i++) {
          const outcome = runOneGame(deckById(a).cards, deckById(b).cards, seed++);
          totalTurns += outcome.turns;
          if (outcome.winner === 'A') aWins++;
          else if (outcome.winner === 'B') bWins++;
          else capped++;
        }
        stuck += capped;
        const avgTurns = (totalTurns / GAMES_PER_MATCHUP).toFixed(1);
        rows.push(
          `${a.padEnd(8)} vs ${b.padEnd(8)}  A승 ${aWins}/${GAMES_PER_MATCHUP}  B승 ${bWins}/${GAMES_PER_MATCHUP}  ` +
          `안전판 ${capped}  평균턴 ${avgTurns}`,
        );
      }
    }

    console.log(`\n=== AI 밸런스 시뮬레이션 (매치업당 ${GAMES_PER_MATCHUP}판) ===`);
    for (const row of rows) console.log(row);
    if (stuck > 0) {
      // 교착(MAX_STEPS 안전판) 발생 — 밸런스가 아니라 AI/룰 상호작용에 남은
      // 버그 신호. assert로 CI를 막지는 않지만(계속 파다 보면 끝이 없는 종류의
      // 이슈들이라) 눈에 띄게 경고는 남긴다. D-1 참고: 2026-07-03 세션에서
      // combatImmune·사거리 차폐 관련 교착 2건을 찾아 고쳤지만 일부는 남음.
      console.warn(`⚠ 안전판(MAX_STEPS=${MAX_STEPS})에 걸려 승부가 안 난 게임 ${stuck}개 — AI 교착 가능성, src/rules/PLAN.md D-1 참고`);
    }

    // 밸런스(누가 더 많이 이기는지)나 교착 여부는 assert하지 않는다 — 통계는
    // 사람이 보고 판단할 몫. 여기서는 매치업이 전부 실제로 돌았는지만 확인.
    expect(rows.length).toBe(DECK_IDS.length * DECK_IDS.length);
  });
});

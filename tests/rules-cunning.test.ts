import { describe, expect, it } from 'vitest';
import { Game } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
}

function place(g: Game, player: PlayerId, cardId: string): string {
  return g.board.summon(player, cardId);
}

// Reach the main phase with empty fields, then set up a 지략 scenario:
//   A holds 혁명 (a wisdom-conditioned spell) and satisfies its 배경
//   (own 지혜 ≥ 15, no own 힘 ≥ 7). B may hold a 지략 unit.
function scenario(): { g: Game; aUnit: string; bUnit: string } {
  const g = new Game({ decks: { A: deck(), B: deck() } });
  act(g, { type: 'finishOpening', player: 'A' });
  act(g, { type: 'finishOpening', player: 'B' });
  const aUnit = place(g, 'A', 'stone-monkey'); // 힘2 지혜1
  g.board.modifyStat(aUnit, 'wisdom', 15);     // A 지혜 16 ≥ 15
  const bUnit = place(g, 'B', 'stone-monkey');
  g.state.hand.A.push('revolution');
  return { g, aUnit, bUnit };
}

describe('지략 (cunning)', () => {
  it('봉쇄 성공: 지략 ≥ N 미사용 유닛이 wisdom 배경 카드를 막는다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    const r = g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    expect(r.error).toBeTruthy();
    expect(g.state.hand.A).toContain('revolution');       // 카드 소모 안 됨
    expect(g.state.cunningUsedThisTurn).toContain(bUnit);  // 지략 1회 소진
    expect(g.state.lockedThisTurn.A).toContain('revolution');
    expect(g.state.playedThisTurn).toBe(false);
  });

  it('봉쇄 실패: 지략 < N 이면 그대로 발동된다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 14); // 15 미만
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    expect(g.state.hand.A).not.toContain('revolution');
    expect(g.state.cunningUsedThisTurn).not.toContain(bUnit);
    expect(g.state.playedThisTurn).toBe(true);
  });

  it('지략 1회 소진: 이미 쓴 유닛은 다시 봉쇄하지 못한다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    g.apply({ type: 'play', player: 'A', cardId: 'revolution' }); // 봉쇄, 소진
    // 같은 턴 잠금 해제 후(가정) 같은 유닛은 더는 막지 못함을 검증하기 위해
    // 잠금만 직접 풀고 재시도하면 발동되어야 한다.
    g.state.lockedThisTurn.A = [];
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    expect(g.state.hand.A).not.toContain('revolution');
  });

  it('카드 잠금: 봉쇄된 카드는 같은 턴 다시 낼 수 없다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    g.apply({ type: 'play', player: 'A', cardId: 'revolution' }); // 봉쇄
    const r = g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    expect(r.error).toBeTruthy();
    expect(g.state.cunningUsedThisTurn.length).toBe(1); // 두 번 소진되지 않음
  });

  it('턴 넘기면 해제: 잠금/소진이 초기화된다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    g.apply({ type: 'play', player: 'A', cardId: 'revolution' }); // 봉쇄
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.cunningUsedThisTurn).toEqual([]);
    expect(g.state.lockedThisTurn.A).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { Game } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';

function deck(): string[] {
  return Array.from({ length: 15 }, () => 'stone-monkey');
}

function act(g: Game, action: Parameters<Game['apply']>[0]): void {
  const r = g.apply(action);
  if (r.error) throw new Error(r.error);
  // 협공 가능한 (incidental) 수비 유닛이 있어도 이 헬퍼를 쓰는 테스트는 기본적으로
  // 단독 방어를 의도하므로 자동으로 opt-out 한다. 협공 자체를 테스트할 때는
  // g.apply()로 직접 attack을 선언하고 resolveAttack을 명시적으로 호출할 것.
  if (r.attackReactionRequest) {
    const r2 = g.apply({ type: 'resolveAttack', player: r.attackReactionRequest.player, blockerIds: [] });
    if (r2.error) throw new Error(r2.error);
  }
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

describe('지략 (cunning) — opt-in 반응', () => {
  it('반응 기회: 봉쇄 가능한 유닛이 있으면 카드 발동이 보류되고 반응 요청을 반환', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    const r = g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    expect(r.reactionRequest).toBeDefined();
    expect(r.reactionRequest!.player).toBe('B');
    expect(r.reactionRequest!.eligibleBlockers).toContain(bUnit);
    expect(g.state.pendingReaction).not.toBeNull();
    // 반응 대기 중에는 다른 액션 불가
    const blocked = g.apply({ type: 'pass', player: 'A' });
    expect(blocked.error).toMatch(/반응 대기/);
  });

  it('봉쇄 선택(block): 카드는 패에 남고 지략 소진 + 잠금', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    act(g, { type: 'react', player: 'B', block: true, blockerId: bUnit });
    expect(g.state.pendingReaction).toBeNull();
    expect(g.state.hand.A).toContain('revolution');        // 카드 소모 안 됨
    expect(g.state.cunningUsedThisTurn).toContain(bUnit);   // 지략 1회 소진
    expect(g.state.lockedThisTurn.A['revolution']).toBeGreaterThan(0);
  });

  it('통과 선택(block:false): 카드가 정상 발동된다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    act(g, { type: 'react', player: 'B', block: false });
    expect(g.state.pendingReaction).toBeNull();
    expect(g.state.hand.A).not.toContain('revolution');     // 발동되어 소모됨
    expect(g.state.cunningUsedThisTurn).not.toContain(bUnit); // 지략 소진 안 됨
  });

  it('봉쇄 불가: 지략 < N 이면 반응 없이 즉시 발동', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 14); // 15 미만 → eligible 아님
    const r = g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    expect(r.reactionRequest).toBeUndefined();
    expect(g.state.hand.A).not.toContain('revolution');
  });

  it('지략 1회 소진: 봉쇄에 쓴 유닛은 같은 턴 다시 eligible 아님', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    act(g, { type: 'react', player: 'B', block: true, blockerId: bUnit });
    g.state.lockedThisTurn.A = {}; // 잠금만 직접 해제 후 재시도
    const r = g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    expect(r.reactionRequest).toBeUndefined(); // 더는 봉쇄 불가 → 즉시 발동
    expect(g.state.hand.A).not.toContain('revolution');
  });

  it('턴 넘기면 해제: 잠금/소진이 초기화된다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    act(g, { type: 'react', player: 'B', block: true, blockerId: bUnit });
    act(g, { type: 'pass', player: 'A' });
    expect(g.state.cunningUsedThisTurn).toEqual([]);
    expect(g.state.lockedThisTurn.A).toEqual({});
  });
});

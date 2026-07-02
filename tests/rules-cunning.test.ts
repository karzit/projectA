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
//   A holds 혁명 (a wisdom-conditioned, 비-개입 spell) and satisfies its 배경
//   (own 지혜 ≥ 15, no own 힘 ≥ 7). B may hold a 지략 unit.
function scenario(copies = 1): { g: Game; aUnit: string; bUnit: string } {
  const g = new Game({ decks: { A: deck(), B: deck() } });
  act(g, { type: 'finishOpening', player: 'A' });
  act(g, { type: 'finishOpening', player: 'B' });
  const aUnit = place(g, 'A', 'stone-monkey'); // 힘2 지혜1
  g.board.modifyStat(aUnit, 'wisdom', 15);     // A 지혜 16 ≥ 15
  const bUnit = place(g, 'B', 'stone-monkey');
  for (let i = 0; i < copies; i++) g.state.hand.A.push('revolution');
  return { g, aUnit, bUnit };
}

// 지략 opt-in의 반응 시점은 "카드를 낼 때"가 아니라 "카드 효과가 처리될 때"(= 카드가
// 공개되는 시점)이다. 혁명은 `개입` 키워드가 없는 일반 카드이므로 처리 시점은 pass 시
// 큐(pendingPlays)가 드레인되는 순간이다 — play 시점엔 반응이 발생하지 않는다.
describe('지략 (cunning) — opt-in 반응 (처리 시점 = 카드 공개 시)', () => {
  it('play 시점엔 반응이 없다 — 카드는 손패를 떠나 큐에 쌓인다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    const rPlay = g.apply({ type: 'play', player: 'A', cardId: 'revolution' });
    expect(rPlay.reactionRequest).toBeUndefined();
    expect(g.state.hand.A).not.toContain('revolution'); // 이미 큐에 들어감
    expect(g.state.pendingPlays.some((p) => p.cardId === 'revolution')).toBe(true);
  });

  it('pass(처리 시점)에 봉쇄 가능한 유닛이 있으면 반응 요청이 뜨고, 그동안 다른 액션은 불가', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    const r = g.apply({ type: 'pass', player: 'A' });
    expect(r.reactionRequest).toBeDefined();
    expect(r.reactionRequest!.player).toBe('B');
    expect(r.reactionRequest!.eligibleBlockers).toContain(bUnit);
    expect(g.state.pendingReaction).not.toBeNull();
    const blocked = g.apply({ type: 'pass', player: 'A' });
    expect(blocked.error).toMatch(/반응 대기/);
  });

  it('봉쇄 선택(block): 효과가 무산되고 카드는 손패로 돌아와 이번 턴 잠긴다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'react', player: 'B', block: true, blockerId: bUnit });
    expect(g.state.pendingReaction).toBeNull();
    expect(g.state.hand.A).toContain('revolution');       // 무산되어 패로 복귀
    // 이 반응이 큐의 마지막 항목이었으므로 턴이 곧바로 마무리되고(active: B로 전환),
    // 잠금/지략 소진도 그 시점에 함께 초기화된다 — "1회 소진" 테스트는 아래 별도 케이스 참고.
    expect(g.state.active).toBe('B');
    expect(g.state.lockedThisTurn.A).toEqual({});
  });

  it('통과 선택(block:false): 카드 효과가 정상 발동되고 큐가 계속 처리된다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 15);
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    act(g, { type: 'pass', player: 'A' });
    act(g, { type: 'react', player: 'B', block: false });
    expect(g.state.pendingReaction).toBeNull();
    expect(g.state.hand.A).not.toContain('revolution');       // 발동되어 소모됨
    expect(g.state.pendingPlays).toEqual([]);
    expect(g.state.active).toBe('B');
  });

  it('봉쇄 불가: 지략 < N 이면 pass 시 반응 없이 바로 발동되고 턴이 끝난다', () => {
    const { g, bUnit } = scenario();
    g.board.grantCunning(bUnit, 14); // 15 미만 → eligible 아님
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    const r = g.apply({ type: 'pass', player: 'A' });
    expect(r.reactionRequest).toBeUndefined();
    expect(g.state.hand.A).not.toContain('revolution');
    expect(g.state.active).toBe('B');
  });

  it('지략 1회 소진: 같은 pass 안에서 봉쇄에 쓴 유닛은 다음 카드에 다시 쓰일 수 없다', () => {
    const { g, bUnit } = scenario(2); // 혁명 2장
    g.board.grantCunning(bUnit, 15);
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    act(g, { type: 'play', player: 'A', cardId: 'revolution' });
    const r1 = g.apply({ type: 'pass', player: 'A' });
    expect(r1.reactionRequest).toBeDefined(); // 첫 번째 카드 처리 시 반응
    act(g, { type: 'react', player: 'B', block: true, blockerId: bUnit });
    // bUnit은 이미 이번 턴 지략을 소진했다 — 큐의 두 번째 카드는 봉쇄 불가, 바로 발동되며
    // 드레인이 끝까지 진행되어(더 이상 반응 없음) 턴이 마무리된다.
    expect(g.state.pendingReaction).toBeNull();
    expect(g.state.active).toBe('B');
  });

  it('개입 카드도 손패를 떠난 뒤(=효과 처리 시점) 반응하며, 봉쇄되면 손패로 돌아온다', () => {
    const g = new Game({ decks: { A: deck(), B: deck() } });
    act(g, { type: 'finishOpening', player: 'A' });
    act(g, { type: 'finishOpening', player: 'B' });
    const aUnit = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(aUnit, 'wisdom', 4); // 기본 체력물약 배경: 지혜 4
    const bUnit = place(g, 'B', 'stone-monkey');
    g.board.grantCunning(bUnit, 4);
    g.state.hand.A.push('health-potion');
    const r = g.apply({ type: 'play', player: 'A', cardId: 'health-potion' });
    expect(r.reactionRequest).toBeDefined(); // 개입 카드 = 처리 시점이 곧 play 시점(같은 호출 안)
    // 상대가 무엇을 냈는지 모르는 채로 막을 수는 없다 — 카드는 이미 손패를 떠나
    // "공개"된 상태에서 반응이 일어난다(일반 카드가 큐에서 처리될 때와 동일한 지점).
    expect(g.state.hand.A).not.toContain('health-potion');
    act(g, { type: 'react', player: 'B', block: true, blockerId: bUnit });
    expect(g.state.hand.A).toContain('health-potion'); // 무산되어 손패로 복귀
    expect(g.state.lockedThisTurn.A['health-potion']).toBeGreaterThan(0);
  });
});

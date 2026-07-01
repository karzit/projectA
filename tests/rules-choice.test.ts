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

function toMain(): Game {
  const g = new Game({ decks: { A: deck(), B: deck() } });
  act(g, { type: 'finishOpening', player: 'A' });
  act(g, { type: 'finishOpening', player: 'B' });
  return g;
}

// 3 동일 배신자(5/5) → 지혜 합 15 충족 + 누구도 단일 최강이 아님(배신 미발동).
function revolutionReady(g: Game): string[] {
  return [place(g, 'A', 'traitor'), place(g, 'A', 'traitor'), place(g, 'A', 'traitor')];
}

describe('B-3 choice request/response — 기본 체력물약 (정확히 1 타겟)', () => {
  it('choices 없이 내면 choiceRequest 반환 + 상태 롤백', () => {
    const g = toMain();
    const unit = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(unit, 'wisdom', 3); // 지혜 4 → 배경:지혜 4 충족
    g.state.hand.A.push('health-potion');
    const r = g.apply({ type: 'play', player: 'A', cardId: 'health-potion' });
    expect(r.error).toBeUndefined();
    expect(r.choiceRequest).toBeDefined();
    expect(r.choiceRequest!.from).toEqual([unit]);
    expect(r.choiceRequest!.min).toBe(1);
    expect(r.choiceRequest!.max).toBe(1);
    expect(r.choiceRequest!.player).toBe('A');
    // 롤백: 카드 그대로, 버프 없음
    expect(g.state.hand.A).toContain('health-potion');
    expect(g.state.units[unit].power).toBe(2);
  });

  it('응답으로 같은 액션에 choices를 채우면 발동', () => {
    const g = toMain();
    const unit = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(unit, 'wisdom', 3); // 지혜 4 → 배경:지혜 4 충족
    g.state.hand.A.push('health-potion');
    g.apply({ type: 'play', player: 'A', cardId: 'health-potion' }); // 요청
    act(g, { type: 'play', player: 'A', cardId: 'health-potion', choices: [unit] });
    expect(g.state.units[unit].power).toBe(4);
    expect(g.state.hand.A).not.toContain('health-potion');
  });

  it('불법 타겟(상대 유닛)은 거부되고 다시 요청된다', () => {
    const g = toMain();
    const own = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(own, 'wisdom', 3); // 지혜 4 → 배경:지혜 4 충족
    const enemy = place(g, 'B', 'stone-monkey');
    g.state.hand.A.push('health-potion');
    const r = g.apply({ type: 'play', player: 'A', cardId: 'health-potion', choices: [enemy] });
    expect(r.choiceRequest).toBeDefined();
    expect(r.choiceRequest!.from).toEqual([own]);
    expect(g.state.units[own].power).toBe(2);   // 효과 없음
    expect(g.state.units[enemy].power).toBe(2);
    expect(g.state.hand.A).toContain('health-potion');
  });
});

describe('B-3 up-to-N — 혁명 (적 유닛 수만큼 교환, 선택적)', () => {
  it('0개 선택(min 0)은 요청 없이 그대로 발동 (교환 안 함)', () => {
    const g = toMain();
    revolutionReady(g);
    place(g, 'B', 'stone-monkey');
    g.state.hand.A.push('revolution');
    const r = g.apply({ type: 'play', player: 'A', cardId: 'revolution', choices: [] });
    expect(r.error).toBeUndefined();
    expect(r.choiceRequest).toBeUndefined();
    expect(g.state.hand.A).not.toContain('revolution');
  });

  it('짝지은 유닛 스탯을 교환한다', () => {
    const g = toMain();
    const [t0] = revolutionReady(g);
    const low = place(g, 'A', 'stone-monkey'); // 2/1
    g.board.modifyStat(low, 'wisdom', 0);
    place(g, 'B', 'stone-monkey');
    g.state.hand.A.push('revolution');
    act(g, { type: 'play', player: 'A', cardId: 'revolution', choices: [t0, low] });
    act(g, { type: 'pass', player: 'A' }); // 효과는 턴 종료 시 처리
    expect([g.state.units[t0].power, g.state.units[t0].wisdom]).toEqual([2, 1]);
    expect([g.state.units[low].power, g.state.units[low].wisdom]).toEqual([5, 5]);
  });

  it('max(=적 유닛 수 × 2)를 초과한 선택은 잘린다', () => {
    const g = toMain();
    const [t0, t1, t2] = revolutionReady(g);
    g.board.modifyStat(t0, 'power', -2); // t0 = 3/5 (단일 최강 방지 + 관찰용)
    place(g, 'B', 'stone-monkey'); // 적 1마리 → 최대 1쌍(=2개)
    g.state.hand.A.push('revolution');
    // 3개 공급하지만 앞의 2개(t0,t1)만 소비되어 1쌍 교환, t2는 그대로
    act(g, { type: 'play', player: 'A', cardId: 'revolution', choices: [t0, t1, t2] });
    act(g, { type: 'pass', player: 'A' }); // 효과는 턴 종료 시 처리
    expect(g.state.units[t0].power).toBe(5); // t1(5)과 교환됨
    expect(g.state.units[t1].power).toBe(3); // t0(3)과 교환됨
    expect(g.state.units[t2].power).toBe(5); // 미소비 → 변화 없음
  });
});

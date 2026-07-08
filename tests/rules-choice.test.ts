import { describe, expect, it } from 'vitest';
import { Game, CARD_REGISTRY } from '../src/rules/index.js';
import type { PlayerId } from '../src/rules/index.js';
import type { GameContext } from '../src/rules/GameContext.js';

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

describe('선택(choice)은 낸 시점이 아니라 공개(큐 처리) 시점에 확정된다', () => {
  // '내 오랜 친구여'는 조건 없이 항상 choices.request를 호출하는 일반(큐잉) 카드라
  // 이 계약을 직접 검증하기 좋다: 낼 때는 대상이 하나도 없어도(choices=[]) 거부되지
  // 않고 큐에 실리며, 같은 턴에 나중에 낸 유닛도 공개 시점엔 유효한 후보가 된다.
  it('낼 때 대상이 없어도 거부되지 않고, 같은 턴에 나중에 낸 유닛도 공개 시점 후보가 된다', () => {
    const g = toMain();
    const wise = place(g, 'A', 'stone-monkey');
    g.board.modifyStat(wise, 'wisdom', 29); // 지혜 30 → 배경 충족(대상 후보는 아직 아님)
    g.state.hand.A.push('old-friend', 'stone-monkey');

    const played = g.apply({ type: 'play', player: 'A', cardId: 'old-friend', choices: [] });
    expect(played.error).toBeUndefined();
    expect(played.choiceRequest).toBeUndefined(); // 낸 시점엔 검증하지 않음 — 그냥 큐에 실림
    expect(g.state.hand.A).not.toContain('old-friend');

    // old-friend보다 나중에, 같은 턴에 새 유닛을 낸다 — 소환 자체는 즉시 이뤄지지만
    // (D-2) 이 유닛의 onPlay는 아직 공개(큐 처리) 전이다. old-friend가 이 유닛을
    // 대상으로 잡을 수 있는지가 이 테스트의 핵심.
    const laterPlayed = g.apply({ type: 'play', player: 'A', cardId: 'stone-monkey', cell: 1 });
    expect(laterPlayed.error).toBeUndefined();
    const laterUnit = g.state.field.A[1]!;

    const r = g.apply({ type: 'pass', player: 'A' });
    expect(r.choiceRequest).toBeDefined(); // 공개 시점에 비로소 선택을 요구
    expect(r.choiceRequest!.from).toContain(laterUnit); // 나중에 낸 유닛도 후보

    const r2 = g.apply({ type: 'resolveChoice', player: 'A', choices: [laterUnit] });
    expect(r2.error).toBeUndefined();
    expect(r2.choiceRequest).toBeUndefined();
  });

  // 후보 자체가 min보다 적어(=누가 골라도 채울 수 없음) 정말 불가능한 경우:
  // 물어보지(pendingChoice) 않고 그 선택만 조용히 불발시킨 채 카드는 정상적으로
  // "낸 것"으로 처리되고 드레인이 계속 진행돼야 한다 — 채울 수 없는 요청으로
  // 게임 전체가 멈추면 안 된다. 선택 이전에 이미 일어난 효과(자체 버프 등)는
  // 그대로 커밋돼야 한다는 것까지 함께 검증하기 위해 테스트 전용 카드를 쓴다.
  it('선택 후보가 정말 부족하면 그 선택만 불발되고, 이전에 일어난 효과는 커밋된 채 드레인이 계속된다', () => {
    const selfBuffThenImpossibleAsk = {
      meta: { id: 'test-self-buff-then-ask', name: '테스트: 자체효과 후 불가능한 선택', kind: 'spell' as const },
      get id() { return this.meta.id; },
      get name() { return this.meta.name; },
      get kind() { return this.meta.kind; },
      subscribe() {},
      onPlay(ctx: GameContext) {
        // 선택과 무관한 효과 — 요청이 불발되더라도 이건 커밋돼야 한다(카드가 낸
        // 것 자체는 정상 처리됨을 검증하는 부분).
        ctx.board.summonCard(ctx.controller, 'stone-monkey');
        // 적 유닛 1마리를 요구하지만, 이 테스트에선 상대 필드가 완전히 비어 있어
        // 후보가 0개 — 누가 골라도 채울 수 없는, 정말 불가능한 요청이다.
        const enemies = ctx.board.unitsOn(ctx.board.otherPlayer(ctx.controller)).map((u) => u.instanceId);
        ctx.choices.request({ from: enemies, min: 1, max: 1, prompt: '적 1마리' });
      },
    };
    (CARD_REGISTRY as unknown as { map: Map<string, unknown> }).map.set(
      selfBuffThenImpossibleAsk.meta.id,
      selfBuffThenImpossibleAsk,
    );

    const g = toMain();
    // 조건 없는 테스트 카드라 아군이 없어도 낼 수 있다 — 이번 필드는 완전히 빈
    // 상태(아군 0마리)로 시작해, 요청이 "정말 불가능"한 상태를 만든다.
    g.state.hand.A.push(selfBuffThenImpossibleAsk.meta.id, 'stone-monkey');

    const played = g.apply({ type: 'play', player: 'A', cardId: selfBuffThenImpossibleAsk.meta.id, choices: [] });
    expect(played.error).toBeUndefined();

    // 이 테스트 카드보다 나중에 다른 카드도 하나 큐에 실어, 드레인이 실제로
    // 계속 진행되는지(막히지 않는지)까지 확인한다.
    const laterPlayed = g.apply({ type: 'play', player: 'A', cardId: 'stone-monkey', cell: 0 });
    expect(laterPlayed.error).toBeUndefined();

    const r = g.apply({ type: 'pass', player: 'A' });
    expect(r.error).toBeUndefined();
    expect(r.choiceRequest).toBeUndefined(); // 물어보지 않는다 — 정말 불가능하므로
    expect(g.state.pendingChoice).toBeNull();
    expect(g.state.pendingPlays).toHaveLength(0); // 큐가 끝까지 비워짐 — 막히지 않음
    // 선택과 무관한 효과(테스트 카드의 자체 소환)는 요청이 불발됐어도 커밋됐다 +
    // 나중에 낸 stone-monkey도 정상 처리됐다 — 필드에 stone-monkey가 2마리(테스트
    // 카드가 만든 것 + 직접 낸 것) 있어야 둘 다 확인된다.
    const monkeys = g.state.field.A.filter((id) => id && g.state.units[id]?.cardId === 'stone-monkey');
    expect(monkeys).toHaveLength(2);
  });
});
